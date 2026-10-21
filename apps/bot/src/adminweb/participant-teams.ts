import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebDeps } from './routes.js';
import type { WebSession } from '../features/auth/data.js';
import type { HackathonEvent } from '../features/events/data.js';
import { getEventForm } from '../features/events/data.js';
import { getForm } from '../features/form/data.js';
import { eligibleParticipant } from '../features/signup/eligibility.js';
import { createTeam, getTeam, getTeamForUser, getGuildSettings, joinTeam, leaveTeam, listTeams, type Team } from '../features/teams/data.js';
import { createInvite, decideRequest, listRequestsForUser } from '../features/teams/requests-data.js';
import { destroyTeamSpace, grantTeamRole, provisionTeamSpace, revokeTeamRole } from '../discord/provision.js';
import { refreshTeamPanel } from '../discord/team-panel.js';

export function registerParticipantTeamRoutes(app: FastifyInstance, deps: WebDeps,
  sessionFrom: (req: FastifyRequest) => Promise<WebSession | null>,
  eventFor: (eventId: string, userId: string) => Promise<HackathonEvent | null>): void {
  const { db } = deps;
  const context = async (req: FastifyRequest) => {
    const session = await sessionFrom(req);
    if (session === null) return null;
    const event = await eventFor((req.params as { eventId: string }).eventId, session.userId);
    if (event === null || await eligibleParticipant(db, event.id, session.userId) === null) return null;
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    return { event, userId: session.userId, actor: `web:${session.userId}`, size: form.teamSize };
  };
  const summary = (team: Team & { members?: unknown[] }) => ({ id: team.id, name: team.name, kind: team.kind, ownerId: team.ownerId, memberCount: team.members?.length ?? 0 });
  const provision = async (team: Team, userId: string, create = false) => {
    if (deps.client === null || deps.config.skipDiscord) return;
    const category = (await getGuildSettings(db, team.guildId)).teamCategoryId ?? deps.config.teamCategoryId;
    const pd = { db, client: deps.client, categoryIdFor: () => category };
    const ready = create ? await provisionTeamSpace(pd, team) : team;
    await grantTeamRole(pd, ready, userId);
    await refreshTeamPanel(pd, ready);
  };
  const base = '/api/participant/events/:eventId';
  app.get(`${base}/teams`, async (req, reply) => {
    const ctx = await context(req);
    if (ctx === null) return reply.code(404).send({ error: 'ineligible' });
    const teams = await listTeams(db, ctx.event.id);
    const own = teams.find((team) => team.members.some((member) => member.userId === ctx.userId));
    return { teams: teams.filter((team) => team.kind === 'public' && team.members.length < ctx.size).map(summary),
      ownTeam: own ? { ...summary(own), members: own.members.map(({ userId, displayName }) => ({ userId, displayName })), ...(own.ownerId === ctx.userId ? { joinCode: own.joinCode } : {}) } : null,
      invitations: (await listRequestsForUser(db, ctx.event.id, ctx.userId, 'pending')).incoming };
  });
  app.post(`${base}/teams`, async (req, reply) => {
    const ctx = await context(req);
    if (ctx === null) return reply.code(404).send({ error: 'ineligible' });
    const body = req.body as { name?: unknown; kind?: unknown } | null;
    if (typeof body?.name !== 'string' || !['public', 'private'].includes(String(body?.kind))) return reply.code(400).send({ error: 'invalid_team' });
    const res = await createTeam(db, ctx.actor, ctx.event.id, ctx.event.guildId, body.name, body.kind as 'public' | 'private', ctx.userId);
    if (!res.ok) return reply.code(409).send({ error: res.code });
    await provision(res.value, ctx.userId, true);
    return { team: summary(res.value) };
  });
  app.post(`${base}/teams/:teamId/join`, async (req, reply) => {
    const ctx = await context(req);
    if (ctx === null) return reply.code(404).send({ error: 'ineligible' });
    const res = await joinTeam(db, ctx.actor, ctx.event.id, ctx.userId, (req.params as { teamId: string }).teamId, ctx.size);
    if (!res.ok) return reply.code(409).send({ error: res.code });
    await provision(res.value, ctx.userId);
    return { team: summary(res.value) };
  });
  app.post(`${base}/teams/:teamId/invites`, async (req, reply) => {
    const ctx = await context(req);
    if (ctx === null) return reply.code(404).send({ error: 'ineligible' });
    const targetId = (req.body as { targetId?: unknown } | null)?.targetId;
    if (typeof targetId !== 'string' || targetId.length > 25 || targetId.length === 0) return reply.code(400).send({ error: 'invalid_target' });
    const res = await createInvite(db, ctx.actor, ctx.event.id, ctx.event.guildId, (req.params as { teamId: string }).teamId, targetId, ctx.size);
    if (!res.ok) return reply.code(409).send({ error: res.code });
    const team = await getTeam(db, (req.params as { teamId: string }).teamId);
    if (team && deps.client && !deps.config.skipDiscord) await refreshTeamPanel({ db, client: deps.client, categoryIdFor: () => undefined }, team);
    return { request: res.value };
  });
  app.post(`${base}/invitations/:requestId/respond`, async (req, reply) => {
    const ctx = await context(req);
    if (ctx === null) return reply.code(404).send({ error: 'ineligible' });
    const id = Number((req.params as { requestId: string }).requestId);
    const decision = (req.body as { decision?: unknown } | null)?.decision;
    if (!Number.isSafeInteger(id) || id < 1 || !['accept', 'decline'].includes(String(decision))) return reply.code(400).send({ error: 'invalid_decision' });
    if (!(await listRequestsForUser(db, ctx.event.id, ctx.userId, 'pending')).incoming.some((request) => request.id === id)) return reply.code(404).send({ error: 'not_found' });
    const res = await decideRequest(db, ctx.actor, id, decision as 'accept' | 'decline', ctx.size);
    if (!res.ok) return reply.code(409).send({ error: res.code });
    if (decision === 'accept') await provision(res.value.team, res.value.joinerId);
    return { ok: true };
  });
  app.delete(`${base}/team`, async (req, reply) => {
    const session = await sessionFrom(req);
    const event = session === null ? null : await eventFor((req.params as { eventId: string }).eventId, session.userId);
    if (event === null || session === null) return reply.code(404).send({ error: 'event_unavailable' });
    const team = await getTeamForUser(db, event.id, session.userId);
    const res = await leaveTeam(db, `web:${session.userId}`, event.id, session.userId);
    if (!res.ok) return reply.code(409).send({ error: res.code });
    if (team && deps.client && !deps.config.skipDiscord) {
      const pd = { db, client: deps.client, categoryIdFor: () => undefined };
      await revokeTeamRole(pd, team, session.userId);
      const remaining = await getTeam(db, team.id);
      if (remaining === null) await destroyTeamSpace(pd, team);
      else await refreshTeamPanel(pd, remaining);
    }
    return { ok: true };
  });
}
