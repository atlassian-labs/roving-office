// The shared classifier: the fallback reasoning every mapper leans on for tools
// nobody has tabled yet. The precedence order is the design, so it is what these
// tests pin: command beats table beats patterns beats 'other'.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  makeClassifier, argsOf, targetOf, commandLabel, unwrapCommand,
} = require('../bin/mappers/lib/tool-classes.cjs');
const { MAPPER_HELPERS: helpers } = require('../bin/lib/aop-core.cjs');

const classify = makeClassifier({ Read: 'read', Bash: 'execute' });

test('an explicit shell command beats everything, including the table', () => {
  assert.equal(classify('Bash', 'git push origin main'), 'scm');
  assert.equal(classify('Bash', 'rg pattern src/'), 'search');
  assert.equal(classify('Bash', 'curl https://example.com'), 'network');
  assert.equal(classify('Bash', 'rovo run --agent researcher'), 'knowledge');
  assert.equal(classify('Bash', 'sleep 5'), 'wait');
});

test('a command the patterns do not know falls back to the table', () => {
  assert.equal(classify('Bash', 'ls -la'), 'execute');
});

test('the exact table answers before the shared patterns', () => {
  // 'Read' also matches the /read/ pattern, but the table answers first.
  assert.equal(classify('Read'), 'read');
});

test('unknown names fall through the shared patterns in order', () => {
  assert.equal(classify('mcp__confluence__get_page'), 'knowledge');
  assert.equal(classify('search_code'), 'knowledge', 'search_code reads as knowledge before search');
  assert.equal(classify('SpawnSubagent'), 'agent');
  assert.equal(classify('GrepFiles'), 'search');
  assert.equal(classify('WebFetch2'), 'network');
  assert.equal(classify('create_page'), 'edit', 'create_page is an edit, not knowledge');
  assert.equal(classify('run_tests'), 'execute');
  assert.equal(classify('ViewDocument'), 'read');
  assert.equal(classify('PollStatus'), 'wait');
});

test('nothing recognisable is other; a bare command is execute', () => {
  assert.equal(classify('Zorble'), 'other');
  assert.equal(classify(undefined, 'zorble --frobnicate'), 'execute');
  assert.equal(classify(undefined, undefined), 'other');
});

test('argsOf finds the arguments wherever a harness puts them', () => {
  assert.deepEqual(argsOf({ tool_input: { a: 1 } }), { a: 1 });
  assert.deepEqual(argsOf({ arguments: { b: 2 } }), { b: 2 });
  assert.deepEqual(argsOf({ tool_input: ['not', 'an', 'object'] }), {});
  assert.deepEqual(argsOf({}), {});
  assert.deepEqual(argsOf(null), {});
});

// `targetOf` takes the redaction mode as its fifth argument, and what each category
// of target may say at each mode lives in `test/aop-target-redaction.test.cjs` rather
// than here. These pin the label itself: which key wins, and how much of a command
// line survives. Both are true at every mode.
test('targetOf prefers a path, tidied against the cwd', () => {
  assert.equal(
    targetOf({ file_path: '/repo/src/a.js' }, undefined, '/repo', helpers, 'metadata'),
    'src/a.js',
  );
  assert.equal(
    targetOf({ file_paths: ['/repo/x.js', '/repo/y.js'] }, undefined, '/repo', helpers, 'metadata'),
    'x.js',
  );
});

test('targetOf never carries a whole command line', () => {
  const line = 'curl -H "Authorization: Bearer hunter2" https://x';
  assert.equal(targetOf({}, line, null, helpers, 'metadata'), 'curl');
  assert.equal(targetOf({}, line, null, helpers, 'full'), 'curl');
});

// The bug this file exists to prevent coming back: a scheduled job whose
// command is an absolute path to a script used to spend its whole budget on the
// directories above the filename, so the office said a home directory was being
// executed and never said which job.
test('a command names its script, however it is wrapped', () => {
  const cwd = '/home/paige/.openclaw/workspace-paige';
  const script = 'scripts/ingest-room-to-read-mail.sh';
  const forms = [
    `${cwd}/${script}`,
    `./${script} --dry-run`,
    `bash -lc "cd ${cwd} && ./${script}"`,
    `env GMAIL_TOKEN=hunter2 ./${script}`,
    `sh -c './${script}' | tee log.txt`,
  ];
  for (const command of forms) {
    assert.equal(commandLabel(command, cwd, helpers), script, command);
  }
});

