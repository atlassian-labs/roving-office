// Codex hook payloads -> AOP. The fixture field names match the public Codex
// hook contract; the stateful driver is the same one aop-send uses per event.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mapper = require('../bin/mappers/codex-cli.cjs');
const { driver } = require('./lib/mapper.cjs');

const SESSION = 'codex-session-1';
const CWD = '/work/repo';

const fire = driver(mapper);

function startWorking(redaction = 'summary') {
  const state = { sessions: {} };
  fire(state, 'SessionStart', {
    session_id: SESSION, cwd: CWD, source: 'startup', model: 'gpt-5.6',
  }, { redaction });
  fire(state, 'UserPromptSubmit', {
    session_id: SESSION, cwd: CWD, turn_id: 'turn-7', prompt: 'Fix the parser',
  }, { redaction });
  return state;
}

test('turn_id opens a turn and the introduction declares only Codex capabilities', () => {
  const state = { sessions: {} };
  assert.deepEqual(fire(state, 'SessionStart', {
    session_id: SESSION, cwd: CWD, source: 'startup', model: 'gpt-5.6',
  }), []);

  const out = fire(state, 'UserPromptSubmit', {
    session_id: SESSION, cwd: CWD, turn_id: 'turn-7', prompt: 'Fix the parser',
  });
  assert.deepEqual(out.map((event) => event.type), ['session.start', 'turn.start']);
  assert.equal(out[0].payload.model, 'gpt-5.6');
  assert.deepEqual(out[0].payload.capabilities, mapper.CAPABILITIES);
  assert.equal(out[1].payload.turn_id, 'turn-7');
  assert.ok(!mapper.CAPABILITIES.includes('permission.resolve'));
  assert.ok(!mapper.CAPABILITIES.includes('notification'));
});

test('Bash is an execute tool; plain responses do not invent a failure signal', () => {
  const state = startWorking();
  const payload = {
    session_id: SESSION,
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: 'call-1',
    tool_input: { command: 'npm test' },
  };
  const start = fire(state, 'PreToolUse', payload);
  assert.equal(start[0].payload.tool_name, 'Bash');
  assert.equal(start[0].payload.tool_class, 'execute');

  const end = fire(state, 'PostToolUse', {
    ...payload,
    tool_response: 'command output without a structured status',
  });
  assert.equal(end[0].payload.status, 'ok');
});

test('apply_patch emits a file artifact without retaining patch text', () => {
  const state = startWorking();
  const patch = '*** Begin Patch\n*** Update File: src/parser.js\n@@\n-old\n+new\n*** End Patch';
  const payload = {
    session_id: SESSION,
    cwd: CWD,
    tool_name: 'apply_patch',
    tool_use_id: 'call-patch',
    tool_input: { command: patch },
  };
  const start = fire(state, 'PreToolUse', payload);
  assert.equal(start[0].payload.tool_class, 'edit');
  assert.equal(start[0].payload.target, 'src/parser.js');

  const end = fire(state, 'PostToolUse', { ...payload, tool_response: { ok: true } });
  const artifact = end.find((event) => event.type === 'artifact.change');
  assert.equal(artifact.payload.path, 'src/parser.js');
  assert.equal(JSON.stringify(end).includes('old'), false);
});

test('update_plan becomes step events', () => {
  const state = startWorking();
  const out = fire(state, 'PostToolUse', {
    session_id: SESSION,
    cwd: CWD,
    tool_name: 'update_plan',
    tool_use_id: 'call-plan',
    tool_input: {
      plan: [
        { step: 'Inspect the parser', status: 'completed' },
        { step: 'Fix the parser', status: 'in_progress' },
        { step: 'Run the tests', status: 'pending' },
      ],
    },
    tool_response: {},
  });
  const step = out.find((event) => event.type === 'step.start');
  assert.equal(step.payload.title, 'Fix the parser');
  assert.deepEqual([step.payload.index, step.payload.of], [2, 3]);
});

test('request_user_input is classified as waiting', () => {
  const state = startWorking('metadata');
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION,
    cwd: CWD,
    tool_name: 'request_user_input',
    tool_use_id: 'call-question',
    tool_input: { questions: [{ question: 'Which one?' }] },
  }, 'metadata');
  assert.equal(out[0].payload.tool_class, 'wait');
  assert.equal(JSON.stringify(out).includes('Which one?'), false);
});

test('PermissionRequest carries the tool class and human-readable reason', () => {
  const state = startWorking();
  const out = fire(state, 'PermissionRequest', {
    session_id: SESSION,
    cwd: CWD,
    turn_id: 'turn-7',
    tool_name: 'apply_patch',
    tool_input: {
      command: '*** Begin Patch\n*** Update File: src/parser.js\n*** End Patch',
      description: 'Update the parser',
    },
  });
  const request = out.find((event) => event.type === 'permission.request');
  assert.equal(request.payload.tool_class, 'edit');
  assert.equal(request.payload.target, 'src/parser.js');
  assert.equal(request.payload.reason, 'Update the parser');
});

test('subagent work is attributed to a real ghost', () => {
  const state = startWorking();
  const out = fire(state, 'PreToolUse', {
    session_id: SESSION,
    cwd: CWD,
    agent_id: 'agent-2',
    agent_type: 'explorer',
    tool_name: 'view_image',
    tool_use_id: 'call-image',
    tool_input: { path: '/work/repo/shot.png' },
  });
  assert.deepEqual(out.map((event) => event.type), ['session.start', 'tool.start']);
  assert.equal(out[0].session.parent_id, SESSION);
  assert.equal(out[0].payload.parent_tool_call_id, undefined,
    'Codex identifies the parent session but does not expose the spawning tool id');
  assert.equal(out[1].payload.tool_class, 'read');
});

test('Stop uses last_assistant_message as the redacted summary', () => {
  const state = startWorking();
  const out = fire(state, 'Stop', {
    session_id: SESSION,
    cwd: CWD,
    last_assistant_message: 'The parser is fixed.',
  });
  assert.equal(out[0].type, 'turn.end');
  assert.equal(out[0].payload.summary, 'The parser is fixed.');
});
