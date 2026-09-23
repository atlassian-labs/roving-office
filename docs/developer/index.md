# Where to look

*Developer documentation. It assumes you have a checkout and something you want to change.*

If you only want to *use* the office — install it, connect a harness, read the room —
that is [the user documentation](../user/index.md), and it assumes nothing but a browser.

## The one constraint worth knowing first

**There is no build step, and that is load-bearing.** `index.html` carries an import map,
three.js is vendored, and every module loads as an ES module straight off disk. The whole
loop is *edit a file, reload the tab*.

Please do not introduce one. The single exception is the documentation site you are reading,
which Eleventy builds into `docs/site/` — it does not touch the app.

## Start here

| | |
| --- | --- |
| [Getting the code](getting-the-code.md) | Clone it, run it, and the five commands that make up a full check |
| [Developing on it](developing.md) | The loop, the headless screenshot recipe, and the traps |
| [Every npm script](npm-scripts.md) | All forty-odd of them, generated from `package.json` |

## How it works

Roughly in the order a change travels:

| | |
| --- | --- |
| [Architecture](architecture.md) | How a keystroke becomes somebody walking across the room, and where every file lives |
| [The AOP spec](protocol/aop-spec.md) | The wire format an adapter speaks |
| [Adapter notes](protocol/aop-harness-adapters.md) | What each harness can actually see, measured |
| [The source model](sources.md) | How several feeds share one room |
| [The physics of the office](physics.md) | The movement rules, and the holes in them |
| [Scene internals](scene-internals.md) | Where the constants live, and the rules that keep a facade still |
| [Job delivery](job-delivery.md) | The mailbox, which is the most stateful corner of the system |
| [The furniture editor](editor.md) | The seams, and the file format |
| [The layout algorithm](layout-algorithm.md) | A seed in, a whole layout out |
| [Tuning the layout generator](tuning-the-layouts.md) | How we found out whether the rooms it makes are any good: one number, a headless simulation, a taste model fitted to human judgement, and an autonomous loop |

## Changing it

| | |
| --- | --- |
| [Extending the office](extending.md) | Add a prop, a building, a source or an adapter — each is one recipe |
| [Photographing a prop](prop-portraits.md) | Getting your new thing into the gallery |
| [The coplanar-face probe](coplanar-probe.md) | Finding the two surfaces you just put on one plane |

Every recipe in **Extending** ends the same way: `npm test`, the probe, and a look at the
scene. The registries fail loudly if you forget a step, which is the whole safety story —
you cannot add half a prop.

## What is not here

**Design records and deployment runbooks live in the maintainers' own workspace**, not in
this repository. That covers the proposals behind decisions already shipped, evaluations
of routes not taken, and the procedures for the hosted offices — access grants, project
administration, the container and edge configuration.

They are kept out for two reasons rather than one. Several of them describe behaviour the
code no longer has, so a contributor reading one would be reading a plan rather than the
system; and the operational ones cite infrastructure nobody outside the maintainers can
reach, so they document a machine you cannot log into. **Nothing you need in order to
change this code is in them.** Where a decision's reasoning is worth having, it belongs in
a comment beside the code or on a page in this set — which is why *why* is a house rule
below.

If you go looking for a design record because a comment refers to one, ask on the issue
tracker instead: the answer is either something that should have been written down here,
in which case say so, or something about a deployment, in which case it is a maintainer's
to answer.

## Two house rules

**Docs move with the code, in the same PR.** The documentation is accurate because that is
a rule, not a hope. If your change makes a doc wrong, the change is not done.

**Comments say why.** This codebase writes its reasons down next to the code they justify.
When you move code the comments travel verbatim; when you change a decision, rewrite its
justification rather than deleting it.

The rest of the working agreement is in [CONTRIBUTING.md](../../CONTRIBUTING.md), and the
agent-facing version in [AGENTS.md](../../AGENTS.md).
