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
import { MODAL_IDS, validateSignupInput } from '../features/form/domain.js';
import { upsertParticipant, getParticipant } from '../features/signup/data.js';
import {
  createTeam,
  getTeamForUser,
  getTeam,
  updateTeamSettings,
  adminAssign,
  joinPrivateTeam,
} from '../features/teams/data.js';
import { createJoinRequest, decideRequest, cancelRequest } from '../features/teams/requests-data.js';
import { applyTeamJoin } from './provision.js';
import { buildSignupModal, CREATE_TEAM_IDS, TEAM_SETTINGS_IDS } from './modal.js';
import { IDS, buildParticipantEmbed, displayErr, embedErr, embedOk, eph, type Ctx } from './shared.js';
import { commitMatchAndAnnounce, resetEventConfirmed } from './admin-commands.js';
import { t } from '../shared/i18n.js';

interface Announcer {
  announce: (guildId: string, content: string) => Promise<void>;
}

// ─── modals ──────────────────────────────────────────────────────────────────

export async function onModalSubmit(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  if (i.customId === MODAL_IDS.signup) {
    await handleSignupModal(i, ctx);
    return;
  }
  if (i.customId === CREATE_TEAM_IDS.modal) {
    await handleCreateTeamModal(i, ctx);
    return;
  }
  if (i.customId === TEAM_SETTINGS_IDS.modal) {
    await handleTeamSettingsModal(i, ctx);
    return;
  }
}

async function handleSignupModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const locale = ctx.botLocale;
  // Blocked users must not pass, even with a stale modal open.
  const existing = getParticipant(ctx.db, ctx.eventId, i.user.id);
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

  const saved = upsertParticipant(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, result.value);
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

  await i.reply({
    embeds: [
      embedOk(t(locale, 'discord.join.saved_title'), t(locale, 'discord.join.saved_thanks', { name: result.value.displayName, hint: prefHint })),
      buildParticipantEmbed(ctx.db, ctx.config, saved.value, locale),
    ],
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

  const res = createTeam(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, name, kind, i.user.id, colorId);
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
  const team = getTeamForUser(ctx.db, ctx.eventId, i.user.id);
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

  const res = updateTeamSettings(ctx.db, ctx.actor, team.id, {
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
  const id = i.customId;
  const locale = ctx.botLocale;

  // ── signup panel buttons ─────────────────────────────────────────────────
  if (id === IDS.signupButton) {
    const existing = getParticipant(ctx.db, ctx.eventId, i.user.id);
    if (existing?.status === 'blocked') {
      await i.reply(eph(t(locale, 'errors.blocked')));
      return;
    }
    await i.showModal(buildSignupModal(ctx.config, locale));
    return;
  }
  if (id === IDS.teamsButton) {
    const { teamsBrowser } = await import('./user-commands.js');
    const browser = teamsBrowser(ctx);
    if (browser === null) {
      await i.reply(eph(t(locale, 'discord.teams.none_open')));
      return;
    }
    await i.reply({ ...browser, flags: MessageFlags.Ephemeral });
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
      const res = cancelRequest(ctx.db, ctx.actor, requestId);
      await i.update({
        content: res.ok ? t(locale, 'discord.teams.cancelled') : t(locale, 'discord.teams.cancel_failed', { message: res.message }),
        embeds: [],
        components: [],
      });
      return;
    }

    const decision = base === IDS.reqAccept ? 'accept' : 'decline';
    const res = decideRequest(ctx.db, ctx.actor, requestId, decision, ctx.config.teamSize);
    if (!res.ok) {
      await i.update({ content: `⚠️ ${res.message}`, embeds: [], components: [] });
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
    const teamId = (i as StringSelectMenuInteraction).values[0] ?? '';
    const team = getTeam(ctx.db, teamId);
    if (team === null) {
      await i.update({ content: t(locale, 'discord.teams.gone'), embeds: [], components: [] });
      return;
    }
    const res = createJoinRequest(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, teamId, ctx.config.teamSize);
    if (!res.ok) {
      await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
      return;
    }
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
  if (id === IDS.matchConfirm || id === IDS.matchCancel) {
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
    const res = adminAssign(ctx.db, ctx.actor, ctx.eventId, userId, value === '__none__' ? null : value);
    await i.update({
      content: res.ok ? t(locale, 'discord.admin.moved_done', { user: userId }) : t(locale, 'discord.admin.failed_label', { message: res.message }),
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