test('a path outside the session keeps its filename and drops the machine', () => {
  assert.equal(commandLabel('/usr/local/bin/vendor-tool --flag', '/repo', helpers), 'vendor-tool');
  assert.equal(commandLabel('/repo/scripts/x.sh', '/repo', helpers), 'scripts/x.sh');
});

test('a known CLI keeps the subcommand that gives it its identity', () => {
  assert.equal(commandLabel('git commit -m "a message"', '/repo', helpers), 'git commit');
  assert.equal(commandLabel('cd /repo && npm run probe -- --sweep', '/repo', helpers), 'npm run probe');
  assert.equal(commandLabel('gcloud compute instances list my-project', '/repo', helpers), 'gcloud compute instances list');
  assert.equal(commandLabel('make test', '/repo', helpers), 'make test');
  assert.equal(commandLabel('docker run -it ubuntu bash', '/repo', helpers), 'docker run');
});

test('an interpreter is named by the script it runs, not by itself', () => {
  assert.equal(commandLabel('node bin/aop-send.cjs --harness openclaw', '/repo', helpers), 'node bin/aop-send.cjs');
  // `-c` is code where a script would be, so there is nothing safe to add.
  assert.equal(commandLabel('python3 -c "print(os.environ[\'SECRET\'])"', '/repo', helpers), 'python3');
});

test('nothing quoted, assigned or secret-shaped ever reaches a label', () => {
  const leaky = [
    ['curl -H "Authorization: Bearer hunter2" https://x?token=abc', 'curl'],
    ['psql postgres://user:pa55word@host/db -c "select 1"', 'psql'],
    ['aws configure set aws_secret_access_key AKIAIOSFODNN7EXAMPLE', 'aws configure set aws_secret_access_key'],
    ['gh auth login --with-token < token.txt', 'gh auth'],
    ['npm config set //registry/:_authToken=s3cret', 'npm config set'],
  ];
  for (const [command, expected] of leaky) {
    const label = commandLabel(command, '/repo', helpers);
    assert.equal(label, expected, command);
    assert.ok(!/hunter2|pa55word|AKIA|s3cret/.test(label), `secret leaked: ${label}`);
  }
});

test('an unknown command says only its name — its arguments are nobody knows what', () => {
  assert.equal(commandLabel('zorble --frobnicate wibble', '/repo', helpers), 'zorble');
  assert.equal(commandLabel('ls -la', '/repo', helpers), 'ls');
  assert.equal(commandLabel('   ', '/repo', helpers), undefined);
  assert.equal(commandLabel(undefined, '/repo', helpers), undefined);
});

test('unwrapCommand takes the first segment that is not just preparation', () => {
  assert.deepEqual(unwrapCommand('cd /repo && git status').map((t) => t.text), ['git', 'status']);
  assert.deepEqual(unwrapCommand('rg pattern src/ | head -20').map((t) => t.text), ['rg', 'pattern', 'src/']);
  // Nothing but preparation still answers, rather than answering nothing.
  assert.deepEqual(unwrapCommand('cd /repo').map((t) => t.text), ['cd', '/repo']);
});

test('a wrapped command is still classified by what it really does', () => {
  assert.equal(classify('Bash', 'cd /repo && git push origin main'), 'scm');
  assert.equal(classify('Bash', 'bash -lc "cd /repo && git commit -m x"'), 'scm');
  assert.equal(classify('Bash', 'sudo -u paige rg pattern .'), 'search');
  assert.equal(classify('Bash', 'env FOO=1 curl https://example.com'), 'network');
  // …and one that really is just shell work stays shell work.
  assert.equal(classify('Bash', 'cd /repo && ls -la'), 'execute');
});

test('targetOf with nothing to say says nothing', () => {
  assert.equal(targetOf({}, undefined, null, helpers, 'full'), undefined);
});
