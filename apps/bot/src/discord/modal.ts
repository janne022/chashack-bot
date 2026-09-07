/**
 * Signup modal: a single modern modal with labels + select menus
 * (discord.js >= 14.23). Rebuilt from the live form config on every open,
 * so admin edits take effect immediately.
 */
import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { MODAL_IDS, type FormConfig } from '../features/form/domain.js';

export function buildSignupModal(config: FormConfig): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(MODAL_IDS.signup).setTitle(config.title.slice(0, 45));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Your name')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(MODAL_IDS.name)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('How should teams know you?')
          .setRequired(true)
          .setMaxLength(60),
      ),
    new LabelBuilder()
      .setLabel('Experience level')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.experience)
          .setOptions(config.experiences.map((e) => new StringSelectMenuOptionBuilder().setLabel(e.label).setValue(e.id)))
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel('Main role this hackathon')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.roleTrack)
          .setOptions(config.roleTracks.map((r) => new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.id)))
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel('What can you do? (pick all that apply)')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.skills)
          .setMinValues(1)
          .setMaxValues(Math.min(config.skills.length, 25))
          .setOptions(config.skills.map((s) => new StringSelectMenuOptionBuilder().setLabel(s.label).setValue(s.id)))
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel('Team preference')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.teamPref)
          .setOptions(config.teamPrefs.map((t) => new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.id)))
          .setRequired(true),
      ),
  );

  return modal;
}
