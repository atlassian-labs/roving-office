// The debug log's one-line summaries, and the cut that keeps them readable.
//
// These are pure functions over an AOP envelope, so they can be tested without a
// DOM — which is worth doing, because the log is what you reach for when the room
// is wrong, and a log that silently drops the one field you needed is worse than
// no log at all. Every case here is a fact the log used to lose.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeAop, familyOf, LOG_COLUMNS } from '../src/debug/event-row.js';
import { elideMiddle } from '../src/ui/format.js';

const aop = (type, payload, session) => ({ aop: '0.1', type, payload, session });

test('a session says how much it is allowed to tell us', () => {
  const line = describeAop('session.start', aop('session.start', {
    source: 'startup', model: 'gpt-5', permission_mode: 'auto', redaction: 'metadata',
  }));
  // Without this, a session whose every title is "Working" looks broken rather
  // than quiet, and the only way to tell them apart was to read a settings file.
  assert.match(line, /redaction metadata/);
  assert.match(line, /startup/);
});

test('a session that says nothing about redaction is not made to', () => {
  const line = describeAop('session.start', aop('session.start', { source: 'resume' }));
  assert.equal(line, 'resume');
});

test('a tool call shows both what it is on and what was said about it', () => {
  const line = describeAop('tool.start', aop('tool.start', {
    tool_name: 'exec',
    tool_class: 'execute',
    target: 'scripts/ingest-room-to-read-mail.sh',
    summary: 'hourly Room to Read Gmail check',
  }));
  assert.match(line, /scripts\/ingest-room-to-read-mail\.sh/);
  assert.match(line, /hourly Room to Read Gmail check/);
});

test('a long path loses its middle, and keeps the end that names it', () => {
  const line = describeAop('artifact.change', aop('artifact.change', {
    kind: 'file',
    path: '/home/mcannonbrookes/.openclaw/workspace-paige/brain/sources/gmail/2026-08-29/digest.md',
  }));
  assert.match(line, /digest\.md$/, 'the filename is the identity, so it survives');
  assert.match(line, /…/);
  assert.ok(!line.includes('mcannonbrookes'), 'the middle is what goes');
});

test('prose keeps its beginning, because that is where prose reads from', () => {
  const message = `Cron job failed: ${'x'.repeat(200)}`;
  const line = describeAop('notification', aop('notification', { level: 'warn', message }));
  assert.match(line, /^warn · Cron job failed:/);
  assert.ok(!line.includes('…'), 'the cell ellipsis handles the right-hand edge');
});

test('an unknown type still renders, because that is when it matters most', () => {
  // This used to be `step.start`, which later became a type the log knows how
  // to phrase — so the example moved rather than the rule. Any type will do here
  // provided the spec does not define it, which is the whole point of the case.
  const line = describeAop('brain.sync', aop('brain.sync', { index: 2, title: 'Sync brain' }));
  assert.match(line, /index=2/);
  assert.match(line, /title=Sync brain/);
});

test('a step names the part and counts it, the same way every other panel does', () => {
  const line = describeAop('step.start', aop('step.start', {
    step_id: 's2', title: 'Ingest mail', index: 2, of: 5,
  }));
  assert.match(line, /Ingest mail/);
  assert.match(line, /2 of 5/);
});

test('a step with no title still says where it is — that is `metadata`, not a bug', () => {
  const line = describeAop('step.start', aop('step.start', { step_id: 's2', index: 2, of: 5 }));
  assert.equal(line, '2 of 5');
});

test('a skipped part is only legible here, so step.end leads with its status', () => {
  assert.match(
    describeAop('step.end', aop('step.end', { step_id: 's2', status: 'skipped' })),
    /^skipped/,
  );
  // Absent means completed on the wire (§4.2), and the log should not leave a reader
  // guessing which of the two an empty cell was.
  assert.match(describeAop('step.end', aop('step.end', { step_id: 's2' })), /^completed/);
});

