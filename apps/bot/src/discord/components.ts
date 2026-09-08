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
  // Blocked users must not pass, even with a stale modal open.
  const existing = getParticipant(ctx.db, ctx.eventId, i.user.id);
  if (existing?.status === 'blocked') {
    await i.reply(eph('You are blocked from signing up. Contact an organizer.'));
    return;
  }

  const raw = {
    displayName: i.fields.getTextInputValue(MODAL_IDS.name),
    experience: i.fields.getStringSelectValues(MODAL_IDS.experience)[0] ?? '',
    roleTrack: i.fields.getStringSelectValues(MODAL_IDS.roleTrack)[0] ?? '',
    skills: [...i.fields.getStringSelectValues(MODAL_IDS.skills)],
    teamPref: i.fields.getStringSelectValues(MODAL_IDS.teamPref)[0] ?? '',
  };

  const result = validateSignupInput(ctx.config, raw);
  if (!result.ok) {
    await i.reply({
      embeds: [
        embedErr(
          'Fix these and try again',
          `${result.errors.map((e) => `• ${e}`).join('\n')}\n\nUse \`/hackathon join\` to open the form again.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const saved = upsertParticipant(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, result.value);
  if (!saved.ok) {
    await i.reply({ embeds: [displayErr(saved.code, saved.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  const prefHint =
    result.value.teamPref === 'create_team'
      ? 'Use `/hackathon create-team` to set up your team — you get invite powers, a private channel and a role.'
      : result.value.teamPref === 'join_team'
        ? 'Browse `/hackathon teams` and send join requests — owners decide, you get a DM.'
        : 'Organizers will match you into a team based on compatibility.';

  await i.reply({
    embeds: [
      embedOk('Signup saved ✅', `Thanks, **${result.value.displayName}**! ${prefHint}`),
      buildParticipantEmbed(ctx.db, ctx.config, saved.value),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCreateTeamModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const name = i.fields.getTextInputValue(CREATE_TEAM_IDS.name);
  const kind = i.fields.getStringSelectValues(CREATE_TEAM_IDS.kind)[0] as 'public' | 'private' | undefined;
  const colorId = i.fields.getStringSelectValues(CREATE_TEAM_IDS.color)[0] ?? null;
  if (kind === undefined) {
    await i.reply(eph('Pick a visibility option.'));
    return;
  }

  const res = createTeam(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, name, kind, i.user.id, colorId);
  if (!res.ok) {
    await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  // Provision role + channels immediately so the founder lands in their space.
  const { provisionTeamSpace, sendJoinWelcome } = await import('./provision.js');
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  const team = await provisionTeamSpace(provisionDeps, res.value);

  const codeLine =
    team.kind === 'private' && team.joinCode !== null
      ? `\n**Join code:** \`${team.joinCode}\` — teammates can use \`/hackathon join-code\` instead of waiting for an invite.`
      : '';
  const channelLine =
    team.textChannelId !== null
      ? `\nYour private space: <#${team.textChannelId}>${team.voiceChannelId !== null ? ` + <#${team.voiceChannelId}>` : ''}`
      : '';

  await i.reply({
    embeds: [
      embedOk(
        'Team created 🏁',
        `**${team.name}** is live.${channelLine}${codeLine}\n\nNext: \`/hackathon invite @someone\` — they get a DM with accept/decline.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  await sendJoinWelcome(provisionDeps, team, i.user.id, [{ userId: i.user.id, displayName: i.user.username }]);
}

async function handleTeamSettingsModal(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  const team = getTeamForUser(ctx.db, ctx.eventId, i.user.id);
  if (team === null || team.ownerId !== i.user.id) {
    await i.reply(eph('Only the team owner can change team settings.'));
    return;
  }
  if (team.kind === 'matched') {
    await i.reply(eph('Matched teams are managed by the matching engine.'));
    return;
  }

  const name = i.fields.getTextInputValue(TEAM_SETTINGS_IDS.name);
  const kind = i.fields.getStringSelectValues(TEAM_SETTINGS_IDS.kind)[0] as 'public' | 'private' | undefined;
  const colorId = i.fields.getStringSelectValues(TEAM_SETTINGS_IDS.color)[0] ?? null;
  if (kind === undefined) {
    await i.reply(eph('Pick a visibility option.'));
    return;
  }

  const res = updateTeamSettings(ctx.db, ctx.actor, team.id, {
    name,
    kind,
    colorId: colorId !== null ? colorId : undefined,
  });
  if (!res.ok) {
    await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  // Sync the Discord role (name + color).
  const { syncRoleColor } = await import('./provision.js');
  await syncRoleColor({ db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor }, res.value);

  const changed: string[] = [];
  if (res.value.name !== team.name) changed.push('renamed');
  if (res.value.kind !== team.kind) changed.push(`now **${res.value.kind}**`);
  if (res.value.colorId !== team.colorId) changed.push('recolored');

  await i.reply({
    embeds: [embedOk('Team updated', `**${res.value.name}**: ${changed.join(', ') || 'no changes'}.`)],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── components ──────────────────────────────────────────────────────────────

export async function onComponent(
  i: ButtonInteraction | StringSelectMenuInteraction,
  ctx: Ctx & Announcer,
): Promise<void> {
  const id = i.customId;

  // ── signup panel buttons ─────────────────────────────────────────────────
  if (id === IDS.signupButton) {
    const existing = getParticipant(ctx.db, ctx.eventId, i.user.id);
    if (existing?.status === 'blocked') {
      await i.reply(eph('You are blocked from signing up. Contact an organizer.'));
      return;
    }
    await i.showModal(buildSignupModal(ctx.config));
    return;
  }
  if (id === IDS.teamsButton) {
    const { teamsBrowser } = await import('./user-commands.js');
    const browser = teamsBrowser(ctx);
    if (browser === null) {
      await i.reply(eph('No teams with open space right now. Create one with `/hackathon create-team`!'));
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
      await i.reply(eph('That request looks malformed — use `/hackathon invitations`.'));
      return;
    }

    if (base === IDS.reqCancel) {
      const res = cancelRequest(ctx.db, ctx.actor, requestId);
      await i.update({
        content: res.ok ? 'Request cancelled.' : `Could not cancel: ${res.message}`,
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
          ? `<@${res.value.joinerId}> declined your invite to **${res.value.team.name}**.`
          : `Your request to join **${res.value.team.name}** was declined.`,
      });
      await i.update({ content: 'Declined. They have been notified.', embeds: [], components: [] });
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
        content: `🎉 You joined **${res.value.team.name}**!${provisioned.textChannelId !== null ? `\nYour team space: <#${provisioned.textChannelId}>` : ''}`,
      });
      await ctx.dm(res.value.request.requesterId, {
        content: `✅ <@${res.value.joinerId}> accepted your invite and joined **${res.value.team.name}**!`,
      });
    } else {
      await ctx.dm(res.value.request.requesterId, {
        content: `✅ Your request was accepted — you are now on **${res.value.team.name}**!${provisioned.textChannelId !== null ? `\nTeam space: <#${provisioned.textChannelId}>` : ''}`,
      });
    }
    await i.update({ content: `✅ Done — **${res.value.team.name}** has a new member.`, embeds: [], components: [] });
    return;
  }

  // ── team browser → join request ──────────────────────────────────────────
  if (id === IDS.teamsSelect) {
    const teamId = (i as StringSelectMenuInteraction).values[0] ?? '';
    const team = getTeam(ctx.db, teamId);
    if (team === null) {
      await i.update({ content: '⚠️ That team no longer exists.', embeds: [], components: [] });
      return;
    }
    const res = createJoinRequest(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, i.user.id, teamId, ctx.config.teamSize);
    if (!res.ok) {
      await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
      return;
    }
    const ownerDm =
      team.ownerId !== null
        ? await ctx.dm(team.ownerId, {
            content: `📨 <@${i.user.id}> asked to join **${team.name}**.`,
            components: [decideRowFor(res.value.id)],
          })
        : false;
    await i.update({
      embeds: [
        embedOk(
          'Request sent 📨',
          ownerDm
            ? `The owner of **${team.name}** got your request by DM. You will get a DM with the decision.`
            : `Request saved. The owner can review it with \`/hackathon team-requests\`.`,
        ),
      ],
      components: [],
    });
    return;
  }

  // ── admin confirm buttons (require admin) ────────────────────────────────
  if (id === IDS.matchConfirm || id === IDS.matchCancel) {
    if (!ctx.isAdmin) {
      await i.reply(eph('Organizer only.'));
      return;
    }
    if (id === IDS.matchCancel) {
      await i.update({ content: 'Match cancelled — nothing was changed.', embeds: [], components: [] });
      return;
    }
    await commitMatchAndAnnounce(i, ctx, ctx.announce);
    return;
  }
  if (id === IDS.resetConfirm || id === IDS.resetCancel) {
    if (!ctx.isAdmin) {
      await i.reply(eph('Organizer only.'));
      return;
    }
    if (id === IDS.resetCancel) {
      await i.update({ content: 'Reset cancelled.', components: [] });
      return;
    }
    await resetEventConfirmed(i, ctx);
    return;
  }

  // ── admin move select ────────────────────────────────────────────────────
  if (id.startsWith(`${IDS.adminMoveSelect}:`)) {
    if (!ctx.isAdmin) {
      await i.reply(eph('Organizer only.'));
      return;
    }
    const userId = id.slice(IDS.adminMoveSelect.length + 1);
    const value = (i as StringSelectMenuInteraction).values[0] ?? '';
    const res = adminAssign(ctx.db, ctx.actor, ctx.eventId, userId, value === '__none__' ? null : value);
    await i.update({
      content: res.ok ? `Done — <@${userId}> moved.` : `Failed: ${res.message}`,
      components: [],
    });
    return;
  }

  await i
    .reply({ content: 'That control is stale — run the command again.', flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}

function decideRowFor(requestId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${IDS.reqAccept}:${requestId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${IDS.reqDecline}:${requestId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
}
