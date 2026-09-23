// Cursor hooks → Agent Office Protocol.
//
// Cursor's native hook names are camelCase and its generic tool hooks carry
// `tool_name`, `tool_input`, and `tool_use_id`. Keep those names at this edge;
// the rest of the office only sees the harness-neutral AOP vocabulary.
'use strict';

const { makeClassifier, argsOf, targetOf } = require('./lib/tool-classes.cjs');
const { isTodoTool, stepEvents, closeOpenStep, resetTodoState } = require('./lib/todo-steps.cjs');
const { stateFor, defined, resultBytes } = require('./lib/event-shape.cjs');

const CAPABILITIES = [
  'session.start', 'session.end', 'turn.start', 'turn.end',
  'step.start', 'step.end', 'tool.start', 'tool.end', 'artifact.change', 'context.compact',
];

const TOOL_CLASSES = {
  Read: 'read', ReadFile: 'read', Grep: 'search', Glob: 'search',
  Write: 'edit', Edit: 'edit', Delete: 'edit', ApplyPatch: 'edit',
  Shell: 'execute', Task: 'agent', TodoWrite: 'other', todo_write: 'other',
};
const classify = makeClassifier(TOOL_CLASSES);

const END_REASONS = {
  completed: 'exit', exit: 'exit', cancelled: 'killed', canceled: 'killed',
  error: 'error', failed: 'error', timeout: 'timeout',
};

function sessionFrom(payload, helpers) {
  const id = helpers.firstString(payload.session_id, payload.sessionId, payload.session);
  if (!id) return null;
  const cwd = helpers.firstString(payload.cwd, payload.working_directory, payload.workspace_roots?.[0]);
  return { id, ...(cwd ? { cwd } : {}) };
}

function toolFailed(payload) {
  if (payload.success === false || payload.error) return true;
  const result = payload.tool_output ?? payload.tool_response ?? payload.output ?? payload.result;
  return Boolean(result && typeof result === 'object' && (result.error || result.is_error || result.isError));
}

function editSize(edits) {
  if (!Array.isArray(edits)) return {};
  const lines = (value) => typeof value === 'string' && value ? value.split('\n').length : 0;
  return edits.reduce((total, edit) => ({
    added: total.added + lines(edit?.new_string),
    removed: total.removed + lines(edit?.old_string),
  }), { added: 0, removed: 0 });
}

