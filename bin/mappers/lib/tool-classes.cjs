// Tool name → `tool_class`, shared by every mapper.
//
// `tool_class` is the closed enum the office actually renders (spec §4.3): it is
// what decides whether a character sits at the desk, walks to the bookshelf or
// carries something to the outbox. Each harness names its tools differently, but
// the *guesses* you have to make about an unfamiliar name are identical
// everywhere — an `mcp__…` tool is a knowledge lookup whether Claude or Rovo
// called it, and `git push` is delivery in any terminal.
//
// So the exact tables live in the per-harness mapper, and the fallbacks live
// here. This matters more than it looks: MCP servers, plugins and new built-ins
// mean every mapper permanently has an unknown-tool problem, and two copies of
// these regexes would drift apart the first time one of them was improved.
//
// This file deliberately sits in `lib/` rather than beside the mappers, because
// `aop-send` resolves `./mappers/<harness>.cjs` from the harness name — a module
// directly in that directory would be loadable as a harness called "lib" and
// would fail confusingly.

'use strict';

/**
 * Fallbacks for tools no table knows, tried in order. Ordering is the whole
 * design: `search_code` must read as search before `code` suggests anything
 * else, and `create_page` must read as an edit rather than as knowledge.
 */
const CLASS_PATTERNS = [
  [/^mcp__|confluence|jira|bitbucket|slack|compass|assets|knowledge|graph|search_code/, 'knowledge'],
  [/subagent|delegate|^task$/, 'agent'],
  [/grep|glob|\bfind\b|search/, 'search'],
  [/fetch|http|web|curl|browser/, 'network'],
  [/commit|push|pull_request|\bpr\b|merge|branch/, 'scm'],
  [/write|edit|create|delete|move|rename|replace|patch/, 'edit'],
  [/bash|shell|exec|run_|command|terminal/, 'execute'],
  [/read|open|view|expand|cat\b/, 'read'],
  [/sleep|wait|poll|watch/, 'wait'],
];

/**
 * Shell commands worth reclassifying. A `Bash` tool call is `execute` by name,
 * but `git push` is the moment work leaves the building, and the office has a
 * different animation for that. The command line is the only place that
 * distinction exists, so it is read — first token only, never logged.
 */
const COMMAND_CLASSES = [
  [/^git\s+(commit|push|tag|merge)|^gh\s+pr|^glab\s+mr/, 'scm'],
  [/^(rg|grep|ag|fd|find)\b/, 'search'],
  [/^(curl|wget|http)\b/, 'network'],
  [/^rovo\b/, 'knowledge'],
  [/^(sleep|watch)\b/, 'wait'],
];

/**
 * Words that wrap a command without saying anything about the work. `sudo`,
 * `env FOO=1`, `nohup`, `time` — each describes *how* something runs, and the
 * office only wants to know *what* is running.
 */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'time', 'command', 'exec', 'nice', 'stdbuf']);

/** Wrapper flags that swallow the token after them, so it is not read as the program. */
const VALUE_FLAGS = new Set(['-u', '--user', '-g', '--group', '-C', '--chdir', '-p', '--prefix']);

/**
 * Shells invoked to run something else: `bash -lc "./scripts/ingest.sh"`. The
 * shell is not the work — its `-c` payload is, so that is what gets read.
 */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'ash']);

/**
 * Segment heads that only prepare the ground. `cd repo && npm test` is a command
 * about npm; a label reading "cd" would be true and useless.
 */
const PREAMBLE = new Set(['cd', 'pushd', 'popd', 'export', 'unset', 'set', 'source', '.', 'umask']);

/** Interpreters whose first path-shaped argument is the thing actually being run. */
const INTERPRETERS = new Set([
  'node', 'python', 'python3', 'ruby', 'perl', 'deno', 'bun', 'php', 'osascript', 'Rscript', 'tsx',
]);

/**
 * CLIs where the subcommand *is* the identity of the work. `git commit` and
 * `git push` are different events in the office, and `npm run probe` is a
 * different job from `npm install`.
 *
 * An allowlist rather than a rule, because appending argument words to an
 * arbitrary command is exactly how a secret reaches a desk label. A known CLI's
 * subcommands are a small public vocabulary; an unknown command's arguments are
 * anything at all.
 */
