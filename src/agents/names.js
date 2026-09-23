// Naming the people in the office.
//
// Every source uses this, live harness sessions and the simulation alike.
//
// A terminal tab is a person in this office, and `rovo-cli 5178` tells you nothing
// about either the person or the work. So every live session gets a name in two
// parts:
//
//   Ada Kettle-Mender
//   └┬┘ └─────┬─────┘
//    │        └─ the job this tab is on, from the job it was given
//    └─ which tab this is, fixed for the life of the session
//
// **The first name is drawn once and sticks.** It is hashed from the session key
// rather than picked at random, which amounts to the same arbitrary choice but
// survives a reload, an office switch and a snapshot replay. Re-drawing on every
// hydration would rename the whole room several times an hour, and hydration
// happens more often than you think. Two tabs in one office never share one.
//
// **The surname is a job, and it changes with the work.** Not a topic and not a
// ticket title: a noun and a verb welded into something a person could be —
// `Cat-Researcher`, `Bread-Baker`, `Kettle-Mender`. The noun says what the job is
// about, the verb says what is being done to it, and together they read as an
// occupation rather than a summary. Each new job earns a new one, because a
// colleague whose name still describes last week's job is worse than no name.
//
// **It is never technical.** Identifiers, paths, flags, versions and acronyms are
// struck out before a noun is chosen, so nobody is called `AopSource-Builder` or
// `SSE-Mender`. If everything descriptive in a job is jargon, the name falls back
// to the bare job — `Ada Mender` — which is a real surname and an honest one.
//
// Before the first prompt there is only metadata, and the git branch is the one
// descriptive thing in it, so it is named from the same pipeline. Under `metadata`
// redaction no prompt ever arrives and that branch job simply stays. That is the
// whole privacy story: this module can only name a session after something the
// office was already told.

/**
 * First names for real sessions, deliberately drawn from Indian, Chinese,
 * European, Australian and Latin American naming traditions — an office of one
 * culture would be a strange thing to have built on purpose.
 *
 * Every source names its people from this one pool, the simulation included: the
 * naming is one of the better things the office does, and the default view of it
 * used to be the one view that opted out. Which feed somebody arrived on is said
 * by the mark they wear and by the source badge, which is where it belongs — a
 * name that doubled as a provenance label would be a worse name for it.
 *
 * Short by design — the name sits in a canvas pill above someone's head.
 */
export const AGENT_FIRST_NAMES = [
  // South Asian
  'Aarav', 'Ananya', 'Arjun', 'Divya', 'Ishaan', 'Kavya', 'Kiran', 'Meera',
  'Neha', 'Nisha', 'Priya', 'Rahul', 'Rohan', 'Sanjay', 'Tara', 'Vikram',
  'Aditi', 'Dev', 'Lakshmi', 'Zara',
  // East Asian
  'Bo', 'Chen', 'Feng', 'Hao', 'Hua', 'Jing', 'Jun', 'Lan', 'Li', 'Ling',
  'Mei', 'Ming', 'Qing', 'Shan', 'Tao', 'Wei', 'Xin', 'Yan', 'Yun', 'Zhen',
  // European
  'Anna', 'Bram', 'Elena', 'Emil', 'Freya', 'Greta', 'Hugo', 'Ines', 'Janek',
  'Klara', 'Lukas', 'Marta', 'Niels', 'Nora', 'Otto', 'Pavel', 'Sanne',
  'Sofia', 'Stefan', 'Ada',
  // Australian, including names of Aboriginal origin in common use
  'Angus', 'Banjo', 'Bindi', 'Cooper', 'Darcy', 'Jarrah', 'Jedda', 'Kirra',
  'Lachlan', 'Matilda', 'Ruby', 'Sienna', 'Talia', 'Tully', 'Wren', 'Kylie',
  'Digby', 'Marlee', 'Bonnie', 'Rowan',
  // Latin American
  'Alejo', 'Camila', 'Carmen', 'Diego', 'Emiliano', 'Isabela', 'Javier',
  'Lucia', 'Mateo', 'Nico', 'Paloma', 'Rafa', 'Rosa', 'Santiago', 'Valentina',
  'Ximena', 'Beatriz', 'Ciro', 'Elias', 'Marisol',
];

