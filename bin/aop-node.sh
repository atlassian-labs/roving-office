#!/bin/sh
# aop-node — find a Node, then run an adapter script with it.
#
# Every hook command goes through here instead of relying on the adapter's own
# `#!/usr/bin/env node` shebang, because a hook does not get the PATH you think
# it does.
#
# A hook inherits the environment of whatever launched the agent. Launch Claude
# Code from a terminal and it inherits a login shell, so a version manager's
# shims are on PATH and `node` resolves. Launch it from the GUI — Claude
# Desktop's Cowork, whose agent is the same claude-code binary driven over the
# SDK — and the parent is launchd, which hands down only:
#
#   PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
#
# nvm, fnm, volta and asdf all install Node under $HOME, none of which is on
# that list. So `env node` exits 127, every hook fails, and the office stays
# empty for exactly the sessions a GUI harness runs — silently, because a
# non-blocking hook's failure is not the agent's problem.
#
# The fix is to look in the places a version manager actually puts Node. The
# answer is cached in ~/.roving-office/node-path so the search costs one stat on
# every hook after the first, and re-runs if that cached path ever goes away
# (a Node upgrade moves it).
#
#   aop-node.sh <script> [args...]
#
# Exits 0 whatever happens, including when no Node can be found: the adapter's
# first design rule is that the office must never become the agent's problem.
# A failure leaves one line in ~/.roving-office/node-missing.log to look at.

set -u

OFFICE_DIR="${HOME}/.roving-office"
CACHE="${OFFICE_DIR}/node-path"

# Highest-versioned `node` under a version manager's directory of installs.
#
# `sort -V` orders v9 before v10; plain `sort -r` does not. BSD sort has had -V
# since macOS 10.13, but fall back rather than assume it, since guessing wrong
# here means picking an ancient Node rather than failing loudly.
newest_under() {
  root="$1"
  suffix="$2"
  [ -d "$root" ] || return 0
  if printf 'v1\nv2\n' | sort -V >/dev/null 2>&1; then
    order="sort -Vr"
  else
    order="sort -r"
  fi
  ls "$root" 2>/dev/null | $order | while IFS= read -r version
  do
    [ -n "$version" ] || continue
    printf '%s/%s/%s\n' "$root" "$version" "$suffix"
  done
}

# Every place worth looking, cheapest and most specific first. Printed rather
# than tested, so the caller can stop at the first one that is really there.
candidates() {
  # An explicit override wins: the escape hatch for a Node in none of the
  # usual places, and what the installer suggests when this script gives up.
  [ -n "${AOP_NODE:-}" ] && printf '%s\n' "$AOP_NODE"

  # The common case, and free: a terminal-launched session already has it.
  command -v node 2>/dev/null

  # What worked last time. Cheaper than any glob below.
  [ -r "$CACHE" ] && cat "$CACHE" 2>/dev/null

  # Fixed installs: Homebrew on Apple silicon and on Intel, a system package,
  # and the version managers that keep a stable current-version symlink.
  printf '%s\n' \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "${HOME}/.volta/bin/node" \
    "${HOME}/.local/share/fnm/aliases/default/bin/node" \
    "${HOME}/Library/Application Support/fnm/aliases/default/bin/node" \
    "${HOME}/n/bin/node"

  # Version managers that keep one directory per install, newest first.
  newest_under "${HOME}/.nvm/versions/node" bin/node
  newest_under "${HOME}/.local/share/fnm/node-versions" installation/bin/node
  newest_under "${HOME}/Library/Application Support/fnm/node-versions" installation/bin/node
  newest_under "${HOME}/.asdf/installs/nodejs" bin/node
  newest_under "${HOME}/.local/share/mise/installs/node" bin/node
}

# read -r rather than `for` over $(...): a candidate can contain spaces, as
# fnm's macOS path does.
NODE=''
while IFS= read -r candidate
do
  [ -n "$candidate" ] || continue
  if [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
    NODE="$candidate"
    break
  fi
done <<CANDIDATES
$(candidates)
CANDIDATES

if [ -z "$NODE" ]; then
  # Best-effort, and silent: this branch runs in a broken environment, so
  # nothing in it may write to the agent's stderr or change the exit status.
  # Overwritten rather than appended — hooks fire often, and one current line is
  # the whole diagnosis. PATH is included because it is the thing that is wrong.
  {
    mkdir -p "$OFFICE_DIR" &&
    printf '%s no node found for the office adapter; set AOP_NODE to one. PATH=%s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '(no date)')" "${PATH:-}" \
      > "${OFFICE_DIR}/node-missing.log"
  } 2>/dev/null || true
  exit 0
fi

# Remember it, but only on a change: a hook should not write to disk 15 times a
# turn to say nothing new. An AOP_NODE override is never remembered — it is a
# one-shot answer to "run it with this one", and outliving its own command line
# would make it a setting nobody chose.
if [ "$NODE" != "${AOP_NODE:-}" ] &&
   { [ ! -r "$CACHE" ] || [ "$(cat "$CACHE" 2>/dev/null)" != "$NODE" ]; }
then
  # Same rule as above: a cache we cannot write is not worth one line of stderr
  # on the agent's critical path. A redirect that cannot open its file reports
  # itself, so the whole group is silenced, not just the printf.
  { mkdir -p "$OFFICE_DIR" && printf '%s\n' "$NODE" > "$CACHE"; } 2>/dev/null || true
fi

# exec, so this shell is replaced rather than left waiting: the adapter's own
# watchdog and exit-0 guarantee stay in force, and the hook costs one process.
exec "$NODE" "$@"
