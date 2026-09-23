#!/usr/bin/env bash
# aop-openclaw-server — install the packed plugin on an OpenClaw server, and point it
# at an office.
#
#   ./aop-openclaw-server.sh roving-office-openclaw-0.6.0.tgz
#   ./aop-openclaw-server.sh <tgz> --receiver http://office.internal:8080
#   ./aop-openclaw-server.sh <tgz> --keycard AB12CD34 --token <write-token>
#   ./aop-openclaw-server.sh <tgz> --new-office
#
# This one runs **on the Gateway host**, not in the checkout — which is the whole reason
# it exists. `npm run connect:openclaw` installs by link and so needs the repo; a server
# has an artifact and nothing else. So the two halves are:
#
#   1. in the checkout:  npm run pack:openclaw   -> dist/*.tgz + a copy of this script
#   2. on the server:    ./aop-openclaw-server.sh <that tgz>
#
# It is deliberately dumb: one install, four `config set`s, and — only the first time —
# one `curl` to mint an office. The tarball is a required argument rather than something
# found by globbing, because "which version is on that box" is the question that wastes
# the most time here, and a script that picks a file for you is a script that can answer
# it wrong.
#
# **A re-run keeps the office it already has.** This script used to mint a fresh one every
# time, which was defensible while an office was disposable — a deploy once lost
# them all anyway, so a new keycard cost nothing that was not already gone. It is not
# defensible now. An office persists across a deploy and holds its scene layout, its
# furniture and its history, and offices hold several named ingest tokens rather
# than one that re-minting revokes. So a second run of this script is almost always
# somebody shipping a new build of the plugin to a box that is already wired up, and
# minting there would silently move that gateway into an empty room and leave the room
# people had bookmarked being written to by nobody. Upgrading is now the default path:
# read the endpoint back out of the config, install, write it again. `--new-office` asks
# for the old behaviour, and says so out loud.
#
# The install is always `--force`. `plugins install` refuses to overwrite an existing
# install ("plugin already exists … delete it first"), and on a server every run after
# the first is a replacement, so the polite form is only ever right once. Not
# `plugins update`: that tracks a registry, and this tarball is on none.
#
# Ordering: install before config. `openclaw plugins install` writes
# `plugins.entries.roving-office`, so config written first is config discarded.

set -euo pipefail

PLUGIN_ID='roving-office'
RECEIVER="${RECEIVER:-https://therovingoffice.com}"
TARBALL=''
KEYCARD=''
TOKEN=''
NEW_OFFICE=0
# Where the endpoint came from, for the one line that says so. A misconfigured emitter is
# silent by nature, and "which office is this box publishing to, and did I just change it"
# is the question a re-run has to answer without being asked.
SOURCE=''
# Rooms are otherwise derived from the git remote, and a Gateway on a server has no
# repo — it would land in a room named after whatever directory it was started in. The
# hostname is a better guess than that, and the flag is there for when it is not.
SCENE="$(hostname -s 2>/dev/null || echo openclaw-server)"
# Whether that default is still just a default. A scene already in the config was chosen
# by somebody, and an upgrade run must not quietly rename their room to this host.
SCENE_GIVEN=0

usage() {
  cat <<'USAGE'
usage: aop-openclaw-server.sh <tarball.tgz> [--receiver <url>]
                              [--keycard <kc> --token <t>] [--scene <name>]
                              [--new-office]

  Installs the packed roving-office plugin on this machine's OpenClaw Gateway and
  points it at an office.

  Which office, in order: the one you name, else the one this Gateway is already
  publishing to, else a freshly minted one. So the second and every later run is an
  upgrade — it installs the new build and keeps the room, its layout and its history.

  <tarball.tgz>      the artifact from `npm run pack:openclaw`, copied here.
  --receiver <url>   where the office lives. Default https://therovingoffice.com,
                     or the RECEIVER environment variable.
  --keycard/--token  use an office that already exists instead. Both are needed
                     together: ingest answers 401 without the write token.
  --scene <name>     the room this Gateway's work arrives in. Defaults to this
                     machine's hostname.
  --new-office       mint a fresh office even though this Gateway already has one.
                     Leaves the old one behind, still holding everything in it.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --receiver) RECEIVER="${2:?--receiver needs a url}"; shift 2 ;;
    --keycard)  KEYCARD="${2:?--keycard needs a keycard}"; shift 2 ;;
    --token)    TOKEN="${2:?--token needs a write token}"; shift 2 ;;
    --scene)    SCENE="${2:?--scene needs a name}"; SCENE_GIVEN=1; shift 2 ;;
    --new-office) NEW_OFFICE=1; shift ;;
    --help|-h)  usage; exit 0 ;;
    -*) echo "unknown option: $1" >&2; echo >&2; usage >&2; exit 2 ;;
    *)  [ -n "$TARBALL" ] && { echo "only one tarball, please: already have $TARBALL" >&2; exit 2; }
        TARBALL="$1"; shift ;;
  esac
