// The test fit: the brief, laid onto the actual 26-by-20 floor.
//
// Four stages, in this order, and the order is the argument:
//
//   1. **Circulation.** The avenue in from the door and the one street it runs
//      into, reserved before anything is placed (see `plate()` in floor.js).
//      Aisles drawn last are aisles made of whatever floor happens to be left.
//   2. **Desks**, because they are the biggest thing in the room, the thing the
//      headcount is made of, and the only thing arranged in *banks* rather than
//      one at a time. A team sits together or it does not sit together; there is
//      no repairing that afterwards.
//   3. **Stations**, each to the sort of place its job wants: the coats by the
//      door, the reference shelf by the desks, the printer and the coffee machine
//      as far from the quiet end as the room allows. Every one of these is an
//      adjacency rule out of the space-planning literature, and each is written
//      down beside the station it governs.
//   4. **The lounge, then the rugs, then the planting** — the dressing, which
//      goes wherever the room has been left generous, and is the reason a
//      generated room reads as somewhere rather than as a diagram.
//
// Everything is placed by the same move: enumerate every position the piece
// could stand at, score them all, take the best. No back-tracking, because a
// scored scan cannot paint itself into a corner the way a greedy walk can — the
// worst it can do is find nowhere at all, and then the piece is simply not in
// this office and `furnish()` says so in its report.

import { ROOM, DOOR } from '../config.js';
import {
  STATION_KINDS, FURNITURE_KINDS, PLANT_KINDS, BODY_BERTH, JOB_ROLES, worldExtent,
} from '../layout.js';
import { streamFor, fieldAt } from './rng.js';
import {
  Floor, plate, alongSide, anywhere, atWindow, heading, middle, round2, daylight,
  SIDES, DESK_APPROACH, DESK_BODY, DESK_HW, DESK_HD, inRect,
} from './floor.js';

/**
 * How far apart desks stand in a bank.
 *
 * A desk top is 4.4 across and its blocked floor 5.0, so anything from 5.0 up is
 * a bank that fits, and the first version spent the slack generously — 5.4 to 6.4,
 * on the grounds that the authored room's neighbours sit 7.0 and 8.5 apart.
 *
 * That was wrong, and the scorecard is what said so. **A bank has to be tighter
 * than the gap between banks or it is not a bank.** Two rows of desks are 5.4
 * apart at the very closest — a desk's own 1.4, its occupant's 2.6 of standing
 * room, and the next desk's 1.4 — so a within-bank pitch of 6.0 put the desk in
 * the *next row* nearer to you than the one on your own bench. Which is what
 * `teams` in src/plan/score.js measures, and it was reading 0.00 on rooms whose
 * banks were each perfectly one team's.
 *
 * So: 5.1 to 5.35, comfortably inside the 5.4 that separates two runs. The tops
 * end up 0.7 to 0.95 apart, which reads as a row of desks pushed together rather
 * than as one long bench — the thing this room's desks are actually modelled as.
 * Drawn per room, so two offices of the same size are not the same office.
 */
const PITCH = [5.1, 5.35];

/** The whole floor, from the outside in — how far a prop may stand from a wall. */
const IN_ROOM = 1.0;

/**
 * The most desks one bank may hold, worked out from the room rather than picked.
 *
 * A bank of `n` desks at `pitch` is `(n - 1) * pitch + 5.0` across, and it has to
 * fit between the walls with a little to spare at each end. Along the room's 26
 * that is four; across its 20, three. A team larger than its bank can hold is
 * split over two banks side by side, which is what a real floor does with a team
 * of eight.
 */
function bankCapacity(along, pitch) {
  const span = (along === 'x' ? ROOM.W : ROOM.D) - 2 * IN_ROOM;
  return Math.max(1, Math.floor((span - 2 * DESK_HW) / pitch) + 1);
}

/**
 * The desks of one bank, as offsets from the bank's own anchor.
 *
 * Two forms, and they are the two ways a desk can have a neighbour:
 *
 *   * **single** — one row, all facing the same way, occupants all on the same
 *     side. The row needs its own aisle behind it, which is what makes a floor of
 *     these read as rows.
 *   * **paired** — two rows with their monitors meeting in the middle, occupants
 *     on the outside. This is what "back to back" means in a bench system, and
 *     it is the arrangement that puts a team face to face across their screens
 *     while giving them one aisle each rather than two.
 *
 * The geometry is the desk's own: `heading(facing)` is the way its occupant sits
 * out from it, and the perpendicular is the way the bank runs — so a bank has no
 * opinion about world axes and works at any of the four quarter turns.
 */
function bankDesks({ form, count, facing, pitch }) {
  const dir = heading(facing);
  const perp = { x: Math.cos(facing), z: -Math.sin(facing) };
  const rows = form === 'paired'
    ? [
      { n: Math.ceil(count / 2), facing, offset: DESK_HD },
      { n: Math.floor(count / 2), facing: facing + Math.PI, offset: -DESK_HD },
    ]
    : [{ n: count, facing, offset: 0 }];

  const out = [];
  for (const row of rows) {
    for (let i = 0; i < row.n; i += 1) {
      const along = (i - (row.n - 1) / 2) * pitch;
      out.push({
        dx: perp.x * along + dir.x * row.offset,
        dz: perp.z * along + dir.z * row.offset,
        facing: row.facing,
      });
    }
  }
  return out;
}

/** Every quarter turn a bank running along this axis can face. */
function facingsFor(along) {
  return along === 'x' ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
}

/**
 * Anchor positions to try for a bank, on a one-unit lattice with a per-room jog.
 *
 * A unit is coarse for a lattice and exactly right for a desk: nothing in the
 * room reads differently for a quarter of a unit, and it cuts the search by
 * sixteen. The jog is what stops every office in the world sitting on integers.
 */
function bankAnchors(jog) {
  const out = [];
  for (let x = IN_ROOM + jog; x <= ROOM.W - IN_ROOM; x += 1) {
    for (let z = IN_ROOM + jog; z <= ROOM.D - IN_ROOM; z += 1) out.push({ x, z });
  }
  return out;
}

/**
 * How the desks are arranged, per typology: where a bank may be anchored, which
 * way it may face, and what makes one position better than another.
 *
 * Each `score` is that typology's whole argument, in a handful of terms. They
 * share the terms in `deskScore` below — daylight, distance from the door, and
 * whether the occupants step out into a street — and add whatever makes the shape
 * itself: rows want to line up with each other, pods want daylight and a gap
 * between them, a spine wants the middle of the room, an island wants to be
 * nowhere near a wall.
 */
