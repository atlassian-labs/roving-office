// Claude Code hook payloads → AOP events, against fixture payloads shaped like
// the real ones the mapper's header documents (verified against 2.1.246).
//
// The mapper is driven exactly as bin/aop-send.cjs drives it: a { sessions: {} }
// state bag that persists across calls, the helpers from aop-core, and a
// redaction mode. Each test drives a fresh state through a realistic sequence,
// because the mapper's whole design — held introductions, turn safety nets —
// only shows up across calls, never in one.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mapper = require('../bin/mappers/claude-code.cjs');
const { CAPS, MAPPER_HELPERS: helpers } = require('../bin/lib/aop-core.cjs');
const { driver } = require('./lib/mapper.cjs');

/** Drive one hook event through the mapper the way aop-send does. */
const fire = driver(mapper);

const SESSION = '478c3346-aaaa-bbbb-cccc-000000000001';
const CWD = '/work/repo';

const sessionStart = { session_id: SESSION, cwd: CWD, hook_event_name: 'SessionStart', source: 'startup', transcript_path: '/x/t.jsonl' };
const prompt = (text, id = 'prompt-1') => ({ session_id: SESSION, cwd: CWD, prompt: text, prompt_id: id });

// --- the held introduction ---------------------------------------------------

test('a bare SessionStart emits nothing: the introduction is held', () => {
  const state = { sessions: {} };
  assert.deepEqual(fire(state, 'SessionStart', sessionStart), []);
  assert.ok(state.sessions[SESSION].intro, 'the introduction waits in state');
  assert.equal(state.sessions[SESSION].started, false);
});

test('a session that starts and ends without working is never mentioned', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart);
  const out = fire(state, 'SessionEnd', { session_id: SESSION, cwd: CWD, reason: 'exit' });
  assert.deepEqual(out, []);
  assert.equal(state.sessions[SESSION].intro, undefined, 'the held introduction is dropped');
});

test('the first real event releases the introduction with its original source', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart);
  const out = fire(state, 'UserPromptSubmit', prompt('Fix the flaky test'));

  assert.equal(out.length, 2);
  const [start, turn] = out;
  assert.equal(start.type, 'session.start');
  assert.equal(start.payload.source, 'startup', 'startup two minutes ago is the truth, attach now is not');
  assert.deepEqual(start.payload.capabilities, mapper.CAPABILITIES);
  assert.equal(start.session.id, SESSION);

  assert.equal(turn.type, 'turn.start');
  assert.equal(turn.payload.turn_id, 'prompt-1');
  assert.equal(turn.payload.title, 'Fix the flaky test');
});

test('Claude\'s generated title beats a direct quote of the prompt', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart);
  const out = fire(state, 'UserPromptSubmit', prompt(
    'Can you add an office printer and set up a worktree for it?',
  ), { sessionTitle: 'Add office printer' });

  assert.equal(out.find((e) => e.type === 'turn.start').payload.title, 'Add office printer');
});

test('the title on the payload is preferred to a transcript read', () => {
  const state = { sessions: {} };
  let reads = 0;
  fire(state, 'SessionStart', sessionStart);
  const out = fire(
    state,
    'UserPromptSubmit',
    { ...prompt('Add an office printer'), session_title: 'add-office-printer' },
    { sessionTitle: () => { reads += 1; return 'Read from the transcript'; } },
  );

  assert.equal(out.find((e) => e.type === 'turn.start').payload.title, 'Add office printer');
  assert.equal(reads, 0, 'the free source answered, so the file was never opened');
});

