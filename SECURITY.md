# Security policy

## Reporting a vulnerability

**Report it privately, through Atlassian's vulnerability reporting process:**
**<https://www.atlassian.com/trust/security/report-a-vulnerability>**

That page is the current route to Atlassian's security team and carries the submission
channels and the PGP key for anything sensitive. Please use it rather than a public issue
or pull request — a report in the open reaches every reader before it reaches a fix.

Useful in a report: what kind of issue it is, the version or commit (`package.json` carries
the version), how to reproduce it, and what an attacker gets out of it.

## What to expect

Atlassian's process governs how the report is triaged and handled, including any
coordinated disclosure; the fix lands here.

The honest half of that: this is an [Atlassian Labs](https://github.com/atlassian-labs)
project, alpha and pre-1.0, maintained in whatever time its maintainers have. There is no
on-call and no support commitment, and only `main` gets fixes — there are no maintained
release branches. Expect acknowledgement in days rather than hours. The response times
that apply are Atlassian's own; this repository does not publish a separate target it
could not keep.

## Scope

In scope — the code in this repository:

- the receiver, `server.cjs` and `lib/`;
- the office web app, `src/`;
- the observer that reports agent activity — `bin/`, `hooks/`, and the harness plugins
  (`.claude-plugin/`, `.codex-plugin/`, `openclaw-plugin/`).

**The hosted demo at [therovingoffice.com](https://therovingoffice.com/) is in scope too**,
with two conditions: include the URL and roughly when you saw it, and test only against an
office you cut yourself. Other people's offices are other people's rooms — do not probe a
keycard you were not given, and no load or denial-of-service testing against the demo.

Out of scope:

- **an office someone deployed themselves.** Report that to whoever runs it.
- **the agent harnesses this project watches** — Claude Code, Codex, and the rest. Those go
  to their own vendors.
- **third-party dependencies.** Report those upstream, though do tell us if the flaw is
  reachable through this project.

## What is not a vulnerability here

Some of what looks alarming is documented design. Worth reading before you write:

- **A keycard is the whole of the access control.** An office lives at `/office/<keycard>`
  with no login and no owner, so anyone holding the link can read the room —
  [offices, keycards and scenes](docs/user/offices-and-keycards.md#a-keycard-is-the-whole-address).
- **A hosted office answers unauthenticated requests and should be treated as public** —
  [sharing an office](docs/user/sharing-an-office.md#before-you-hand-the-link-round).
  Writing to one needs a token; reading it needs only the keycard.
- **The observer transmits repository host, owner and name, the branch, the working
  directory, file paths and tool activity even at its default redaction setting.** That is
  documented behaviour, written out in full in
  [connect your agents](docs/user/connect-your-agents.md#what-the-default-actually-sends).
  Prompts and free text need two deliberate opt-ins.
- **Missing security headers or raw scanner output** on the demo host, with no demonstrated
  impact.

What *is* worth reporting is any of that turning out untrue — a redaction setting that
sends more than its table says, an office readable without its keycard, a write accepted
without a token.
