/**
 * Signup + create-team modals. Modern labels + select menus (discord.js 14.23+).
 * Signup modal rebuilds from the live form config on every open, so admin
 * edits apply immediately.
 *
 * All labels come from the bot i18n catalogs (BOT_LANGUAGE). Form option
 * labels prefer `label_sv` when the bot locale is 'sv' and it exists; English
 * labels (set in the admin web UI) stay the source of truth.
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
import { t, type BotLocale } from '../shared/i18n.js';

/** Pick the display label for a form option, honoring the bot locale. */
export function optionLabel(
  option: { label: string; label_sv?: string },
  locale: BotLocale,
): string {
  if (locale === 'sv' && option.label_sv !== undefined && option.label_sv !== '') return option.label_sv;
  return option.label;
}

export function buildSignupModal(config: FormConfig, locale: BotLocale): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(MODAL_IDS.signup).setTitle(config.title.slice(0, 45));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(t(locale, 'discord.join.form_name'))
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(MODAL_IDS.name)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(t(locale, 'discord.join.form_name_ph'))
          .setRequired(true)
          .setMaxLength(60),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.join.form_experience'))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.experience)
          .setOptions(
            config.experiences.map(
              (e) => new StringSelectMenuOptionBuilder().setLabel(optionLabel(e, locale)).setValue(e.id),
            ),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.join.form_role'))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.roleTrack)
          .setOptions(
            config.roleTracks.map(
              (r) => new StringSelectMenuOptionBuilder().setLabel(optionLabel(r, locale)).setValue(r.id),
            ),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.join.form_skills'))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.skills)
          .setMinValues(1)
          .setMaxValues(Math.min(config.skills.length, 25))
          .setOptions(
            config.skills.map(
              (s) => new StringSelectMenuOptionBuilder().setLabel(optionLabel(s, locale)).setValue(s.id),
            ),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.join.form_teampref'))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_IDS.teamPref)
          .setOptions(
            config.teamPrefs.map(
              (tp) => new StringSelectMenuOptionBuilder().setLabel(optionLabel(tp, locale)).setValue(tp.id),
            ),
          )
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
export function buildCreateTeamModal(locale: BotLocale): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CREATE_IDS.modal).setTitle(t(locale, 'discord.teams.create_title'));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(t(locale, 'discord.teams.create_label_name'))
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(CREATE_IDS.name)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(t(locale, 'discord.teams.create_name_ph'))
          .setMinLength(3)
          .setMaxLength(60)
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.teams.create_label_visibility'))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(CREATE_IDS.kind)
          .setOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(t(locale, 'discord.teams.create_vis_public'))
              .setValue('public'),
            new StringSelectMenuOptionBuilder()
              .setLabel(t(locale, 'discord.teams.create_vis_private'))
              .setValue('private'),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(t(locale, 'discord.teams.create_label_color'))
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
export function buildTeamSettingsModal(
  currentName: string,
  kind: string,
  colorId: string | null,
  locale: BotLocale,
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(SETTINGS_IDS.modal).setTitle(t(locale, 'discord.teams.settings_title'));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(t(locale, 'discord.teams.create_label_name'))
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
      .setLabel(t(locale, 'discord.teams.settings_visibility', { kind }))
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(SETTINGS_IDS.kind)
          .setOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(t(locale, 'discord.teams.create_vis_public'))
              .setValue('public'),
            new StringSelectMenuOptionBuilder()
              .setLabel(t(locale, 'discord.teams.create_vis_private'))
              .setValue('private'),
          )
          .setRequired(true),
      ),
    new LabelBuilder()
      .setLabel(
        t(locale, 'discord.teams.settings_color', { color: colorId ?? t(locale, 'discord.teams.default_color') }),
      )
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
