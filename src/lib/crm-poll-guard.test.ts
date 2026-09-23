import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* Regression tests for issue #37: the CRM lead-detail panel polls every 30s
 * and used to overwrite in-progress user edits — most sharply the next-action
 * date input, which has no explicit edit mode, so a poll mid-edit reset the
 * picked date. After the fix:
 *  - a dirty latch (nextActionDirtyRef) tracks unsaved date input: set on
 *    change, cleared only after a successful save;
 *  - the poll hydration effect skips the date while latched, notes while the
 *    notes editor is open, and the profile draft while its editor is open;
 *  - field-specific setters are used (never a whole-form replace on poll).
 * Source-contract tests: rendering this client component under node:test is
 * not practical, so we assert the guard logic exists and is wired to both the
 * poll and the input handlers. */

const panelSrc = readFileSync(path.resolve('src', 'components', 'crm', 'lead-detail-panel.tsx'), 'utf8');

test('next-action date input has a dirty latch set on change (#37)', () => {
  assert.ok(/nextActionDirtyRef\s*=\s*useRef\(<boolean>\(false\)|nextActionDirtyRef\s*=\s*useRef\(false\)/.test(panelSrc),
    'nextActionDirtyRef must exist');
  assert.ok(
    /onChange=\{e\s*=>\s*\{\s*nextActionDirtyRef\.current\s*=\s*true;/.test(panelSrc),
    'date onChange must latch dirty before updating state',
  );
});

test('poll hydration skips the date while the dirty latch is set (#37)', () => {
  // The poll-driven effect must guard the date setter with the latch.
  assert.ok(
    /if\s*\(!nextActionDirtyRef\.current\s*&&\s*data\?\.lead\)/.test(panelSrc),
    'poll effect must not touch nextAction while latched',
  );
});

test('a successful save clears the latch; failures keep it (#37)', () => {
  assert.ok(
    /\.then\(ok\s*=>\s*\{\s*if\s*\(ok\)\s*nextActionDirtyRef\.current\s*=\s*false;/.test(panelSrc.replace(/\r?\n\s+/g, ' ')),
    'latch must clear only on successful patchLead',
  );
});

test('notes and profile drafts are only hydrated while their editors are closed (#37)', () => {
  assert.ok(
    /if\s*\(!editingNotes\s*&&\s*data\?\.lead\?\.notes\s*!==\s*undefined\)/.test(panelSrc),
    'notes value must not be overwritten while the notes editor is open',
  );
  assert.ok(
    /if\s*\(!editingProfile\s*&&\s*data\?\.lead\)/.test(panelSrc),
    'profile draft must not be overwritten while the profile editor is open',
  );
});

test('poll never replaces the whole form with server data (#37)', () => {
  // The only hydration path is the guarded effect with field-level setters.
  const effect = panelSrc.match(/Poll hydration[\s\S]*?\},\s*\[[^\]]*\]\);/)?.[0] ?? '';
  assert.ok(effect.length > 0, 'guarded poll-hydration effect must exist');
  assert.ok(/setNextAction/.test(effect) && /setNotesValue/.test(effect) && /setProfileDraft/.test(effect),
    'effect must hydrate the three editable fields individually');
  // And there must be no unguarded setForm(next)-style whole-form replace.
  assert.ok(!/setForm\(/.test(panelSrc), 'no whole-form setter may exist on the panel');
});