test('a title generated after the prompt upgrades the turn in flight', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart);
  // The first prompt of a session: Claude has not written a title yet, so the desk
  // opens under a quote of the request.
  const opened = fire(state, 'UserPromptSubmit', prompt(
    'Create a work item to "Make great movies" and then switch to the branch',
  ));
  assert.equal(
    opened.find((e) => e.type === 'turn.start').payload.title,
    'Create a work item to "Make great movies" and then switch to the branch',
  );

  // Seconds later the title lands, and the turn's first tool call carries it over.
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
    tool_name: 'Read', tool_use_id: 'call-1', tool_input: { file_path: `${CWD}/a.js` },
  }, { sessionTitle: 'Cinematic office activity filming' });

  const retitle = out.find((e) => e.type === 'turn.title');
  assert.ok(retitle, 'the better title is carried over mid-turn');
  assert.equal(retitle.payload.title, 'Cinematic office activity filming');
  assert.equal(retitle.payload.turn_id, 'prompt-1', 'the same turn, renamed');
  assert.equal(retitle.session.id, SESSION);
  assert.ok(
    out.findIndex((e) => e.type === 'turn.title') < out.findIndex((e) => e.type === 'tool.start'),
    'the rename lands before the work it renames',
  );
});

test('the upgrade happens once, and only while the title is provisional', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart);
  fire(state, 'UserPromptSubmit', prompt('Do the long thing'));
  const tool = (n) => ({
    session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
    tool_name: 'Read', tool_use_id: `call-${n}`, tool_input: { file_path: `${CWD}/a.js` },
  });

  const first = fire(state, 'PreToolUse', tool(1), { sessionTitle: 'Long thing' });
  const second = fire(state, 'PreToolUse', tool(2), { sessionTitle: 'Long thing' });

  assert.equal(first.filter((e) => e.type === 'turn.title').length, 1);
  assert.deepEqual(second.filter((e) => e.type === 'turn.title'), [], 'not a running commentary');
});

test('a turn whose title never lands stops reading the transcript', () => {
  const state = { sessions: {} };
  let reads = 0;
  fire(state, 'SessionStart', sessionStart);
  fire(state, 'UserPromptSubmit', prompt('Nameless work'));

  for (let n = 0; n < 20; n += 1) {
    fire(
      state,
      'PreToolUse',
      {
        session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
        tool_name: 'Read', tool_use_id: `call-${n}`, tool_input: { file_path: `${CWD}/a.js` },
      },
      { sessionTitle: () => { reads += 1; return null; } },
    );
  }

  assert.equal(reads, 8, 'the chase is bounded: a read per tool call all turn is the bug');
});

test('a turn this adapter inferred takes the generated title too', () => {
  // Hooks installed mid-turn: the first thing we ever see is a tool call, so the turn
  // is opened by the safety net under a bare `Working`.
  const state = { sessions: {} };
  const opened = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
    tool_name: 'Read', tool_use_id: 'call-1', tool_input: { file_path: `${CWD}/a.js` },
  });
  assert.equal(opened.find((e) => e.type === 'turn.start').payload.title, 'Working');

  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
    tool_name: 'Grep', tool_use_id: 'call-2', tool_input: { pattern: 'x' },
  }, { sessionTitle: 'Fix the flaky test' });

  assert.equal(out.find((e) => e.type === 'turn.title')?.payload.title, 'Fix the flaky test');
});

test('metadata mode never upgrades a title, and never opens the transcript to try', () => {
  const state = { sessions: {} };
  let reads = 0;
  const opts = { redaction: 'metadata' };
  fire(state, 'SessionStart', sessionStart, opts);
  fire(state, 'UserPromptSubmit', prompt('secret plans here'), opts);

  const out = fire(
    state,
    'PreToolUse',
    {
      session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl',
      session_title: 'Secret generated title',
      tool_name: 'Read', tool_use_id: 'call-1', tool_input: { file_path: `${CWD}/a.js` },
    },
    { ...opts, sessionTitle: () => { reads += 1; return 'Secret generated title'; } },
  );

  assert.deepEqual(out.filter((e) => e.type === 'turn.title'), []);
  assert.equal(reads, 0);
});

test('a generated title arriving late retitles the completed turn', () => {
  const state = workingSession();
  const out = fire(state, 'Stop', {
    session_id: SESSION, cwd: CWD, transcript_path: '/x/t.jsonl', summary: 'Finished',
  }, { sessionTitle: 'Add office printer' });

  assert.equal(out.find((e) => e.type === 'turn.end').payload.title, 'Add office printer');
});