const SUBCOMMAND_CLIS = new Set([
  'git', 'gh', 'glab', 'jj', 'hg', 'svn',
  'npm', 'pnpm', 'yarn', 'npx', 'bun', 'deno', 'make', 'just', 'cargo', 'go', 'gradle', 'mvn',
  'docker', 'podman', 'kubectl', 'helm', 'terraform', 'systemctl', 'brew', 'apt', 'apt-get',
  'pip', 'pip3', 'poetry', 'uv', 'rovo', 'claude', 'aws', 'gcloud', 'az', 'flyctl', 'fly',
]);

/** Tokens that read as credentials by name. Retention stops at one of these. */
const SECRETISH = /(pass|pwd|secret|token|key|cred|auth|bearer|session|cookie|otp)/i;

/** The last segment of a path, on either separator. */
function basenameOf(value) {
  const m = /[^/\\]*$/.exec(String(value));
  return m && m[0] ? m[0] : String(value);
}

/**
 * Does this token read as a subcommand rather than as an argument?
 *
 * A subcommand is a short, plain word, and the shape test does most of the work:
 * it rejects flags, `KEY=value`, URLs, paths and anything quoted. The second
 * test catches what shape cannot — a generated credential that happens to be
 * word-shaped, like `AKIAIOSFODNN7EXAMPLE`.
 *
 * Note what is deliberately *not* rejected here: a word like `auth`, `token` or
 * `key`. Those are names, and a name is not a secret — `gh auth` is a perfectly
 * good label. It is the token *after* one of them that is dangerous, which is a
 * rule about where to stop rather than about what a word looks like, so it lives
 * with the loop in `commandLabel`.
 */
function wordShaped(token) {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(token)) return false;
  // Mixed case with digits, at length, is a generated string rather than a word.
  if (token.length > 16 && /\d/.test(token) && /[A-Z]/.test(token)) return false;
  return true;
}

/**
 * Split a command line into tokens, remembering which were quoted.
 *
 * The quoting matters more than the splitting. A quoted token is free text its
 * author chose — a commit message, a `-c` script, a password — and nothing
 * quoted is ever emitted. Tracking it here lets every rule below be about
 * meaning rather than about escaping.
 */
function tokenize(line) {
  const out = [];
  let buf = '';
  let quote = null;
  let quoted = false;
  const push = () => { if (buf) out.push({ text: buf, quoted }); buf = ''; quoted = false; };

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; quoted = true; continue; }
    if (c === '\\') { i += 1; buf += line[i] ?? ''; continue; }
    if (/\s/.test(c)) { push(); continue; }
    if ('|&;<>()'.includes(c)) {
      push();
      let op = c;
      if ((c === '&' || c === '|') && line[i + 1] === c) { op = c + c; i += 1; }
      out.push({ text: op, operator: true });
      continue;
    }
    buf += c;
  }
  push();
  return out;
}

/**
 * Reduce a command line to the tokens of the one thing worth naming.
 *
 * Three reductions, repeated until nothing more comes off:
 *  - **Segments.** Split on `&&`, `;`, `|` and friends, then skip the segments
 *    that only prepare the ground (`cd …`). A pipeline is named by its head,
 *    where the intent usually lives (`rg pattern | head`).
 *  - **Assignments.** A leading `FOO=bar` is environment, and its value may be a
 *    secret, so it goes without being read.
 *  - **Wrappers.** `sudo`, `env`, `time`, and a shell running a `-c` payload —
 *    which recurses, because `bash -lc "cd repo && ./x.sh"` hides two more
 *    layers of the same problem.
 *
 * Pure and helper-free on purpose: the classifier wants this too — a `git push`
 * behind a `cd` is still delivery — and the classifier has no cwd to hand.
 *
 * @returns {{text: string, quoted?: boolean}[]} tokens, program first
 */