/**
 * Verb → what to call someone who does it. This is the half that turns a job into
 * a job: without it a surname is two nouns off a ticket title, which is exactly the
 * thing that reads like a machine wrote it.
 *
 * Listed as bare stems and matched whole, never as prefixes. Prefixes look tempting
 * and are quietly wrong: `plan` swallows "plant", `read` swallows "ready", `add`
 * swallows "address", and one wrong match renames somebody after a word that was
 * never in their job. {@link VERB_ROLES} expands each stem into the inflections
 * people actually type instead.
 */
const ROLES = [
  [['implement', 'build', 'add', 'create', 'make', 'scaffold', 'generate'], 'Builder'],
  [['fix', 'repair', 'patch', 'resolve', 'unbreak', 'correct'], 'Mender'],
  [['verify', 'check', 'validate', 'confirm', 'test', 'audit', 'assert'], 'Verifier'],
  [['investigate', 'debug', 'diagnose', 'trace', 'reproduce', 'inspect'], 'Sleuth'],
  [['research', 'study', 'survey'], 'Researcher'],
  [['document', 'draft', 'describe', 'explain', 'annotate'], 'Scribe'],
  [['write', 'author'], 'Scribe'],
  [['refactor', 'clean', 'tidy', 'sort', 'simplify', 'reorganise', 'reorganize',
    'restructure'], 'Tidier'],
  [['optimise', 'optimize', 'speed', 'profile', 'tune', 'improve', 'polish',
    'reduce', 'shrink'], 'Tuner'],
  [['migrate', 'move', 'port', 'convert', 'upgrade', 'rename', 'merge'], 'Mover'],
  [['deploy', 'release', 'ship', 'publish', 'launch', 'promote'], 'Shipper'],
  [['delete', 'remove', 'drop', 'prune', 'purge', 'clear', 'trim'], 'Pruner'],
  [['search', 'find', 'locate', 'lookup', 'discover'], 'Finder'],
  [['review', 'read', 'summarise', 'summarize', 'digest'], 'Reader'],
  [['plan', 'design', 'spec', 'scope', 'propose'], 'Planner'],
  [['trial', 'try', 'experiment', 'prototype', 'explore'], 'Tinkerer'],
  [['connect', 'integrate', 'wire', 'hook', 'link'], 'Connector'],
  [['update', 'refresh', 'sync', 'bump'], 'Updater'],
  [['analyse', 'analyze', 'measure', 'count', 'compare'], 'Analyst'],
  [['translate', 'localise', 'localize'], 'Translator'],
  [['teach', 'train', 'coach', 'onboard'], 'Tutor'],
  [['draw', 'render', 'paint', 'sketch', 'illustrate'], 'Painter'],
  [['grow', 'plant', 'seed', 'garden', 'water'], 'Gardener'],
  [['bake', 'cook', 'brew'], 'Baker'],
  // Weak openers. These earn a role mostly so they are never mistaken for the
  // subject of the sentence — "Look at the naming protocol" should be about
  // naming, not about looking.
  [['look', 'see', 'view', 'examine', 'show', 'tell', 'consider', 'think'], 'Reader'],
  [['help', 'assist', 'support'], 'Helper'],
  [['run', 'execute', 'invoke', 'start'], 'Runner'],
  [['set', 'setup', 'configure', 'install'], 'Fitter'],
  [['ask', 'answer', 'reply', 'respond'], 'Answerer'],
];

/**
 * Every form of a stem a prompt might use: "fix", "fixes", "fixed", "fixing",
 * "fixer". Also the doubled and e-dropped spellings English insists on — shipping,
 * planning, tuning, moved — because a job written in the present participle
 * ("fixing the couch") describes exactly the same job as one in the imperative.
 */
function inflect(stem) {
  const forms = new Set([stem, `${stem}s`, `${stem}es`, `${stem}ed`, `${stem}ing`,
    `${stem}er`, `${stem}ers`]);
  if (stem.endsWith('e')) {                       // tune → tuning, tuned, tuner
    const cut = stem.slice(0, -1);
    for (const f of [`${stem}d`, `${stem}r`, `${stem}rs`, `${cut}ing`, `${cut}ed`,
      `${cut}er`, `${cut}ers`]) forms.add(f);
  }
  if (stem.endsWith('y')) {                       // tidy → tidies, tidied
    const cut = stem.slice(0, -1);
    for (const f of [`${cut}ies`, `${cut}ied`, `${cut}ier`]) forms.add(f);
  }
  // Consonant-vowel-consonant doubles before a suffix: ship → shipping, run →
  // running, plan → planning.
  const [c1, v, c2] = [stem.at(-3) ?? '', stem.at(-2) ?? '', stem.at(-1) ?? ''];
  if (/[bdglmnprt]/.test(c2) && /[aeiou]/.test(v) && /[^aeiou]/.test(c1)) {
    for (const f of [`${stem}${c2}ing`, `${stem}${c2}ed`, `${stem}${c2}er`]) forms.add(f);
  }
  return forms;
}

