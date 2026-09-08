/**
 * Admin web routes. Session auth via HMAC-signed cookie; all state-changing
 * routes are POST + JSON. UI files served from public/.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import { audit } from '../shared/audit.js';
import { auditList } from '../shared/audit.js';
import {
  blockParticipant,
  unblockParticipant,
  withdrawParticipant,
  listParticipants,
  getParticipant,
} from '../features/signup/data.js';
import {
  createTeam,
  deleteTeam,
  rotateJoinCode,
  adminAssign,
  listTeams,
  removeMember,
  updateTeamSettings,
  setGuildCategory,
  getGuildSettings,
} from '../features/teams/data.js';
import { previewMatch, commitMatch, lastMatchInfo } from '../features/matching/data.js';
import {
  createEvent,
  getActiveEvent,
  getEvent,
  getEventForm,
  listEvents,
  activateEvent,
  endEvent,
  saveTemplate,
  listTemplates,
  deleteTemplate,
} from '../features/events/data.js';
import { getForm, updateForm, resetForm } from '../features/form/data.js';
import { refreshSignupPanel } from '../discord/signup-panel.js';
import { sendAnnouncement, createDiscordEvents } from '../discord/notify.js';
import type { FormConfig } from '../features/form/domain.js';

export interface WebDeps {
  db: Db;
  config: Env;
  announce: (guildId: string, content: string) => Promise<void>;
  /** Live Discord client, used to auto-refresh the signup panel on form edits. May be null in SKIP_DISCORD mode. */
  client: import('discord.js').Client | null;
}

const COOKIE = 'hacksess';

function sign(secret: string, exp: number): string {
  return createHmac('sha256', secret).update(`admin:${exp}`).digest('hex');
}

function makeToken(secret: string): string {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  return `${exp}.${sign(secret, exp)}`;
}

function verifyToken(secret: string, token: string): boolean {
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const exp = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(secret, exp));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function sessionFrom(req: FastifyRequest, config: Env): string | null {
  const cookie = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (m === null) return null;
  return verifyToken(config.adminSessionSecret, decodeURIComponent(m[1]!)) ? m[1]! : null;
}