function unwrapCommand(command, depth = 0) {
  const line = String(command ?? '').trim();
  if (!line || depth > 3) return [];

  const segments = [[]];
  for (const t of tokenize(line)) {
    if (t.operator) { if (segments[segments.length - 1].length) segments.push([]); }
    else segments[segments.length - 1].push(t);
  }
  let tokens = segments.find((seg) => seg[0] && !PREAMBLE.has(basenameOf(seg[0].text)))
    ?? segments.find((seg) => seg.length)
    ?? [];

  for (let guard = 0; guard < 6 && tokens.length; guard += 1) {
    while (tokens.length && !tokens[0].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0].text)) {
      tokens = tokens.slice(1);
    }
    const head = tokens[0];
    if (!head) break;
    const name = basenameOf(head.text);

    if (WRAPPERS.has(name)) {
      tokens = tokens.slice(1);
      while (tokens.length && tokens[0].text.startsWith('-')) {
        tokens = tokens.slice(VALUE_FLAGS.has(tokens[0].text) ? 2 : 1);
      }
      continue;
    }

    if (SHELLS.has(name)) {
      const flag = tokens.findIndex((t, i) => i > 0 && !t.quoted && /^-[a-z]*c[a-z]*$/.test(t.text));
      const payload = flag >= 0 ? tokens[flag + 1] : undefined;
      if (payload && payload.text) {
        const inner = unwrapCommand(payload.text, depth + 1);
        return inner.length ? inner : tokens.slice(1);
      }
      // `bash script.sh` — no payload, so whatever follows is the work.
      tokens = tokens.slice(1);
      continue;
    }

    break;
  }

  return tokens;
}

/** The unwrapped line, for pattern-matching only — never emitted. See `commandLabel`. */
function unwrappedLine(command) {
  return unwrapCommand(command).map((t) => t.text).join(' ');
}

/**
 * Build a classifier over one harness's own tool table.
 *
 * Precedence, and why: an explicit shell command beats everything, because
 * `Bash` and `bash` tell you nothing while their argument tells you everything.
 * Then the harness's exact table, then the shared patterns, then `other` — which
 * the office renders as plain work rather than as nothing.
 *
 * The command is matched twice, as written and unwrapped, because
 * `COMMAND_CLASSES` is anchored to the start of the line: without the second
 * pass a `git push` behind a `cd … &&` or a `bash -lc` reads as ordinary shell
 * work, and the office misses the moment work left the building.
 *
 * @param {Record<string, string>} table exact tool name → tool_class
 * @returns {(toolName?: string, command?: string) => string}
 */
function makeClassifier(table) {
  return function classify(toolName, command) {
    if (command) {
      for (const [re, cls] of COMMAND_CLASSES) if (re.test(command)) return cls;
      const unwrapped = unwrappedLine(command);
      if (unwrapped && unwrapped !== String(command).trim()) {
        for (const [re, cls] of COMMAND_CLASSES) if (re.test(unwrapped)) return cls;
      }
    }
    if (!toolName) return command ? 'execute' : 'other';
    const exact = table[toolName];
    if (exact) return exact;
    const lower = toolName.toLowerCase();
    for (const [re, cls] of CLASS_PATTERNS) if (re.test(lower)) return cls;
    return 'other';
  };
}

/** The tool arguments object, wherever a given harness happens to put it. */
function argsOf(entry) {
  for (const k of ['tool_input', 'tool_args', 'args', 'arguments', 'input', 'parameters', 'params']) {
    if (entry && entry[k] && typeof entry[k] === 'object' && !Array.isArray(entry[k])) return entry[k];
  }
  return {};
}

/**
 * A path as a label: relative to the session's cwd where it sits underneath it,
 * and otherwise just its basename.
 *
 * Two reasons for the basename. Somebody else's absolute path is both
 * identifying and, at the width of a desk label, mostly prefix — and the prefix
 * is the half that says nothing. `~/.openclaw/workspace-paige/scripts/ingest.sh`
 * describes a machine; `ingest.sh` describes the job.
 */
