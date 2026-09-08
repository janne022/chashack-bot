/**
 * Team join requests and owner invites. One table, `kind` discriminates:
 *  - kind='join_request': user → team owner ("let me in")
 *  - kind='invite':       team owner → user ("join us")
 *
 * Decision rules (enforced here, presented in Discord):
 *  - Accepting an invite/request requires an active signup and free capacity.
 *  - Anyone already in a team (or with a pending request to the same team)
 *    cannot create or accept another one.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { countMembers, getTeam, getTeamForUser, type Team } from './service.js';

export type RequestKind = 'join_request' | 'invite';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TeamRequest {
  id: number;
  eventId: string;
  guildId: string;
  teamId: string;
  requesterId: string;
  targetId: string;
  kind: RequestKind;
  status: RequestStatus;
  createdAt: number;
  decidedAt: number | null;
}

interface RequestRow {
  id: number;
  event_id: string | null;
  guild_id: string;
  team_id: string;
  requester_id: string;
  target_id: string;
  kind: string;
  status: string;
  created_at: number;
  decided_at: number | null;
}

function toRequest(row: RequestRow): TeamRequest {
  return {
    id: row.id,
    eventId: row.event_id ?? '',
    guildId: row.guild_id,
    teamId: row.team_id,
    requesterId: row.requester_id,
    targetId: row.target_id,
    kind: row.kind as RequestKind,
    status: row.status as RequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function actorMatches(actor: string, userId: string): boolean {
  return actor === `discord:${userId}` || actor === `web:${userId}`;
}

function insert(
  db: Db,
  eventId: string,
  guildId: string,
  teamId: string,
  requesterId: string,
  targetId: string,
  kind: RequestKind,
): Result<TeamRequest> {
  db.prepare(
    `INSERT INTO team_requests (event_id, guild_id, team_id, requester_id, target_id, kind, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(eventId, guildId, teamId, requesterId, targetId, kind, Date.now());
  const row = db
    .prepare('SELECT * FROM team_requests WHERE id = last_insert_rowid()')
    .get() as unknown as RequestRow;
  return ok(toRequest(row));
}

/** User asks to join a team → pending request aimed at the team owner. */
export function createJoinRequest(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  userId: string,
  teamId: string,
  teamSize: number,
): Result<TeamRequest> {
  const team = getTeam(db, teamId);
  if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
  if (team.kind === 'matched') return err('not_joinable', 'Matched teams cannot be requested.');

  const participant = db
    .prepare('SELECT status FROM participants WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId) as { status: string } | undefined;
  if (participant === undefined) return err('no_signup', 'Sign up first with /hackathon join.');
  if (participant.status !== 'active') return err('not_active', 'Your signup is not active.');

  if (getTeamForUser(db, eventId, userId) !== null) {
    return err('already_in_team', 'You are already in a team. Leave it first.');
  }
  const pending = listRequestsForUser(db, eventId, userId, 'pending');
  if (pending.outgoing.some((r) => r.teamId === teamId && r.kind === 'join_request')) {
    return err('already_requested', 'You already have a pending request to that team.');
  }
  if (countMembers(db, teamId) >= teamSize) return err('team_full', 'That team is already full.');

  const res = insert(db, eventId, guildId, teamId, userId, team.ownerId ?? userId, 'join_request');
  if (res.ok) audit(db, actor, 'request.create', eventId, { teamId, userId, kind: 'join_request' });
  return res;
}

/** Team owner (or admin) invites a user → pending invite aimed at the user. */
export function createInvite(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  teamId: string,
  targetId: string,
  teamSize: number,
): Result<TeamRequest> {
  const team = getTeam(db, teamId);
  if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
  if (team.kind === 'matched') return err('not_joinable', 'Matched teams cannot invite.');

  const participant = db
    .prepare('SELECT status FROM participants WHERE event_id = ? AND user_id = ?')
    .get(eventId, targetId) as { status: string } | undefined;
  if (participant === undefined) return err('no_signup', 'They have not signed up to this event yet.');
  if (participant.status !== 'active') return err('not_active', 'Their signup is not active.');

  if (getTeamForUser(db, eventId, targetId) !== null) {
    return err('already_in_team', 'They are already on a team.');
  }
  if (countMembers(db, teamId) >= teamSize) return err('team_full', 'Your team is already full.');
  if (listRequestsForUser(db, eventId, targetId, 'pending').incoming.some((r) => r.teamId === teamId && r.kind === 'invite')) {
    return err('already_requested', 'They already have a pending invite to that team.');
  }

  const res = insert(db, eventId, guildId, teamId, actor, targetId, 'invite');
  if (res.ok) audit(db, actor, 'request.create', eventId, { teamId, targetId, kind: 'invite' });
  return res;
}

/** Invitee or owner makes the decision. */
export function decideRequest(
  db: Db,
  actor: string,
  requestId: number,
  decision: 'accept' | 'decline',
  teamSize: number,
): Result<{ request: TeamRequest; team: Team; joinerId: string }> {
  const row = db.prepare('SELECT * FROM team_requests WHERE id = ?').get(requestId) as unknown as
    | RequestRow
    | undefined;
  if (row === undefined) return err('not_found', 'That request no longer exists.');
  const request = toRequest(row);
  if (request.status !== 'pending') return err('already_decided', 'That request was already handled.');

  const team = getTeam(db, request.teamId);
  if (team === null) return err('not_found', 'The team no longer exists.');

  // Who must authorize? invites: the target. join requests: the owner (target side).
  if (!actorMatches(actor, request.targetId)) {
    return err('not_your_decision', 'This request is not yours to decide.');
  }

  if (decision === 'decline') {
    db.prepare("UPDATE team_requests SET status = 'declined', decided_at = ? WHERE id = ?").run(
      Date.now(),
      requestId,
    );
    audit(db, actor, 'request.decline', request.eventId, { requestId, teamId: team.id, kind: request.kind });
    const joinerId = request.kind === 'invite' ? request.targetId : request.requesterId;
    return ok({ request: { ...request, status: 'declined' }, team, joinerId });
  }

  // Accept: re-check the moving parts.
  const joinerId = request.kind === 'invite' ? request.targetId : request.requesterId;
  const participant = db
    .prepare('SELECT status FROM participants WHERE event_id = ? AND user_id = ?')
    .get(request.eventId, joinerId) as { status: string } | undefined;
  if (participant === undefined || participant.status !== 'active') {
    return err('not_active', 'Signup is no longer active.');
  }
  if (getTeamForUser(db, request.eventId, joinerId) !== null) {
    return err('already_in_team', 'They are already on a team.');
  }
  if (countMembers(db, team.id) >= teamSize) {
    return err('team_full', `Team is full (${teamSize}/${teamSize}).`);
  }

  db.prepare("UPDATE team_requests SET status = 'accepted', decided_at = ? WHERE id = ?").run(
    Date.now(),
    requestId,
  );
  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    team.id,
    Date.now(),
    request.eventId,
    joinerId,
  );
  audit(db, actor, 'request.accept', request.eventId, { requestId, teamId: team.id, joinerId, kind: request.kind });
  return ok({ request: { ...request, status: 'accepted' }, team, joinerId });
}

