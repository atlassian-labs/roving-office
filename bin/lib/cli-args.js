//
// `--name` and `--name=value` — the argument convention every tool in bin/ uses.
//
// None of these tools take a parser dependency and none of them should: the whole
// convention is two `startsWith` calls, and a repo with no build step should not
// need `npm install` to read `--seed=7`. But two lines of convention restated in
// twelve tools is still twelve places for it to drift, and it had already drifted
// into three spellings of the same idea — one of which sliced the value off by
// `name.length + 3` rather than at the `=`, which is the same answer only as long
// as nobody changes the prefix.
//
// So the convention lives here once, and the tools say what their flags *mean*.
//

/**
 * The readers for one tool's argument list.
 *
 * `opt` and `value` differ on a bare `--name`, and the difference matters:
 *
 * - `opt` returns `true` for it, because most of these tools have switches
 *   (`--json`, `--sweep`, `--quiet`) alongside their valued flags, and a switch
 *   is written without a value.
 * - `value` returns the fallback instead, because a tool whose flags are *all*
 *   values has nothing sensible to do with `true` — `--rooms` with no filename
 *   would go on to be read as a path.
 *
 * So a tool that reads its switches through this reader wants `opt`, and one
 * whose every flag carries a value wants `value`. (`bin/office-shot.js` has a
 * switch and still wants `value`, because it tests that one with `includes`.)
 *
 * @param {string[]} argv  usually `process.argv.slice(2)`
 * @returns {{
 *   opt: (name: string, fallback?: *) => *,
 *   value: (name: string, fallback?: *) => *,
 *   all: (name: string) => string[],
 *   positional: string[],
 * }}
 */
export function options(argv) {
  const valueOf = (arg) => arg.slice(arg.indexOf('=') + 1);
  const opt = (name, fallback = null) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return fallback;
    return hit.includes('=') ? valueOf(hit) : true;
  };
  const value = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? valueOf(hit) : fallback;
  };
  // A repeatable flag: `--id=a --id=b`. Only ever valued, so a bare `--id`
  // contributes nothing rather than an empty string.
  const all = (name) => argv.filter((a) => a.startsWith(`--${name}=`)).map(valueOf);
  return { opt, value, all, positional: argv.filter((a) => !a.startsWith('--')) };
}