/** Word → job, built once from {@link ROLES}. First stem to claim a form keeps it. */
const VERB_ROLES = new Map();
for (const [stems, role] of ROLES) {
  for (const stem of stems) {
    for (const form of inflect(stem)) {
      if (!VERB_ROLES.has(form)) VERB_ROLES.set(form, role);
    }
  }
}

/** Used when a job names its subject but nothing in it looks like a verb. */
const DEFAULT_ROLE = 'Wrangler';

/**
 * How many characters the name pill shows before it starts clipping words.
 *
 * Measured against the tag's own smallest type rather than guessed: at that size it
 * holds around 28 ordinary characters, and this sits under that so a name made of
 * unusually wide ones still lands. A character count is a rough stand-in for a pixel
 * width, which is fine because the tag ellipsises anything that overruns anyway —
 * this only has to stop that happening for names people actually get.
 *
 * `Shan Sourdough-Bak…` is a worse name than `Shan Baker`, so where even this is not
 * enough, the budget is spent on the job: see {@link fullName}.
 */
const NAME_BUDGET = 26;

/** Branches that describe no work at all get a name about the branch instead. */
const TRUNK_SURNAMES = {
  main: 'Main-Line', master: 'Main-Line', trunk: 'Trunk-Line',
  develop: 'Dev-Line', dev: 'Dev-Line', staging: 'Stage-Line',
};

/** Filler that never describes the work. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with',
  'my', 'our', 'your', 'this', 'that', 'these', 'those', 'it', 'its', 'is',
  'are', 'was', 'be', 'been', 'can', 'could', 'would', 'should', 'you', 'we',
  'i', 'please', 'just', 'only', 'also', 'again', 'more', 'most', 'very',
  'really', 'actually', 'all', 'any', 'some', 'from', 'into', 'about', 'as',
  'by', 'up', 'out', 'so', 'then', 'than', 'if', 'when', 'why', 'how', 'what',
  'where', 'which', 'who', 'not', 'no', 'yes', 'ok', 'okay', 'let', 'lets',
  'me', 'us', 'them', 'there', 'here', 'now', 'new', 'good', 'well', 'like',
  'want', 'need', 'try', 'going', 'get', 'got', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'shall', 'may', 'might', 'must', 'one', 'two', 'first',
  'understand', 'ensure', 'figure', 'sure', 'able', 'thing', 'stuff',
  'same', 'other', 'another', 'rest', 'both', 'each', 'every', 'still', 'yet',
]);

/**
 * A prompt made only of these is somebody nodding along, not handing out new work:
 * "yes", "carry on", "keep going, thanks". Naming a colleague after it would give
 * us `Carry-Wrangler`, so a title of nothing but these words yields no name and the
 * one already earned stays put.
 */
const CONTINUATIONS = new Set([
  'yes', 'yep', 'yeah', 'yup', 'no', 'nope', 'nah', 'ok', 'okay', 'kk', 'sure',
  'thanks', 'thank', 'ta', 'cheers', 'continue', 'carry', 'keep', 'go', 'goes',
  'ahead', 'onward', 'next', 'again', 'more', 'done', 'stop', 'wait', 'hold',
  'fine', 'great', 'nice', 'cool', 'perfect', 'lovely', 'right', 'exactly',
  'hmm', 'oops', 'sorry', 'yikes', 'proceed', 'resume', 'finish', 'retry',
  'redo', 'ready', 'agreed', 'correct', 'indeed', 'works', 'worked', 'better',
]);

/**
 * Titles an adapter sends when it has nothing to say — under `metadata` redaction
 * every turn is called "Working". None of them may become a name.
 */
const GENERIC_TITLES = new Set([
  'working', 'new request', 'untitled', 'prompt',
  // Both words, because this list is matched against what an *adapter* sends and
  // adapters say "task": the office renaming its own vocabulary changed
  // nothing about the harnesses feeding it. Same reason 'task' survives in
  // `WEAK_NOUNS` below.
  'incoming job', 'job', 'incoming task', 'task',
  'redacted', 'user prompt', 'no title',
]);

