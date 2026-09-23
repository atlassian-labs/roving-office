import { COLORS } from '../../config.js';
import { box, cyl, group, put } from '../build.js';

// ---------------------------------------------------------------------------
// Printer: the floor-standing multifunction device every office has in a corner,
// on the model of an HP Color LaserJet Enterprise Flow E778 — white, chest-high,
// three paper cassettes under an output bin, a scanner deck with a document feeder
// on top, and a big touchscreen cantilevered off the front right.
//
// Built facing +z, which is the side every one of those things is on: the trays
// pull out of it, the paper lands on it, the screen points off it. A printer turned
// to face the wall shows the room a blank white slab, which is exactly what a real
// one looks like from behind.
//
// It is tall on purpose. The first version stood 1.17 and read as a microwave on a
// cabinet; the machine this is drawn from is over a metre and a half to the top of
// its feeder, and the height is most of what makes it legible from the isometric
// camera — a printer is recognised by its silhouette long before any of the detail
// below can be made out.
//
// Nobody uses it yet. It is a station rather than furniture because it has a front
// and standing room in front of that front (see STATION_KINDS in layout.js), so
// when an agent is eventually sent to print something, the floor they stand on is
// already worked out and nothing in the room has to move.
const PR = {
  W: 1.20,       // body, across the front
  D: 0.82,       // body, front to back
  castorH: 0.08, // it rolls, as the real cabinet does
  bodyH: 1.18,   // cassettes below, engine and output bin above
  deckW: 1.24,   // the scanner deck overhangs the body slightly, all round
  deckD: 0.86,
  deckH: 0.14,
  adfH: 0.17,    // document feeder, at the back of the deck
};

// The front face of the body, and the plane every applied detail stands proud of.
// Nothing is mounted flush: two surfaces on one plane is the bug this scene keeps
// having (see docs/developer/coplanar-probe.md), and two boxes drawn to the same width are
// the same bug in a different coat — the seam below is inset a centimetre either
// side for exactly that reason.
const FRONT = PR.D / 2;
const BODY_Y0 = PR.castorH;
const BODY_Y1 = BODY_Y0 + PR.bodyH;          // 1.26 — top of the body
const DECK_Y1 = BODY_Y1 + PR.deckH;          // 1.40 — top of the scanner deck

// Where the three cassettes sit. Lowest first, and stopping well short of the
// waist: the top of the stack is the output bin's business.
const TRAYS = [0.20, 0.46, 0.72];

/**
 * How many sheets the output bin shows before it stops counting.
 *
 * Five, the same as the mailbox's parcel pile and for the same reason: it is the point
 * past which another sheet tells you nothing you did not already know. The tray's
 * *count* runs on past it (see `setWaiting`), so a busy office does not silently lose
 * work — it simply stops drawing more of it.
 */
const PRINT_SLOTS = 5;

/** How long the ready light stays amber and the screen busy after a page starts. */
const PRINT_RUN = 1.9;

/**
 * How long the handset shakes before the page comes out.
 *
 * One second, which is the whole of the arrival: long enough to be seen from across the
 * room and short enough that nobody is waiting on it. The manager holds the envelope for
 * exactly this long (see `RING_SECONDS` in agents/AgentManager.js, derived from it) so
 * the ring and the sheet cannot drift apart — a shake that finished after the paper
 * appeared would be a phone ringing about something that already happened.
 */
export const RING_SECONDS = 1.0;

/** Radians of shake, and how fast. Small and quick: a phone rattles, it does not swing. */
const RING_TILT = 0.22;
const RING_SPEED = 0.028;

/**
 * How often a page misses the tray altogether.
 *
 * One in six, which is the number that makes it a joke rather than a fault. Every time
 * and it is a broken printer; once in fifty and nobody ever sees it. Drawn per print
 * from an injectable rng so a test can pin it either way.
 */
const OVERSHOOT_ODDS = 1 / 6;