/** Cancel by the side that created it (user cancels their request, owner cancels an invite). */
export function cancelRequest(db: Db, actor: string, requestId: number): Result<TeamRequest> {
  const row = db.prepare('SELECT * FROM team_requests WHERE id = ?').get(requestId) as unknown as
    | RequestRow
    | undefined;
  if (row === undefined) return err('not_found', 'That request no longer exists.');
  const request = toRequest(row);
  if (request.status !== 'pending') return err('already_decided', 'That request was already handled.');

  if (!actorMatches(actor, request.requesterId)) return err('not_your_decision', 'Only the sender can cancel this.');
  db.prepare("UPDATE team_requests SET status = 'cancelled', decided_at = ? WHERE id = ?").run(
    Date.now(),
    requestId,
  );
  audit(db, actor, 'request.cancel', request.eventId, { requestId, teamId: request.teamId });
  return ok({ ...request, status: 'cancelled' });
}

/** Everything touching a user: incoming (to decide) and outgoing (sent). */
export function listRequestsForUser(
  db: Db,
  eventId: string,
  userId: string,
  status?: RequestStatus,
): { incoming: TeamRequest[]; outgoing: TeamRequest[] } {
  const base =
    status === undefined
      ? db
          .prepare(
            'SELECT * FROM team_requests WHERE event_id = ? AND (target_id = ? OR requester_id = ?) ORDER BY created_at DESC',
          )
          .all(eventId, userId, userId)
      : db
          .prepare(
            'SELECT * FROM team_requests WHERE event_id = ? AND status = ? AND (target_id = ? OR requester_id = ?) ORDER BY created_at DESC',
          )
          .all(eventId, status, userId, userId);
  const rows = (base as unknown as RequestRow[]).map(toRequest);

  return {
    // invites aimed at me + join requests aimed at me (I own that team)
    incoming: rows.filter((r) => r.targetId === userId),
    // requests/invites I sent
    outgoing: rows.filter((r) => r.requesterId === userId),
  };
}

/** Pending requests for a team (owner inbox). */
export function listPendingForTeam(db: Db, teamId: string): TeamRequest[] {
  return (
    db
      .prepare("SELECT * FROM team_requests WHERE team_id = ? AND status = 'pending' ORDER BY created_at")
      .all(teamId) as unknown as RequestRow[]
  ).map(toRequest);
}

/** Expire stale pending requests (7 days) — call opportunistically. */
export function expireStale(db: Db): void {
  db.prepare(
    "UPDATE team_requests SET status = 'cancelled', decided_at = ? WHERE status = 'pending' AND created_at < ?",
  ).run(Date.now(), Date.now() - 7 * 24 * 3600 * 1000);
}