const ARRANGEMENTS = {
  rows: {
    form: 'single',
    // Every row faces the same way, decided once for the room: a floor of rows
    // where half of them face the other way is two floors of rows.
    lockFacing: true,
    score: ({ bank, prev, along }) => {
      if (!prev) return 0;
      // Lined up with the row before it, and a row's width clear of it: the aisle
      // between two rows of desks is where their occupants' chairs go.
      const across = along === 'x' ? Math.abs(bank.z - prev.z) : Math.abs(bank.x - prev.x);
      const level = along === 'x' ? Math.abs(bank.x - prev.x) : Math.abs(bank.z - prev.z);
      return (level < 0.75 ? 2.5 : 0) + (across > 5 && across < 9 ? 2 : 0);
    },
  },
  pods: {
    form: 'paired',
    score: ({ bank, prev }) => {
      if (!prev) return 0;
      const gap = Math.hypot(bank.x - prev.x, bank.z - prev.z);
      // Far enough apart to be two teams, near enough to be one floor.
      return gap > 6.5 && gap < 15 ? 2.5 : -1.5;
    },
  },
  spine: {
    form: 'paired',
    lockFacing: true,
    score: ({ bank, work, along }) => {
      // Down the middle of the working half, which is what a spine is: the desks
      // hang off it and the walking happens either side.
      const mid = middle(work);
      const off = along === 'x' ? Math.abs(bank.z - mid.z) : Math.abs(bank.x - mid.x);
      return 4 * Math.max(0, 1 - off / 6);
    },
  },
  perimeter: {
    form: 'single',
    // Against the walls and the open edges, faces to the outside of the room.
    sides: true,
    score: ({ bank, prev, used }) => {
      let s = used.has(bank.side) ? -2 : 2;
      if (prev) s += Math.hypot(bank.x - prev.x, bank.z - prev.z) > 5 ? 1 : -1;
      return s;
    },
  },
  island: {
    form: 'paired',
    score: ({ bank }) => {
      // One block, in the middle, with floor all round it.
      const off = Math.hypot(bank.x - ROOM.W / 2, bank.z - ROOM.D / 2);
      return 5 * Math.max(0, 1 - off / 7);
    },
  },
};

/**
 * What every arrangement agrees about, wherever a bank goes.
 *
 * Three rules, all three out of the same place in the space-planning literature:
 * put the focus zone where the entrance traffic does not run through it, give
 * desks the daylight, and hang the desks off a circulation lane rather than
 * making people thread between them.
 */
function deskScore({ desks, floor, work, ways }) {
  let s = 0;
  for (const d of desks) {
    // In the half of the room the plan set aside to work in.
    if (inRect(work, d.at.x, d.at.z)) s += 2.5;
    // Daylight, measured to the openings themselves rather than to the walls they
    // are cut into, and on **the very curve the scorecard grades this with** —
    // `daylight()` in src/plan/floor.js is the single copy both read, so a
    // placement rule cannot end up optimising a different distance from the one
    // being measured.
    //
    // The weight is this file's own opinion. The curve's old shape was a straight
    // line from the glass to ten units out, which pays a bank for edging a metre
    // closer from anywhere in the room; the ramp pays for actually arriving.
    // Raising the weight instead of the shape ran out at 8: at 10 and 14 whole
    // banks set off across the floor after a window, splitting teams and taking
    // the window bays the planting wants.
    s += 8 * daylight(d.at);
    // Away from the door, because everybody who ever comes in walks past it.
    const toDoor = Math.hypot(d.at.x - DOOR.x, d.at.z - DOOR.inside.z);
    s += Math.min(2, toDoor / 6);
    // Standing room that opens onto a walking lane: the aisle behind the chairs
    // *is* the street, which is the whole idea of a bench off a circulation spine.
    if (d.spot && ways.some((w) => inRect(w, d.spot.x, d.spot.z))) s += 1.2;
    // Not jammed against whatever is already there.
    s += Math.min(1, floor.distanceTo('station:', d.at.x, d.at.z) / 8);
  }
  return s / desks.length;
}

/**
 * Lay the desks, bank by bank, and say which team each one belongs to.
 *
 * Teams come from the brief and are split down to what a bank can hold, so a team
 * of eight is two banks of four standing together rather than one bank of eight
 * that does not fit. Each bank is placed by a scan over every anchor and every
 * facing its arrangement allows; a bank with nowhere to go is dropped, and the
 * desks in it are dropped with it — which is `furnish()` reporting that the floor
 * plate could not take the brief, and is the honest answer.
 */
