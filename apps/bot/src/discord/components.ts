/**
 * Modal submit + button/select component handling.
 *
 * Modals: signup, create-team, team-settings.
 * Components: signup panel buttons, team browser (join request), request
 * accept/decline/cancel, admin move select, match/reset confirmations.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { MODAL_IDS, validateSignupInput, validateCustomAnswers } from '../features/form/domain.js';
import { upsertParticipant, getParticipant, listTeamRoster } from '../features/signup/data.js';
import {
  createTeam,
  getTeamForUser,
  getTeam,
  updateTeamSettings,
  adminAssign,
  joinPrivateTeam,
  leaveTeam,
} from '../features/teams/data.js';
import { createJoinRequest, createInvite, decideRequest, cancelRequest, listRequestsForUser } from '../features/teams/requests-data.js';
import { eligibleParticipant } from '../features/signup/eligibility.js';
import { getEvent, getEventForm } from '../features/events/data.js';
import { getForm } from '../features/form/data.js';
import { getMessageRef } from '../features/events/data.js';
import { getRegistrationAnswers } from '../features/registration/data.js';
import { applyTeamJoin, applyTeamLeave } from './provision.js';
import { buildSignupModal, buildCreateTeamModal, buildTeamSettingsModal, buildTeamInviteModal, CREATE_TEAM_IDS, TEAM_SETTINGS_IDS, TEAM_INVITE_TARGET_ID } from './modal.js';
import { isCurrentTeamPanel, refreshTeamPanel } from './team-panel.js';
import { IDS, buildParticipantEmbed, displayErr, embedErr, embedOk, eph, type Ctx } from './shared.js';
import { commitMatchAndAnnounce, resetEventConfirmed } from './admin-commands.js';
import { t } from '../shared/i18n.js';

interface Announcer {
  announce: (guildId: string, content: string) => Promise<void>;
}

async function panelTeam(ctx: Ctx, eventId: string, teamId: string, channelId: string) {
  const team = await getTeam(ctx.db, teamId);
  if (team === null || team.eventId !== eventId || team.guildId !== ctx.guildId || team.textChannelId !== channelId) return null;
  return team;
}

async function explicitEventContext(ctx: Ctx & Announcer, eventId: string): Promise<(Ctx & Announcer) | null> {
  const event = await getEvent(ctx.db, eventId);
  if (event === null || event.guildId !== ctx.guildId || event.status !== 'active') return null;
  return { ...ctx, eventId, eventName: event.name, hasActiveEvent: true,
    ...(ctx.webCompletionUrl ? { webCompletionUrl: ctx.webCompletionUrl.replace(/\/events\/[^/]+\/signup$/, `/events/${encodeURIComponent(eventId)}/signup`) } : {}),
    config: getEventForm(ctx.db, event, await getForm(ctx.db, event.guildId)) };
}

async function handleTeamPanelModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<boolean> {
  const parts = i.customId.split(':');
  if (parts[0] !== 'hack' || parts[1] !== 'team-panel-modal') return false;
  const [, , action, eventId, teamId, panelMessageId, actorId] = parts;
  if (!eventId || !teamId) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
  const team = i.channelId === null ? null : await panelTeam(ctx, eventId, teamId, i.channelId);
  const eligibleOwner = team !== null && team.ownerId === i.user.id
    && await eligibleParticipant(ctx.db, eventId, i.user.id, true) !== null;
  if (!eligibleOwner) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.owner_only'))); return true; }
  if (team.kind === 'matched') { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.matched_restricted'))); return true; }
  const pinnedCtx = { ...ctx, eventId };
  if (action === 'settings') {
    await handleTeamSettingsModal(i, pinnedCtx);
  } else if (action === 'invite') {
    const panel = await getMessageRef(ctx.db, `team_panel:${team.id}`);
    const targetId = i.fields.getSelectedUsers(TEAM_INVITE_TARGET_ID)?.first()?.id;
    if (actorId !== i.user.id || panel === null || panel.messageId !== panelMessageId || panel.channelId !== i.channelId || !targetId) {
      await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
      return true;
    }
    const pinned = await explicitEventContext(ctx, eventId);
    if (!pinned) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
    const result = await createInvite(ctx.db, `discord:${i.user.id}`, eventId, team.guildId, team.id, targetId, pinned.config.teamSize);
    if (!result.ok) { await i.reply({ embeds: [displayErr(ctx.botLocale, result.code, result.message)], flags: MessageFlags.Ephemeral }); return true; }
    const { inviteEmbed } = await import('./user-commands.js');
    const dmSent = await ctx.dm(targetId, {
      content: t(ctx.botLocale, 'discord.teams.invite_dm', { inviter: `${i.user.username} (from **${team.name}**)` }),
      embeds: [await inviteEmbed(pinned, team.name, team.id)],
      components: [decideRowFor(result.value.id, ctx.botLocale)],
    });
    await refreshTeamPanel({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, team, ctx.botLocale);
    await i.reply(eph(t(ctx.botLocale, dmSent ? 'discord.teams.invite_sent_body' : 'discord.teams.invite_saved_body', { name: targetId })));
  } else {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
  }
  return true;
}

async function handleTeamPanelButton(i: ButtonInteraction, ctx: Ctx & Announcer): Promise<boolean> {
  const bits = i.customId.split(':');
  const confirm = bits[1] === 'team-panel-confirm';
  if (bits[0] !== 'hack' || (!confirm && bits[1] !== 'team-panel')) return false;
  const eventId = bits[2];
  const teamId = bits[3];
  const action = confirm ? bits[5] : bits[4];
  if (!eventId || !teamId || !action) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
  const team = i.channelId === null ? null : await panelTeam(ctx, eventId, teamId, i.channelId);
  const roster = team === null ? [] : await listTeamRoster(ctx.db, team.id);
  if (team === null || !roster.some((member) => member.userId === i.user.id)
      || await eligibleParticipant(ctx.db, eventId, i.user.id, true) === null) {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
    return true;
  }
  if (confirm) {
    const [, , confirmEventId, confirmTeamId, nonce, decision] = bits;
    const key = `team_panel_confirm:${team.id}:${i.user.id}:${nonce}`;
    const current = await ctx.db.transaction(async () => {
      const row = await ctx.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
      const ref = await getMessageRef(ctx.db, `team_panel:${team.id}`);
      let binding: { channelId?: string; messageId?: string; actorId?: string; panelMessageId?: string } = {};
      try { binding = row ? JSON.parse(row.value) as typeof binding : {}; } catch { /* stale */ }
      if (confirmEventId !== eventId || confirmTeamId !== teamId || decision !== action
          || binding.messageId !== i.message.id || binding.actorId !== i.user.id
          || !isCurrentTeamPanel(ref, i.channelId, binding.panelMessageId ?? '')) return false;
      await ctx.db.run('DELETE FROM meta WHERE key = ?', key);
      return true;
    });
    if (!current) {
      await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
      return true;
    }
    if (action === 'cancel') { await i.update({ content: t(ctx.botLocale, 'discord.team_panel.cancel'), embeds: [], components: [] }); return true; }
    if (action !== 'leave') { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
    const result = await leaveTeam(ctx.db, `discord:${i.user.id}`, eventId, i.user.id);
    if (!result.ok) { await i.update({ content: '', embeds: [displayErr(ctx.botLocale, result.code, result.message)], components: [] }); return true; }
    await applyTeamLeave({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, result.value, i.user.id);
    await i.update({ content: t(ctx.botLocale, 'discord.team_panel.left'), embeds: [], components: [] });
    return true;
  }
  const ref = await getMessageRef(ctx.db, `team_panel:${team.id}`);
  if (ref?.channelId !== i.channelId || ref.messageId !== i.message.id) {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
    return true;
  }
  const owner = team.ownerId === i.user.id && await eligibleParticipant(ctx.db, eventId, i.user.id, true) !== null;
  if (['invite', 'settings', 'requests'].includes(action) && !owner) {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.owner_only')));
    return true;
  }
  if (['invite', 'settings'].includes(action) && team.kind === 'matched') {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.matched_restricted')));
    return true;
  }
  if (action === 'settings') {
    await i.showModal(buildTeamSettingsModal(team.name, team.kind, team.colorId, ctx.botLocale, `hack:team-panel-modal:settings:${eventId}:${teamId}`));
  } else if (action === 'invite') {
    const pinned = await explicitEventContext(ctx, eventId);
    if (pinned === null) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
    await i.showModal(buildTeamInviteModal(eventId, teamId, i.message.id, i.user.id, ctx.botLocale));
  } else if (action === 'requests') {
    const requests = (await listRequestsForUser(ctx.db, eventId, i.user.id, 'pending')).incoming
      .filter((request) => request.teamId === team.id && request.kind === 'join_request');
    const rows = requests.slice(0, 5).map((request) => decideRowFor(request.id, ctx.botLocale));
    await i.reply({ content: requests.length ? requests.map((request) => `<@${request.requesterId}>`).join('\n') : t(ctx.botLocale, 'discord.teams.nothing_pending'), components: rows, flags: MessageFlags.Ephemeral });
  } else if (action === 'leave') {
    const nonce = randomBytes(6).toString('base64url');
    const panelRef = await getMessageRef(ctx.db, `team_panel:${team.id}`);
    if (!panelRef || panelRef.messageId !== i.message.id) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return true; }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hack:team-panel-confirm:${eventId}:${teamId}:${nonce}:leave`).setLabel(t(ctx.botLocale, 'discord.team_panel.confirm')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`hack:team-panel-confirm:${eventId}:${teamId}:${nonce}:cancel`).setLabel(t(ctx.botLocale, 'discord.team_panel.cancel')).setStyle(ButtonStyle.Secondary),
    );
    await i.reply({ content: t(ctx.botLocale, 'discord.team_panel.confirm_leave'), components: [row], flags: MessageFlags.Ephemeral });
    const confirmation = await i.fetchReply();
    await ctx.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `team_panel_confirm:${team.id}:${i.user.id}:${nonce}`,
      JSON.stringify({ channelId: i.channelId, messageId: confirmation.id, actorId: i.user.id, panelMessageId: panelRef.messageId }));
  } else {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
  }
  return true;
}

// ─── modals ──────────────────────────────────────────────────────────────────

export async function onModalSubmit(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  if (await handleTeamPanelModal(i, ctx)) return;
  if (i.customId.startsWith('hack:signup:event:')) {
    const eventId = i.customId.slice('hack:signup:event:'.length);
    const pinned = await explicitEventContext(ctx, eventId);
    if (pinned === null) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return; }
    await handleSignupModal(i, pinned);
    return;
  }
  if (i.customId.startsWith('hack:create:modal:event:')) {
    const eventId = i.customId.slice('hack:create:modal:event:'.length);
    const pinned = await explicitEventContext(ctx, eventId);
    if (pinned === null) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return; }
    await handleCreateTeamModal(i, pinned);
    return;
  }
  if (i.customId.startsWith('hack:team-settings:event:')) {
    const [, , , eventId, teamId] = i.customId.split(':');
    const team = teamId ? await getTeam(ctx.db, teamId) : null;
    const pinned = eventId ? await explicitEventContext(ctx, eventId) : null;
    if (team === null || pinned === null || team.eventId !== eventId || team.guildId !== ctx.guildId
        || team.ownerId !== i.user.id || team.kind === 'matched'
        || await eligibleParticipant(ctx.db, eventId, i.user.id, true) === null) {
      await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.owner_only')));
      return;
    }
    await handleTeamSettingsModal(i, pinned);
    return;
  }
  await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
}

async function handleSignupModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const locale = ctx.botLocale;
  // Blocked users must not pass, even with a stale modal open.
  const existing = await getParticipant(ctx.db, ctx.eventId, i.user.id);
  if (existing?.status === 'blocked') {
    await i.reply(eph(t(locale, 'errors.blocked')));
    return;
  }

  const raw = {
    displayName: i.fields.getTextInputValue(MODAL_IDS.name),
    experience: i.fields.getStringSelectValues(MODAL_IDS.experience)[0] ?? '',
    roleTrack: i.fields.getStringSelectValues(MODAL_IDS.roleTrack)[0] ?? '',
    skills: [...i.fields.getStringSelectValues(MODAL_IDS.skills)],
    teamPref: i.fields.getStringSelectValues(MODAL_IDS.teamPref)[0] ?? '',
  };

  const result = validateSignupInput(ctx.config, raw, locale);
  if (!result.ok) {
    await i.reply({
      embeds: [
        embedErr(
          t(locale, 'discord.join.fix_title'),
          `${result.errors.map((e) => `• ${e}`).join('\n')}\n\n${t(locale, 'discord.join.fix_hint')}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const saved = await upsertParticipant(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, result.value);
  if (!saved.ok) {
    await i.reply({ embeds: [displayErr(locale, saved.code, saved.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  const prefHint =
    result.value.teamPref === 'create_team'
      ? t(locale, 'discord.join.hint_create')
      : result.value.teamPref === 'join_team'
        ? t(locale, 'discord.join.hint_join')
        : t(locale, 'discord.join.hint_match');

  // Continuation: act on the team preference right from the reply —
  // create-team opens its modal, join/browse opens the team picker.
  const registration = await getRegistrationAnswers(ctx.db, ctx.eventId, i.user.id);
  const customAnswers = registration?.formVersion === ctx.config.version ? registration.answers : {};
  const customValidation = validateCustomAnswers(ctx.config, customAnswers);
  const incomplete = !customValidation.ok || customValidation.missingRequiredQuestionIds.length > 0;
  const actions = incomplete
    ? ctx.webCompletionUrl
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
        .setLabel(t(locale, 'discord.join.web_complete_btn'))
        .setURL(ctx.webCompletionUrl)
        .setStyle(ButtonStyle.Link))
      : null
    : new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.followCreateTeam}:${ctx.eventId}`).setLabel(t(locale, 'discord.join.actions_create')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${IDS.followBrowseTeams}:${ctx.eventId}`).setLabel(t(locale, 'discord.join.actions_browse')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.followInvitations}:${ctx.eventId}`).setLabel(t(locale, 'discord.join.actions_invitations')).setStyle(ButtonStyle.Secondary),
    );

  await i.reply({
    embeds: [
      embedOk(t(locale, 'discord.join.saved_title'), incomplete
        ? `${t(locale, 'discord.join.incomplete_web')}${ctx.webCompletionUrl ? `\n\n${t(locale, 'discord.join.web_completion', { url: `<${ctx.webCompletionUrl}>` })}` : ''}`
        : `${t(locale, 'discord.join.saved_thanks', { name: result.value.displayName, hint: prefHint })}${ctx.webCompletionUrl ? `\n\n${t(locale, 'discord.join.web_completion', { url: `<${ctx.webCompletionUrl}>` })}` : ''}`),
      await buildParticipantEmbed(ctx.db, ctx.config, saved.value, locale),
    ],
    components: actions === null ? [] : [actions],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCreateTeamModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const locale = ctx.botLocale;
  const name = i.fields.getTextInputValue(CREATE_TEAM_IDS.name);
  const kind = i.fields.getStringSelectValues(CREATE_TEAM_IDS.kind)[0] as 'public' | 'private' | undefined;
  const colorId = i.fields.getStringSelectValues(CREATE_TEAM_IDS.color)[0] ?? null;
  if (kind === undefined) {
    await i.reply(eph(t(locale, 'discord.join.pick_visibility')));
    return;
  }

  const res = await createTeam(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, name, kind, i.user.id, colorId);
  if (!res.ok) {
    await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  // Provision role + channels immediately so the founder lands in their space.
  const { provisionTeamSpace, sendJoinWelcome } = await import('./provision.js');
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  const team = await provisionTeamSpace(provisionDeps, res.value);

  const codeLine =
    team.kind === 'private' && team.joinCode !== null
      ? `\n${t(locale, 'discord.teams.join_code_line', { code: team.joinCode })}`
      : '';
  const channelLine =
    team.textChannelId !== null
      ? `\n${t(locale, 'discord.teams.your_space')} <#${team.textChannelId}>${team.voiceChannelId !== null ? ` + <#${team.voiceChannelId}>` : ''}`
      : '';

  await i.reply({
    embeds: [
      embedOk(
        t(locale, 'discord.teams.created_title'),
        `${t(locale, 'discord.teams.created_body', { name: team.name })}${channelLine}${codeLine}\n\n${t(locale, 'discord.teams.created_next')}`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  await sendJoinWelcome(provisionDeps, team, i.user.id, [{ userId: i.user.id, displayName: i.user.username }]);
}

async function handleTeamSettingsModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const locale = ctx.botLocale;
  const team = await getTeamForUser(ctx.db, ctx.eventId, i.user.id);
  if (team === null || team.ownerId !== i.user.id) {
    await i.reply(eph(t(locale, 'discord.teams.not_owner')));
    return;
  }
  if (team.kind === 'matched') {
    await i.reply(eph(t(locale, 'errors.matched_team')));
    return;
  }

  const name = i.fields.getTextInputValue(TEAM_SETTINGS_IDS.name);
  const kind = i.fields.getStringSelectValues(TEAM_SETTINGS_IDS.kind)[0] as 'public' | 'private' | undefined;
  const colorId = i.fields.getStringSelectValues(TEAM_SETTINGS_IDS.color)[0] ?? null;
  if (kind === undefined) {
    await i.reply(eph(t(locale, 'discord.join.pick_visibility')));
    return;
  }

  const res = await updateTeamSettings(ctx.db, ctx.actor, team.id, {
    name,
    kind,
    colorId: colorId !== null ? colorId : undefined,
  });
  if (!res.ok) {
    await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  // Sync the Discord role (name + color).
  const { syncRoleColor } = await import('./provision.js');
  await syncRoleColor({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, res.value);
  await refreshTeamPanel({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, res.value, locale);

  const changed: string[] = [];
  if (res.value.name !== team.name) changed.push(t(locale, 'discord.teams.changed_renamed'));
  if (res.value.kind !== team.kind) changed.push(t(locale, 'discord.teams.changed_kind', { kind: res.value.kind }));
  if (res.value.colorId !== team.colorId) changed.push(t(locale, 'discord.teams.changed_recolored'));

  await i.reply({
    embeds: [embedOk(t(locale, 'discord.teams.updated_title'), t(locale, 'discord.teams.updated_body', { name: res.value.name, changes: changed.join(', ') || t(locale, 'discord.teams.no_changes') }))],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── components ──────────────────────────────────────────────────────────────

export async function onComponent(
  i: ButtonInteraction | StringSelectMenuInteraction,
  ctx: Ctx & Announcer,
): Promise<void> {
  let id = i.customId;
  let routedEventId: string | null = null;
  if (id.startsWith('hack:panel:')) {
    const [, , eventId, action] = id.split(':');
    routedEventId = eventId ?? null;
    id = action === 'signup' ? IDS.signupButton : action === 'teams' ? IDS.teamsButton : id;
  } else if (id.startsWith(`${IDS.followCreateTeam}:`)) {
    routedEventId = id.slice(IDS.followCreateTeam.length + 1); id = IDS.followCreateTeam;
  } else if (id.startsWith(`${IDS.followBrowseTeams}:`)) {
    routedEventId = id.slice(IDS.followBrowseTeams.length + 1); id = IDS.followBrowseTeams;
  } else if (id.startsWith(`${IDS.followInvitations}:`)) {
    routedEventId = id.slice(IDS.followInvitations.length + 1); id = IDS.followInvitations;
  } else if (id.startsWith(`${IDS.teamsSelect}:`)) {
    routedEventId = id.slice(IDS.teamsSelect.length + 1); id = IDS.teamsSelect;
  }
  if (routedEventId !== null) {
    const pinned = await explicitEventContext(ctx, routedEventId);
    if (pinned === null) { await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale'))); return; }
    ctx = pinned;
  } else if ([IDS.signupButton, IDS.teamsButton, IDS.followCreateTeam, IDS.followBrowseTeams, IDS.followInvitations, IDS.teamsSelect].some((legacyId) => legacyId === id)) {
    await i.reply(eph(t(ctx.botLocale, 'discord.team_panel.stale')));
    return;
  }
  const locale = ctx.botLocale;
  if (typeof i.isButton === 'function' && i.isButton() && await handleTeamPanelButton(i, ctx)) return;


  // ── signup panel buttons ─────────────────────────────────────────────────
  if (id === IDS.signupButton) {
    if (!ctx.hasActiveEvent) {
      await i.reply(eph(t(locale, 'discord.gate.no_active')));
      return;
    }
    const existing = await getParticipant(ctx.db, ctx.eventId, i.user.id);
    if (existing?.status === 'blocked') {
      await i.reply(eph(t(locale, 'errors.blocked')));
      return;
    }
    await i.showModal(buildSignupModal(ctx.config, locale, `hack:signup:event:${ctx.eventId}`));
    return;
  }
  if (id === IDS.teamsButton) {
    if (!ctx.hasActiveEvent) {
      await i.reply(eph(t(locale, 'discord.gate.no_active')));
      return;
    }
    const { teamsBrowser } = await import('./user-commands.js');
    const browser = await teamsBrowser(ctx);
    if (browser === null) {
      await i.reply(eph(t(locale, 'discord.teams.none_open')));
      return;
    }
    await i.reply({ ...browser, flags: MessageFlags.Ephemeral });
    return;
  }

  // ── post-signup follow-up actions ────────────────────────────────────────
  if (id === IDS.followCreateTeam) {
    if (!ctx.hasActiveEvent) {
      await i.reply(eph(t(locale, 'discord.gate.no_active')));
      return;
    }
    if ((await getParticipant(ctx.db, ctx.eventId, i.user.id)) === null) {
      await i.reply(eph(t(locale, 'discord.teams.signup_first')));
      return;
    }
    if ((await getTeamForUser(ctx.db, ctx.eventId, i.user.id)) !== null) {
      await i.reply(eph(t(locale, 'errors.already_in_team')));
      return;
    }
    await i.showModal(buildCreateTeamModal(locale, `hack:create:modal:event:${ctx.eventId}`));
    return;
  }
  if (id === IDS.followBrowseTeams) {
    if (!ctx.hasActiveEvent) {
      await i.reply(eph(t(locale, 'discord.gate.no_active')));
      return;
    }
    const { teamsBrowser } = await import('./user-commands.js');
    const browser = await teamsBrowser(ctx);
    if (browser === null) {
      await i.reply({ content: t(locale, 'discord.teams.none_open'), embeds: [], components: [] });
      return;
    }
    await i.update({ ...browser });
    return;
  }
  if (id === IDS.followInvitations) {
    if (!ctx.hasActiveEvent || (await getParticipant(ctx.db, ctx.eventId, i.user.id))?.status !== 'active') {
      await i.reply(eph(t(locale, 'discord.teams.signup_first')));
      return;
    }
    const { teamRequestsView } = await import('./user-commands.js');
    await i.reply({ ...await teamRequestsView(ctx, i.user.id), flags: MessageFlags.Ephemeral });
    return;
  }

  // ── request accept/decline/cancel ────────────────────────────────────────
  for (const base of [IDS.reqAccept, IDS.reqDecline, IDS.reqCancel]) {
    if (!id.startsWith(`${base}:`)) continue;
    const requestId = Number(id.slice(base.length + 1));
    if (!Number.isInteger(requestId)) {
      await i.reply(eph(t(locale, 'discord.teams.malformed')));
      return;
    }

    if (base === IDS.reqCancel) {
      const res = await cancelRequest(ctx.db, ctx.actor, requestId);
      await i.update({
        content: res.ok ? t(locale, 'discord.teams.cancelled') : '',
        embeds: res.ok ? [] : [displayErr(locale, res.code, res.message)],
        components: [],
      });
      return;
    }

    const decision = base === IDS.reqAccept ? 'accept' : 'decline';
    const res = await decideRequest(ctx.db, ctx.actor, requestId, decision, ctx.config.teamSize);
    if (!res.ok) {
      await i.update({ content: '', embeds: [displayErr(locale, res.code, res.message)], components: [] });
      return;
    }

    if (decision === 'decline') {
      const isInvite = res.value.request.kind === 'invite';
      await ctx.dm(res.value.request.requesterId, {
        content: isInvite
          ? t(locale, 'discord.teams.invite_declined_dm', { user: res.value.joinerId, team: res.value.team.name })
          : t(locale, 'discord.teams.request_declined_dm', { team: res.value.team.name }),
      });
      await i.update({ content: t(locale, 'discord.teams.declined_reply'), embeds: [], components: [] });
      return;
    }

    // Accepted → full join flow: role, channels, welcome, notifications.
    const provisioned = await applyTeamJoin(
      { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor },
      res.value.team,
      res.value.joinerId,
    );

    if (res.value.request.kind === 'invite') {
      await ctx.dm(res.value.joinerId, {
        content: t(locale, 'discord.teams.accepted_invite_dm', {
          team: res.value.team.name,
          space: provisioned.textChannelId !== null ? `\n${t(locale, 'discord.teams.your_space')} <#${provisioned.textChannelId}>` : '',
        }),
      });
      await ctx.dm(res.value.request.requesterId, {
        content: t(locale, 'discord.teams.accepted_invite_owner_dm', { user: res.value.joinerId, team: res.value.team.name }),
      });
    } else {
      await ctx.dm(res.value.request.requesterId, {
        content: t(locale, 'discord.teams.accepted_request_dm', {
          team: res.value.team.name,
          space: provisioned.textChannelId !== null ? `\n${t(locale, 'discord.teams.team_space')} <#${provisioned.textChannelId}>` : '',
        }),
      });
    }
    await i.update({ content: t(locale, 'discord.teams.accepted_reply', { team: res.value.team.name }), embeds: [], components: [] });
    return;
  }

  // ── team browser → join request ──────────────────────────────────────────
  if (id === IDS.teamsSelect) {
    if (!ctx.hasActiveEvent) {
      await i.reply(eph(t(locale, 'discord.gate.no_active')));
      return;
    }
    const teamId = (i as StringSelectMenuInteraction).values[0] ?? '';
    const team = await getTeam(ctx.db, teamId);
    if (team === null) {
      await i.update({ content: t(locale, 'discord.teams.gone'), embeds: [], components: [] });
      return;
    }
    const res = await createJoinRequest(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, teamId, ctx.config.teamSize);
    if (!res.ok) {
      await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshTeamPanel({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, team, locale);
    const ownerDm =
      team.ownerId !== null
        ? await ctx.dm(team.ownerId, {
            content: t(locale, 'discord.teams.owner_dm_new_request', { user: i.user.id, team: team.name }),
            components: [decideRowFor(res.value.id, locale)],
          })
        : false;
    await i.update({
      embeds: [
        embedOk(
          t(locale, 'discord.teams.request_sent_title'),
          ownerDm
            ? t(locale, 'discord.teams.request_sent_body', { team: team.name })
            : t(locale, 'discord.teams.request_saved_body'),
        ),
      ],
      components: [],
    });
    return;
  }

  // ── admin confirm buttons (require admin) ────────────────────────────────
  if (id === IDS.matchConfirm || id.startsWith(`${IDS.matchConfirm}:`) || id === IDS.matchCancel) {
    if (!ctx.isAdmin) {
      await i.reply(eph(t(locale, 'discord.admin.organizer_only_short')));
      return;
    }
    if (id === IDS.matchCancel) {
      await i.update({ content: t(locale, 'discord.admin.match_cancelled'), embeds: [], components: [] });
      return;
    }
    await commitMatchAndAnnounce(i, ctx, ctx.announce);
    return;
  }
  if (id === IDS.resetConfirm || id === IDS.resetCancel) {
    if (!ctx.isAdmin) {
      await i.reply(eph(t(locale, 'discord.admin.organizer_only_short')));
      return;
    }
    if (id === IDS.resetCancel) {
      await i.update({ content: t(locale, 'discord.admin.reset_cancelled'), components: [] });
      return;
    }
    await resetEventConfirmed(i, ctx);
    return;
  }

  // ── admin move select ────────────────────────────────────────────────────
  if (id.startsWith(`${IDS.adminMoveSelect}:`)) {
    if (!ctx.isAdmin) {
      await i.reply(eph(t(locale, 'discord.admin.organizer_only_short')));
      return;
    }
    const userId = id.slice(IDS.adminMoveSelect.length + 1);
    const value = (i as StringSelectMenuInteraction).values[0] ?? '';
    const res = await adminAssign(ctx.db, ctx.actor, ctx.eventId, userId, value === '__none__' ? null : value, ctx.config.teamSize);
    if (res.ok && res.value !== null) await applyTeamLeave({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, res.value, userId);
    if (res.ok && value !== '__none__') {
      const destination = await getTeam(ctx.db, value);
      if (destination !== null) await refreshTeamPanel({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, destination, locale);
    }
    await i.update({
      content: res.ok ? t(locale, 'discord.admin.moved_done', { user: userId }) : '',
      embeds: res.ok ? [] : [displayErr(locale, res.code, res.message)],
      components: [],
    });
    return;
  }

  await i
    .reply({ content: t(locale, 'discord.admin.stale_control'), flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}

function decideRowFor(requestId: number, locale: import('../shared/i18n.js').BotLocale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${IDS.reqAccept}:${requestId}`).setLabel(t(locale, 'discord.teams.accept_btn')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${IDS.reqDecline}:${requestId}`).setLabel(t(locale, 'discord.teams.decline_btn')).setStyle(ButtonStyle.Secondary),
  );
}