done

# A trailing slash would produce `https://host//office/…`, which the receiver's keycard
# parser reads as a path it does not recognise.
RECEIVER="${RECEIVER%/}"

if [ -z "$TARBALL" ]; then
  echo 'no tarball given — this needs the .tgz from `npm run pack:openclaw`.' >&2
  echo >&2; usage >&2; exit 2
fi
[ -f "$TARBALL" ] || { echo "no such file: $TARBALL" >&2; exit 1; }
# npm-pack: wants a path it can resolve from anywhere, and a bare filename will not do.
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

if [ -n "$KEYCARD" ] && [ -z "$TOKEN" ]; then
  echo '--keycard needs --token: a hosted office answers 401 without its write token.' >&2
  exit 2
fi
if [ -n "$TOKEN" ] && [ -z "$KEYCARD" ]; then
  echo '--token needs --keycard: a token alone does not say which office to publish to.' >&2
  exit 2
fi
if [ -n "$KEYCARD" ] && [ "$NEW_OFFICE" = 1 ]; then
  echo '--new-office and --keycard ask for opposite things: mint one, or use that one.' >&2
  exit 2
fi

# Unlike the installers in the checkout, a missing `openclaw` here is a real failure:
# this script has no purpose on a machine without a Gateway.
command -v openclaw >/dev/null 2>&1 || {
  echo 'openclaw is not on this PATH. This script is meant to run on the Gateway host.' >&2
  exit 1
}

say() { printf '%s\n' "$*"; }
run() { say "  \$ $*"; "$@"; }

# Read one string out of OpenClaw's config file.
#
# Not `openclaw config get`: that is the stabler contract and it is the wrong tool here,
# because it prints the config **redacted** — anything that looks like a token comes back
# masked, which is exactly the field this needs. So the file, parsed by node, which is
# present wherever a Gateway runs. `jq` is a thing people happen to have.
#
# A config that will not parse is treated as no config rather than as a failure. It is
# JSON5 and may legitimately carry comments that `JSON.parse` refuses, and the cost of
# being wrong here is minting an office nobody asked for — so that case is caught and
# reported below rather than guessed at.
OPENCLAW_CONFIG="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"
config_string() {
  [ -f "$OPENCLAW_CONFIG" ] || return 1
  node -e '
    const fs = require("node:fs");
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(5); }
    const value = process.argv.slice(2).reduce((at, key) => (at == null ? at : at[key]), cfg);
    if (typeof value !== "string" || !value.trim()) process.exit(3);
    process.stdout.write(value.trim());
  ' "$OPENCLAW_CONFIG" plugins entries "$PLUGIN_ID" config "$1"
}

# --- 1. an office to publish to -------------------------------------------
#
# Resolved **before** the install, and that ordering is load-bearing in a way that is easy
# to undo: `openclaw plugins install` rewrites `plugins.entries.roving-office`, so the
# endpoint this reads back is gone by the time step 2 has finished. Read, install, write.

if [ -n "$KEYCARD" ]; then
  SOURCE='the office you named'
  say "Using the office you named, on $RECEIVER"
elif [ "$NEW_OFFICE" = 0 ] && EXISTING_URL="$(config_string url)"; then
  # `…/office/<keycard>/aop/v0/events` — the keycard is the segment after `office`, and
  # taking it from the url means the config carries one answer rather than two that can
  # disagree. A url this does not recognise is left alone and reported, not guessed at.
  KEYCARD="$(printf '%s' "$EXISTING_URL" | sed -n 's|.*/office/\([^/]*\)/aop/.*|\1|p')"
  TOKEN="$(config_string token || true)"
  if [ -z "$KEYCARD" ] || [ -z "$TOKEN" ]; then
    say "This Gateway has a roving-office endpoint configured, but not one this script"
    say "can read back:"
    say "    url   ${EXISTING_URL}"
    say "    token $([ -n "$TOKEN" ] && echo 'set' || echo 'missing')"
    say ''
    say 'Name the office to use, or ask for a new one:'
    say "    $0 $(basename "$TARBALL") --keycard <kc> --token <t>"
    say "    $0 $(basename "$TARBALL") --new-office"
    exit 1
  fi
  # The receiver comes from the configured url too, so an upgrade keeps publishing where
  # it already publishes rather than quietly moving to this script's default.
  RECEIVER="$(printf '%s' "$EXISTING_URL" | sed -n 's|\(.*\)/office/[^/]*/aop/.*|\1|p')"
  SOURCE='the office this Gateway already uses'
  # The room, for the same reason as the office: it is a name somebody chose, and the
  # default here is only a guess at one. `--scene` still overrides it.
  if [ "$SCENE_GIVEN" = 0 ]; then
    EXISTING_SCENE="$(config_string scene || true)"
    [ -n "$EXISTING_SCENE" ] && SCENE="$EXISTING_SCENE"
  fi
  say "Keeping the office this Gateway already publishes to, on $RECEIVER"
  say '  (its layout, furniture and history stay where they are — pass --new-office'
  say '   for a fresh one, which leaves this one behind rather than replacing it.)'