function map({ event, payload = {}, state, redaction, helpers }) {
  const session = sessionFrom(payload, helpers);
  if (!session) return [];
  const sessionState = stateFor(state, session.id);
  const ts = helpers.toIso(payload.timestamp);
  const cwd = session.cwd;
  const out = [];

  const ensureSession = (source = 'attach') => {
    if (sessionState.started) return;
    sessionState.started = true;
    out.push({ type: 'session.start', ts, session, payload: {
      source, capabilities: CAPABILITIES, redaction,
      transcript: Boolean(payload.transcript_path),
      model: helpers.firstString(payload.model, payload.model_id),
    } });
  };
  const closeTurn = (status = 'completed', summary) => {
    if (!sessionState.turnOpen) return;
    out.push(...closeOpenStep(sessionState.todo, {
      status: status === 'error' ? 'failed' : (status === 'cancelled' ? 'cancelled' : 'completed'),
      ts, session,
    }));
    sessionState.turnOpen = false;
    out.push({ type: 'turn.end', ts, session, payload: defined({
      turn_id: sessionState.turnId, status, summary,
      duration_ms: sessionState.turnAt ? Date.now() - sessionState.turnAt : undefined,
    }) });
    sessionState.turnId = undefined;
  };
  const openTurn = (prompt, trigger = 'user') => {
    if (sessionState.turnOpen) closeTurn();
    sessionState.turnOpen = true;
    sessionState.turnAt = Date.now();
    resetTodoState(sessionState.todo);
    sessionState.turnId = helpers.firstString(payload.generation_id, payload.prompt_id, payload.request_id);
    const title = redaction === 'metadata' ? 'Working'
      : helpers.clamp(String(prompt ?? 'Working').split('\n')[0], helpers.CAPS.title) ?? 'Working';
    out.push({ type: 'turn.start', ts, session, payload: defined({
      turn_id: sessionState.turnId, title, trigger,
      prompt: redaction === 'full' ? helpers.clamp(prompt, helpers.CAPS.prompt) : undefined,
      prompt_chars: prompt ? String(prompt).length : undefined,
    }) });
  };

  ensureSession(event === 'sessionStart' ? 'startup' : 'attach');

  switch (event) {
    case 'sessionStart': break;
    case 'beforeSubmitPrompt': openTurn(helpers.firstString(payload.prompt, payload.message, payload.text)); break;
    case 'preToolUse': {
      const toolName = helpers.firstString(payload.tool_name, payload.toolName) ?? 'tool';
      const args = argsOf(payload);
      const command = helpers.firstString(args.command, args.cmd);
      const id = helpers.firstString(payload.tool_use_id, payload.toolUseId, payload.tool_call_id)
        ?? `${session.id}:${++sessionState.seq}`;
      if (!sessionState.turnOpen) openTurn('Working');
      const toolClass = classify(toolName, command);
      sessionState.tools[id] = { toolName, toolClass, at: Date.now() };
      out.push({ type: 'tool.start', ts, session, payload: {
        tool_call_id: id, tool_name: toolName, tool_class: toolClass,
        target: targetOf(args, command, cwd, helpers, redaction),
      } });
      break;
    }
    case 'postToolUse':
    case 'postToolUseFailure': {
      const id = helpers.firstString(payload.tool_use_id, payload.toolUseId, payload.tool_call_id);
      const known = id ? sessionState.tools[id] : null;
      const toolName = helpers.firstString(payload.tool_name, payload.toolName, known?.toolName) ?? 'tool';
      const args = argsOf(payload);
      const command = helpers.firstString(args.command, args.cmd);
      const failed = event === 'postToolUseFailure' || toolFailed(payload);
      out.push({ type: 'tool.end', ts, session, payload: defined({
        tool_call_id: id ?? `${session.id}:unknown`, tool_name: toolName,
        tool_class: known?.toolClass ?? classify(toolName, command), status: failed ? 'error' : 'ok',
        duration_ms: known?.at ? Date.now() - known.at : undefined,
        error: failed && redaction !== 'metadata'
          ? helpers.clamp(helpers.firstString(payload.error, payload.message), helpers.CAPS.message) : undefined,
        result_bytes: resultBytes(payload.tool_output ?? payload.tool_response ?? payload.output ?? payload.result),
      }) });
      if (id) delete sessionState.tools[id];
      if (!failed && isTodoTool(toolName)) {
        out.push(...stepEvents({
          todos: args.todos, merge: args.merge === true, todoState: sessionState.todo,
          session, ts, redaction, helpers,
        }));
      }
      break;
    }
    case 'beforeShellExecution': {
      // Generic tool hooks normally cover Shell. Only synthesize this boundary
      // when Cursor did not provide a matching generic tool call.
      if (Object.values(sessionState.tools).some((tool) => tool.toolName === 'Shell')) break;
      const id = `shell:${++sessionState.seq}`;
      if (!sessionState.turnOpen) openTurn('Working');
      sessionState.tools[id] = { toolName: 'Shell', toolClass: 'execute', at: Date.now() };
      out.push({ type: 'tool.start', ts, session, payload: {
        tool_call_id: id, tool_name: 'Shell', tool_class: 'execute',
        target: targetOf({ command: payload.command }, payload.command, cwd, helpers, redaction),
      } });
      break;
    }
    case 'afterShellExecution': {
      const id = Object.keys(sessionState.tools).find((key) => sessionState.tools[key]?.toolName === 'Shell');
      if (!id) break;
      const known = sessionState.tools[id];
      out.push({ type: 'tool.end', ts, session, payload: defined({
        tool_call_id: id, tool_name: 'Shell', tool_class: 'execute', status: 'ok',
        duration_ms: Number.isFinite(payload.duration) ? payload.duration : Date.now() - known.at,
        result_bytes: resultBytes(payload.output),
      }) });
      delete sessionState.tools[id];
      break;
    }
    case 'afterFileEdit': {
      const path = helpers.firstString(payload.file_path, payload.path);
      if (path) out.push({ type: 'artifact.change', ts, session, payload: {
        kind: 'file', path: helpers.tidyPath(path, cwd), ...editSize(payload.edits),
      } });
      break;
    }
    case 'preCompact':
      out.push({ type: 'context.compact', ts, session, payload: { trigger: 'auto' } }); break;
    case 'stop': closeTurn(payload.error ? 'error' : 'completed', redaction === 'metadata' ? undefined
      : helpers.clamp(helpers.firstString(payload.summary, payload.message), helpers.CAPS.summary)); break;
    case 'sessionEnd':
      closeTurn('cancelled');
      out.push({ type: 'session.end', ts, session, payload: {
        reason: END_REASONS[String(payload.reason ?? '').toLowerCase()] ?? 'other',
      } });
      break;
    default:
      out.push({ type: 'session.heartbeat', ts, session, payload: {} });
  }
  return out;
}

module.exports = { map, CAPABILITIES, TOOL_CLASSES, classify };