// A job label is a heading, not the first eighty characters of a conversation.
// These wrappers are safe to remove without pretending to understand the request:
// the work in "Could you fix the parser?" is still exactly "Fix the parser".
const ACKNOWLEDGEMENT_LEAD = /^(?:yes|yep|yeah|yup|ok(?:ay)?|sure|thanks|thank you|understood|got it|right|great|perfect|sounds good)\b(?:\s*[-–—,:.!]\s*|\s+)/i;
const REQUEST_LEAD = /^(?:(?:can|could|would|will) you|please|i (?:want|need|would like) you to)\s+/i;

// Once a session has a job, references back to "it" and routine packing-up work
// qualify that job rather than replacing it. A user can still draw a hard boundary
// with "new job", "switch to", or the other explicit forms below.
const EXPLICIT_JOB_BOUNDARY = /^(?:(?:new|next|different|separate) (?:job|task|request)\b|(?:switch|move) (?:to|onto)\b|instead\b|forget (?:that|this)\b)/i;
const REFERENTIAL_FOLLOW_UP = /^(?:(?:also|and|then|while you(?:'re| are) there|one more thing)\b|(?:make|keep|change|move|put|remove|add|fix|test|check|verify|update)\s+(?:it|this|that|them|those)\b)/i;
const PACKING_UP_FOLLOW_UP = /^(?:clean up (?:the )?work\s*tree|run (?:the )?tests?\b|commit\b|push\b|open (?:the )?(?:pull request|pr)\b|bring up (?:the )?(?:test )?server\b)/i;

/**
 * Words that name work in general rather than *this* work. Skipped while anything
 * more specific is left in the sentence — "fix the bug in the pathfinder" is about
 * the pathfinder — but taken over nothing at all.
 */
const WEAK_NOUNS = new Set([
  'bug', 'bugs', 'issue', 'issues', 'problem', 'problems', 'error', 'errors',
  'fault', 'failure', 'fail', 'fails', 'failed', 'failing',
  'change', 'changes', 'work', 'working', 'job', 'jobs', 'task', 'tasks',
  'ticket', 'item', 'items', 'feature', 'features', 'part', 'parts', 'bit',
  'bits', 'piece', 'place', 'way', 'ways', 'case', 'cases', 'point', 'step',
  'steps', 'line', 'lines', 'list', 'note', 'notes', 'side', 'end', 'start',
  'version', 'stuff', 'things', 'detail', 'details', 'bunch', 'lot',
]);

/**
 * Words that say *how*, never *what*: comparatives and adverbs. "Grow the plants
 * faster" is about plants, and `Faster-Gardener` is a name about nothing.
 *
 * Adverbs are mostly caught by the `-ly` rule in {@link isModifier}; comparatives
 * have to be listed, because an `-er` rule would eat parser, render and server.
 */
const MODIFIERS = new Set([
  'better', 'worse', 'faster', 'slower', 'quicker', 'easier', 'harder', 'cleaner',
  'simpler', 'smaller', 'bigger', 'larger', 'longer', 'shorter', 'nicer', 'safer',
  'higher', 'lower', 'older', 'newer', 'fewer', 'further', 'sooner', 'later',
  'best', 'worst', 'fastest', 'easiest', 'nicest', 'proper', 'wrong', 'broken',
]);

/**
 * Jargon. A name built from any of this reads as a stack trace wearing a hat, and
 * the brief for surnames is that they are never technical.
 *
 * Shape catches most of it — `AopSource`, `src/scene/city.js`, `--dry-run`, `v2`
 * are all struck out by {@link isTechnical} without needing to be listed. This set
 * is for the jargon that looks like ordinary English: lowercase acronyms, the
 * proper nouns of software, and the nouns that only exist inside a program.
 */
const TECHNICAL_WORDS = new Set([
  // Acronyms, as typed in a hurry.
  'ci', 'cd', 'api', 'apis', 'pr', 'prs', 'aop', 'cli', 'sse', 'ttl', 'ui', 'ux',
  'sql', 'jql', 'cql', 'aql', 'mcp', 'jsm', 'pir', 'http', 'https', 'json',
  'yaml', 'toml', 'csv', 'dns', 'cpu', 'gpu', 'ram', 'sdk', 'css', 'html', 'dom',
  'svg', 'png', 'jwt', 'rfc', 'qa', 'ide', 'os', 'db', 'url', 'urls', 'uri',
  'uuid', 'sha', 'ip', 'tls', 'ssl', 'ssh', 'orm', 'crud', 'regex', 'regexp',
  // Tools, languages and platforms.
  'git', 'github', 'gitlab', 'npm', 'yarn', 'pnpm', 'node', 'deno', 'bun',
  'docker', 'kubernetes', 'terraform', 'aws', 'gcp', 'azure', 'lambda', 'webpack',
  'vite', 'rollup', 'babel', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
  'pytest', 'javascript', 'typescript', 'python', 'ruby', 'rust', 'golang',
  'java', 'kotlin', 'swift', 'bash', 'zsh', 'shell', 'linux', 'macos', 'windows',
  // Nouns that only exist inside a program.
  'repo', 'repos', 'branch', 'branches', 'commit', 'commits', 'rebase', 'stash',
  'worktree', 'worktrees', 'submodule', 'diff', 'config', 'schema', 'payload',
  'param', 'params', 'arg', 'args', 'flag', 'flags', 'env', 'endpoint', 'callback',
  'promise', 'async', 'await', 'null', 'undefined', 'boolean', 'enum', 'struct',
  'array', 'string', 'int', 'float', 'var', 'const', 'func', 'function', 'method',
  'class', 'module', 'package', 'import', 'export', 'datasource', 'middleware',
  'runtime', 'stacktrace', 'traceback', 'stdout', 'stderr', 'localhost', 'port',
  'socket', 'cache', 'buffer', 'mutex', 'thread', 'heap', 'stack', 'token',
  'tokens', 'hash', 'lint', 'linter', 'codebase', 'refactor', 'boilerplate',
  'nullpointer', 'getter', 'setter', 'regression', 'changelog', 'monorepo',
]);

/** FNV-1a. Small, dependency-free, and stable across reloads — which is the point. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Capitalise a single word, never exceeding `max` — the name tag is only so wide. */
function titleCase(word, max = 12) {
  const bare = word.replace(/[^A-Za-z0-9]/g, '');
  if (!bare) return '';
  const out = bare[0].toUpperCase() + bare.slice(1).toLowerCase();
  return out.length > max ? out.slice(0, max) : out;
}

/**
 * A sentence as typed, one chunk per word — punctuation still attached, because
 * the punctuation is exactly what gives a path or a flag away.
 */
function chunk(text) {
  return String(text ?? '').split(/[\s,;:!?()[\]{}"'`]+/).filter(Boolean);
}

/** Split a chunk into words, on separators *and* camelCase humps. */
function tokenise(text) {
  return String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does this chunk come from a keyboard shortcut for a machine rather than a
 * sentence? Shape alone settles most of it, and shape generalises where a word
 * list cannot: every future filename and ticket key is already covered.
 */
function isTechnical(raw) {
  if (/^-{1,2}[A-Za-z]/.test(raw)) return true;         // --dry-run, -v
  const bare = String(raw).replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
  if (!bare) return true;
  if (/[/\\_@#$%^&*=<>|]/.test(bare)) return true;      // src/scene/city.js, snake_case
  if (/\d/.test(bare)) return true;                     // ABC-11, v2, 40dc1f3
  if (/\.[A-Za-z]/.test(bare)) return true;             // names.js, rec.name
  if (/[a-z][A-Z]/.test(bare)) return true;             // camelCase, AopSource
  if (/^[A-Z]{2,}$/.test(bare)) return true;            // SSE, AOP, JSON
  return false;
}

/** The job half: the first verb we recognise, anywhere in the sentence. */
function roleFor(chunks) {
  for (const raw of chunks) {
    for (const word of tokenise(raw)) {
      const role = VERB_ROLES.get(word.toLowerCase());
      if (role) return role;
    }
  }
  return null;
}

/**
 * A job wears its noun in the singular — a Bread-Baker, not a Breads-Baker — so an
 * obvious plural is folded back. Only the safe endings: `-ss`, `-us` and `-is` words
 * are singular already, and mangling one would be worse than leaving it plural.
 */
function singular(word) {
  const lower = word.toLowerCase();
  if (/(ss|us|is|as|os)$/.test(lower)) return word;
  if (/[^aeiou]ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  if (lower.length > 3 && lower.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Does this word describe the manner of the work rather than the work? */
function isModifier(lower) {
  return MODIFIERS.has(lower) || (lower.length > 4 && lower.endsWith('ly'));
}

/** Filler, in any of its forms: "keep" and "keeps" are both nodding along. */
function isFiller(lower) {
  const stem = singular(lower);
  return STOPWORDS.has(lower) || STOPWORDS.has(stem)
    || CONTINUATIONS.has(lower) || CONTINUATIONS.has(stem);
}

/**
 * The subject half: the first word that is plain English, specific, and not the
 * verb we already used. Weak nouns are held in reserve rather than discarded, so
 * "sort out the errors" still beats no name at all.
 */
function nounFor(chunks) {
  let weak = null;
  for (const raw of chunks) {
    if (isTechnical(raw)) continue;
    for (const word of tokenise(raw)) {
      const lower = word.toLowerCase();
      if (lower.length < 3) continue;                   // "up", "AI": too small to carry
      if (isFiller(lower) || isModifier(lower)) continue;
      if (TECHNICAL_WORDS.has(lower) || TECHNICAL_WORDS.has(singular(lower))) continue;
      if (VERB_ROLES.has(lower)) continue;              // already the other half
      if (WEAK_NOUNS.has(lower)) { weak ??= word; continue; }
      return titleCase(singular(word));
    }
  }
  return weak ? titleCase(singular(weak)) : null;
}

/** Nothing but nodding along? Then this prompt hands out no new work. */
function isContinuation(chunks) {
  const words = chunks.flatMap((raw) => tokenise(raw)).map((w) => w.toLowerCase());
  if (!words.length) return true;
  return words.every((w) => isFiller(w) || isModifier(w));
}

/**
 * A job from a bag of words: noun and verb, welded.
 *
 * A missing verb is filled in — `Kettle-Wrangler` still reads as a person. A
 * missing noun is not: `Ada Mender` is a perfectly good name, and inventing a
 * noun would be inventing a fact about the work.
 */
function jobFrom(chunks) {
  const role = roleFor(chunks);
  const noun = nounFor(chunks);
  if (!noun) return role;
  if (noun.toLowerCase() === (role ?? '').toLowerCase()) return role;
  return `${noun}-${role ?? DEFAULT_ROLE}`;
}

/**
 * Titles, not names. `Dr House` is House, and a first name of `Dr` would be a
 * character called Doctor Something for the rest of the session.
 *
 * Matched case-insensitively with any trailing full stop already stripped, which is
 * why `dr` covers `Dr.` too.
 */
const HONORIFICS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'mx', 'prof', 'professor', 'sir', 'dame',
  'lord', 'lady', 'capt', 'captain', 'cmdr', 'rev', 'father', 'sister', 'the',
]);

/** Longest single-word identity that still leaves room for a job on the name tag. */
const ACTOR_FIRST_NAME_MAX = 14;

/**
 * Who an agent is, when it came with a name of its own.
 *
 * Most harnesses have nothing to offer here: a Claude Code tab is a tab, and the
 * office names it. OpenClaw is different — an operator configures agents by hand and
 * names them — so `albus` is really *Albus Dumbledclaw* to the person watching, and
 * drawing `Priya` from the pool for it would be renaming their colleague.
 *
 * The number of words decides how much of the name is ours to write:
 *
 *   'Albus Dumbledclaw'  → { first: 'Albus',  surname: 'Dumbledclaw' }
 *   'Dr House'           → { first: 'Dr',     surname: 'House' }
 *   'bobster'            → { first: 'Bobster', surname: null }
 *   'agent-7'            → null
 *   'agent:albus:direct' → null
 *
 * **A whole name is left whole.** These names are usually the joke — Paige Turner,
 * Florence Nightingclaw, Guy Fawkes — and replacing that surname with a job would
 * throw away the better line and claim the credit. So a two-word identity keeps its
 * own surname for good, and the office says nothing over the top of it.
 *
 * **A single word is a first name**, and gets a job like anybody else: `Bobster` is
 * *Bobster Flaky-Mender* by the afternoon. A lone honorific is nobody, and a word too
 * long to leave room for a job is declined, both of which come back as `null`.
 *
 * `null` means "nothing usable here" and sends the caller to the pool — never an
 * error, because an identity we cannot read is not a reason to go unnamed.
 */
export function actorName(actor) {
  const words = [];
  for (const token of String(actor ?? '').trim().split(/\s+/)) {
    // A digit anywhere means this word is an identifier wearing a name's clothes, and
    // stripping it would make one: `agent-7` would otherwise come back as `Agent`.
    if (/\p{Nd}/u.test(token)) continue;
    // Punctuation around a word is decoration — `(Albus)` and `Albus,` are Albus —
    // but punctuation *inside* one is part of the name: Anne-Marie, O'Hara.
    const bare = token.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '');
    if (!bare) continue;
    // Anything still carrying a colon or a slash is an address, not a person.
    if (!/^\p{L}[\p{L}'’-]*$/u.test(bare)) continue;
    words.push(bare[0].toLocaleUpperCase() + bare.slice(1));
  }
  if (words.length > 1) return { first: words[0], surname: words.slice(1).join(' ') };
  const only = words[0];
  if (!only || only.length > ACTOR_FIRST_NAME_MAX) return null;
  if (HONORIFICS.has(only.toLowerCase())) return null;
  return { first: only, surname: null };
}

/**
 * A stable first name for a session.
 *
 * `taken` keeps two tabs in one room from both being Ada: on a collision we probe
 * forward through the list, which is still deterministic given the same room.
 *
 * @param {string} key   stable session key, e.g. `rovo-cli:b2b5e280…`
 * @param {Set<string>} [taken] first names already in use in this office
 */
export function firstNameFor(key, taken = new Set()) {
  const start = hash(String(key)) % AGENT_FIRST_NAMES.length;
  for (let i = 0; i < AGENT_FIRST_NAMES.length; i++) {
    const candidate = AGENT_FIRST_NAMES[(start + i) % AGENT_FIRST_NAMES.length];
    if (!taken.has(candidate)) return candidate;
  }
  return AGENT_FIRST_NAMES[start];   // a full house; duplicates beat no name
}

/**
 * A job from a git branch: `feature/fix-the-couch-nav` → `Couch-Mender`.
 *
 * Branch names are punctuation soup, so each dash-separated piece is judged on its
 * own: that is what lets `ABC-11-rename-the-protocol-layer` drop a ticket key it
 * would otherwise be named after, and come back with `Protocol-Mover`.
 */
export function surnameFromBranch(branch) {
  if (!branch) return null;
  // Only the last segment describes the work: `feature/`, `users/mike/` and
  // `release/2026/` are all bookkeeping, and a name built from them would say who
  // owns the branch rather than what is happening on it.
  const cleaned = String(branch).split('/').filter(Boolean).pop() ?? '';
  const trunk = TRUNK_SURNAMES[cleaned.toLowerCase()] ?? TRUNK_SURNAMES[String(branch).toLowerCase()];
  if (trunk) return trunk;

  return jobFrom(cleaned.split(/[-_.]+/).filter(Boolean));
}

/**
 * The job a piece of free text describes — a prompt, a turn title, whatever
 * arrives as `title` — or null if it describes no work at all: a label an
 * adapter sends when it has nothing to say, or a prompt that is nothing but
 * nodding along ("yes", "carry on", "thanks").
 *
 * The one place that answers "is there a job in here, and what is it." Naming a
 * session from scratch and deciding whether a later prompt earns a rename used to
 * ask that in slightly different words — a title with a real verb and a filename
 * for a noun (`"Fix src/scene/city.js"`) computed a perfectly good job but failed
 * the separate *is this new* check, which wanted a verb *and* a noun where the job
 * itself only ever needed one. A session named from its first job then stayed
 * that way through everything after it, however different the work, as long as
 * later titles kept leaning technical — which real second jobs often do. Reading
 * both questions off this one function is what keeps them from disagreeing again.
 */
function jobForTitle(title) {
  if (GENERIC_TITLES.has(String(title ?? '').trim().toLowerCase())) return null;
  const chunks = chunk(title);
  if (!chunks.length || isContinuation(chunks)) return null;
  return jobFrom(chunks);
}

/**
 * A job from the job in hand — the prompt, the turn title, the session name.
 *
 *   "Implement the office pathfinder"     → Office-Builder
 *   "Verify the docs are accurate"        → Docs-Verifier
 *   "Why is the kettle flaky?"            → Kettle-Wrangler
 *   "Fix src/scene/city.js"               → Mender
 *   "yes, carry on"                       → null, so the current name stays
 */
export function surnameFromPrompt(title) {
  return jobForTitle(title);
}

/**
 * Is this prompt a new job, or more of the current one?
 *
 * The same question {@link jobForTitle} already answers, asked as a boolean, so a
 * caller that only needs to know *whether* a rename would happen — rather than
 * the surname it would produce — need not compute the job itself to find out.
 */
export function describesNewJob(title) {
  return Boolean(jobForTitle(title));
}

/**
 * Turn conversational request text into the compact heading the roster needs.
 *
 * This is deliberately editorial rather than semantic: it removes politeness and
 * acknowledgement wrappers, collapses whitespace, and leaves the actual words of
 * the request alone. Understanding and inventing a summary belongs to a model; a
 * deterministic receiver should only make the label read like a label.
 */
export function jobLabel(title) {
  let label = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!label) return null;

  // Several wrappers can stack: "Okay, could you please fix it?".
  for (let i = 0; i < 3; i += 1) {
    const next = label.replace(ACKNOWLEDGEMENT_LEAD, '').replace(REQUEST_LEAD, '').trim();
    if (!next || next === label) break;
    label = next;
  }

  label = label.replace(/[?!.]+$/, '').trim();
  if (!label) return null;
  label = `${label[0].toUpperCase()}${label.slice(1)}`;
  return label.length <= 80 ? label : `${label.slice(0, 79)}…`;
}

/**
 * Whether a turn should replace the session's stable job heading.
 *
 * The conservative default after a job exists is intentional: coding work is a
 * conversation, so most later prompts are corrections, approvals or finishing
 * chores inside the same assignment. An explicit boundary, or a plainly unrelated
 * substantive request, starts a new job; acknowledgements and referential turns do
 * not. The raw title is inspected as well as the cleaned label because "Yup — clean
 * up the worktree" has useful words after an acknowledgement and is still a follow-up.
 */
export function startsNewJob(current, title) {
  const candidate = jobLabel(title);
  if (!candidate || !describesNewJob(candidate)) return false;
  if (!current || !describesNewJob(current)) return true;

  if (EXPLICIT_JOB_BOUNDARY.test(candidate)) return true;
  const raw = String(title ?? '').trim();
  if (ACKNOWLEDGEMENT_LEAD.test(raw)) return false;
  if (REFERENTIAL_FOLLOW_UP.test(candidate)) return false;
  if (PACKING_UP_FOLLOW_UP.test(candidate)) return false;
  return true;
}

/**
 * Put a first name and a job together, inside what the name tag can show.
 *
 * A double barrel that would be clipped loses its noun rather than its job: the
 * noun is the nice-to-have, and a `Sourdough-Baker` who reads as `Sourdough-Bak…`
 * has lost the only word that made the name a person.
 */
export function fullName(first, surname) {
  if (!surname) return String(first);
  const whole = `${first} ${surname}`;
  if (whole.length <= NAME_BUDGET) return whole;
  return `${first} ${surname.split('-').pop()}`;
}

/**
 * The first name out of a whole one — `Ada Kettle-Mender` → `Ada`.
 *
 * The inverse of `fullName`, and it lives beside it so the two agree on what the
 * halves of a name are. Panels tight enough that a surname would wrap use this to
 * name somebody the way a colleague would, and the surname is the half worth
 * losing: it describes the job, which those panels are usually stating anyway.
 *
 * A one-word name is already a first name, so it comes back untouched — which is
 * what anybody looks like before their first request has given them a job.
 */
export function firstNameOf(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * The job half of a whole name — `Ada Kettle-Mender` → `Kettle-Mender`, and `''` for
 * somebody who has not been given one yet.
 *
 * Used when only the person changes and the job should survive it: an identity that
 * arrives late (spec §3.2 `actor`) renames Priya to Albus without forgetting what
 * Priya was in the middle of.
 */
export function surnameOf(name) {
  return String(name ?? '').trim().split(/\s+/).slice(1).join(' ');
}

/**
 * The whole name for a session, given whatever is known so far.
 *
 * An `actor` outranks the pool, and deliberately also outranks `taken`: two sessions
 * of one configured agent are two tabs belonging to the *same* colleague, so both
 * being Albus is the truth rather than a collision. The anti-collision probe exists
 * because a drawn name is arbitrary — and a name somebody chose is not.
 *
 * An actor with a surname of its own keeps it, and the job is not written at all —
 * see `actorName`.
 *
 * @param {object}  opts
 * @param {string}  opts.key          stable session key
 * @param {?string} [opts.actor]      identity the harness supplied, if any
 * @param {?string} [opts.branch]     git branch, for the pre-prompt job
 * @param {?string} [opts.title]      the job in hand, once one is known
 * @param {Set<string>} [opts.taken]  first names already in the room
 */
export function nameForSession({ key, actor = null, branch = null, title = null, taken = new Set() }) {
  const person = actorName(actor);
  const first = person?.first ?? firstNameFor(key, taken);
  const surname = person?.surname
    ?? (title ? surnameFromPrompt(title) : null)
    ?? surnameFromBranch(branch);
  return fullName(first, surname);
}
