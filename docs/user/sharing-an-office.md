# Sharing an office

*Put the sessions running on your laptop into a room somebody else can open.*

Two different things get called sharing, and only one of them needs a command.

**Handing out a keycard needs nothing.** The keycard in an office URL is the half that is
safe to send: it opens the room for watching and **cannot write to it**. Send someone the
link and they are in the room with you.

**And you can take it back.** Click the keycard at the top of the office for everything
that decides who is in the room: the link, the headcount, a
[passcode](#put-a-passcode-on-an-office), and
[closing the office](#close-an-office-when-the-link-has-gone-too-far) — plus the offices
this browser remembers, and a button to open one more.

**Filling a hosted office from your own machine** is the other one, and it needs one
command. A remote office cannot tell your adapters where to post — it has no access to your
home directory — so something local has to do it on the office's behalf.

## Point this machine at a hosted office

```bash
# 1. cut an office up there, and aim this machine's adapters at it
npm run connect:remote -- https://therovingoffice.com

# 2. check where events are going — expect `mode: remote`
npm run connect:remote:status
```

That prints the office URL to open, and stores the office's **write token** locally. That
is the only copy there will ever be: no route will tell you that token again, and only its
first few characters are ever printed, because terminal scrollback is a poor home for a
credential.

While you still hold it you can cut another for a second machine, or revoke one you have
lost. If you lose every token, the office is read-only for good and a fresh office is the
answer.

To staff the same office from a second machine, read the token out of that file and pass
it across:

```bash
node bin/aop-connect.cjs <url> --office ABCD-1234 --token <write-token>
```

Now open the office URL and give an agent something to do. People should walk in within a
second or two. An office made this way starts out watching the live harnesses rather than
Test Data, because connecting a machine and then finding invented agents in the room is a
half-finished job.

When you are done, hand the machine back:

```bash
npm run disconnect:remote
```

## Claude Code needs a nudge

Claude runs a *copy* of the plugin taken at install time and cached by version, so an
update offering a version it already holds does nothing at all:

```bash
node bin/aop-claude-install.cjs --status     # says whether the copy has drifted
claude plugin marketplace update roving-office
claude plugin update roving-office@roving-office
```

Then **restart the sessions**, as always.

## When nothing shows up

A hook may never make an agent wait and may never print, which is what makes this safe and
also what makes it quiet. Two things follow.

**Nothing is lost while the host is away.** Events spool locally and drain when it comes
back — through one outage, 94 queued events arrived the moment a working endpoint did. A
flaky office is a *delayed* office, not a lossy one, so an empty room is worth a minute's
patience before it is worth debugging.

**Tell the platform's failures apart from the office's by their wording**, because the
status code will not do it for you. The office answers in its own JSON shape; the host
answers in its. Something like `403 sandbox ingress policy missing` or `502 bridge token
was rejected` is the gateway between you and a perfectly good office — not a bad token.

**A `200` from a health check does not mean posting works.** Only a real post succeeding
does.

The one failure that is genuinely yours to fix looks identical from outside: **a
redeployed or restarted host forgets the token**, and hooks then fail forever, silently.
`npm run connect:remote:status` shows a spool that never drains. The fix is to cut a new
office.

## Put a passcode on an office

A link travels in ways a passcode does not. It ends up in a screenshot with the address
bar in it, in a channel with two hundred people in it, in browser history on a shared
machine, in a bookmark synced to a personal account. That is the ordinary leak, and it is
ordinary precisely because a URL is what tooling copies by itself while a passcode is
something a person has to type on purpose.

So an office can ask for one. Click the keycard, choose **Set a passcode**, type it, and
**Lock the office**. From then on anyone opening the link is asked for it once per
browser, and a padlock appears beside the keycard so you can see at a glance that the
room is locked.

**Optional means optional.** Offices have no passcode until you set one, and one that has
none behaves exactly as it always did. The shared demo office refuses a passcode
outright.

Four things are worth knowing before you rely on it:

- **It does not replace redaction.** A passcode is a door on the room. What your agents
  actually send is decided where they run — see
  [redaction](connect-your-agents.md#how-much-of-your-prompt-the-office-is-told) — and a
  passcode changes that by nothing.
- **It cannot un-see anything.** Setting one now does nothing about what somebody already
  read out of the room. For that, close the office.
- **A link and its passcode leaking together defeats it completely.** Send them by
  different routes, or do not bother sending the passcode at all.
- **An unlocked office stays unlocked in that browser.** That is the convenience — nobody
  wants to retype a passcode on every reload — and the cost is that a shared or kiosk
  machine keeps the room open. **Changing the passcode locks every browser out again**,
  including your own, which is the answer when a passcode has gone further than you meant.

Take it off with **Remove** in the same dialog.

## Close an office when the link has gone too far

**Close this office** is the one action that revokes everything at once: the link, every
person currently watching, the rooms and their furniture, the event history, and every
machine posting into it. The button asks once, and the second click does it.

One thing is genuinely surprising and worth reading twice. **A closed office does not
produce an error for whoever kept your link.** Visiting a keycard nobody is using *creates*
an office there — that is how a shared link works before anyone has opened it — so the old
link resolves to a brand-new empty room. Nobody is told they were cut off, which is a
feature rather than an oversight: revocation that announces itself invites a conversation
you may not want to have.

It cannot be undone, and there is no reason to want to: an office is an address you throw
away, and the answer to a lost one is another one.

The demo office cannot be closed.

## No accounts, ever

There is no sign-up, no password, no email and no user store anywhere in this project, and
there is not going to be. An office is an address you throw away; an account is the
opposite of that.

What stands in for one is a **write token**, minted with the office and kept by the
browser that opened it. Holding it is the whole of owning an office. Say all of what that
costs, plainly:

- **There is no recovery.** Clear that browser's storage, or open the office from your
  phone, and you stop being its owner. The office keeps working and the keycard still
  opens it — you have simply lost the passcode and close controls. If you connected the
  office from a terminal you still have the token
  [in that file](#point-this-machine-at-a-hosted-office) and can use it from there.
- **No cross-device ownership**, and no list of your offices anywhere but that browser.
- **You can revoke a credential, never a person.** A passcode shared with six people is
  removed from all six or from none.
- **Nobody is identified, so nobody can be audited.** There is no record of who read the
  room.

## Before you hand the link round

> **Treat a hosted office as public.** Unless you have put a passcode on it, it answers
> unauthenticated requests. Redaction withholds the *words* by default — no prompts, no
> messages, no search queries — but it still sends your repository host, owner and name,
> the branch, which tools ran, and **the file paths they touched**. Those paths are
> shortened, not hidden: one under your home folder still names every folder below it.
> Read [what the default actually sends](connect-your-agents.md#what-the-default-actually-sends)
> and set your redaction before you share, not after. A passcode is a door, not
> redaction.

**A hosted office is a demonstration, not a filing cabinet.** It does not reliably
remember offices, scenes or furniture across a redeploy. If you want a room that keeps
what you gave it, run one [on your own machine](install.md).