function layDesks(brief, plan, floor, stream) {
  const arrangement = ARRANGEMENTS[brief.typology] ?? ARRANGEMENTS.rows;
  const pitch = stream.range(PITCH[0], PITCH[1]);
  const jog = stream.pick([0, 0.25, 0.5, 0.75]);
  const along = plan.axis;
  const capacity = bankCapacity(along, pitch) * (arrangement.form === 'paired' ? 2 : 1);

  // Teams, cut to what one bank can hold.
  const queue = [];
  brief.teams.forEach((size, team) => {
    let left = size;
    while (left > 0) {
      const take = Math.min(left, capacity);
      queue.push({ team, count: take });
      left -= take;
    }
  });

  const anchors = bankAnchors(jog);
  const locked = arrangement.lockFacing ? stream.pick(facingsFor(along)) : null;
  const placed = [];
  const used = new Set();
  /** The last bank that went down, and whose team it belonged to. */
  let prev = null;
  let prevTeam = null;
  let ids = 0;
  let banks = 0;

  // Every bank placed either seats its whole team or seats what it can and hands
  // the rest back to the queue as another bank. That is what a floor plate does to
  // a team of six in a room with space for four in a run: four here and two at the
  // end of the next bank along, which is the arrangement every open-plan office
  // ends up with. It also has to be this way round rather than "the bank fits or
  // it does not" — that version dropped whole teams, and a room asked for eight
  // desks came back with two.
  const guard = queue.length + brief.desks + 4;
  for (let round = 0; queue.length && round < guard; round += 1) {
    const spec = queue.shift();
    const index = banks;

    // Where this bank may be anchored, and facing which way. A perimeter bank is
    // pinned to a side of the room by its own standoff; every other arrangement
    // may stand anywhere the desks fit.
    const tries = [];
    if (arrangement.sides) {
      for (const side of Object.keys(SIDES)) {
        for (const at of alongSide(side, { hw: DESK_HW, hd: DESK_HD }, 1)) {
          tries.push({ ...at, facing: SIDES[side].facing, side });
        }
      }
    } else {
      for (const facing of locked != null ? [locked] : facingsFor(along)) {
        for (const at of anchors) tries.push({ ...at, facing });
      }
    }

    /** The best few anchors, because the reachability test costs a flood fill. */
    const ranked = [];
    for (const anchor of tries) {
      const offsets = bankDesks({ form: arrangement.form, count: spec.count, pitch, facing: anchor.facing });
      // As many of the bank's desks as the floor takes, in the order they were
      // laid out — so a bank that half fits is half a bank in the right place
      // rather than nothing at all.
      const probes = [];
      for (const [i, off] of offsets.entries()) {
        const at = { x: anchor.x + off.dx, z: anchor.z + off.dz, facing: off.facing };
        const probe = floor.probe(`desk:trial-${index}-${i}`, at, {
          ...DESK_BODY, approach: DESK_APPROACH,
        });
        if (!probe) continue;
        // A bank's own desks are probed against the floor as it stands, so two of
        // them could be handed the same patch. Checked here rather than by
        // committing as we go, because a bank that turns out not to fit must
        // leave nothing behind.
        if (probes.some((p) => overlap(p.foot, probe.foot)
          || overlap(p.foot, probe.strip) || overlap(p.strip, probe.foot))) continue;
        probes.push(probe);
      }
      if (!probes.length) continue;

      const shared = deskScore({
        desks: probes, floor, work: plan.work, ways: plan.ways,
      });
      const own = arrangement.score({
        bank: anchor, prev, work: plan.work, along, used,
      });
      // The rest of a team goes at the end of the same run, not in the next row.
      //
      // This is what the scorecard's `teams` measure found (src/plan/score.js): in
      // a floor of rows, a team split over two banks was being put on the row
      // behind rather than along from itself, because the arrangement's own score
      // rewards a bank for lining up with the last one *and* for being a row's
      // width off it — and the next row over earns both. So a desk's nearest
      // neighbour was somebody else's teammate, which is the one thing the brief
      // is explicit about not wanting. A continuation says so and is scored for
      // being *beside* what it continues.
      const together = spec.team === prevTeam && prev
        ? (offAxis(anchor, prev, along) < 0.75 ? 4 : -2)
        : 0;
      // **Nobody else's desk closer than your own teammate's.**
      //
      // `teams` in the scorecard asks exactly one question — is the desk nearest
      // yours in your team — and this is the placement rule that answers it. It
      // used to hold by accident: a desk's claimed floor was 2.5 half-wide, which
      // is half a pitch, so two banks could not get within a pitch of each other
      // without overlapping. Measuring the real desk brought that to 2.03 and the
      // accident stopped working — fourteen rooms in two hundred and forty seated
      // somebody next to another team, against a budget of twelve.
      //
      // So it is a rule now rather than a side effect of a footprint, which is
      // where it should have been: a bank is refused if it would put a stranger's
      // desk nearer to one of its own than the pitch it is laid out at.
      const crowds = probes.some((probe) => placed.some((other) => other.team !== spec.team
        && Math.hypot(other.x - probe.at.x, other.z - probe.at.z) < pitch - 0.01));
      if (crowds) continue;
      const wobble = fieldAt(brief.seed, `bank-${index}`, anchor.x, anchor.z);
      // Seating people is what a desk bank is for, so it outweighs every question
      // of where: a position that takes four desks beats one that takes three
      // however much better the three would have looked.
      const total = probes.length * 4 + shared + own + together + wobble;
      // Kept in order rather than one at a time: the best bank may turn out to
      // fence in the bank before it, and then the second best is what the room
      // gets. One flood fill each, for the best few only — see `FILL_TRIES`.
      ranked.push({ anchor, probes, total });
      ranked.sort((a, b) => b.total - a.total);
      if (ranked.length > FILL_TRIES) ranked.pop();
    }

    // The best bank nobody ends up fenced in by — its own occupants included.
    // Tested as one piece, because that is how it goes down.
    const bestBank = ranked.find((candidate) => !floor.strands(candidate.probes));

    if (!bestBank) continue;
    banks += 1;
    for (const probe of bestBank.probes) {
      ids += 1;
      const id = `desk-${ids}`;
      // Committed under its real key, not the trial one the probe was made with:
      // the keys are what everything downstream measures distances to, so a room
      // full of `desk:trial-2-0` would leave the stations with nothing to avoid.
      floor.commit({
        ...probe,
        foot: { ...probe.foot, key: `desk:${id}` },
        strip: { ...probe.strip, key: `stand:desk:${id}` },
        label: id,
      });
      placed.push({
        id, x: probe.at.x, z: probe.at.z, facing: probe.at.facing, team: spec.team,
      });
    }
    prev = bestBank.anchor;
    prevTeam = spec.team;
    if (bestBank.anchor.side) used.add(bestBank.anchor.side);
    // Whoever the bank could not seat goes back to the front of the queue, so the
    // rest of a team is placed next and lands beside them.
    const short = spec.count - bestBank.probes.length;
    if (short > 0) queue.unshift({ team: spec.team, count: short });
  }

  return { desks: placed, pitch, along, banks };
}

/**
 * How far one bank sits off another's line, across the axis the banks run along.
 *
 * Zero means the two are on the same run — end to end along one bench line —
 * which is what a team split over two banks wants to be.
 */
function offAxis(a, b, along) {
  return along === 'x' ? Math.abs(a.z - b.z) : Math.abs(a.x - b.x);
}

