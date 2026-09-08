/**
 * Signup + create-team modals. Modern labels + select menus (discord.js 14.23+).
 * Signup modal rebuilds from the live form config on every open, so admin
 * edits apply immediately.
 */
import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { MODAL_IDS, TEAM_COLORS, type FormConfig } from '../features/form/domain.js';

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

const CREATE_IDS = {
  modal: 'hack:create:modal',
  name: 'hack:create:name',
  kind: 'hack:create:kind',
  color: 'hack:create:color',
} as const;

const SETTINGS_IDS = {
  modal: 'hack:settings:modal',
  name: 'hack:settings:name',
  kind: 'hack:settings:kind',
  color: 'hack:settings:color',
} as const;

/** Create-team modal: name + visibility + role color in one shot. */
export function buildCreateTeamModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CREATE_IDS.modal).setTitle('Create your team');

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Team name')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(CREATE_IDS.name)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Compiler Crashers')
          .setMinLength(3)
          .setMaxLength(60)
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel('Visibility')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(CREATE_IDS.kind)
          .setOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Public — anyone can ask to join from the team browser')
              .setValue('public'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Private — only people you invite (or with the join code)')
              .setValue('private'),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel('Role color')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(CREATE_IDS.color)
          .setOptions(TEAM_COLORS.map((c) => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.id)))
          .setRequired(true),
      ),
  );

  return modal;
}

/** Owner settings modal (kind/color can't be preselected — Discord limitation). */
export function buildTeamSettingsModal(currentName: string, kind: string, colorId: string | null): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(SETTINGS_IDS.modal).setTitle('Team settings');

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Team name')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(SETTINGS_IDS.name)
          .setStyle(TextInputStyle.Short)
          .setValue(currentName.slice(0, 60))
          .setMinLength(3)
          .setMaxLength(60)
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(`Visibility (currently: ${kind})`)
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(SETTINGS_IDS.kind)
          .setOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Public — anyone can ask to join from the team browser')
              .setValue('public'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Private — only people you invite (or with the join code)')
              .setValue('private'),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(`Role color (currently: ${colorId ?? 'default'})`)
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(SETTINGS_IDS.color)
          .setOptions(TEAM_COLORS.map((c) => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.id)))
          .setRequired(true),
      ),
  );

  return modal;
}

export const CREATE_TEAM_IDS = CREATE_IDS;
export const TEAM_SETTINGS_IDS = SETTINGS_IDS;