export function registerRoutes(app: FastifyInstance, deps: WebDeps): void {
  const { db, config } = deps;
  const guildId = config.guildId ?? 'default';

  /** The event the admin web UI is operating on: the active one. */
  const activeEventId = (): string => {
    const row = db
      .prepare("SELECT id FROM events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get(guildId) as { id: string } | undefined;
    return row?.id ?? guildId;
  };

  app.addHook('preHandler', async (req, reply) => {
    const isApi = req.url.startsWith('/api/');
    const isLogin = req.url === '/api/login';
    // Static files and the login endpoint are public; every other /api route
    // requires a valid session.
    if (!isApi || isLogin) return;
    if (sessionFrom(req, config) === null) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post('/api/login', async (req, reply) => {
    const body = req.body as { password?: string } | null;
    if (body?.password !== config.adminPassword) {
      await reply.code(401).send({ error: 'invalid_password' });
      return;
    }
    const token = makeToken(config.adminSessionSecret);
    reply.header(
      'set-cookie',
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}`,
    );
    audit(db, 'web', 'web.login', 'admin', null);
    return { ok: true };
  });

  app.get('/api/state', async () => {
    const eventId = activeEventId();
    const participants = listParticipants(db, eventId);
    const teams = listTeams(db, eventId);
    const events = listEvents(db, guildId);
    const active = events.find((e) => e.status === 'active') ?? null;
    return {
      participants,
      teams,
      config: getForm(db),
      audit: auditList(db, 100),
      lastMatch: lastMatchInfo(db, eventId),
      guildSettings: getGuildSettings(db, guildId),
      events,
      templates: listTemplates(db, guildId),
      activeEventId: active?.id ?? null,
      stats: {
        signups: participants.filter((p) => p.status !== 'withdrawn').length,
        active: participants.filter((p) => p.status === 'active').length,
        blocked: participants.filter((p) => p.status === 'blocked').length,
        unteamed: participants.filter((p) => p.status === 'active' && p.teamId === null).length,
        matchingOptIn: participants.filter((p) => p.status === 'active' && p.teamId === null && p.teamPref === 'random_team').length,
        teams: teams.length,
      },
    };
  });

  // ── events ────────────────────────────────────────────────────────────────

  app.post('/api/events', async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string;
      startsAt?: number | null;
      endsAt?: number | null;
      templateId?: string;
    } | null;
    if (body?.name === undefined || body.name.trim().length < 3) {
      await reply.code(400).send({ ok: false, code: 'bad_name', message: 'Event name must be at least 3 characters.' });
      return;
    }
    let form: Parameters<typeof createEvent>[3]['form'];
    if (body.templateId !== undefined) {
      const tpl = listTemplates(db, guildId, 'event').find((t) => t.id === body.templateId);
      if (tpl === undefined) {
        await reply.code(400).send({ ok: false, code: 'not_found', message: 'Template not found.' });
        return;
      }
      const { templateToEventInput } = await import('../features/events/data.js');
      form = templateToEventInput(tpl.json).form;
    }
    const res = createEvent(db, 'web', guildId, {
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.startsAt != null ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt != null ? { endsAt: body.endsAt } : {}),
      ...(form !== undefined ? { form } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/:eventId/activate', async (req, reply) => {
    const res = activateEvent(db, 'web', (req.params as { eventId: string }).eventId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Refresh the signup panel for the newly active event.
    if (deps.client !== null) {
      await refreshSignupPanel(db, deps.client, guildId).catch(() => undefined);
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/:eventId/end', async (req, reply) => {
    const res = endEvent(db, 'web', (req.params as { eventId: string }).eventId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/announce', async (req, reply) => {
    const body = req.body as { eventId?: string; title?: string; message?: string; dm?: boolean } | null;
    const event = body?.eventId !== undefined ? getEvent(db, body.eventId) : getActiveEvent(db, guildId);
    if (event === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord.' });
      return;
    }
    if (body?.title === undefined || body.message === undefined) {
      await reply.code(400).send({ ok: false, code: 'bad_input', message: 'title and message are required.' });
      return;
    }
    const result = await sendAnnouncement({ db, client: deps.client }, 'web', event, body.title, body.message, body.dm ?? false);
    return { ok: true, ...result };
  });

  app.post('/api/events/:eventId/discord-events', async (req, reply) => {
    const event = getEvent(db, (req.params as { eventId: string }).eventId);
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord.' });
      return;
    }
    const body = req.body as { days?: number; durationHours?: number } | null;
    const result = await createDiscordEvents({ db, client: deps.client }, 'web', event, body?.days ?? 1, body?.durationHours ?? 24);
    if (result.created.length === 0) {
      await reply.code(400).send({ ok: false, code: 'failed', message: result.errors.join('; ') || 'Nothing created.' });
      return;
    }
    return { ok: true, created: result.created, errors: result.errors };
  });

  // ── templates ─────────────────────────────────────────────────────────────

  app.post('/api/templates', async (req, reply) => {
    const body = req.body as { eventId?: string; name?: string; kind?: string } | null;
    const event = body?.eventId !== undefined ? getEvent(db, body.eventId) : getActiveEvent(db, guildId);
    if (event === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    const { getEventForm } = await import('../features/events/data.js');
    const { DEFAULT_FORM } = await import('../features/form/domain.js');
    const payload = {
      name: event.name,
      description: event.description,
      cleanupDelayHours: event.cleanupDelayHours,
      form: getEventForm(db, event, DEFAULT_FORM),
    };
    const res = saveTemplate(db, 'web', guildId, body?.name ?? event.name, 'event', JSON.stringify(payload));
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, template: res.value };
  });

  app.delete('/api/templates/:templateId', async (req, reply) => {
    const res = deleteTemplate(db, 'web', (req.params as { templateId: string }).templateId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/participants/:userId/status', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { action?: string; reason?: string } | null;
    const actor = 'web';
    const eventId = activeEventId();
    let res;
    switch (body?.action) {
      case 'block':
        res = blockParticipant(db, actor, eventId, userId, body.reason ?? 'No reason given');
        break;
      case 'unblock':
        res = unblockParticipant(db, actor, eventId, userId);
        break;
      case 'withdraw':
        res = withdrawParticipant(db, actor, eventId, userId);
        break;
      case 'reactivate': {
        const p = getParticipant(db, eventId, userId);
        if (p === null) {
          res = { ok: false, code: 'not_found', message: 'Participant not found.' };
          break;
        }
        db.prepare("UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?").run(
          Date.now(),
          eventId,
          userId,
        );
        audit(db, actor, 'participant.reactivate', eventId, { userId });
        res = { ok: true, value: undefined };
        break;
      }
      default:
        res = { ok: false, code: 'bad_action', message: 'Unknown action.' };
    }
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/participants/:userId/team', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { teamId?: string | null } | null;
    const res = adminAssign(db, 'web', activeEventId(), userId, body?.teamId ?? null);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/teams', async (req, reply) => {
    const body = req.body as { name?: string; kind?: string; ownerId?: string } | null;
    if (body?.kind !== 'public' && body?.kind !== 'private') {
      await reply.code(400).send({ ok: false, code: 'bad_kind', message: 'kind must be public|private' });
      return;
    }
    if (body.ownerId !== undefined && getParticipant(db, activeEventId(), body.ownerId) === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Owner has no signup.' });
      return;
    }
    const ownerId = body.ownerId ?? `admin-${Date.now()}`;
    const res = createTeam(db, 'web', activeEventId(), guildId, body.name ?? '', body.kind, ownerId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/delete', async (req, reply) => {
    const res = deleteTeam(db, 'web', (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/teams/:teamId/settings', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { name?: string; kind?: string; colorId?: string | null } | null;
    const res = updateTeamSettings(db, 'web', teamId, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.kind === 'public' || body?.kind === 'private' ? { kind: body.kind } : {}),
      ...(body?.colorId !== undefined ? { colorId: body.colorId } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/rotate-code', async (req, reply) => {
    const res = rotateJoinCode(db, 'web', (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, code: res.value };
  });

  app.post('/api/teams/:teamId/remove-member', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { userId?: string } | null;
    const res = removeMember(db, 'web', teamId, body?.userId ?? '');
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/match/preview', async (req, reply) => {
    const res = previewMatch(db, activeEventId(), getForm(db));
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, result: res.value };
  });

  app.post('/api/match/commit', async () => {
    const res = commitMatch(db, 'web', activeEventId(), guildId, getForm(db));
    if (!res.ok) {
      return { ok: false, code: res.code, message: res.message };
    }
    const lines = res.value.teams
      .map((t) => `**${t.name}** — compatibility ${t.score}\n${t.memberIds.map((id) => `<@${id}>`).join(', ')}`)
      .join('\n\n');
    await deps.announce(guildId, `🏁 **Teams are locked in!**\n\n${lines}`);
    return { ok: true, result: res.value };
  });

  app.post('/api/form', async (req, reply) => {
    const body = req.body as Partial<FormConfig> | null;
    const res = updateForm(db, 'web', body ?? {});
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Keep the Discord signup panel in sync with the new form config.
    if (deps.client !== null && config.guildId !== undefined) {
      void refreshSignupPanel(db, deps.client, config.guildId).catch(() => undefined);
    }
    return { ok: true, config: res.value };
  });

  app.post('/api/form/reset', async () => {
    const res = resetForm(db, 'web');
    return { ok: res.ok, config: res.ok ? res.value : undefined };
  });

  app.post('/api/event/reset', async () => {
    const eventId = activeEventId();
    const { purgeEventParticipants } = await import('../features/signup/data.js');
    const { deleteEventTeams } = await import('../features/teams/data.js');
    const participants = purgeEventParticipants(db, 'web', eventId);
    const teams = deleteEventTeams(db, 'web', eventId);
    return { ok: true, removed: { participants, teams } };
  });

  app.post('/api/guild/category', async (req) => {
    const body = req.body as { categoryId?: string | null } | null;
    setGuildCategory(db, 'web', guildId, body?.categoryId ?? null);
    return { ok: true };
  });
}
