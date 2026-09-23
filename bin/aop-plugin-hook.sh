#!/bin/sh
# One hook manifest serves both plugin hosts. Codex exports PLUGIN_ROOT (and a
# CLAUDE_PLUGIN_ROOT compatibility alias); Claude Code exports only the latter.
# Keep the choice here so hooks/hooks.json stays a host-neutral declaration.
#
# **Nothing in this chain relies on the executable bit**, which is why
# hooks/hooks.json says `sh "…/aop-plugin-hook.sh"` rather than naming the script
# on its own, and why the exec below says `sh` too. A local install copies the
# plugin with `fs.cpSync` or Codex's own copier and modes survive; a *published*
# install is unpacked from a zip archive by the host, and whether a zip's stored
# unix mode makes it onto disk is the extractor's business, not ours. The failure
# it prevents is the worst kind this adapter has: a hook that cannot be executed
# fails silently, because a non-blocking hook's failure is not the agent's
# problem, so the only symptom is an office that stays empty. Costs one `sh`
# lookup, which is a builtin path search, per hook.

set -eu

plugin_root=${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}
[ -n "$plugin_root" ] || exit 0

if [ -n "${PLUGIN_ROOT:-}" ]; then
  harness=codex-cli
else
  harness=claude-code
fi

exec sh "$plugin_root/bin/aop-node.sh" "$plugin_root/bin/aop-send.cjs" "$harness"
