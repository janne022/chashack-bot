/**
 * Modal submit + button/select component handling.
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { MODAL_IDS, labelFor } from '../features/form/domain.js';
import { validateSignupInput } from '../features/form/domain.js';
import { upsertParticipant, getParticipant } from '../features/signup/store.js';
import { buildSignupModal } from './modal.js';
import { IDS, buildParticipantEmbed, displayErr, embedErr, embedOk, eph, type Ctx } from './shared.js';
import { commitMatchAndAnnounce, resetEventConfirmed } from './admin-commands.js';

interface Announcer {
  announce: (guildId: string, content: string) => Promise<void>;
}

export async function onModalSubmit(i: ModalSubmitInteraction, ctx: Ctx & Announcer): Promise<void> {
  if (i.customId !== MODAL_IDS.signup) return;

  // Blocked users must not pass, even with a stale modal open.
  const existing = getParticipant(ctx.db, ctx.guildId, i.user.id);
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
    // Re-open the modal with an error summary so nothing they typed is lost
    // (Discord does not refill modal fields programmatically, so we tell them).
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

  const saved = upsertParticipant(ctx.db, ctx.actor, ctx.guildId, i.user.id, result.value);
  if (!saved.ok) {
    await i.reply({ embeds: [displayErr(saved.code, saved.message)], flags: MessageFlags.Ephemeral });
    return;
  }

  const prefHint =
    result.value.teamPref === 'with_friends'
      ? 'Use `/hackathon teammates` to say who you want on your team — they must sign up and mention you back.'
      : result.value.teamPref === 'public_team'
        ? 'Create a team with `/hackathon create-team` or browse `/hackathon teams`.'
        : 'Organizers will match you into a team based on compatibility.';

  await i.reply({
    embeds: [
      embedOk(
        'Signup saved ✅',
        `Thanks, **${result.value.displayName}**! ${prefHint}`,
      ),
      buildParticipantEmbed(ctx.db, ctx.config, saved.value),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function onComponent(
  i: ButtonInteraction | StringSelectMenuInteraction,
  ctx: Ctx & Announcer,
): Promise<void> {
  const id = i.customId;

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
    if (i.isStringSelectMenu() && value === '__none__') {
      const { adminAssign } = await import('../features/teams/service.js');
      const res = adminAssign(ctx.db, ctx.actor, ctx.guildId, userId, null);
      await i.update({
        content: res.ok ? `Unassigned <@${userId}> from all teams.` : `Failed: ${res.message}`,
        components: [],
      });
      return;
    }
    const { adminAssign } = await import('../features/teams/service.js');
    const res = adminAssign(ctx.db, ctx.actor, ctx.guildId, userId, value);
    await i.update({
      content: res.ok ? `Moved <@${userId}> into the team.` : `Failed: ${res.message}`,
      components: [],
    });
    return;
  }

  // ── public team browser ──────────────────────────────────────────────────
  if (id === IDS.teamsSelect) {
    const teamId = (i as StringSelectMenuInteraction).values[0] ?? '';
    const res = await import('../features/teams/service.js').then((m) =>
      m.joinTeam(ctx.db, ctx.actor, ctx.guildId, i.user.id, teamId, ctx.config.teamSize),
    );
    if (!res.ok) {
      await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
      return;
    }
    await i.update({
      embeds: [embedOk('Joined!', `You joined **${res.value.name}**. See you at the hackathon 🎉`)],
      components: [],
    });
    return;
  }

  await i
    .reply({ content: 'That control is stale — run the command again.', flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}