test('the stable title comes from Claude transcript metadata, not a custom worktree label', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-title-'));
  try {
    const transcript = path.join(projectsDir, 'session.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'ai-title', aiTitle: 'add-office-printer' }),
      JSON.stringify({ type: 'agent-name', agentName: 'furniture-worktree-setup' }),
      JSON.stringify({ type: 'assistant', message: { content: 'working' } }),
    ].join('\n'));
    fs.writeFileSync(path.join(projectsDir, 'custom-title.json'), JSON.stringify({
      customTitle: 'furniture-worktree-setup',
    }));

    assert.equal(mapper.readSessionTitle(transcript, helpers, projectsDir), 'Add office printer');
    assert.equal(mapper.readSessionTitle('/etc/passwd.jsonl', helpers, projectsDir), null);
    assert.equal(mapper.readSessionTitle(path.join(projectsDir, 'missing.jsonl'), helpers, projectsDir), null);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

// --- redaction ---------------------------------------------------------------

test('metadata mode never lets the user\'s words onto a desk label', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart, { redaction: 'metadata' });
  const out = fire(state, 'UserPromptSubmit', prompt('secret plans here'), { redaction: 'metadata' });
  const turn = out.find((e) => e.type === 'turn.start');
  assert.equal(turn.payload.title, 'Working');
  assert.equal(turn.payload.prompt, undefined);
  assert.equal(turn.payload.prompt_chars, 'secret plans here'.length, 'a length is metadata');
});

test('metadata mode does not read Claude\'s model-generated title', () => {
  const state = { sessions: {} };
  let reads = 0;
  const out = fire(state, 'UserPromptSubmit', prompt('private prompt'), {
    redaction: 'metadata',
    sessionTitle: () => { reads += 1; return 'Private generated title'; },
  });
  assert.equal(reads, 0);
  assert.equal(out.find((e) => e.type === 'turn.start').payload.title, 'Working');
});

test('full mode carries the prompt itself, clamped', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart, { redaction: 'full' });
  const out = fire(state, 'UserPromptSubmit', prompt('Do the thing'), { redaction: 'full' });
  const turn = out.find((e) => e.type === 'turn.start');
  assert.equal(turn.payload.prompt, 'Do the thing');
});

// --- tools -------------------------------------------------------------------

/** A session already introduced and mid-turn, ready for tool traffic. */
function workingSession(opts = {}) {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart, opts);
  fire(state, 'UserPromptSubmit', prompt('Work on it'), opts);
  return state;
}

test('PreToolUse becomes tool.start with the right class and a tidy target', () => {
  const state = workingSession();
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD,
    tool_name: 'Read', tool_use_id: 'call-1',
    tool_input: { file_path: `${CWD}/src/main.js` },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'tool.start');
  assert.equal(out[0].payload.tool_class, 'read');
  assert.equal(out[0].payload.target, 'src/main.js', 'paths leave relative, never absolute');
});

test('a successful edit emits tool.end and an artifact.change with line counts', () => {
  const state = workingSession();
  const args = { file_path: `${CWD}/src/a.js`, old_string: 'one\ntwo', new_string: 'one\ntwo\nthree' };
  fire(state, 'PreToolUse', { session_id: SESSION, cwd: CWD, tool_name: 'Edit', tool_use_id: 'c2', tool_input: args });
  const out = fire(state, 'PostToolUse', {
    session_id: SESSION, cwd: CWD, tool_name: 'Edit', tool_use_id: 'c2', tool_input: args,
    tool_response: { ok: true },
  });

  const end = out.find((e) => e.type === 'tool.end');
  assert.equal(end.payload.status, 'ok');
  assert.equal(typeof end.payload.duration_ms, 'number', 'the start was remembered in state');

  const artifact = out.find((e) => e.type === 'artifact.change');
  assert.equal(artifact.payload.kind, 'file');
  assert.equal(artifact.payload.path, 'src/a.js');
  assert.equal(artifact.payload.added, 3);
  assert.equal(artifact.payload.removed, 2);
});

