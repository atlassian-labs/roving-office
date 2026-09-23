//
// `--name` and `--name <value>` — the argument convention the aop installers use.
//
// The sibling of bin/lib/cli-args.js, and deliberately not the same module. The
// twelve tools in bin/ that generate and measure offices take their values with an
// `=` (`--seed=7`), because they are typed by hand dozens of times a session and a
// flag that carries its own value cannot be separated from it by a shell. The five
// `aop-*-install.cjs` adapters take a *path* (`--config <path>`), which is the
// spelling every harness's own CLI uses for the same argument, and the one that
// tab-completes. Two conventions, so two readers; one file each rather than one
// reader with a mode, because a tool belongs entirely to one of them.
//
// (They cannot be one module for a second reason: these five are CommonJS, because
// a hook adapter has to start under whatever node the harness launches it with, and
// `require` of an ES module is only available from node 22.12.)
//
// This was restated in four of the five installers and in three spellings — `flag`
// three times, `value` three times with two different answers for an absent flag,
// and one file that built a `Set` of the whole argument list to ask the same
// questions with `.has`. A fifth read `args.includes('--uninstall')` six times
// inline. So the convention lives here once.
//

/**
 * The readers for one installer's argument list.
 *
 * - `flag` is a switch: is this name present at all.
 * - `value` is the argument *after* a name — `--config ~/.claude/settings.json`.
 *   A name that is present but last carries no value, so it answers the fallback
 *   too: an installer that read `--config` off the end of argv would resolve
 *   `undefined` as a path.
 * - `help` is `--help` or `-h`, which every one of these tools accepts. Stated
 *   once because it is the convention rather than one tool's argument.
 *
 * @param {string[]} argv  usually `process.argv.slice(2)`
 * @returns {{
 *   flag: (name: string) => boolean,
 *   value: (name: string, fallback?: *) => *,
 *   help: boolean,
 * }}
 */
function flags(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1] ?? fallback;
  };
  return { flag, value, help: flag('--help') || flag('-h') };
}

module.exports = { flags };
