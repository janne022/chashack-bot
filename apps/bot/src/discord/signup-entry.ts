import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { Ctx } from './shared.js';
import { t } from '../shared/i18n.js';
import type { FormConfig } from '../features/form/domain.js';

export function needsWebSignup(config: FormConfig): boolean {
  return config.signupMode === 'web' || [config.experiences, config.roleTracks, config.skills, config.teamPrefs].some(options => options.length === 0 || options.length > 25);
}

/** Use the complete web form when the organizer chooses it or a profile cannot fit Discord. */
export async function replyWithWebSignup(i: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction, ctx: Ctx): Promise<boolean> {
  if (!needsWebSignup(ctx.config)) return false;
  await i.reply({
    content: t(ctx.botLocale, ctx.webCompletionUrl ? 'discord.join.web_only' : 'discord.join.web_unavailable'),
    components: ctx.webCompletionUrl ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(ctx.botLocale, 'discord.panel.signup_btn')).setURL(ctx.webCompletionUrl))] : [],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}
