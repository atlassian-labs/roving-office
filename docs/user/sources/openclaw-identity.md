# OpenClaw: names, colours and faces

*Your agents keep the identities they gave themselves.*

Every other harness hands the office a terminal tab, so the office
[invents a person](../agent-names.md) to stand for it. OpenClaw is
the exception, because its agents have **already told you who they are**.

Every workspace holds an `IDENTITY.md` the agent filled in during its bootstrap
conversation, and the office reads it:

```markdown
# IDENTITY.md - Agent Identity

- Name: Albus Dumbledclaw
- Creature: Wizard
- Vibe: AI schoolmaster and family logistics wizard
- Emoji: 🧙
- Colour: rebeccapurple
- Avatar: avatars/albus.jpg
```

## The name

`IDENTITY.md` is read first; the config block is the fallback. In order: the workspace
file, then an identity block in your config, then a plainer name field, then the agent id
if it reads as a word — which is how `main` ends up as **Main**.

The workspace comes first because **that is the answer that is actually filled in.** `main`
— usually the busiest desk in the building — typically has no identity block in the config
at all, but its workspace has always been through bootstrapping.

**A name you have already written is kept exactly as it is:**

| The name it found | In the office |
| --- | --- |
| `Albus Dumbledclaw` | **Albus Dumbledclaw** |
| `Paige Turner` | **Paige Turner** |
| `Florence Nightingclaw` | **Florence Nightingclaw** |
| `Bobster` | **Bobster Flaky-Mender** → **Bobster Docs-Verifier** |
| *(nothing anywhere)* | **Aarav Flaky-Mender** — generated, like every other harness |

The office usually writes the surname itself, as the job in hand. **It stops doing that the
moment you have supplied a surname of your own**, because those names are the joke — Paige
*Turner*, Florence *Nightingclaw* — and overwriting them with `Docs-Verifier` would delete
the better line and take the credit for it.

A single-word identity is treated as a first name and *does* get a job, so `Bobster` still
tells you what he is up to.

An agent id is only used when it reads as a word on its own: `main` becomes Main, but
`code-reviewer` does not become Code-reviewer, because a room of characters called that is
worse than a room of plausible strangers.

### If a name looks wrong

```bash
node bin/aop-openclaw-install.cjs --status
```

```
Cast:      who the office will call each agent
           main         Bobster McClaw, wearing Rich red / crimson
                        ~/.openclaw/workspace/IDENTITY.md
           sideline     Sideline Cruston, wearing Field green / pitch green
                        ~/.openclaw/workspace-sideline/IDENTITY.md
```

It names the **file** each answer came from, because an identity that is wrong is nearly
always an `IDENTITY.md` read from the wrong directory. The Gateway log says the same thing
as it happens.

### Three things to expect

**A name may arrive a beat late.** The agent id comes with the agent context, not the
session, so a character can be Aarav for one event and Albus from the next.

**Two sessions of one agent are the same colleague**, so they deliberately share a name. The
rule that stops two anonymous tabs both being Ada does not apply to a name somebody chose.

**Helpers are not copies.** A subagent that is one of your own configured agents — Albus,
invoked by Sideline — keeps its name, colour and face, because it really is somebody else.
But OpenClaw also runs helper threads *as the spawning agent*, and naming those after their
parent put four identical Sidelines in the room with nothing to tell them apart. A helper is
Sideline's, not a second Sideline, so it gets a character of its own.

## The colour

Everyone in the office wears a shirt from a palette — pleasant, and meaningless, since it is
redrawn every time they arrive. Put a `Colour` in an `IDENTITY.md` and that agent wears it
**in every session**, so the colour becomes something you recognise across a restart.

**Write it however you already write it.** Real agents do not specify colours, they describe
them, and the office reads descriptions:

```markdown
- Colour: Rich red / crimson
- Colour: Bright tangerine / golden-orange
- Colour: Warm library yellow / marigold
- Colour: Lavender / healthcare purple
- Colour: Field green / pitch green
```

Every one of those lands on a shirt. Behind it is a table of 12,005 colour names — which
knows `tangerine`, `marigold`, `field green`, `oxblood` and `stormy sea` — and a fitting
step that pulls whatever it finds into the range the office's own shirts occupy.

**That second half is the one doing the quiet work.** The *ideal* of `crimson` is nearly
black, and `marigold` is a highlighter. Dropped into this room unaltered they read as a
rendering fault, so the hue is kept and the lightness and vividness are made wearable.

Adjectives are read too, so `deep teal`, `muted olive` and `pale sage` differ from the plain
colour even where the table has no entry for them. Where a description offers alternatives,
the office takes the side it can explain *completely*: `Warm library yellow / marigold`
becomes marigold, not a mouthful of olive.

### Want an exact colour? Give a hex

```markdown
- Colour: Rich red / crimson (#b03a3a)
```

A hex is honoured exactly and **never adjusted**, because it is a decision rather than a
description — words for whoever reads the file, the hex for the office. `#c1440e`, `c1440e`
(the hash is easy to forget), `rgb(193 68 14)` and `hsl(20 87% 41%)` all count.

A bare colour *word* does not: `teal` is a description like any other and gets fitted, since
the CSS keyword is nobody's shirt.

A line with no colour in it at all is quietly ignored and the palette decides, so nothing
breaks if you use the field as a mood board. `Colour: the vibe of a Tuesday` costs nothing
but the wish.

Where a colour was chosen it appears as a **Colour** row in the agent's detail panel,
showing what you wrote next to the swatch it resolved to. **That pairing is the point:** the
words are yours and the swatch is what the office made of them, so a disagreement is visible
rather than mysterious. Agents wearing a palette colour get no row, because there is nothing
to tell you.

## The face

```markdown
- Avatar: avatars/florence-nightingclaw.jpg
```

An avatar shows up in the agent's detail panel, beside their name. The path is relative to
the agent's workspace — the directory the `IDENTITY.md` is in — and an absolute path, a
`~/` path or an `http(s)` URL all work.

**The picture is copied to the office, once.** It has to be: the file is on the gateway and
the office is a browser somewhere else, so there is nothing to link to. The plugin hashes
it, asks the office whether it already has that picture, and uploads it only if not — so a
gateway restart costs one small question per agent rather than an upload. It never happens
inside a hook, so an agent is never waiting on it.

Two things to expect:

- **The face arrives a few events late.** The upload has to finish before there is a URL to
  send, so a session is usually named and dressed before it has a portrait. Open the panel
  again a moment later.
- **PNG, JPEG, GIF and WebP only.** An `.svg` is refused on purpose: it is a document that
  can carry script, and the office would be serving it from its own origin.

If a picture never appears, the usual answer is the plainest one — the path does not point at
a file that exists.

## Read next

- [OpenClaw](openclaw.md) — installing it, and the troubleshooting table
- [The room, prop by prop](../agent-names.md) — how everyone else gets named