function pathLabel(value, cwd, helpers) {
  const raw = String(value).replace(/^\.\//, '');
  const tidied = helpers.tidyPath(raw, cwd);
  if (!tidied) return undefined;
  return /^[/~]/.test(tidied) ? basenameOf(tidied) : tidied;
}

/**
 * Name what a shell command is doing, in as few words as are true.
 *
 * The old rule here was "first token, cut to 40 characters", which is right for
 * `rg` and wrong for everything a scheduled job runs: a cron whose command is an
 * absolute path to a script spent all forty characters on the directories and
 * ran out before the filename, so the office showed a truncated home directory
 * and the log said only that *something* was executing.
 *
 * So: unwrap the command to the part that matters, name a path by its file, and
 * for CLIs whose subcommands are their identity keep a word or two more. Never
 * the whole command line, never a quoted string, never an assignment, and never
 * an argument to a command we do not have a vocabulary for — those are where
 * secrets live, and a desk label is not worth a leak.
 */
function commandLabel(command, cwd, helpers) {
  const tokens = unwrapCommand(command);
  const head = tokens[0];
  if (!head) return undefined;

  const program = /[/\\]/.test(head.text) ? pathLabel(head.text, cwd, helpers) : head.text;
  if (!program) return undefined;

  const parts = [program];
  const name = basenameOf(program);
  const rest = tokens.slice(1);

  if (INTERPRETERS.has(name)) {
    // `node bin/aop-send.cjs` is about the script, not about node. A path or a
    // suffixed filename only: `python -c "…"` has code where a script would be.
    const script = rest.find((t) => !t.quoted
      && !t.text.startsWith('-')
      && (/[/\\]/.test(t.text) || /\.[A-Za-z0-9]+$/.test(t.text)));
    const label = script ? pathLabel(script.text, cwd, helpers) : undefined;
    if (label) parts.push(label);
  } else if (SUBCOMMAND_CLIS.has(name)) {
    // Stop at the first thing that is not plainly a subcommand, rather than
    // skipping it: once flags and values start, the words after them belong to
    // them, and `gcloud compute instances list` has said enough anyway.
    for (const t of rest) {
      if (parts.length >= 4 || t.quoted || !wordShaped(t.text)) break;
      parts.push(t.text);
      // A credential-sounding word is safe to say; whatever it introduces is not.
      if (SECRETISH.test(t.text)) break;
    }
  }

  return helpers.clamp(parts.join(' '), (helpers.CAPS && helpers.CAPS.target) || 200);
}

/**
 * The argument keys that say what a tool is working on — and, for each one, what
 * *kind* of thing that value is.
 *
 * The kind is the whole reason this is a table rather than a list. It used to be
 * a list, passed to `firstString`, and a list cannot tell a file path from the
 * model's own words: `metadata` promises "paths … no free text from the model or
 * user" (spec §10) while `pattern`, `content_pattern`, `query` and `url` sent a
 * Grep pattern, a web search and a URL's query string verbatim at every mode.
 * Truncating to 200 characters is not redaction, and 200 characters is a lot of
 * credential. So the categories are named here and the policy is applied in
 * `redactTarget`.
 *
 * The key list is the union across harnesses on purpose. Claude's `file_path`
 * and Rovo's `file_paths[0]` are the same idea, and a mapper should not have to
 * restate that idea to benefit from it. Order is the preference order.
 *
 *   `path`     a file or directory the tool touched. What the office animates,
 *              and what the documentation promises.
 *   `name`     an identifier somebody declared rather than composed — a saved
 *              prompt's name. The same category as a tool name, which §10
 *              already sends.
 *   `search`   the model's own words: a pattern, a web query. Free text.
 *   `network`  a URL. Free text with credentials in its query string.
 *   `command`  what a shell command runs, via `commandLabel`, which is careful.
 *
 * `pattern` is `search` even though `Glob`'s pattern is path-shaped. A glob is
 * still the model composing text — a recursive glob over `customers/acme-*.pdf`
 * says as much as a grep — and one key cannot be two kinds without a tool name
 * this function does not have. The verb alone is the safe answer and the office
 * still animates the trip, so the cost of being wrong this way is a desk label.
 */
const TARGET_KEYS = [
  ['file_path', 'path'],
  ['path', 'path'],
  ['new_path', 'path'],
  ['notebook_path', 'path'],
  ['file', 'path'],
  ['filename', 'path'],
  ['file_paths', 'path'],
  ['paths', 'path'],
  ['folder_path', 'path'],
  ['url', 'network'],
  ['pattern', 'search'],
  ['content_pattern', 'search'],
  ['query', 'search'],
  ['prompt_name', 'name'],
];

/** Keys a harness may hand over as a list, of which the first is the label. */
const TARGET_LIST_KEYS = new Set(['file_paths', 'paths']);

/**
 * What each kind of target may say at `metadata`, and the marker on the row of
 * documentation that promises it.
 *
 * This table is the source of truth for the code *and* for the two pages that
 * describe it: `test/docs.test.js` reads the markers and fails when a page stops
 * carrying one. That is the answer to how this defect survived — the code and
 * the promise were two independent statements, and only one of them was tested.
 *
 *   `send`      the value, as it always was.
 *   `host`      a URL's host, dropping the path and the query string, which is
 *               where credentials hide. The same reduction §10 already requires
 *               of `project.repo.remote`.
 *   `withhold`  nothing at all. `tool_class` still says a search happened, which
 *               is what the office animates; `openclaw-plugin/lib/map.mjs`
 *               already drew this line for its desk labels.
 */
const TARGET_KINDS = {
  path: { metadata: 'send', doc: 'target-path' },
  name: { metadata: 'send', doc: 'target-name' },
  command: { metadata: 'send', doc: 'target-command' },
  search: { metadata: 'withhold', doc: 'target-search' },
  network: { metadata: 'host', doc: 'target-network' },
};

/**
 * A URL's host, and nothing else — userinfo, path, query and fragment all go.
 *
 * `URL` first because it is right about the forms that are hard (`https://user:
 * token@host:8443/p?q`), and a regex second because a harness may hand over a
 * bare `host/path?q=1` that `URL` refuses. A value with no host to find — a
 * `file:` URL, `about:blank` — reduces to nothing, which is the safe end.
 */
function hostOf(value) {
  const raw = String(value).trim();
  try {
    const host = new URL(raw).host;
    if (host) return host;
  } catch { /* not something URL will parse; fall through */ }
  const m = /^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/)?(?:[^/?#\s@]*@)?([^/?#\s]+)/i.exec(raw);
  // A dot, so that the first segment of a bare path is not mistaken for a host.
  return m && m[1].includes('.') ? m[1] : undefined;
}

/**
 * What this tool call is working on, and what kind of thing that is:
 * `{ value, kind }`, or nothing when the call says nothing.
 *
 * Categorisation only. It makes no redaction decision, because it cannot: a
 * helper that knows only "the first string that was present" is exactly what
 * shipped a search query at the default mode.
 */
function describeTarget(args, command, cwd, helpers) {
  const a = args ?? {};
  for (const [key, kind] of TARGET_KEYS) {
    const held = a[key];
    const raw = TARGET_LIST_KEYS.has(key)
      ? (Array.isArray(held) ? held[0] : undefined)
      : held;
    const value = helpers.firstString(raw);
    if (value) {
      const tidied = helpers.tidyPath(value, cwd);
      if (tidied) return { value: tidied, kind };
    }
  }
  if (command) {
    const value = commandLabel(command, cwd, helpers);
    if (value) return { value, kind: 'command' };
  }
  return undefined;
}

/**
 * Apply `TARGET_KINDS` to a described target for the mode in force.
 *
 * One function rather than a ternary at each of the seven emission points, and
 * that is deliberate: a three-branch policy copied seven times is how the eighth
 * call site gets it wrong. The mode is still passed in at the emission point,
 * where a reader can see the gate.
 *
 * **An unknown mode redacts.** A caller that forgets to pass one gets `metadata`
 * behaviour, so the worst a future emission point can do is say too little.
 */
function redactTarget(described, redaction) {
  if (!described || !described.value) return undefined;
  const { value, kind } = described;
  if (redaction === 'summary' || redaction === 'full') return value;
  switch (TARGET_KINDS[kind] && TARGET_KINDS[kind].metadata) {
    case 'send': return value;
    case 'host': return hostOf(value);
    default: return undefined;
  }
}

/**
 * A short, non-sensitive `target` for the desk label, for the mode in force:
 * the path a file tool is working on, the name of what a shell command runs,
 * a fetch's host — and, for a search, nothing.
 *
 * `redaction` is not optional in spirit even though the signature tolerates its
 * absence: see `redactTarget`.
 */
function targetOf(args, command, cwd, helpers, redaction) {
  return redactTarget(describeTarget(args, command, cwd, helpers), redaction);
}

module.exports = {
  makeClassifier, argsOf, targetOf, describeTarget, redactTarget, hostOf,
  commandLabel, unwrapCommand,
  CLASS_PATTERNS, COMMAND_CLASSES, SUBCOMMAND_CLIS, TARGET_KEYS, TARGET_KINDS,
};
