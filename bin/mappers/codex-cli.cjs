// Codex hooks -> AOP.
//
// Codex and Claude Code deliberately share almost the same hook vocabulary and
// payload shape. Keep the state machine in the proven Claude mapper, and make
// the differences explicit here: Codex calls a prompt id a `turn_id`, names its
// built-in tools differently, and shapes plans and patches differently.

'use strict';

const claude = require('./claude-code.cjs');

const CAPABILITIES = claude.CAPABILITIES.filter((name) => ![
  'session.heartbeat',
  'permission.resolve',
  'notification',
].includes(name));

const TOOL_NAMES = {
  exec_command: 'Bash',
  write_stdin: 'Bash',
  apply_patch: 'Edit',
  update_plan: 'TodoWrite',
  request_user_input: 'AskUserQuestion',
  spawn_agent: 'Task',
  view_image: 'Read',
};

function firstPatchPath(args) {
  const patch = [args.patch, args.input, args.command].find((value) => typeof value === 'string');
  if (!patch) return undefined;
  const match = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch);
  return match?.[1]?.trim();
}

function toolFailed(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  if (response.is_error === true || response.isError === true || response.error) return true;
  // Codex currently sends Bash's model-facing text rather than a structured
  // exit status, so quiet command failures cannot be distinguished. Keep the
  // structured cases for MCP/local tools and for a future richer Bash response.
  const exitCode = response.exit_code ?? response.exitCode;
  return Number.isFinite(exitCode) && exitCode !== 0;
}

function normalize(payload) {
  const next = { ...payload };
  if (next.prompt_id == null && next.turn_id != null) next.prompt_id = next.turn_id;
  if (next.last_message == null && next.last_assistant_message != null) {
    next.last_message = next.last_assistant_message;
  }

  const originalName = next.tool_name;
  if (typeof originalName === 'string') next.tool_name = TOOL_NAMES[originalName] ?? originalName;

  const input = next.tool_input && typeof next.tool_input === 'object'
    ? { ...next.tool_input }
    : {};

  if (originalName === 'apply_patch') {
    input.file_path ??= firstPatchPath(input);
  } else if (originalName === 'update_plan' && Array.isArray(input.plan)) {
    input.todos = input.plan.map((item) => ({
      content: item?.step,
      activeForm: item?.step,
      status: item?.status,
    }));
  }
  next.tool_input = input;
  if (next.reason == null && typeof input.description === 'string') next.reason = input.description;

  if (toolFailed(next.tool_response)) next.success = false;
  return next;
}

function map(options) {
  const events = claude.map({ ...options, payload: normalize(options.payload) });
  for (const event of events) {
    if (event.type === 'session.start') event.payload.capabilities = CAPABILITIES;
  }
  return events;
}

module.exports = { map, normalize, CAPABILITIES, TOOL_NAMES };