test('git push is delivery: scm class, then a commit artifact', () => {
  const state = workingSession();
  const input = { command: 'git push origin main' };
  const start = fire(state, 'PreToolUse', { session_id: SESSION, cwd: CWD, tool_name: 'Bash', tool_use_id: 'c3', tool_input: input });
  assert.equal(start[0].payload.tool_class, 'scm');

  const out = fire(state, 'PostToolUse', { session_id: SESSION, cwd: CWD, tool_name: 'Bash', tool_use_id: 'c3', tool_input: input, tool_response: 'ok' });
  const artifact = out.find((e) => e.type === 'artifact.change');
  assert.equal(artifact.payload.kind, 'commit');
});

test('a failed tool reports error — and a failed write changes no artifact', () => {
  const state = workingSession();
  const args = { file_path: `${CWD}/src/a.js`, content: 'x' };
  fire(state, 'PreToolUse', { session_id: SESSION, cwd: CWD, tool_name: 'Write', tool_use_id: 'c4', tool_input: args });
  const out = fire(state, 'PostToolUseFailure', {
    session_id: SESSION, cwd: CWD, tool_name: 'Write', tool_use_id: 'c4', tool_input: args,
    error: 'disk full',
  });
  const end = out.find((e) => e.type === 'tool.end');
  assert.equal(end.payload.status, 'error');
  assert.equal(end.payload.error, 'disk full');
  assert.equal(out.find((e) => e.type === 'artifact.change'), undefined);
});

test('in metadata mode a failure keeps its status but loses its words', () => {
  const state = workingSession({ redaction: 'metadata' });
  fire(state, 'PreToolUse', { session_id: SESSION, cwd: CWD, tool_name: 'Bash', tool_use_id: 'c5', tool_input: { command: 'make' } }, { redaction: 'metadata' });
  const out = fire(state, 'PostToolUseFailure', {
    session_id: SESSION, cwd: CWD, tool_name: 'Bash', tool_use_id: 'c5', error: 'secret in stderr',
  }, { redaction: 'metadata' });
  const end = out.find((e) => e.type === 'tool.end');
  assert.equal(end.payload.status, 'error');
  assert.equal(end.payload.error, undefined);
});

test('tool activity with no turn open opens one — the mid-session-install net', () => {
  const state = { sessions: {} };
  // No SessionStart at all: hooks were installed while this session was running.
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, tool_name: 'Read', tool_use_id: 'c1',
    tool_input: { file_path: `${CWD}/x.js` },
  });
  assert.deepEqual(out.map((e) => e.type), ['session.start', 'turn.start', 'tool.start']);
  assert.equal(out[0].payload.source, 'attach');
});

// --- turns -------------------------------------------------------------------

test('Stop closes the turn with a summary; a new prompt closes a stale one', () => {
  const state = workingSession();
  const stopped = fire(state, 'Stop', { session_id: SESSION, cwd: CWD, summary: 'All done' });
  assert.equal(stopped[0].type, 'turn.end');
  assert.equal(stopped[0].payload.status, 'completed');
  assert.equal(stopped[0].payload.summary, 'All done');

  // Open a turn, then send another prompt without a Stop between.
  fire(state, 'UserPromptSubmit', prompt('Task two', 'p2'));
  const out = fire(state, 'UserPromptSubmit', prompt('Task three', 'p3'));
  assert.deepEqual(out.map((e) => e.type), ['turn.end', 'turn.start']);
  assert.equal(out[1].payload.turn_id, 'p3');
});

// --- subagents ---------------------------------------------------------------

test('a subagent\'s tool call introduces the ghost, bound to its Task call', () => {
  const state = workingSession();
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD,
    agent_id: 'ghost-1', agent_type: 'Explore', parent_tool_use_id: 'task-call-9',
    tool_name: 'Grep', tool_use_id: 'g1', tool_input: { pattern: 'foo' },
  });

  assert.deepEqual(out.map((e) => e.type), ['session.start', 'tool.start']);
  const [ghost, tool] = out;
  assert.equal(ghost.session.kind, 'subagent');
  assert.equal(ghost.session.parent_id, SESSION);
  assert.equal(ghost.session.agent_type, 'Explore');
  assert.equal(ghost.payload.parent_tool_call_id, 'task-call-9');
  assert.equal(tool.session.id, 'ghost-1');
  assert.equal(tool.payload.tool_class, 'search');
});