/**
 * How much this room exaggerates the machine, and in which directions.
 *
 * Everything above is authored at life size, because that is the only size the
 * proportions of a printer can be reasoned about at — a 520-sheet cassette is 0.22
 * of a metre deep and nothing else. These two constants are the separate question
 * of how the *scene* wants it, and the answer is not uniform.
 *
 * `SCALE` is height, and it is 2 for legibility, the same reason the desks are 4.4
 * long. The camera looks down on a room 26 by 20 from across the street: at life
 * size the printer stood 1.59, shorter than a desk is wide, and against the back
 * wall behind desk-2 it read as a white box somebody had left there. Twice up, it
 * is a head taller than the people at the desks and unmistakable from anywhere in
 * the room.
 *
 * `PLAN` is width and depth, and it is 0.75 *against* that. Twice up in every
 * direction, the machine was a two-and-a-half-metre cube of white — a monolith
 * rather than a printer, and it ate the corner of the room it stands in. A printer
 * is a tall thing you stand in front of, so the silhouette that reads as one is
 * narrow and deep-set, not square. Taken together the prop is 1.5 up in plan and 2
 * up in height: a third taller than its own proportions, which is a stylisation and
 * is meant to be. Nothing above is distorted relative to anything else beside it.
 *
 * Both go on the group, so `place()` (scene/movables.js) goes on setting position
 * and rotation without knowing about either. What they do *not* reach is the
 * footprint in `STATION_KINDS` — those half-extents are world measurements, written
 * out already multiplied. Change either constant and they change with it.
 */
const SCALE = 2;
const PLAN = 0.75;

/**
 * One printed page, as a thing in its own right.
 *
 * Exported because it is carried as well as stacked: an agent walks back from the
 * machine holding one (`this.sheet` in agents/Agent.js) and the gallery photographs one
 * (`printout` in scene/catalogue.js), and all three want the same object. Drawn flat and
 * face up, so whoever positions it decides the tilt.
 *
 * Two grey bands for text and no more. At the room's camera distance anything finer is
 * a smudge, and the point of the bands is only to say *printed on* — a blank white
 * rectangle reads as a tile.
 */
export function buildPrintout() {
  const g = group(0, 0, 0);
  g.add(box(0.52, 0.02, 0.4, COLORS.paper, { rough: 0.9 }));
  for (const z of [-0.08, 0.06]) {
    put(g, box(0.36, 0.024, 0.05, 0xb9b3a4, { rough: 0.9, cast: false }), 0, 0.001, z);
  }
  return g;
}