/** Do these two rectangles share any floor? Nulls share nothing. */
function overlap(a, b) {
  if (!a || !b) return false;
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/**
 * How many of a scan's best positions are worth a flood fill.
 *
 * The expensive half of a placement is asking whether it fences anybody in, and
 * the answer is almost always no — so it is asked of the best position, then the
 * next best, and so on for a few. Six, because a room where the six best spots
 * for a bookshelf all seal a corridor is a room that should not have a bookshelf.
 */
const FILL_TRIES = 6;

/**
 * The one placement move, used for every station and every piece of furniture.
 *
 * Enumerate, score, sort, then take the best position that does not fence
 * anybody in. `score` may return null to refuse a position outright — which is
 * how a telescope is kept at a window and a coat stand kept by the door, without
 * either being a special case in the search.
 *
 * The reachability test is the second gate and it is deliberately last, because
 * it is the only one that costs a flood fill: a prop that overlaps nothing can
 * still be the thing that seals the corridor behind a bank of desks, and no
 * rectangle can see that coming. It is the same refusal the furniture editor
 * makes on a drop (`reachFault` in editor/placement.js), applied to a candidate.
 *
 * @returns {?{x: number, z: number, facing: number}} where it went, or null if
 *   the room had nowhere for it
 */
function put(floor, key, tries, size, score, { seed, salt }) {
  const scored = [];
  for (const at of tries) {
    const probe = floor.probe(key, at, size);
    if (!probe) continue;
    const s = score(at, probe);
    if (s == null) continue;
    scored.push({ probe, total: s + fieldAt(seed, salt, at.x, at.z) });
  }
  scored.sort((a, b) => b.total - a.total);

  for (const candidate of scored.slice(0, FILL_TRIES)) {
    if (floor.strands(candidate.probe)) continue;
    floor.commit(candidate.probe);
    // The probe's position rather than the candidate's: the probe is what was
    // measured, and it snapped the candidate to authoring precision on the way in.
    return candidate.probe.at;
  }
  return null;
}

/** Every side-of-the-room position a prop of this kind could stand at. */
function sideSpots(kind, sides = ['back', 'left', 'front', 'right']) {
  const out = [];
  for (const side of sides) {
    for (const at of alongSide(side, { hw: kind.hw, hd: kind.hd })) out.push(at);
  }
  return out;
}

/** How far from the door, measured to the spot just inside it. */
function fromDoor(at) {
  return Math.hypot(at.x - DOOR.inside.x, at.z - DOOR.inside.z);
}

/**
 * Where each sort of station wants to be, and why.
 *
 * This table is the whole adjacency argument of the room, and every line of it is
 * a rule somebody would recognise from a real floor plan:
 *
 *   * **Noisy machines away from the quiet end.** The printer and the coffee
 *     machine are the two things every space-planning guide names, and they score
 *     on distance from the nearest desk.
 *   * **Reference where the work is.** A shelf is somewhere you go mid-task, so
 *     it scores the other way — near the desks, on a wall.
 *   * **Coats by the door**, because that is what a coat stand is.
 *   * **The post where the post arrives.** Near the entrance, or under a window:
 *     both are true here, since a parcel comes in through the door and a letter
 *     flies in through the glass as a paper plane.
 *   * **The telescope at a window**, refused anywhere else, because a telescope
 *     in the middle of a room is a prop somebody left out.
 *   * **The bin in a corner, near the printer** — where a bin actually lives.
 *
 * `sides` limits a kind to the sides of the room it belongs against; everything
 * here is a wall prop, since every one of them is a machine or a piece of
 * casework and none of them is furniture you walk round.
 */
const STATION_RULES = {
  coatStand: {
    sides: ['back', 'left'],
    score: (at) => 6 - fromDoor(at),
  },
  mailbox: {
    score: (at, floor) => {
      const door = Math.max(0, 8 - fromDoor(at)) * 0.5;
      const glass = atWindow(at) ? 2 : 0;
      // Within reach of the desks rather than as far from them as possible. The
      // post is not a noisy machine — nobody stands at it for five minutes — and
      // every job in the room starts with a walk to it, so distance here is paid
      // for on every collection. A band rather than a ramp: on top of the desks is
      // not where a post box goes either.
      const desks = floor.distanceTo('desk:', at.x, at.z);
      const reach = Number.isFinite(desks) ? Math.max(0, 2 - Math.abs(desks - 4) / 3) : 1;
      return door + glass + reach;
    },
  },
  inbox: {
    // Stock stands with the post, out of the way: a stack of boxes is furniture
    // you take from, not something anybody queues at.
    score: (at, floor) => {
      const post = floor.distanceTo('station:mailbox', at.x, at.z);
      const near = Number.isFinite(post) ? Math.max(0, 3 - Math.abs(post - 3)) : 0;
      return near + Math.min(2, floor.distanceTo('desk:', at.x, at.z) / 3);
    },
  },
  printer: {
    score: (at, floor) => Math.min(4, floor.distanceTo('desk:', at.x, at.z))
      + Math.min(1.5, fromDoor(at) / 6),
  },
  bin: {
    score: (at, floor) => {
      const corner = Math.min(
        Math.hypot(at.x, at.z), Math.hypot(ROOM.W - at.x, at.z),
        Math.hypot(at.x, ROOM.D - at.z), Math.hypot(ROOM.W - at.x, ROOM.D - at.z),
      );
      const printer = floor.distanceTo('station:printer', at.x, at.z);
      // Not the corner by the door, which is the one corner a bin may not have:
      // the leaf swings through it, every arrival walks past it, and the bin was moved
      // the authored bin out of exactly this spot.
      const doorway = Math.max(0, 7 - fromDoor(at));
      return Math.max(0, 5 - corner) - doorway
        + (Number.isFinite(printer) ? Math.max(0, 3 - printer / 2) : 0);
    },
  },
  bookshelf: {
    score: (at, floor) => {
      const desks = floor.distanceTo('desk:', at.x, at.z);
      if (!Number.isFinite(desks)) return 1;
      return Math.max(0, 5 - desks) + (fromDoor(at) > 4 ? 1 : 0);
    },
  },
  telescope: {
    sides: ['back', 'left'],
    // At a window or not at all. The one hard refusal in the table.
    score: (at) => (atWindow(at) ? 3 + (fromDoor(at) > 5 ? 1 : 0) : null),
  },
  coffee: {
    score: (at, floor) => Math.min(5, floor.distanceTo('desk:', at.x, at.z))
      + Math.min(2, fromDoor(at) / 5),
  },
  waterCooler: {
    score: (at, floor) => {
      const coffee = floor.distanceTo('station:coffee', at.x, at.z);
      // With the coffee if there is coffee — the break end of a room is one end —
      // and otherwise wherever the desks are not.
      if (Number.isFinite(coffee)) return Math.max(0, 4 - Math.abs(coffee - 4));
      return Math.min(4, floor.distanceTo('desk:', at.x, at.z));
    },
  },
};

/**
 * How many of each kind of station the brief asks for, in the order they are
 * placed.
 *
 * The order is not arbitrary: the coats go first because they want the door and
 * nothing else does, the post next because the stock and the bin are placed
 * *relative* to it, and the drinks last because the lounge is placed relative to
 * them. Anything whose position depends on another thing's comes after it.
 */
function stationWants(brief) {
  const want = [];
  const add = (kind, n) => { for (let i = 0; i < n; i += 1) want.push(kind); };
  add('coatStand', 1);
  add('mailbox', brief.post.mailboxes);
  add('printer', brief.post.printers);
  add('inbox', brief.post.inboxes);
  add('bookshelf', brief.research.bookshelves);
  if (brief.research.telescope) add('telescope', 1);
  if (brief.bin) add('bin', 1);
  if (brief.refresh.coffee) add('coffee', 1);
  if (brief.refresh.cooler) add('waterCooler', 1);
  return want;
}

/** The id a new station of this kind gets: `mailbox`, then `mailbox-2`. */
function nextId(kind, taken) {
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

function layStations(brief, floor) {
  const out = [];
  const taken = new Set();
  for (const kind of stationWants(brief)) {
    const def = STATION_KINDS[kind];
    const rule = STATION_RULES[kind] ?? { score: () => 0 };
    const id = nextId(kind, taken);
    const size = {
      hw: def.hw, hd: def.hd, offX: def.offX, offZ: def.offZ,
      approach: def.approachDist, label: id,
    };
    const scoring = (spot) => rule.score(spot, floor);
    const salt = { seed: brief.seed, salt: `station-${id}` };
    let at = put(floor, `station:${id}`, sideSpots(def, rule.sides), size, scoring, salt);

    // Nowhere against a wall, and the room cannot go without the job: stand it
    // free.
    //
    // A room with desks all round its walls — the `perimeter` arrangement — can
    // genuinely leave no frontage for a bookcase, and the answer used to be that
    // the whole brief was trimmed and refitted: forty-five rooms in a thousand
    // lost a third of their desks so that a shelf could have a wall. A bookcase
    // standing free with its back to a bank of desks is a thing offices have, and
    // it is a far smaller compromise than sending three people home.
    //
    // Only for the required jobs (`JOB_ROLES`), and only as a fallback: a coffee
    // machine adrift in the middle of the floor is not somewhere anybody put it,
    // and nothing breaks if the room has none.
    if (!at && (STATION_KINDS[kind]?.roles ?? []).some((role) => JOB_ROLES.includes(role))) {
      at = put(floor, `station:${id}`, anywhere({ hw: def.hw, hd: def.hd }), size, scoring, salt);
    }
    if (!at) continue;
    taken.add(id);
    out.push({
      id, kind, x: at.x, z: at.z, facing: at.facing, side: at.side,
    });
  }
  return out;
}

/**
 * The lounge, the rugs and the planting — everything in the room that is there
 * because a room needs somewhere to sit down and something green in the corner.
 *
 * The lounge is placed as a *group*: a couch first, wherever the room has been
 * left most generous, and then everything else relative to it. That is the
 * difference between a reading corner and a couch with a lamp somewhere else in
 * the building — and it is why the couch's own score is mostly about emptiness,
 * since a corner is only a corner if there is nothing else in it.
 */
function layLounge(brief, floor, desks) {
  const out = [];
  const wants = brief.lounge;
  const seed = brief.seed;

  /**
   * Somewhere a body-sized piece of furniture could go, facing any way.
   *
   * Every position is scored, so there is nothing to shuffle: the scan's order
   * decides nothing and `fieldAt` breaks the ties. Which matters more than it
   * sounds — shuffling a few thousand candidates would take a few thousand draws
   * from this room's stream, so adding one lattice step anywhere would move every
   * later decision in the office.
   */
  const spots = (kind) => anywhere({ hw: kind.hw, hd: kind.hd });

  // Everything anybody sits on, in the order it went down: each new seat is
  // placed against the group that already exists, so this is read while it is
  // still being written.
  const seated = [];
  const couches = [];
  for (let i = 0; i < wants.couches; i += 1) {
    const kind = FURNITURE_KINDS.couch;
    const id = i === 0 ? 'couch' : `couch-${i + 1}`;
    const at = put(
      floor, `furniture:${id}`, spots(kind),
      {
        hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ,
        approach: kind.approachDist, label: id,
      },
      (spot) => {
        // Away from the desks: a couch in the middle of the working floor is
        // somewhere nobody sits.
        const desks = floor.distanceTo('desk:', spot.x, spot.z);
        if (Number.isFinite(desks) && desks < 2) return null;
        let s = Math.min(6, Number.isFinite(desks) ? desks : 6);
        // With its back to something. A couch marooned in open floor reads as
        // furniture in transit.
        const backed = Math.min(spot.x, spot.z, ROOM.W - spot.x, ROOM.D - spot.z) < 4;
        if (backed) s += 1.5;
        // Facing the camera rather than away from it, since one of the two is a
        // couch with people on it and the other is the back of a couch.
        if (spot.facing === 0 || spot.facing === Math.PI / 2) s += 1;
        // Facing whatever is already sitting there. See `facesGroup`: a second
        // couch may sit opposite the first or square to it, and may not sit with
        // its back to it.
        if (!inFrontOfAll(spot, couches)) return null;
        const inward = facesGroup(spot, couches);
        if (inward != null && inward < FACING_GROUP) return null;
        if (inward != null) s += 2 * inward;
        // The break end of the room: with the drinks, if the room has any.
        const drink = Math.min(
          floor.distanceTo('station:coffee', spot.x, spot.z),
          floor.distanceTo('station:waterCooler', spot.x, spot.z),
        );
        if (Number.isFinite(drink)) s += Math.max(0, 3 - Math.abs(drink - 5) / 2);
        // Near whichever couch is already down, so two of them are a parlour —
        // and refused outright beyond talking distance. "Face each other" only
        // means anything at a range where facing each other is a thing two seats
        // can do: this was a preference worth two points and it let a room put its
        // two couches at opposite ends of the floor, sixteen units apart, pointing
        // at each other down the length of the room. Which passes the facing rule
        // to the letter and is two seats, not a parlour.
        if (couches.length) {
          const near = floor.distanceTo('furniture:couch', spot.x, spot.z);
          if (near > 9) return null;
          s += near > 1.5 && near < 7 ? 2 : -1;
        }
        return s;
      },
      { seed, salt: `couch-${i}` },
    );
    if (!at) continue;
    const piece = {
      id, kind: 'couch', x: at.x, z: at.z, facing: at.facing, color: colourFor(brief, 'couch', i),
    };
    out.push(piece);
    couches.push(piece);
    seated.push(piece);
  }

  for (let i = 0; i < wants.armchairs; i += 1) {
    const kind = FURNITURE_KINDS.armchair;
    const id = i === 0 ? 'armchair' : `armchair-${i + 1}`;
    const at = put(
      floor, `furniture:${id}`, spots(kind),
      {
        hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ,
        approach: kind.approachDist, label: id,
      },
      (spot) => {
        const desks = floor.distanceTo('desk:', spot.x, spot.z);
        // Clear of the working floor, on the couch's own terms: a chair wedged
        // between two banks of desks is not somewhere anybody sits down.
        if (Number.isFinite(desks) && desks < 2) return null;
        let s = Math.min(5, Number.isFinite(desks) ? desks : 5);
        // Pulled up to the couch. Refused outright past conversation range of it:
        // a chair on its own across the room is not part of the corner the couch
        // makes, and two seats that are not a group is worse than one seat that is.
        //
        // 4.5 rather than the 3.5 it used to be, and the extra unit is bought by
        // the facing rule below. A chair now has to be in front of the couch *and*
        // turned back towards it, which is a narrow arc — squeezed into 3.5 as
        // well, it cost seventeen per cent of the armchairs the briefs asked for.
        // Being in the group is what "part of the corner" was reaching for, and
        // it is now checked directly rather than inferred from a radius.
        if (couches.length) {
          const near = floor.distanceTo('furniture:couch', spot.x, spot.z);
          if (near > 4.5) return null;
          s += 5 - near;
        } else if (i > 0) {
          const near = floor.distanceTo('furniture:armchair', spot.x, spot.z);
          s += near > 1 && near < 4 ? 3 : 0;
        }
        // Turned in towards the seats already down — the same refusal the second
        // couch gets, and against *all* the seating rather than against the first
        // couch's facing. The old test compared the two facings and asked only
        // that they differ, which passes a chair at ninety degrees looking out of
        // the group as readily as one looking into it.
        if (!inFrontOfAll(spot, seated)) return null;
        const inward = facesGroup(spot, seated);
        if (inward != null && inward < FACING_GROUP) return null;
        if (inward != null) s += 3 * inward;
        return s;
      },
      { seed, salt: `armchair-${i}` },
    );
    if (!at) continue;
    const chair = {
      id, kind: 'armchair', x: at.x, z: at.z, facing: at.facing, color: colourFor(brief, 'armchair', i),
    };
    out.push(chair);
    seated.push(chair);
  }

  // A table goes at the end of a couch and a lamp behind one, so both are placed
  // against whatever seating actually got down rather than against the brief.
  const seating = out.filter((p) => p.kind === 'couch' || p.kind === 'armchair');
  for (let i = 0; i < wants.tables && seating.length; i += 1) {
    const kind = FURNITURE_KINDS.sideTable;
    const id = i === 0 ? 'sideTable' : `sideTable-${i + 1}`;
    const at = put(
      floor, `furniture:${id}`, spots(kind),
      {
        hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ, label: id,
      },
      (spot) => {
        const near = nearestOf(seating, spot);
        // Within reach of somebody sitting down, or it is not a side table: at
        // 3.2 it is at the arm of a couch, and past that it is a table.
        if (near.d > 3.2) return null;
        let s = 4 - Math.abs(near.d - 2.4) * 2 + (spot.facing === near.piece.facing ? 0.5 : 0);
        // Better still between two of them, where both sitters can reach it —
        // which is what a side table in a group of seats is for, and is the same
        // rule the seats themselves follow: part of the group, not beside it.
        const within = seating.filter(
          (p) => Math.hypot(p.x - spot.x, p.z - spot.z) <= 3.2,
        ).length;
        if (within > 1) s += 2;
        // And never behind the back of the seat it serves, which is a refusal for
        // the same reason as the seats' own: a table a sitter cannot reach is not a
        // side table, whatever it measures as. 55% of them were stranded back there
        // before anybody looked.
        const back = heading(near.piece.facing);
        const off = { x: spot.x - near.piece.x, z: spot.z - near.piece.z };
        if (back.x * off.x + back.z * off.z < -1.2) return null;
        return s;
      },
      { seed, salt: `table-${i}` },
    );
    if (at) out.push({ id, kind: 'sideTable', x: at.x, z: at.z, facing: at.facing });
  }

  for (let i = 0; i < wants.lamps && seating.length; i += 1) {
    const kind = FURNITURE_KINDS.floorLamp;
    const id = i === 0 ? 'floorLamp' : `floorLamp-${i + 1}`;
    const at = put(
      floor, `furniture:${id}`, anywhere({ hw: kind.hw + BODY_BERTH, hd: kind.hd + BODY_BERTH }, { turns: false }),
      { hw: kind.hw + BODY_BERTH, hd: kind.hd + BODY_BERTH, label: id },
      (spot) => {
        const near = nearestOf(seating, spot);
        // Beside the seat it is there to light. A standard lamp four metres from
        // the couch lights the floor, and reads from above as something nobody
        // put anywhere.
        if (near.d > 4) return null;
        return 4 - Math.abs(near.d - 3);
      },
      { seed, salt: `lamp-${i}` },
    );
    if (at) out.push({ id, kind: 'floorLamp', x: at.x, z: at.z });
  }

  // The rug last of the furniture, because it goes *under* things: its rectangle
  // is soft, so it is measured and bounded like any other and blocks nothing.
  // Which is also why it is the one piece that can be placed by looking only at
  // what it would cover.
  // Which areas a rug could be defining: the lounge, and each bank of desks.
  const areas = [seating, ...deskGroups(desks)].filter((g) => g.length);
  const laidRugs = () => floor.rects.filter((r) => r.soft && r.key.startsWith('furniture:rug'));
  const on = (r, p) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;

  for (let i = 0; i < brief.rugs; i += 1) {
    const kind = FURNITURE_KINDS.rug;
    const id = i === 0 ? 'rug' : `rug-${i + 1}`;
    // **The area with the most of itself still on bare floor**, which is what lets
    // two rugs join up into one bigger area instead of being spread one apiece.
    //
    // Both halves of this come from the person who ranked the generated rooms:
    // *"Rugs help define an area (for sitting or a group of desks). 4 can be
    // overlapped slightly to make a single large area to define."* Neither was
    // possible before. Rugs were placed by proximity to a centroid, which put them
    // *beside* the thing they were meant to be defining, and any rug within six
    // units of another was refused outright — "two rugs in a heap is one rug" — so
    // a bank of eight desks could never be given a floor big enough to stand on,
    // because one rug is 9 by 7 and the bank is bigger than that.
    const before = laidRugs();
    const bare = (g) => g.filter((p) => !before.some((r) => on(r, p))).length;
    // The lounge first, always, while any of it is still on bare floor: *"sofas
    // ideally mostly on rugs"*. Choosing purely by how much of an area is
    // uncovered sounds fairer and is not — a bank of eight desks has more bare
    // pieces than a parlour of two seats will ever have, so the lounge lost every
    // contest and the couches on a rug fell from 52% to 45%. The seating is where
    // a rug does the most work and it is also the smallest thing to cover.
    const target = seating.length && bare(seating) ? seating
      : [...areas].sort((a, b) => bare(b) - bare(a))[0];
    const group = bare(target ?? []) ? target : (areas[0] ?? []);

    const at = put(
      floor, `furniture:${id}`, anywhere({ hw: kind.hw, hd: kind.hd }),
      {
        hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ, soft: true, label: id,
      },
      (spot) => {
        if (!group.length) return 0;
        const world = worldExtent(spot.facing, kind.hw, kind.hd);
        const mine = {
          x0: spot.x - world.hw, x1: spot.x + world.hw,
          z0: spot.z - world.hd, z1: spot.z + world.hd,
        };
        // Stacked rather than joined, which is the one case that really is a wasted
        // rug: a second layer of floor over floor that already has a rug on it.
        if (before.some((r) => Math.hypot(
          spot.x - (r.x0 + r.x1) / 2, spot.z - (r.z0 + r.z1) / 2,
        ) < 2.5)) return null;

        const covered = group.filter((p) => before.some((r) => on(r, p))).length;
        const now = group.filter((p) => on(mine, p) || before.some((r) => on(r, p))).length;
        const gained = now - covered;
        // Overlapping the rug next door by a foot or two reads as one large area;
        // leaving a strip of bare floor between them reads as two small ones.
        //
        // **And the overlap has to be square.** "Rectangular rugs — or combined
        // multiple rugs as a rectangle to indicate an area — are definitely better
        // than ragged ones." Two rugs joined at any old offset make an L or a
        // staircase; two rugs sharing a full edge make one larger rectangle, which
        // is the thing that reads as a defined area. Only a quarter of the rooms
        // with two rugs were managing it by luck.
        //
        // Aligned against the *whole* area this rug is joining rather than against
        // one of its rugs, so a third and a fourth extend a rectangle instead of
        // stepping off the corner of the last one.
        const meets = before.filter((r) => mine.x0 < r.x1 - 0.5 && mine.x1 > r.x0 + 0.5
          && mine.z0 < r.z1 - 0.5 && mine.z1 > r.z0 + 0.5);
        let joins = 0;
        if (meets.length) {
          const near = (a, b) => Math.abs(a - b) < 0.01;
          const square = (near(mine.x0, Math.min(...meets.map((r) => r.x0)))
              && near(mine.x1, Math.max(...meets.map((r) => r.x1))))
            || (near(mine.z0, Math.min(...meets.map((r) => r.z0)))
              && near(mine.z1, Math.max(...meets.map((r) => r.z1))));
          // A ragged join is worse than no join: two separate tidy areas read
          // better than one area with a corner bitten out of it, and a room is
          // allowed one to three areas before it starts looking like confetti.
          joins = square ? 6 : -3;
        }
        const mid = middleOf(group);
        const off = Math.hypot(spot.x - mid.x, spot.z - mid.z);
        return 3 * gained + (gained ? joins : 0) + Math.max(0, 2 - off / 6);
      },
      { seed, salt: `rug-${i}` },
    );
    if (at) {
      out.push({
        id, kind: 'rug', x: at.x, z: at.z, facing: at.facing, color: brief.scheme.rug,
      });
    }
  }

  return out;
}

/**
 * How squarely a seat looks at the group it is joining.
 *
 * The rule, as given: *"Sofas and armchairs, side tables etc. should always face
 * each other, or face at 90 degrees to each other, never away from each other."*
 *
 * One test does all three. A seat's front points along `heading(facing)` — the
 * same vector the approach point is derived from, so it is where the seat's knees
 * are and not a guess — and this returns the cosine of the angle between that and
 * the direction of the group's middle. Two sofas across a rug from each other come
 * out at 1, an L of a sofa and a chair at about 0.7, a chair alongside a sofa
 * looking the same way at 0, and a sofa with its back to the group at −1.
 *
 * So a single threshold sorts the allowed arrangements from the forbidden one,
 * which is what makes this a refusal rather than a preference: "never away from
 * each other" is not something to trade off against being near the coffee.
 *
 * @returns {?number} −1..1, or null when there is nothing yet to face
 */
function facesGroup(spot, placed) {
  const mid = middleOf(placed);
  if (!mid) return null;
  const to = { x: mid.x - spot.x, z: mid.z - spot.z };
  const len = Math.hypot(to.x, to.z);
  if (len < 0.5) return 1;
  const look = heading(spot.facing);
  return (look.x * to.x + look.z * to.z) / len;
}

/**
 * How far off the group's middle a seat may look and still be part of it.
 *
 * 0.34 is about seventy degrees, which is chosen to be the widest angle that
 * still admits every arrangement asked for and no others. Facing each other is
 * 1.0 and an L is 0.71, so both clear it comfortably; two seats side by side
 * looking the same way come out at exactly 0 and a seat with its back to the
 * group is negative. The slack between 0.34 and 0.71 is for the lattice — a
 * quarter-turn facing and a half-unit grid do not put an L's two pieces at
 * exactly forty-five degrees to their own centroid.
 */
const FACING_GROUP = 0.34;

/**
 * Whether a seat may go *here*, given who is already sitting down.
 *
 * `facesGroup` alone leaves one hole, and it is the important one: the first seat
 * is placed with nothing to face, so the rule never applies to it and the rest of
 * the group is free to assemble behind its back. Enforcing the facing rule on the
 * later seats only took the seats looking away from their own group from 43% to
 * 15%, and essentially all of the remainder was an anchor couch with its back to
 * the parlour.
 *
 * Fixing it after the fact would mean releasing a claimed footprint and its
 * approach strip and re-placing it, so instead the constraint is moved to the
 * side that is still free to move: **a new seat must be in front of every seat
 * already down**, and then the anchor faces the group by construction.
 *
 * The threshold is a hair above zero rather than up at `FACING_GROUP`, because
 * this is a rule about *position* and the rule about position is much weaker than
 * the rule about facing. A chair square beside a couch's arm, its sitter looking
 * across it, is 90° to the couch and dead level with it — allowed, and asked for:
 * "or face at 90 degrees to each other". A chair behind the couch is not.
 */
function inFrontOfAll(spot, placed) {
  return placed.every((p) => {
    const to = { x: spot.x - p.x, z: spot.z - p.z };
    const len = Math.hypot(to.x, to.z);
    if (len < 0.5) return true;
    const look = heading(p.facing);
    return (look.x * to.x + look.z * to.z) / len > 0.05;
  });
}

/** The middle of a set of things with an x and a z. */
function middleOf(list) {
  if (!list.length) return null;
  return {
    x: list.reduce((n, p) => n + p.x, 0) / list.length,
    z: list.reduce((n, p) => n + p.z, 0) / list.length,
  };
}

/**
 * The banks of desks, as groups of desks that are near each other.
 *
 * Single linkage at seven units, which is a little over one desk pitch, so a bank
 * and the bank behind it count as one group and an island across the room does
 * not. Three things read this: which group a rug should be under, which pairs of
 * groups want something between them, and how organised the room is.
 */
function deskGroups(desks, reach = 7) {
  const left = [...desks];
  const out = [];
  while (left.length) {
    const group = [left.pop()];
    for (let grew = true; grew;) {
      grew = false;
      for (let i = left.length - 1; i >= 0; i -= 1) {
        if (!group.some((g) => Math.hypot(g.x - left[i].x, g.z - left[i].z) <= reach)) continue;
        group.push(left.splice(i, 1)[0]);
        grew = true;
      }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Is this spot *between* two of the room's areas, and how squarely?
 *
 * The test is the triangle inequality: a point on the straight line between two
 * places adds nothing to the distance between them, and a point off to one side
 * adds a lot. Within a unit of the line, and not standing on either group, is a
 * divider; anywhere else is a plant in the way.
 *
 * @returns {?number} a score, or null if this is not between anything
 */
function dividerScore(spot, groups) {
  let best = null;
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i];
      const b = groups[j];
      const span = Math.hypot(a.x - b.x, a.z - b.z);
      if (span < 6) continue;                       // one area, not two
      const via = Math.hypot(spot.x - a.x, spot.z - a.z)
        + Math.hypot(spot.x - b.x, spot.z - b.z);
      const detour = via - span;
      const clear = Math.min(
        Math.hypot(spot.x - a.x, spot.z - a.z),
        Math.hypot(spot.x - b.x, spot.z - b.z),
      );
      if (detour > 1.2 || clear < 3.5) continue;
      const score = 3 * (1 - detour / 1.2);
      if (best == null || score > best) best = score;
    }
  }
  return best;
}

/** Which of these pieces is nearest, and how far. */
function nearestOf(pieces, at) {
  let piece = null;
  let d = Infinity;
  for (const p of pieces) {
    const dist = Math.hypot(p.x - at.x, p.z - at.z);
    if (dist >= d) continue;
    d = dist;
    piece = p;
  }
  return { piece, d };
}

/**
 * The upholstery a piece gets.
 *
 * The scheme's own two colours and nothing else, so a room cannot end up wearing
 * a colour from some other room: a matched suite puts everything in the couch
 * colour, an accented one gives the chairs the scheme's second colour. See
 * `SCHEMES` in brief.js for why this is a table of pairs and not a hue rotation.
 */
function colourFor(brief, kind, index) {
  if (brief.suite === 'matched') return brief.scheme.sofa;
  if (kind === 'armchair') return brief.scheme.accent;
  return index % 2 === 0 ? brief.scheme.sofa : brief.scheme.accent;
}

/**
 * The planting.
 *
 * Placed for the light and for the view, which is how a plant actually ends up
 * somewhere: the corners and the window bays first, because that is where there
 * is room and light for something with a spread, and the seasonal ones out on the
 * open edges and in the bays where the street is visible behind them — so when
 * they turn, they turn against a matching season outdoors. The rest of the room
 * stays evergreen, which is what stops February looking dead. Both halves of that
 * rule are the authored room's own (see `DECOR.plants` in src/layout.js).
 */
function layPlanting(brief, floor, stream, groups) {
  const out = [];
  const species = Object.keys(PLANT_KINDS);
  for (let i = 0; i < brief.planting.count; i += 1) {
    const kind = stream.weighted([
      ['bush', 26], ['monstera', 24], ['fig', 20], ['snake', 18], ['fern', 12],
    ]);
    const def = PLANT_KINDS[kind] ?? PLANT_KINDS[species[0]];
    // Rounded here rather than on the way into the blob, so the spread this is
    // placed against is the spread the stored plant will actually have.
    const scale = round2(def.scale * stream.range(0.85, 1.15));
    const spread = def.spread * scale;
    const id = `plant-${i + 1}`;
    const at = put(
      floor, `plant:${id}`, anywhere({ hw: spread, hd: spread }, { turns: false }),
      { hw: spread, hd: spread, label: id },
      (spot) => {
        // Out of the middle of the floor — *unless* it is standing between two
        // groups, which is a different job.
        //
        // "Plants and other items can also be used to make logical dividers in the
        // room among groups of desks, sitting furniture or a break area." A flat
        // refusal of anything more than four units from an edge made that
        // impossible: every plant went to a corner, and the one place a plant
        // earns its keep in the middle of a floor is the gap between two areas
        // that would otherwise run into each other.
        const edge = Math.min(spot.x, spot.z, ROOM.W - spot.x, ROOM.D - spot.z);
        const divides = dividerScore(spot, groups);
        if (edge > 4 && divides == null) return null;
        let s = Math.max(0, 3 - edge);
        const corner = Math.min(
          Math.hypot(spot.x, spot.z), Math.hypot(ROOM.W - spot.x, spot.z),
          Math.hypot(spot.x, ROOM.D - spot.z), Math.hypot(ROOM.W - spot.x, ROOM.D - spot.z),
        );
        s += Math.max(0, 4 - corner) * 0.8;
        if (atWindow(spot)) s += 1.5;
        // Spread out rather than potted up together.
        const other = floor.distanceTo('plant:', spot.x, spot.z);
        if (Number.isFinite(other)) s += other < 1.4 ? -3 : Math.min(1.5, other / 4);
        // The last plants of the brief are the dividers, and in those slots a gap
        // between two areas outranks the best corner in the room. Ordered that way
        // round because corners are where a plant goes by default — a room gets its
        // corners filled first and *then* its divisions, and a divider slot with
        // nowhere to divide falls back to being an ordinary plant rather than being
        // dropped.
        if (divides != null) s += (i >= brief.planting.count - brief.dividers ? 6 : 0) + divides;
        return s;
      },
      { seed: brief.seed, salt: `plant-${i}` },
    );
    if (!at) continue;
    // Seasonal where the street shows behind it: the open edges, and the window
    // bays. Elsewhere the evergreen palette, so the room reads green all year.
    const seasonal = atWindow(at) || at.x > ROOM.W - 3 || at.z > ROOM.D - 3;
    out.push({
      id, kind, x: at.x, z: at.z, facing: 0, scale, seasonal,
    });
  }
  return out;
}

/**
 * Lay a whole office out.
 *
 * @param {object} brief  from `brief()`
 * @returns {{plan: object, floor: Floor, desks: object[], stations: object[],
 *   furniture: object[], plants: object[], fit: object}}
 */
export function furnish(brief) {
  const floor = new Floor();
  const plan = plate(brief, streamFor(brief.seed, 'streets'));
  floor.reserve('way:street', plan.street);
  floor.reserve('way:avenue', plan.avenue);

  const desks = layDesks(brief, plan, floor, streamFor(brief.seed, 'desks'));
  const stations = layStations(brief, floor);
  const furniture = layLounge(brief, floor, desks.desks);
  // The areas a divider could stand between: the banks of desks, and the lounge.
  const groups = [
    ...deskGroups(desks.desks).map((g) => middleOf(g)),
    middleOf(furniture.filter((f) => f.kind === 'couch' || f.kind === 'armchair')),
  ].filter(Boolean);
  const plants = layPlanting(brief, floor, streamFor(brief.seed, 'planting'), groups);

  // Which desks travel. The nearest to the camera first, because a raised top
  // only reads as raised beside a neighbour at ordinary height and the thing
  // worth seeing goes where it can be seen — the same argument the authored room
  // makes for `desk-4` (see DESKS in src/layout.js).
  const standing = [...desks.desks]
    .sort((a, b) => (b.x + b.z) - (a.x + a.z))
    .slice(0, Math.min(brief.standing, desks.desks.length))
    .map((d) => d.id);

  return {
    plan,
    floor,
    desks: desks.desks.map((d) => ({ ...d, standing: standing.includes(d.id) })),
    stations,
    furniture,
    plants,
    /** What the floor plate made of the brief. */
    fit: {
      pitch: desks.pitch,
      along: desks.along,
      banks: desks.banks,
      asked: brief.desks,
      got: desks.desks.length,
    },
  };
}