test('a turn that arrives knowing it has parts says so', () => {
  const line = describeAop('turn.start', aop('turn.start', {
    title: 'Nightly sweep', plan: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  }));
  assert.match(line, /Nightly sweep/);
  assert.match(line, /3 steps/);
  // ...and one that does not, does not: the plain turn row must be untouched.
  assert.equal(describeAop('turn.start', aop('turn.start', { title: 'Nightly sweep' })), 'Nightly sweep');
});

test('a mid-turn retitle reads as the new name, in the turn family', () => {
  assert.equal(familyOf('turn.title'), 'turn');
  assert.equal(
    describeAop('turn.title', aop('turn.title', { turn_id: 'p1', title: 'Standing desk review' })),
    'Standing desk review',
  );
});

test('steps are turns, not tools: a round reads as one turn, not a burst of tool traffic', () => {
  assert.equal(familyOf('step.start'), 'turn');
  assert.equal(familyOf('step.end'), 'turn');
  assert.equal(familyOf('step', 'office'), 'turn');
});

test('elideMiddle cuts on separators, and keeps a bearing at the front', () => {
  assert.equal(
    elideMiddle('/home/paige/.openclaw/workspace-paige/scripts/ingest-room-to-read-mail.sh', 60),
    '/home/…/workspace-paige/scripts/ingest-room-to-read-mail.sh',
  );
  // A URL's bearing is its host: `https:/…` would be worse than no elision.
  assert.match(elideMiddle('https://bitbucket.org/atlassian/repo/pull-requests/62/diff', 40), /^https:\/\/bitbucket\.org\/…\//);
  // Nothing to cut on, so it falls back to the middle of the run itself.
  const solid = elideMiddle('a'.repeat(120), 40);
  assert.equal(solid.length, 40);
  assert.match(solid, /…/);
});

test('elideMiddle leaves anything that already fits completely alone', () => {
  assert.equal(elideMiddle('src/debug/event-row.js', 72), 'src/debug/event-row.js');
  assert.equal(elideMiddle('', 72), '');
  assert.equal(elideMiddle(undefined, 72), '');
});

test('the columns are described once, and the summary is the one that grows', () => {
  const classes = LOG_COLUMNS.map((c) => c.cls);
  assert.deepEqual(classes, [
    'lr-time', 'lr-mark', 'lr-type', 'lr-character', 'lr-who', 'lr-session', 'lr-summary',
  ]);
  // Every column carries a hint, since the header is the only place a reader can
  // find out what a column means — except the mark, which has no room for a label.
  for (const col of LOG_COLUMNS) assert.ok(col.hint, `${col.cls} needs a hint`);
  assert.equal(LOG_COLUMNS.at(-1).cls, 'lr-summary');
});

test('a scheduled turn says which job, and when it runs', () => {
  const origin = {
    kind: 'schedule',
    name: 'Paige hourly Room to Read Gmail check',
    id: 'cbcfacee-4c25-4f4f-963d-292d0d02dff8',
    schedule: '17 * * * *',
  };
  const line = describeAop('turn.start', aop('turn.start', {
    title: 'Paige hourly Room to Read Gmail check', trigger: 'schedule', origin,
  }));
  assert.match(line, /Paige hourly Room to Read Gmail check/);
  // The name is already the title two columns to the left, so saying it twice would
  // spend the row's width on nothing. The schedule is the part that is not up there.
  assert.match(line, /via schedule: 17 \* \* \* \*/);
  assert.ok(!/check.*check/s.test(line), 'the name is not repeated');
});

test('an origin with nothing but a kind still says the kind', () => {
  // A heartbeat has no name and no id to have, and "nobody asked for this" is worth
  // saying on its own — it is the difference between a round and a person.
  const line = describeAop('turn.start', aop('turn.start', {
    title: 'Heartbeat', trigger: 'schedule', origin: { kind: 'heartbeat' },
  }));
  assert.match(line, /via heartbeat/);
});

test('a turn with no origin reads exactly as it always did', () => {
  const line = describeAop('turn.start', aop('turn.start', {
    title: 'Fix the nav grid around the couch', trigger: 'user',
  }));
  assert.match(line, /Fix the nav grid around the couch/);
  assert.match(line, /via user/);
});