export function buildPrinter() {
  const g = group(0, 0, 0);

  // --- Castors -----------------------------------------------------------
  // Four, inset from the corners. A machine this size is wheeled into place
  // rather than carried, and the shadow gap under it is what stops the whole
  // thing reading as a block sitting in the floorboards.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const castor = cyl(0.05, 0.05, PR.castorH, COLORS.printerPanel, {
        segments: 10, rough: 0.6, cast: false,
      });
      castor.position.set(sx * (PR.W / 2 - 0.12), PR.castorH / 2, sz * (PR.D / 2 - 0.12));
      g.add(castor);
    }
  }

  // --- The body ----------------------------------------------------------
  // One mass from the castors to the underside of the scanner deck, rather than a
  // cabinet with an engine stacked on it. The two are the same white and the same
  // width on the real machine, so modelling them apart bought two more boxes and
  // a seam to get wrong; the waist band below is what divides them.
  put(g, box(PR.W, PR.bodyH, PR.D, COLORS.printerBody, { rough: 0.55 }), 0, BODY_Y0 + PR.bodyH / 2);

  // --- Paper trays -------------------------------------------------------
  // Three cassettes, drawn as applied panels rather than cut recesses: the body is
  // a solid box, so anything set *into* it is inside it and invisible, and at this
  // camera distance the shadow line under a panel is what reads as a drawer
  // anyway. Each gets a full-width pull, which is how a cassette this size opens.
  for (const y of TRAYS) {
    put(g, box(PR.W - 0.06, 0.22, 0.04, COLORS.printerBody, { rough: 0.5, cast: false }), 0, y, FRONT - 0.01);
    put(g, box(0.72, 0.04, 0.035, COLORS.printerTrim, { rough: 0.4, cast: false }), 0, y + 0.07, FRONT + 0.02);
  }

  // Waist band: the dark line where the paper stack ends and the engine begins.
  // Without it the front is a metre of unbroken white with three drawers at the
  // bottom, and the top half has no scale to it.
  put(g, box(PR.W - 0.02, 0.045, 0.02, COLORS.printerPanel, { rough: 0.7, cast: false }), 0, 0.90, FRONT + 0.005);

  // --- Output bin --------------------------------------------------------
  // A letterbox on the left of the upper body, with a catch tray under it. Left
  // rather than centred, because the right of this face belongs to the screen.
  put(g, box(0.62, 0.15, 0.02, COLORS.printerPanel, { rough: 0.6, cast: false }), -0.24, 1.10, FRONT + 0.008);
  // The tray projects, as a real one does — which is why the kind table's `hd` is
  // measured past the front of the body rather than to it.
  put(g, box(0.58, 0.035, 0.14, COLORS.printerTrim, { rough: 0.5, cast: false }), -0.24, 0.985, FRONT + 0.02);

  // The stack in the output bin: one sheet per slot, revealed as prints pile up.
  //
  // Exactly the mailbox's backlog pattern, and named after it (`MAILBOX_LETTER_SLOTS`
  // in props/mailbox.js) — the visuals cap at a number that reads as "a pile" and the
  // count behind them does not. What differs is what a full tray *means*: the post's
  // pile is work that arrived, this is work the office made, so it grows while the room
  // is busy and empties when somebody finally goes to fetch some.
  //
  // The first sheet is the one that was already here: a printer with an empty output
  // tray is a printer nobody has ever used, and a sheet sitting slightly askew is one
  // somebody walked away from, which is the office this is. So slot 0 starts visible
  // and the rest arrive on top of it.
  //
  // The angles stay small. A wide thin panel turned even a little swings its corners a
  // long way forward, and the whole stack has to stay inside the floor the printer
  // claims — the kind table's `hd` is measured past this tray.
  const sheets = [];
  for (let i = 0; i < PRINT_SLOTS; i++) {
    const flip = i % 2 ? 1 : -1;
    const sheet = box(0.44, 0.012, 0.18, COLORS.paper, {
      rough: 0.9, cast: false, emissive: 0xfff6e0, emissiveIntensity: 0.1,
    });
    sheet.position.set(-0.22 + flip * 0.012, 1.01 + i * 0.016, FRONT + 0.005);
    sheet.rotation.y = 0.02 + flip * (0.012 + i * 0.006);
    sheet.visible = i === 0;
    g.add(sheet);
    sheets.push(sheet);
  }

  // The overshoot: one sheet on the floor, out in front of the machine and a little
  // to the left, where the tray is.
  //
  // Hidden until a print goes wrong, which is occasionally rather than every time — the
  // joke is that it is occasional, so it lives here as a mesh that gets shown rather
  // than as an animation that plays.
  //
  // **Where it lands is not decoration.** An agent picks this up from the standing room
  // rather than walking to it, so the sheet has to be somewhere a person stood there
  // could actually reach — the first version put it 0.78 in front of the machine's own
  // face, which is most of a body away from the spot they stop at, and the page simply
  // vanished while they were nowhere near it. These numbers put it about 0.65 off the
  // standing room in world units: a stoop away, on the machine side, and outside the
  // footprint so it is lying on floor somebody walks on rather than under the printer.
  //
  // Local metres, so `SCALE`/`PLAN` at the end of this function multiply them like
  // everything else. `hd` in the kind table is 0.85 world, which this is clear of.
  const escaped = box(0.44, 0.012, 0.30, COLORS.paper, { rough: 0.9, cast: false });
  escaped.position.set(-0.27, 0.012, 0.90);
  escaped.rotation.y = -0.38;
  escaped.visible = false;
  g.add(escaped);

  // Ready light, above the output slot on the left. Not on the right, where it
  // would sit behind the touchscreen and be visible from nowhere at all.
  const ready = box(0.05, 0.05, 0.02, 0x5fd08a, {
    rough: 0.4, cast: false, emissive: 0x5fd08a, emissiveIntensity: 0.5,
  });
  ready.position.set(-0.45, 1.22, FRONT + 0.012);
  g.add(ready);

  // --- Scanner deck and document feeder ----------------------------------
  // The deck overhangs the body all round, which is the one place this machine has
  // a lip and therefore the one place it throws a line of shadow across its own
  // front. That lip is most of what says "this is a copier, not a cabinet".
  put(g, box(PR.deckW, PR.deckH, PR.deckD, COLORS.printerBody, { rough: 0.5 }), 0, BODY_Y1 + PR.deckH / 2);
  // The glass line under the lid, inset from the deck's sides so it cannot share a
  // face with either the deck or the body.
  put(g, box(PR.deckW - 0.04, 0.03, 0.02, COLORS.printerPanel, { rough: 0.7, cast: false }), 0, BODY_Y1 + 0.035, PR.deckD / 2 + 0.005);

  // Document feeder, along the back of the deck. It sits back rather than covering
  // the whole deck so the flatbed lid in front of it stays visible from above,
  // which is the angle this scene is always looked at from.
  put(g, box(PR.deckW - 0.08, PR.adfH, 0.40, COLORS.printerBody, { rough: 0.5 }), 0, DECK_Y1 + PR.adfH / 2, -0.20);
  // Its input tray, a thin shelf on top with a dark slot behind. Two sheets of
  // detail for the whole top of the machine, because from the office camera the
  // top of the machine is about four pixels of it.
  put(g, box(0.70, 0.022, 0.26, COLORS.printerTrim, { rough: 0.5, cast: false }), 0, DECK_Y1 + PR.adfH + 0.011, -0.14);
  put(g, box(0.66, 0.03, 0.02, COLORS.printerPanel, { rough: 0.7, cast: false }), 0, DECK_Y1 + PR.adfH - 0.05, 0.005);

  // --- Touchscreen -------------------------------------------------------
  // The big one, cantilevered off the front right on a stubby arm, as the Flow
  // models carry it. Tilted back rather than stood upright: the camera looks *down*
  // on this prop, which inverts the intuition — a screen facing the room is a
  // sliver from up here, and one lying back towards the ceiling is the one you can
  // actually read. It is the only lit thing on the prop and the detail that says
  // at a glance which way the machine faces.
  // Two placements to get right, and both were wrong first time. The arm goes
  // *under* the screen, not in front of it: mounted level with the panel it drew
  // over the middle of it, a dark block across the one lit face on the prop. And
  // the panel has to hang clear of the scanner deck's overhang above it — set any
  // higher, it passed up through the deck's front right corner and the deck drew
  // over its top edge.
  put(g, box(0.12, 0.07, 0.10, COLORS.printerPanel, { rough: 0.5, cast: false }), 0.36, 1.06, FRONT + 0.03);

  const panel = group(0.36, 1.10, FRONT + 0.07);
  panel.rotation.x = -0.45;
  const bezel = box(0.44, 0.30, 0.035, COLORS.printerPanel, { rough: 0.5, cast: false });
  panel.add(bezel);
  const screen = box(0.36, 0.23, 0.012, 0x4b6b86, {
    rough: 0.35, cast: false, emissive: 0x76a6cc, emissiveIntensity: 0.45,
  });
  screen.position.z = 0.024;
  panel.add(screen);

  // An incoming call, drawn on the screen and hidden until there is one.
  //
  // A fax has no journey to watch — it does not fly in through a window or get thrown at
  // the door — so without this an arrival was a sheet that silently appeared in the tray.
  // This is the journey, compressed into the one second before it lands: the screen shows
  // a handset, the handset shakes the way a phone does, and *then* the page comes out.
  //
  // A handset rather than a word, because at this camera distance the screen is a
  // thumbnail and text on it is a smudge — and because a shaking phone is the one shape
  // everybody already reads as "answer me". Three boxes: an earpiece, a mouthpiece and
  // the bar between them, tilted so it reads as a handset rather than as a letter H.
  // Three boxes, and the arrangement is the whole of it: a bar with an earpiece at each
  // end, both jutting out the *same* side. The first version offset them in opposite
  // directions — one up-and-right, one down-and-left — which draws an S rather than a
  // receiver. A handset is a shallow C.
  const phone = group(0, 0, 0.03);
  const handset = box(0.045, 0.16, 0.014, 0xf4f1e8, { rough: 0.6, cast: false });
  phone.add(handset);
  for (const sy of [-1, 1]) {
    const cup = box(0.075, 0.05, 0.018, 0xf4f1e8, { rough: 0.6, cast: false });
    // Same x for both — that is the C — and the ends splayed a touch wider than the
    // bar so the silhouette has shoulders rather than being a plain rounded rectangle.
    cup.position.set(0.026, sy * 0.078, 0);
    phone.add(cup);
  }
  // Tilted the way a receiver is held rather than standing upright, which is how the
  // glyph everybody knows is drawn.
  phone.rotation.z = -0.55;
  phone.visible = false;
  panel.add(phone);
  g.add(panel);

  // Stood up at room scale: tall in y, drawn in on the two floor axes. Last thing,
  // so everything above is authored in the machine's own metres and this is the only
  // line that knows the room exaggerates.
  g.scale.set(SCALE * PLAN, SCALE, SCALE * PLAN);

  // The two lit things on the prop, kept so `update` can drive them. The ready light
  // is the whole of the machine's mood from across the room — green idle, amber
  // working — and the touchscreen brightens with it, because a printer nobody is using
  // has a dark panel.
  // Cloned, both of them, because `box()` hands out materials from a shared cache
  // (`_mats` in scene/build.js) and these two get written to every frame. Tinting a
  // cached material tints everything else drawn in that colour — the same trap the
  // agents' cup hit, which says so in as many words in agents/Agent.js. A second
  // printer would otherwise go amber whenever the first one did.
  ready.material = ready.material.clone();
  screen.material = screen.material.clone();
  const readyMat = ready.material;
  const screenMat = screen.material;
  const READY_GREEN = 0x5fd08a;
  const READY_AMBER = 0xe8ab52;

  /**
   * The handle: a print, a fax, and the tray's own tally.
   *
   * It was `{ id, kind }` and nothing else, with a comment saying a `print()` nobody
   * calls is a promise the code does not keep. Somebody calls it now.
   *
   * The tally is *told* to this prop rather than counted in it, which is the mailbox's
   * hard-won lesson: every path that removed a sheet would otherwise owe a matching
   * decrement, and the one that forgot would leave a tray drawn full over an empty
   * queue. One source of truth (`PrintTray` in agents/print.js) is worth the frame of
   * latency.
   */
  const handle = {
    id: 'printer',
    kind: 'printer',
    sheets,
    /** How many sheets the queue says are waiting. Set by `setWaiting`. */
    waiting: 1,
    /** Seconds left of the current run. Read by tests; drives the light. */
    _run: 0,
    /** Seconds left of an incoming call. */
    _ringing: 0,
    _overshot: false,

    /**
     * A page comes out.
     *
     * The machine runs for `PRINT_RUN` whatever happens, because the comedy is in the
     * timing: the screen lights, nothing appears for a beat longer than anybody expects,
     * and then the sheet is there. Whether it lands in the tray is a separate draw.
     *
     * @param {() => number} [rng]  injectable so a test can force either outcome
     * @returns {boolean} true if the page missed the tray
     */
    print(rng = Math.random) {
      this._run = PRINT_RUN;
      // A page already on the floor is not thrown twice: the gag is one loose sheet
      // somebody has to walk round, not a drift of them.
      const missed = !escaped.visible && rng() < OVERSHOOT_ODDS;
      if (missed) {
        escaped.visible = true;
        this._overshot = true;
      }
      return missed;
    },

    /** True while a page is on the floor, waiting to be picked up. */
    get overshot() { return escaped.visible; },

    /**
     * Somebody picked the loose page up off the floor.
     *
     * Separate from collecting out of the tray, because they are separate errands: the
     * tray is on the way past, and this is a stoop somebody has to make.
     */
    retrieve() {
      escaped.visible = false;
      this._overshot = false;
    },

    /** Finished work fed into the feeder and sent. The machine runs for it. */
    fax() { this._run = PRINT_RUN; },

    /**
     * A fax is coming in: shake the handset on the screen.
     *
     * The whole of an incoming arrival, because a fax has no journey — it does not fly
     * in through a window or arrive at the door, so without this a page simply appeared
     * in the tray with nothing to watch. The manager rings, waits, and *then* lands the
     * envelope, so the shake is over exactly as the paper shows up.
     */
    ring(seconds = RING_SECONDS) {
      this._ringing = Math.max(this._ringing, seconds);
      phone.visible = true;
    },

    /** True while the handset is shaking. For tests and for the docs gallery. */
    get ringing() { return this._ringing > 0; },

    /**
     * Tell the tray how many sheets the queue is holding.
     *
     * @param {number} count  sheets waiting to be collected
     */
    setWaiting(count) {
      if (count === this.waiting) return;
      this.waiting = count;
      for (let i = 0; i < sheets.length; i++) sheets[i].visible = i < count;
    },

    update(dt) {
      if (this._run > 0) this._run = Math.max(0, this._run - dt);
      if (this._ringing > 0) {
        this._ringing = Math.max(0, this._ringing - dt);
        // A rattle, not a swing: fast and small, about the tilt it is drawn at.
        const t = performance.now() * RING_SPEED;
        phone.rotation.z = -0.5 + Math.sin(t) * RING_TILT;
        if (this._ringing === 0) {
          phone.visible = false;
          phone.rotation.z = -0.5;
        }
      }
      // Ringing counts as busy: the screen is lit and the light is amber from the moment
      // the call comes in, so the machine is visibly *about* to do something rather than
      // idle right up until paper appears.
      const busy = this._run > 0 || this._ringing > 0;
      readyMat.color.setHex(busy ? READY_AMBER : READY_GREEN);
      readyMat.emissive.setHex(busy ? READY_AMBER : READY_GREEN);
      // The screen wakes with the machine and dims back down, rather than switching:
      // a hard cut on a prop this small reads as a flicker, which is a different gag.
      const want = busy ? 0.85 : 0.45;
      screenMat.emissiveIntensity += (want - screenMat.emissiveIntensity) * Math.min(1, dt * 5);
    },
  };
  return { obj: g, handle };
}