test('a subagent that did nothing dissolves silently on SubagentStop', () => {
  const state = workingSession();
  fire(state, 'SubagentStart', {
    session_id: SESSION, cwd: CWD, agent_id: 'ghost-2', agent_type: 'Plan', parent_tool_use_id: 't1',
  });
  const out = fire(state, 'SubagentStop', {
    session_id: SESSION, cwd: CWD, agent_id: 'ghost-2', agent_type: 'Plan', parent_tool_use_id: 't1',
  });
  assert.equal(out.find((e) => e.session?.id === 'ghost-2'), undefined,
    'a fan-out of idle ghosts renders as the one Task call it really was');
});

test('a subagent that worked gets a real session.end', () => {
  const state = workingSession();
  fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, agent_id: 'ghost-3', tool_name: 'Read', tool_use_id: 'r1',
    tool_input: { file_path: `${CWD}/x.js` },
  });
  const out = fire(state, 'SubagentStop', { session_id: SESSION, cwd: CWD, agent_id: 'ghost-3' });
  const end = out.find((e) => e.type === 'session.end');
  assert.equal(end.session.id, 'ghost-3');
});

// --- lifecycle ---------------------------------------------------------------

test('SessionEnd on a working session closes the turn, then the session', () => {
  const state = workingSession();
  const out = fire(state, 'SessionEnd', { session_id: SESSION, cwd: CWD, reason: 'exit' });
  assert.deepEqual(out.map((e) => e.type), ['turn.end', 'session.end']);
  assert.equal(out[0].payload.status, 'cancelled');
  assert.equal(out[1].payload.reason, 'exit');
});

test('a new receiver gets the session introduced again, turn and all', () => {
  const state = { sessions: {} };
  fire(state, 'SessionStart', sessionStart, { endpointId: 'ep-1' });
  fire(state, 'UserPromptSubmit', prompt('Long task'), { endpointId: 'ep-1' });

  // The office restarts: same session, different endpoint identity.
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION, cwd: CWD, tool_name: 'Read', tool_use_id: 'r9',
    tool_input: { file_path: `${CWD}/y.js` },
  }, { endpointId: 'ep-2' });

  assert.deepEqual(out.map((e) => e.type), ['session.start', 'turn.start', 'tool.start']);
  assert.equal(out[1].payload.title, 'Long task', 'the turn in flight is repeated to the new listener');
});

test('an unknown hook still proves the session is alive', () => {
  const state = workingSession();
  const out = fire(state, 'SomeFutureEvent', { session_id: SESSION, cwd: CWD });
  assert.equal(out[0].type, 'session.heartbeat');
});

// --- variant -----------------------------------------------------------------

test('variant reads CLAUDE_CODE_ENTRYPOINT and slugs the unknown', () => {
  assert.equal(mapper.variant({ env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } }), 'cli');
  assert.equal(mapper.variant({ env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } }), 'desktop');
  assert.equal(mapper.variant({ env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }), 'sdk');
  assert.equal(mapper.variant({ env: { CLAUDE_CODE_ENTRYPOINT: 'Some New Thing!' } }), 'some-new-thing');
  assert.equal(mapper.variant({ env: {} }), null);
});

// --- todo lists become steps -------------------------------------------------
//
// TodoWrite used to be classed `other` and thrown away, which meant the one signal
// this harness sends about a turn having parts was the one signal we ignored.

/** A TodoWrite PostToolUse, with the list it was called with. */
const todoWrite = (todos, id = 'call-todo') => ({
  session_id: SESSION,
  cwd: CWD,
  tool_name: 'TodoWrite',
  tool_use_id: id,
  tool_input: { todos },
});

const todo = (content, status, activeForm) => ({ content, status, activeForm });