else
  SOURCE='freshly minted'
  if [ "$NEW_OFFICE" = 1 ]; then
    say "Minting a fresh office on $RECEIVER, because you asked for one."
    say '  The office this Gateway was using is left behind, not replaced — everything'
    say '  in it is still there for anyone holding its keycard.'
  else
    say "Minting a fresh office on $RECEIVER, since this Gateway has none configured."
  fi
  # -f so an HTTP error is an error, rather than an error page parsed as JSON — which
  # is how "403 from an egress proxy" becomes a confusing crash three steps later.
  if ! MINTED="$(curl -fsS --max-time 20 -X POST "$RECEIVER/api/offices" \
                   -H 'content-type: application/json' -d '{}')"; then
    say ''
    say "Could not mint an office at $RECEIVER/api/offices."
    say 'Check this host can reach the receiver at all:'
    say "  \$ curl -i -X POST $RECEIVER/api/offices -d '{}'"
    say 'A 403 with an HTML body is the network refusing you, not the office:'
    say 'the hosted one answers only from inside Atlassian (docs/developer/adapters/openclaw.md).'
    exit 1
  fi

  # `node` rather than `jq` to read the reply: OpenClaw is itself a node program, so
  # node is present wherever this can run, whereas jq is a thing people happen to have.
  field() {
    printf '%s' "$MINTED" | node -e '
      let raw = "";
      process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
        try {
          const value = JSON.parse(raw)[process.argv[1]];
          if (value === undefined || value === null) process.exit(3);
          process.stdout.write(String(value));
        } catch { process.exit(4); }
      });
    ' "$1"
  }
  KEYCARD="$(field keycard)" || { say "The receiver answered with no keycard in it:"; say "  $MINTED"; exit 1; }
  TOKEN="$(field writeToken)" || { say "The receiver answered with no writeToken in it:"; say "  $MINTED"; exit 1; }
fi

OFFICE_URL="$RECEIVER/office/$KEYCARD"
INGEST_URL="$OFFICE_URL/aop/v0/events"

# Masked: enough to tell two tokens apart in a scrollback buffer, not enough to use.
# The full value lands in ~/.openclaw/openclaw.json below, if it is needed again.
#
# Ten rather than six because a token now begins `rot_`, which is four
# characters that are the same on every one of them. Six left two that were not, which
# is not enough to tell two tokens apart — the one job this line has.
say "  keycard $KEYCARD   token ${TOKEN:0:10}…   ($SOURCE)"
say ''

# --- 2. the plugin --------------------------------------------------------

say "Installing $(basename "$TARBALL") into OpenClaw $(openclaw --version 2>/dev/null | head -1)"
run openclaw plugins install "npm-pack:$TARBALL" --force
say ''

# --- 3. point it at the office --------------------------------------------

say 'Pointing it at the office'
run openclaw config set "plugins.entries.$PLUGIN_ID.config.url" "$INGEST_URL"
run openclaw config set "plugins.entries.$PLUGIN_ID.config.token" "$TOKEN"
run openclaw config set "plugins.entries.$PLUGIN_ID.config.scene" "$SCENE"

# Set explicitly because an install does not turn a plugin back on, and a previous run
# or a hand edit during debugging may have turned it off.
run openclaw config set "plugins.entries.$PLUGIN_ID.config.enabled" true

# The one setting whose absence is invisible. `before_agent_run` and `agent_end` are
# conversation hooks, and OpenClaw blocks them for any non-bundled plugin unless this is
# true — registration still succeeds and the handler simply never fires. A plain chat
# turn is session_start, before_agent_run, agent_end and nothing else, so blocked, an
# ordinary conversation publishes nothing at all and the office stays empty with no clue.
run openclaw config set "plugins.entries.$PLUGIN_ID.hooks.allowConversationAccess" true

# --- 4. what is left for a human -----------------------------------------

say ''
say 'The plugin only loads at Gateway startup, so it is not running yet. Restart it:'
say ''
say '    openclaw gateway restart'
say ''
say "Then join your office, where this Gateway's work arrives in room \"$SCENE\":"
say ''
say "    $OFFICE_URL"
say ''
say 'Press D in there and tick OpenClaw. If nothing arrives, what is loaded is not'
say 'always what you installed — check the version moved and nothing is blocked:'
say ''
say "    openclaw plugins inspect $PLUGIN_ID --runtime --json"
say "    # install.resolvedVersion, diagnostics[]"
say ''
say "Reading the events as text instead: $OFFICE_URL/debuglog"
