import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, validateCustomAnswers, validateCustomQuestions, type CustomQuestion } from '../features/form/domain.js';
import { buildPanelPayload } from './signup-panel.js';
import { needsWebSignup } from './signup-entry.js';

test('scale and yes/no answers distinguish unanswered, no, and out-of-range values', () => {
  const questions: CustomQuestion[] = ['slider', 'toggle'].map(kind => ({ id: kind, kind: kind as 'slider' | 'toggle', label: { en: kind, sv: kind }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }));
  assert.equal(validateCustomQuestions(questions).ok, true);
  assert.deepEqual(validateCustomAnswers({ customQuestions: questions }, {}), { ok: true, answers: {}, missingRequiredQuestionIds: ['slider', 'toggle'] });
  assert.deepEqual(validateCustomAnswers({ customQuestions: questions }, { slider: '1', toggle: 'no' }), { ok: true, answers: { slider: '1', toggle: 'no' }, missingRequiredQuestionIds: [] });
  for (const value of ['0', '11', '1.5', '01', 5, [], 'NaN']) assert.equal(validateCustomAnswers({ customQuestions: questions }, { slider: value, toggle: 'no' }).ok, false);
  assert.equal(validateCustomAnswers({ customQuestions: questions }, { slider: '10', toggle: false }).ok, false);
});

test('persistent panel recovers team actions and binds every action to the event', () => {
  const payload = buildPanelPayload(DEFAULT_FORM, 'en', 'event-one');
  const buttons = payload.components[0]!.toJSON().components;
  assert.equal(buttons.length, 4);
  assert.deepEqual(buttons.map(button => 'custom_id' in button ? button.custom_id : ''), ['hack:panel:event-one:signup', 'hack:panel:event-one:teams', 'hack:follow:create-team:event-one', 'hack:follow:invitations:event-one']);
});

test('web mode links directly; incompatible Discord profiles use the website', () => {
  assert.equal(needsWebSignup(DEFAULT_FORM), false);
  assert.equal(needsWebSignup({ ...DEFAULT_FORM, signupMode: 'web' }), true);
  assert.equal(needsWebSignup({ ...DEFAULT_FORM, skills: [] }), true);
  const button = buildPanelPayload({ ...DEFAULT_FORM, signupMode: 'web' }, 'sv', 'event-one', 'https://example.com/events/event-one/signup').components[0]!.toJSON().components[0]!;
  assert.equal('url' in button && button.url, 'https://example.com/events/event-one/signup');
  assert.equal('custom_id' in button, false);
});