test('a todo list with one item in progress opens a step, and carries the plan', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Run the nightly sweep'));
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('Collect the exports', 'completed', 'Collecting the exports'),
    todo('Check the row counts', 'in_progress', 'Checking the row counts'),
    todo('Post the summary', 'pending', 'Posting the summary'),
  ]));

  const step = out.find((e) => e.type === 'step.start');
  assert.ok(step, 'the tool.end is not the whole of it any more');
  // The present continuous, because this field answers "what is happening now" —
  // both tools make the distinction and it costs nothing to honour it.
  assert.equal(step.payload.title, 'Checking the row counts');
  assert.deepEqual([step.payload.index, step.payload.of], [2, 3]);
  // The plan keeps the imperative: a checklist reads as a list of things to do.
  assert.deepEqual(step.payload.plan.map((e) => e.title),
    ['Collect the exports', 'Check the row counts', 'Post the summary']);
  assert.deepEqual(step.payload.plan.map((e) => e.status),
    ['completed', 'active', 'pending']);
  // Still a tool call, and still desk work: writing a list moves nobody.
  assert.equal(out.find((e) => e.type === 'tool.end').payload.tool_class, 'other');
});

test('the next list closes the last part and opens the next', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Run the nightly sweep'));
  fire(state, 'PostToolUse', todoWrite([
    todo('One', 'in_progress', 'Doing one'), todo('Two', 'pending', 'Doing two'),
  ]));
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('One', 'completed', 'Doing one'), todo('Two', 'in_progress', 'Doing two'),
  ], 'call-todo-2'));

  const [end, start] = [out.find((e) => e.type === 'step.end'), out.find((e) => e.type === 'step.start')];
  assert.equal(end.payload.status, 'completed');
  assert.equal(start.payload.title, 'Doing two');
  // The end must come before the start: a reducer would cope either way (§4.2 rule 2)
  // but the log is read by people, and out-of-order pairs read as a bug.
  assert.ok(out.indexOf(end) < out.indexOf(start));
});

test('a part left pending while another starts was skipped, not finished', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Run the nightly sweep'));
  fire(state, 'PostToolUse', todoWrite([
    todo('One', 'in_progress'), todo('Two', 'pending'), todo('Three', 'pending'),
  ]));
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'pending'), todo('Three', 'in_progress'),
  ], 'call-todo-2'));

  // The distinction that makes step.end worth emitting at all: without it a part
  // passed over looks exactly like a part done.
  assert.equal(out.find((e) => e.type === 'step.end').payload.status, 'skipped');
});

test('a part that vanishes from the list was cancelled', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  fire(state, 'PostToolUse', todoWrite([todo('One', 'in_progress'), todo('Two', 'pending')]));
  const out = fire(state, 'PostToolUse', todoWrite([todo('Two', 'in_progress')], 'call-todo-2'));
  assert.equal(out.find((e) => e.type === 'step.end').payload.status, 'cancelled');
});

test('the last part closing emits an end and no start', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  fire(state, 'PostToolUse', todoWrite([todo('One', 'in_progress')]));
  const out = fire(state, 'PostToolUse', todoWrite([todo('One', 'completed')], 'call-todo-2'));
  assert.equal(out.filter((e) => e.type === 'step.end').length, 1);
  assert.equal(out.filter((e) => e.type === 'step.start').length, 0);
  assert.equal(state.sessions[SESSION].todo.activeId, null, 'nothing left in hand');
});

test('the same list twice says nothing the second time', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  const list = [todo('One', 'in_progress'), todo('Two', 'pending')];
  fire(state, 'PostToolUse', todoWrite(list));
  const out = fire(state, 'PostToolUse', todoWrite(list, 'call-todo-2'));
  assert.equal(out.filter((e) => e.type.startsWith('step.')).length, 0,
    'an agent re-reading its own list has not moved on');
});

test('an item that changes position keeps its identity', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  fire(state, 'PostToolUse', todoWrite([todo('One', 'in_progress'), todo('Two', 'pending')]));
  // A forgotten step inserted at the top renumbers everything below it. Ids are
  // hashed from the text for exactly this reason: position is the one thing about a
  // todo list that genuinely moves.
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('Zero', 'pending'), todo('One', 'in_progress'), todo('Two', 'pending'),
  ], 'call-todo-2'));
  assert.equal(out.filter((e) => e.type.startsWith('step.')).length, 0,
    'still on the same part, however far down the list it slid');
});

