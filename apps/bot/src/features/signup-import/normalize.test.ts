import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FORM, type CustomQuestion, type FormConfig } from '../form/domain.js';
import { foldKey, importedRowProfile, matchOption, normalizeImportedRow, normalizeValues, sanitizeAnswers, splitValues } from './normalize.js';
import { HACKOWEEN_FORM_PRESET, genericTarget, suggestMapping } from './presets.js';

const form = (customQuestions: CustomQuestion[] = []): FormConfig => ({ ...DEFAULT_FORM, version: 3, customQuestions });

const QUESTION: CustomQuestion = {
  id: 'area', kind: 'multi_choice', label: { en: 'Area', sv: 'Område' }, help: { en: '', sv: '' },
  required: false, presentation: 'web', visibility: 'self_and_organizer',
  choices: [
    { id: 'frontend', label: { en: 'Frontend', sv: 'Frontend' } },
    { id: 'backend', label: { en: 'Backend', sv: 'Backend' } },
    { id: 'other', label: { en: 'Something else', sv: 'Något annat' } },
  ],
};

test('foldKey folds case, accents and punctuation the way exports vary', () => {
  assert.equal(foldKey('Ditt namn och klass'), 'ditt namn och klass');
  assert.equal(foldKey('Övrigt: fritext!'), 'ovrigt fritext');
  assert.equal(foldKey('  Chas-mail  '), 'chas mail');
});

test('splitValues handles every separator Google Forms emits', () => {
  assert.deepEqual(splitValues('Frontend, UX'), ['Frontend', 'UX']);
  assert.deepEqual(splitValues('Frontend;UX|Backend\nDevOps'), ['Frontend', 'UX', 'Backend', 'DevOps']);
  assert.deepEqual(splitValues('  ,,  '), []);
});

test('matchOption resolves ids, both label languages and participation sentences', () => {
  const options = DEFAULT_FORM.teamPrefs;
  assert.equal(matchOption('random_team', options), 'random_team');
  assert.equal(matchOption('Bli matchad till ett slumpmässigt team', options), 'random_team');
  assert.equal(matchOption('Jag vill bli tilldelad en grupp', options, true), 'random_team');
  assert.equal(matchOption('Jag anmäler en färdig grupp', options, true), 'join_team');
  assert.equal(matchOption('Jag vill ha en öppen grupp som fler kan gå med i', options, true), 'create_team');
  assert.equal(matchOption('Ingenting av detta', options, true), null);
});

test('broad area checkboxes map to the representative skill', () => {
  const { values, issues } = normalizeValues(form(), { skills: 'Frontend, UX, Backend, DevOps', teamPref: 'random_team' });
  assert.equal(values.skills, 'frontend_react,ui_design,backend_node,devops');
  assert.equal(values.teamPref, 'random_team');
  assert.deepEqual(issues, []);
});

test('unresolvable values are dropped and reported instead of failing the row', () => {
  const { values, issues } = normalizeValues(form(), {
    name: 'Ada', teamPref: 'Jag vill dansa', skills: 'Frontend, Övrigt: kaffebryggare', experience: 'Aldrig kodat',
  });
  assert.equal(values.name, 'Ada');
  assert.equal(values.skills, 'frontend_react');
  assert.equal(values.teamPref, undefined);
  assert.equal(values.experience, undefined);
  assert.ok(issues.some((issue) => issue.includes('teamPref')));
  assert.ok(issues.some((issue) => issue.includes('kaffebryggare')));
  assert.ok(issues.some((issue) => issue.includes('experience')));
});

test('sanitizeAnswers translates labels and drops only what cannot be read', () => {
  const questions: CustomQuestion[] = [
    QUESTION,
    { id: 'size', kind: 'slider', label: { en: 'Group size' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer' },
    { id: 'single', kind: 'single_choice', label: { en: 'One' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer',
      choices: [{ id: 'yes', label: { en: 'Yes please' } }] },
  ];
  const result = sanitizeAnswers(form(questions), {
    area: 'Frontend, Backend',
    size: '42',
    single: 'yes please',
    removed_question: 'ignored',
  });
  assert.deepEqual(result.answers, { area: ['frontend', 'backend'], size: '10', single: 'yes' });
  assert.ok(result.issues.some((issue) => issue.includes('removed_question')));
  assert.equal('removed_question' in result.answers, false);
});

test('normalizeImportedRow keeps the profile inside the form options only', () => {
  const row = normalizeImportedRow(form(), { name: 'Ada', experience: 'veteran', role: 'backend', skills: 'frontend_react', teamPref: 'join_team' }, {});
  assert.equal(row.values.experience, 'veteran');
  assert.equal(row.values.role, 'backend');
  const profile = importedRowProfile(form(), { experience: 'veteran', role: 'wizard', skills: 'frontend_react,retired_skill', teamPref: 'join_team' });
  assert.deepEqual(profile, { experience: 'veteran', roleTrack: '', skills: ['frontend_react'], teamPref: 'join_team' });
});

test('the Hackoween preset maps every known question of the Google Form', () => {
  const headers = [
    'Tidsstämpel', 'Ditt namn och klass', 'Din chas-mail', 'Din discord username',
    'Har du några allergier vi ska ta hänsyn till när vi köper fika?', 'Hur vill du delta i Hackoween?',
    'Hur många är ni i er grupp?', 'Gruppnamn (för dig som anmäler i en färdig grupp)',
    'Namn på medlemmarna i gruppen', 'Vilket område vill du helst jobba med under Hackatonet?',
  ];
  const { mapping, presetId } = suggestMapping(headers);
  assert.equal(presetId, HACKOWEEN_FORM_PRESET.id);
  assert.deepEqual(mapping, {
    'Tidsstämpel': 'sourceTimestamp',
    'Ditt namn och klass': 'name',
    'Din chas-mail': 'email',
    'Din discord username': 'discordUsername',
    'Har du några allergier vi ska ta hänsyn till när vi köper fika?': 'allergies',
    'Hur vill du delta i Hackoween?': 'teamPref',
    'Hur många är ni i er grupp?': 'groupSize',
    'Gruppnamn (för dig som anmäler i en färdig grupp)': 'groupName',
    'Namn på medlemmarna i gruppen': 'members',
    'Vilket område vill du helst jobba med under Hackatonet?': 'skills',
  });
});

test('member headers are not stolen by the shorter name header', () => {
  const { mapping } = suggestMapping(['Namn på medlemmarna i gruppen', 'Ditt namn och klass', 'Din Chas-mail']);
  assert.equal(mapping['Namn på medlemmarna i gruppen'], 'members');
  assert.equal(mapping['Ditt namn och klass'], 'name');
});

test('an explicit template id wins, and unknown exports fall back to generic keywords', () => {
  assert.equal(suggestMapping(['Ditt namn och klass', 'Din Chas-mail'], HACKOWEEN_FORM_PRESET.id).presetId, HACKOWEEN_FORM_PRESET.id);
  assert.equal(genericTarget('Chas mail'), 'email');
  const unknown = suggestMapping(['Favourite colour']);
  assert.equal(unknown.presetId, null);
  assert.deepEqual(unknown.mapping, {});
});