test('at metadata the counters survive and the words do not', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'), { redaction: 'metadata' });
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('Collect the exports', 'completed'), todo('Check the row counts', 'in_progress'),
  ]), { redaction: 'metadata' });

  const step = out.find((e) => e.type === 'step.start');
  // A tool *name* is operator-authored and survives `metadata`. A todo item is a
  // sentence the model wrote, so it goes — and the office says "Step 2 of 2".
  assert.equal(step.payload.title, undefined);
  assert.equal(step.payload.plan, undefined);
  assert.deepEqual([step.payload.index, step.payload.of], [2, 2]);
});

test('a failed TodoWrite announces no part, because none was started', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  const out = fire(state, 'PostToolUseFailure', todoWrite([todo('One', 'in_progress')]));
  assert.equal(out.filter((e) => e.type.startsWith('step.')).length, 0);
});

test('an empty or absent list is not a plan', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  assert.equal(fire(state, 'PostToolUse', todoWrite([]))
    .filter((e) => e.type.startsWith('step.')).length, 0);
  assert.equal(fire(state, 'PostToolUse', todoWrite(undefined, 'c2'))
    .filter((e) => e.type.startsWith('step.')).length, 0);
});

test('a long checklist is truncated to 20 and a long title to its cap', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  const todos = Array.from({ length: 26 }, (_, i) => todo(`Item ${i + 1}`, i === 0 ? 'in_progress' : 'pending'));
  todos[0] = todo('z'.repeat(300), 'in_progress', 'y'.repeat(300));
  const out = fire(state, 'PostToolUse', todoWrite(todos));
  const step = out.find((e) => e.type === 'step.start');
  assert.equal(step.payload.plan.length, 20);
  assert.equal(step.payload.title.length, CAPS.step_title);
  // `of` counts the real list, not the plan we could carry: the office would
  // otherwise shorten somebody's afternoon.
  assert.equal(step.payload.of, 26);
});

test('step.start and step.end are declared as capabilities', () => {
  assert.ok(mapper.CAPABILITIES.includes('step.start'));
  assert.ok(mapper.CAPABILITIES.includes('step.end'));
});

test('a skip is remembered, because every later list puts the item back at pending', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  fire(state, 'PostToolUse', todoWrite([
    todo('One', 'in_progress'), todo('Two', 'pending'), todo('Three', 'pending'),
  ]));
  fire(state, 'PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'in_progress'), todo('Three', 'pending'),
  ], 'c2'));
  // Third call, and `One` is still `pending` in the harness's list — it has no way to
  // say "skipped". Without remembering the inference, this plan would un-skip it and
  // the receiver's mark would be silently overwritten.
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'completed'), todo('Three', 'in_progress'),
  ], 'c3'));

  const plan = out.find((e) => e.type === 'step.start').payload.plan;
  assert.deepEqual(plan.map((e) => e.status), ['skipped', 'completed', 'active']);
});

test('a part picked back up stops being skipped', () => {
  const state = { sessions: {} };
  fire(state, 'UserPromptSubmit', prompt('Sweep'));
  fire(state, 'PostToolUse', todoWrite([todo('One', 'in_progress'), todo('Two', 'pending')]));
  fire(state, 'PostToolUse', todoWrite([todo('One', 'pending'), todo('Two', 'in_progress')], 'c2'));
  // Second thoughts: the agent comes back to the part it passed over. The list is the
  // newer truth of the two, and the remembered skip must not outvote it.
  const out = fire(state, 'PostToolUse', todoWrite([
    todo('One', 'in_progress'), todo('Two', 'completed'),
  ], 'c3'));

  const plan = out.find((e) => e.type === 'step.start').payload.plan;
  assert.deepEqual(plan.map((e) => e.status), ['active', 'completed']);
});
