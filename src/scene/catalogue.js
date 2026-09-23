//
// The catalogue: every object in the scene, buildable one at a time.
//
// The room is assembled by buildProps() and buildExterior(), which raise dozens of
// pieces at once and place them against each other. That is the right shape for a
// scene and the wrong shape for a *picture* of a chair, so this is the other way
// in: one named entry per object, each of which builds that object alone, standing
// at the origin, dressed as it deserves to be seen.
//
// It exists for the prop portrait tool (bin/prop-portrait.js), which photographs
// each entry for the docs — see docs/user/the-kit.md. Nothing in the running scene reads
// it, which is deliberate: a catalogue the scene depended on would be a second
// place the room gets built, and the two would drift.
//
// Adding an object here is the cheapest documentation there is. Export its builder
// from wherever it lives, add an entry, run the tool, and the gallery grows a row.
//
// What is *not* here is composite architecture: walls, floors, the storeys below,
// the skyline, the city field. Those are not objects but arrangements — a wall is
// only a wall in the presence of the room it closes — and they are documented,
// with pictures of the whole building, in docs/user/buildings.md.
//
import * as THREE from 'three';
import { DOOR, WINDOW_HEAD_Y, WINDOW_SILL_Y } from '../config.js';
import { DECOR, FURNITURE_KINDS } from '../layout.js';
import {
  buildAeronChair, buildArmchair, buildBin, buildBookshelf, buildCoatStand, buildCoffeeStation,
  buildCouch, buildDesk, buildEspressoMachine, buildFloorLamp, buildInbox,
  buildMailbox, buildPrinter, buildRug, buildSideTable, buildTelescope, buildWallClock,
  buildWaterCooler, codeScreenTexture,
} from './props/index.js';
import { makeKanbanBoard } from './kanban.js';
import {
  buildCactus, buildDeskBloom, buildFern, buildFig, buildLeafyBush, buildMonstera,
  buildPothos, buildSnakePlant, buildSucculent, buildWindowTrough,
} from './plants.js';
import { buildDoor, buildElevator, buildWindow } from './environment.js';
import { buildGlobe } from './globe.js';
import { buildAceLogo, buildRovoLogo } from './standees.js';
import { buildBush, buildCar, buildStreetLamp, buildTree } from './outlooks/streetscape.js';
import { buildPaperPlaneMesh } from './mail.js';
import { buildBirdMesh } from './birds.js';
import { buildCourier, buildParcel } from './courier.js';
import { buildPrintout } from './props/printer.js';
import { Agent } from '../agents/Agent.js';

/**
 * The sections of the catalogue, in the order the gallery presents them.
 *
 * @type {Array<{id: string, label: string, blurb: string}>}
 */
export const GROUPS = [
  {
    id: 'openings',
    label: 'Ways in and out',
    blurb: 'How an office is entered and left. Which one you get depends on the '
      + 'building, and the agent layer treats them as the same thing.',
  },
  {
    id: 'stations',
    label: 'Stations',
    blurb: 'Every one of these is somewhere an agent walks to, and a job they go there to do.',
  },
  {
    id: 'furniture',
    label: 'Furniture and fittings',
    blurb: 'The rest of the room: what agents sit on, what lights it, what softens the floor.',
  },
  {
    id: 'screens',
    label: 'Screens',
    blurb: 'Drawn into a canvas at runtime rather than loaded, which is why the page needs no assets.',
  },
  {
    id: 'greenery',
    label: 'Greenery',
    blurb: 'Ten species, built from the same few primitives, most of which take a seasonal palette.',
  },
  {
    id: 'people',
    label: 'People, post and jobs',
    blurb: 'The agents themselves, the courier who brings their work, what it arrives in, and the four props a job passes through: collected from the mailbox or the inbox, binned if it fails. The coat stand is here because it counts who is in.',
  },
  {
    id: 'outside',
    label: 'Outside',
    blurb: 'The street kit. Built to be read at distance, so a close-up is a fair test of how little it takes.',
  },
];

/**
 * One entry per object.
 *
 * `build` returns an Object3D standing at the origin with its feet at y = 0. The
 * portrait tool frames whatever it is given from its own bounding box, so nothing
 * here needs to know how big it is — but it does need to say which way it faces
 * and how it means to be seen, and that is what the view hints are for:
 *
 *   face       radians of Y rotation, turning the object's front towards the
 *              camera. Most pieces are built facing +z; a few are not, and the
 *              mailbox opens along +x.
 *   azimuth    where the camera stands, as a bearing about the object. The default
 *              three-quarter view shows a front and a side at once; square on (0)
 *              is for the things that are essentially pictures.
 *   elevation  how high the camera sits, relative to its distance out. Low for
 *              something you look at square on, high for something lying on the
 *              floor.
 *   pad        air around the subject. 1 is a tight crop.
 *   grounded   false for anything that hangs on a wall or flies, which gets no
 *              contact shadow because it has nothing to stand on.
 *
 * Several builders take a spec from src/config.js rather than arguments of their
 * own. Those are passed the real thing, so the picture is of the object the office
 * actually contains.
 *
 * @type {Array<{
 *   id: string, group: string, label: string, blurb: string,
 *   build: () => THREE.Object3D,
 *   face?: number, azimuth?: number, elevation?: number, pad?: number,
 *   grounded?: boolean,
 * }>}
 */
export const CATALOGUE = [
  // --- Ways in and out ------------------------------------------------------
  {
    id: 'door',
    group: 'openings',
    label: 'Door',
    blurb: 'A hinged leaf on a brass knob, panelled, with a plaque over the head. It '
      + 'swings inward as somebody passes and eases itself shut behind them — shown here '
      + 'held open, which is what an arrival looks like.',
    build: () => {
      const { obj, handle } = buildDoor(0, 0, DOOR.width, DOOR.height);
      // Asked to open and then run forward, because the swing is eased rather than
      // set: a single frame of it would be a door that is merely ajar.
      handle.requestOpen(4);
      for (let i = 0; i < 60; i++) handle.update(1 / 30);
      return obj;
    },
    face: 0,
    azimuth: 0.75,
    elevation: 0.3,
  },
  {
    id: 'elevator',
    group: 'openings',
    label: 'Elevator',
    blurb: 'The other way in, for an office up a tower. The car really travels, and '
      + 'doubles as the landing: when it is at this floor its plate is flush with the '
      + 'office floor, so there is no step and no stoop outside. Shown with the car in '
      + 'and the landing doors wide.',
    build: () => {
      // One storey of shaft rather than the usual three: enough to show that the car
      // comes from somewhere, without making the portrait a picture of a lift shaft.
      const { obj, handle } = buildElevator(0, 0, DOOR.width, DOOR.height, { storeysBelow: 1 });
      handle.requestOpen(30);          // hold it, or it would close and depart again
      for (let i = 0; i < 300 && !handle.ready; i++) handle.update(1 / 30);
      return obj;
    },
    face: 0,
    azimuth: 0.7,
    elevation: 0.32,
  },
  {
    id: 'window',
    group: 'openings',
    label: 'Window',
    blurb: 'Not a way agents come in, but the way the light and the work do: the sun '
      + 'rakes through these all day, and a posted job arrives as a paper plane through '
      + 'an open one. Three lights by two, with a sill deep enough for a trough.',
    build: () => buildWindow(0, 0, 6, WINDOW_HEAD_Y - WINDOW_SILL_Y),
    face: 0,
    azimuth: 0.5,
    elevation: 0.25,
    grounded: false,               // it is a hole in a wall, standing on nothing
  },
  // --- Stations -------------------------------------------------------------
  {
    id: 'desk',
    group: 'stations',
    label: 'Desk',
    blurb: 'A workstation with its chair, both monitors awake and a mug on the top. '
      + 'Screens are black until somebody sits down, so this is a desk being worked at.',
    build: () => {
      const { obj, handle } = buildDesk({ id: 'portrait', x: 0, z: 0, facing: 0 }, 0);
      handle.setWorking(true);
      handle.update(0.05);          // one tick, to draw the board on the second screen
      return obj;
    },
    face: 0.55,
    elevation: 0.5,
  },
  {
    id: 'chair',
    group: 'stations',
    label: 'Aeron chair',
    blurb: 'Graphite frame, curved mesh back, five-star base on casters. It swivels: '
      + 'nobody walks through their own chair to sit down, they swing it out first.',
    face: 0.6,
  },
  {
    id: 'standingDesk',
    group: 'stations',
    label: 'Standing desk',
    blurb: 'A desk on a sit-stand frame rather than four legs, photographed raised with '
      + 'its chair pushed aside. Two-stage lifting columns on T-feet with a beam between '
      + 'them, a handset under the front edge and a mat to stand on. One curved ultrawide '
      + 'instead of two flat monitors \u2014 half again as wide, at the 25\u00b0 of a 1800R '
      + 'panel, with the editor and the board open side by side on it. The whole working '
      + 'surface travels \u2014 top, screen, keyboard and plant together \u2014 and its '
      + 'occupant shoves the chair clear before sending it up. Everything else about it '
      + 'is an ordinary desk, because it is one.',
    build: () => {
      const { obj, handle } = buildDesk({ id: 'standingDesk', x: 0, z: 0, facing: 0, standing: true }, 3);
      // Posed, the way a product photograph is: raised, screens awake and the chair pushed
      // aside, which is this desk in use rather than this desk waiting. Nothing in the room
      // does any of it to itself — an agent pushes the chair — so the portrait asks. Working
      // first, then one long tick: the tick draws the board on the panel and lands the shove
      // rather than catching it halfway.
      handle.setWorking(true);
      handle.pushChairAside(true);
      handle.update(1);
      return obj;
    },
    face: 0.45,
    elevation: 0.42,
  },
  {
    id: 'bookshelf',
    group: 'stations',
    label: 'Bookshelf',
    blurb: 'Where things get looked up. Agents pull a real book off a shelf, read it '
      + 'and put it back; the trailing pothos on top is a plant in its own right.',
    build: () => buildBookshelf().obj,
    face: 0.6,
  },
  {
    id: 'globe',
    group: 'stations',
    label: 'Globe',
    blurb: 'Stands for the web, and turns for as long as a look-up takes. Its map is '
      + 'drawn into a canvas at runtime — coarse coastlines, green land, blue water.',
    build: () => buildGlobe().obj,
    face: 0.2,
    elevation: 0.35,
  },
  {
    id: 'waterCooler',
    group: 'stations',
    label: 'Water cooler',
    blurb: 'Where the water and sparkling-water drinkers take their breaks. Two taps, '
      + 'a drip tray, and a cup dispenser down the side.',
    build: () => buildWaterCooler().obj,
    face: 0.5,
  },
  {
    id: 'printer',
    group: 'stations',
    label: 'Printer',
    blurb: 'The big floor-standing multifunction device, on castors: three '
      + 'paper cassettes, an output bin with one sheet sitting askew in it, a scanner '
      + 'deck that overhangs the body all round, a document feeder along the back of it, '
      + 'and a touchscreen cantilevered off the front right — tilted back towards the '
      + 'ceiling rather than up at the room, because this scene is looked at from above '
      + 'and a screen facing the room is a sliver from there. Photographed at the size '
      + 'it is drawn, which is the size of the real machine; the room stretches it — '
      + 'twice up in height, three quarters in plan — so on the floor it stands over '
      + 'three metres, a head taller than the people at the desks, and narrower than '
      + 'its own proportions want. Work faxes in and out of here — finished work leaves the '
      + 'building through it, and new work arrives the same way, appearing in the output '
      + 'tray with no plane and no courier because there is nothing to watch travel. Once '
      + 'in every six prints the page sails clear of the tray and lands on the floor, and '
      + 'the next person over picks it up on the way past.',
    build: () => buildPrinter().obj,
    face: 0.5,
  },
  {
    id: 'telescope',
    group: 'stations',
    label: 'Telescope',
    blurb: 'The room\'s other way of looking something up. A three-legged timber tripod '
      + 'with brass shoes and a spreader, a brass yoke, and a tube slung in it pitched '
      + 'up and out — aimed over the window sill rather than level at it, because level '
      + 'is a line into the plaster below the glass. The far end carries a dew shield '
      + 'and dark objective glass; the near end a canted eyepiece with a rubber cup, a '
      + 'finder scope alongside and a focus knob on the room side. The eyepiece is the '
      + 'measurement everything else is derived from: it sits at 2.10, a tenth under a '
      + 'standing agent\'s eye, and the bend that reaches it is derived from exactly that '
      + 'gap. Which is why the stoop is small — at this leverage a bend is mostly a lean, '
      + 'so the same angle that lowers an eye 0.10 carries it 0.50 in towards the '
      + 'eyepiece. In the room it stands at the window along from '
      + 'the printer, and it answers for the questions the bookshelf cannot — the ones '
      + 'whose answer is outside the building.',
    build: () => buildTelescope().obj,
    // Turned broadside rather than to the gallery's usual three-quarter view, which is
    // the one object here where the default is actively wrong: the tube is built along
    // −z, the camera sits at an azimuth of π/4, and from there you look straight down
    // the barrel — so a 35° pitch foreshortens into something that reads as pointing at
    // the ceiling. At −π/4 the axis is square to the camera and the pitch is the true
    // angle, with the eyepiece nearest the viewer and the objective going up and away,
    // which is the whole shape of the thing. The low elevation is the same argument:
    // photographing something that points up from above flattens it.
    face: -Math.PI / 4,
    elevation: 0.28,
  },
  {
    id: 'coffeeStation',
    group: 'stations',
    label: 'Coffee station',
    blurb: 'A wide counter with the machine at the back and room to work in front of it. '
      + 'A single-dose grinder stands beside it, its glass hopper holding the ground '
      + 'coffee rather than whole beans, with a stack of cups beyond. Tea drinkers come '
      + 'here too — it is the only hot water in the office.',
    build: () => buildCoffeeStation().obj,
    face: 0.5,
  },
  {
    id: 'espressoMachine',
    group: 'stations',
    label: 'Espresso machine',
    blurb: 'Off its counter and on its own: a polished silver three-group machine with a '
      + 'chrome rail round its cup warmer, an AV paddle beside each group instead of a '
      + 'button, twin gauges, a steam wand on each side, and a full shelf of espresso and '
      + 'cappuccino cups warming on top — a couple of them stacked two deep.',
    build: buildEspressoMachine,
    face: 0.55,
    elevation: 0.4,
  },

  // --- Furniture ------------------------------------------------------------
  {
    id: 'couch',
    group: 'furniture',
    label: 'Couch',
    blurb: 'Two sittable seats for idle rest, and the one piece of furniture big '
      + 'enough to swallow its own seats — which is why the way into it is measured, not assumed.',
    // A record of its own rather than the room's couch. The gallery shows what a couch
    // looks like, and a couch now takes the instance it belongs to — but the seats and
    // standing room a real one derives are beside the point when nobody in a picture is
    // going to sit down, and reaching into the layout would break the moment somebody
    // deleted the last couch out of the office.
    build: () => buildCouch({
      id: 'couch', kind: 'couch', x: 0, z: 0, facing: 0,
      approach: { x: 0, z: 0 }, seats: [],
    }).obj,
    face: 0.35,
    elevation: 0.55,
  },
  {
    id: 'armchair',
    group: 'furniture',
    label: 'Armchair',
    blurb: 'The couch narrowed to one cushion: the same measured way in, turn and '
      + 'lowering movement, with one bookable seat instead of two.',
    build: () => buildArmchair({
      id: 'armchair', kind: 'armchair', x: 0, z: 0, facing: 0,
      approach: { x: 0, z: 0 }, seats: [],
    }).obj,
    face: 0.35,
    elevation: 0.55,
  },
  {
    id: 'sideTable',
    group: 'furniture',
    label: 'Side table',
    blurb: 'A pile of books and a fern, at the end of the couch. Furniture nobody '
      + 'walks to: it is here to make the reading corner a corner.',
    face: 0.5,
  },
  {
    id: 'floorLamp',
    group: 'furniture',
    label: 'Floor lamp',
    blurb: 'A real PointLight inside a brass-poled shade. It comes up as the sun goes '
      + 'down, along with the rest of the lamps — see After dark.',
    face: 0.3,
  },
  {
    id: 'wallClock',
    group: 'furniture',
    label: 'Wall clock',
    blurb: 'A seven-segment LED readout of the real time, drawn digit by digit into a '
      + 'canvas, mounted above the coffee machine.',
    build: () => {
      const { obj, handle } = buildWallClock(DECOR.wallClock);
      handle.setTime(new Date());
      return obj;
    },
    face: 0,
    elevation: 0.12,
    grounded: false,                 // it hangs on a wall
  },
  {
    id: 'rug',
    group: 'furniture',
    label: 'Rug',
    blurb: 'Bordered, and lying a centimetre clear of the floorboards, because two '
      + 'surfaces on one plane is the bug this scene keeps having. It comes in six '
      + 'colours and in "whatever the room is", which is what it starts as — shown here '
      + 'in the sage the default theme paints it.',
    // Built from the kind's own half-extents rather than from an instance, because the
    // catalogue photographs the *kind*: there may be two rugs in a room or none.
    build: () => buildRug({
      x: 0, z: 0, w: FURNITURE_KINDS.rug.hw * 2, d: FURNITURE_KINDS.rug.hd * 2,
    }),
    face: 0.4,
    elevation: 1.5,                  // lies flat, so it is looked down on
    pad: 1.15,
  },
  {
    id: 'aceLogo',
    group: 'furniture',
    label: 'Atlassian Ace statue',
    blurb: 'The Atlassian mark, extruded off its own vector artwork rather than '
      + 'kit-bashed — a third of its height in depth, deep enough to stand on a sill.',
    build: () => buildAceLogo(0.6).obj,
    face: 0,
    elevation: 0.2,
  },
  {
    id: 'rovoLogo',
    group: 'furniture',
    label: 'Rovo statue',
    blurb: 'The Rovo mark, resolved into 4 solid facets — blue, purple, orange '
      + 'and green — standing on the sill behind the water cooler.',
    build: () => buildRovoLogo(0.6).obj,
    face: 0,
    elevation: 0.2,
  },

  // --- Screens --------------------------------------------------------------
  {
    id: 'codeScreen',
    group: 'screens',
    label: 'Code editor',
    blurb: 'What runs on the left-hand monitor: a night-palette editor, drawn as ruled '
      + 'lines of syntax rather than real text, which at this size would only smear.',
    build: () => screenPlane(codeScreenTexture()),
    face: 0,
    azimuth: 0,
    elevation: 0,
    grounded: false,
  },
  {
    id: 'kanbanBoard',
    group: 'screens',
    label: 'Kanban board',
    blurb: 'The right-hand monitor: three columns with counts, cards that slide across '
      + 'every few seconds, and one piece of literal text — an issue key.',
    build: () => {
      const board = makeKanbanBoard();
      board.update(0.05);            // one tick, to draw the first frame
      return screenPlane(board.texture);
    },
    face: 0,
    azimuth: 0,
    elevation: 0,
    grounded: false,
  },

  // --- Greenery -------------------------------------------------------------
  {
    id: 'fig',
    group: 'greenery',
    label: 'Fiddle-leaf fig',
    blurb: 'The big floor plant, and the tallest thing growing indoors.',
    build: () => buildFig(1),
  },
  {
    id: 'monstera',
    group: 'greenery',
    label: 'Monstera',
    blurb: 'Split leaves on long stems, each one cut differently.',
    build: () => buildMonstera(1),
  },
  {
    id: 'snakePlant',
    group: 'greenery',
    label: 'Snake plant',
    blurb: 'Stiff uprights in a pot. The one that survives an office.',
    build: () => buildSnakePlant(1),
  },
  {
    id: 'fern',
    group: 'greenery',
    label: 'Fern',
    blurb: 'Arching fronds; also what sits on the side table.',
    build: () => buildFern(1),
  },
  {
    id: 'pothos',
    group: 'greenery',
    label: 'Pothos',
    blurb: 'Trailing, so it wants a shelf edge to fall over — one long runner goes down the side.',
    build: () => buildPothos(1, { sideDrop: 11 }),
    elevation: 0.45,
  },
  {
    id: 'leafyBush',
    group: 'greenery',
    label: 'Leafy bush',
    blurb: 'A dense mound of foliage, for filling a corner cheaply.',
    build: () => buildLeafyBush(1),
  },
  {
    id: 'cactus',
    group: 'greenery',
    label: 'Cactus',
    blurb: 'Arms and spines, and the only plant here nobody has to remember to water.',
    build: () => buildCactus(1),
  },
  {
    id: 'succulent',
    group: 'greenery',
    label: 'Succulent',
    blurb: 'A rosette in a small pot. Desk-sized.',
    build: () => buildSucculent(1),
  },
  {
    id: 'deskBloom',
    group: 'greenery',
    label: 'Desk bloom',
    blurb: 'The flowering one that stands on the corner of a desk, nearest the viewer.',
    build: () => buildDeskBloom(1),
  },
  {
    id: 'windowTrough',
    group: 'greenery',
    label: 'Window trough',
    blurb: 'Sits on the sill and is the one thing indoors that says what month it is. '
      + 'Shown here in summer; the season repaints and replants it.',
    build: () => buildWindowTrough({ width: 2.4, season: 'summer' }),
    face: 0.25,
    elevation: 0.4,
  },

  // --- People, post and jobs ------------------------------------------------------
  {
    id: 'agent',
    group: 'people',
    label: 'Agent',
    blurb: 'One of your sessions, standing up: keycard, hair, and the status ring that '
      + 'says what they are doing. The floating name tag is hidden here.',
    build: () => {
      const agent = new Agent({ id: 'portrait', name: 'Portrait' });
      agent.setTagFade(0);
      agent.update(0);
      return agent.root;
    },
    face: Math.PI + 0.35,       // built facing -z: turned round to be looked at
    elevation: 0.3,
  },
  {
    id: 'courier',
    group: 'people',
    label: 'Courier',
    blurb: 'Not an agent — a delivery. He climbs the stair, steps inside, throws the '
      + 'work in and leaves. Nobody in the office is him.',
    // Built hidden, because he only exists for the length of a delivery, and
    // returned as a handle with his limbs on it so the throw can be animated.
    build: () => {
      const { obj } = buildCourier();
      obj.visible = true;
      return obj;
    },
    face: 0.35,                 // built facing +z, the way the peak of his cap points
    elevation: 0.3,
  },
  {
    id: 'pigeon',
    group: 'people',
    label: 'Carrier pigeon',
    blurb: 'The letter channel’s other wing: a bird that carries the envelope in through '
      + 'the window, holds a flutter over the box while the letter drops, and flies home. '
      + 'The pigeon leads the day roster — the bird whose whole species is named after '
      + 'this job — with the raven and the kookaburra on odd shifts and the owl at night. '
      + 'Photographed mid-wingbeat, letter in the talons.',
    build: () => {
      const { root, wingL, wingR } = buildBirdMesh('pigeon');
      wingL.rotation.z = -0.5;
      wingR.rotation.z = 0.5;
      return root;
    },
    face: 0.35,
    elevation: 0.25,
  },
  {
    id: 'parcel',
    group: 'people',
    label: 'Parcel',
    blurb: 'How a big job arrives: cardboard, tape and a label. Small ones come as paper planes.',
    build: () => {
      const parcel = buildParcel();
      parcel.visible = true;      // hidden until it is thrown, like the courier
      return parcel;
    },
    face: 0.5,
    elevation: 0.5,
  },
  {
    id: 'mailbox',
    group: 'people',
    label: 'Mailbox',
    blurb: 'Work both ways: posted jobs wait here with the flag up until an agent '
      + 'collects one, and finished work gets posted back. Letters in the slot, packages beside it.',
    build: () => {
      const { obj, handle } = buildMailbox();
      handle.setWaiting(2, 1);       // flag up, with post waiting to be collected
      handle.update(1);
      return obj;
    },
    face: -0.9,                      // modelled with its open end along +x
    elevation: 0.5,
  },
  {
    id: 'inbox',
    group: 'people',
    label: 'Inbox',
    blurb: 'Fallback job material. When no post is waiting, an agent collects a '
      + 'package from this stack instead of standing idle.',
    build: () => buildInbox().obj,
    face: 0.6,
  },
  {
    id: 'bin',
    group: 'people',
    label: 'Bin',
    blurb: 'Where failed jobs go, crumpled up, before the retry. The only prop whose '
      + 'job is to be a dead end.',
    build: () => buildBin().obj,
    face: 0.4,
  },
  {
    id: 'coatStand',
    group: 'people',
    label: 'Coat stand',
    blurb: 'One coat per agent currently in the office, so the stand is a census: it '
      + 'fills up as the room does and empties as everyone clocks off.',
    build: () => {
      const { obj, handle } = buildCoatStand();
      for (const c of [0x6fb1e0, 0xd8734f, 0x8ba888]) handle.addCoat(c);
      return obj;
    },
    face: 0.3,
  },
  {
    id: 'paperPlane',
    group: 'people',
    label: 'Paper plane',
    blurb: 'A small job in flight. It comes in through the window and lands in the '
      + 'mailbox, nose first.',
    build: buildPaperPlaneMesh,
    face: 2.5,
    elevation: 0.75,           // looked down on, the way it is seen coming in
    grounded: false,                 // it is flying
  },

  {
    id: 'printout',
    group: 'people',
    label: 'Printout',
    blurb: 'What comes out of the printer, and the fourth thing a job can be while it '
      + 'is being carried — a parcel, an envelope, a book, and now a page. Two grey '
      + 'bands for text and nothing finer: at the room\'s camera distance a line of '
      + 'type is a smudge, and all this has to say is *printed on*. It is the same '
      + 'object three times over — stacked in the output tray, lying on the floor when '
      + 'a print overshoots it, and held flat in one hand on the walk back to a desk. '
      + 'Its own shape rather than the envelope\'s, because the point of it is to be '
      + 'recognisable across the room: a page says the machine, an envelope says '
      + 'the post.',
    build: buildPrintout,
    // Low and square on, because it is flat: a three-quarter view of a sheet of paper
    // from above is a thin grey line.
    azimuth: 0.35,
    elevation: 0.5,
  },

  // --- Outside --------------------------------------------------------------
  {
    id: 'tree',
    group: 'outside',
    label: 'Tree',
    blurb: 'Icosahedron canopy over a tapered trunk, flat-shaded. In summer.',
    build: () => buildTree(0, 0, 0, 1, 'summer'),
  },
  {
    id: 'treeWinter',
    group: 'outside',
    label: 'Tree, in winter',
    blurb: 'The same tree with the leaves off: a different silhouette rather than a '
      + 'repainted one. Limbs are jointed to the trunk and fork near their ends, and '
      + 'every tree is spun on the spot, because they all share one skeleton.',
    build: () => buildTree(0, 0, 0, 1, 'winter'),
  },
  {
    id: 'bush',
    group: 'outside',
    label: 'Bush',
    blurb: 'Ground-hugging foliage, for the edges of the grass.',
    build: () => buildBush(0, 0, 0, 'summer'),
    elevation: 0.5,
  },
  {
    id: 'streetLamp',
    group: 'outside',
    label: 'Street lamp',
    blurb: 'Lights the road after dark, with a pool of glow on the tarmac beneath it.',
    build: () => buildStreetLamp(0, 0, 0, 1, 'summer', 0),
    face: 0.4,
  },
  {
    id: 'car',
    group: 'outside',
    label: 'Car',
    blurb: 'Parked at the kerb. Never driven: it is scenery, and the street is a still life.',
    build: () => buildCar(0, 0, 0x4f7a8a, 0, 'summer'),
    face: 0.6,
    elevation: 0.4,
  },
];

/**
 * A flat plane wearing a screen texture, at the aspect of the monitor it runs on.
 *
 * Unlit on purpose: on a desk these textures are also the screen's emissive map,
 * so a lamp-lit version of one would be a picture of a lamp, not of a screen.
 *
 * @param {THREE.Texture} texture
 * @returns {THREE.Mesh}
 */
function screenPlane(texture) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.77, 1),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  mesh.position.y = 0.5;
  return mesh;
}

// Entries that name no builder take the one their id implies, which keeps the
// common case — an object with a no-argument builder — down to a single line.
const DEFAULT_BUILDERS = {
  chair: buildAeronChair,
  sideTable: buildSideTable,
  floorLamp: buildFloorLamp,
};

for (const entry of CATALOGUE) {
  if (!entry.build) entry.build = DEFAULT_BUILDERS[entry.id];
  if (!entry.build) throw new Error(`Catalogue entry "${entry.id}" has no builder.`);
}

/** @type {Map<string, object>} every entry, by id. */
export const CATALOGUE_BY_ID = new Map(CATALOGUE.map((e) => [e.id, e]));

/** The view hints, with the defaults filled in. */
export function viewFor(entry) {
  return {
    face: entry.face ?? 0.6,
    azimuth: entry.azimuth ?? Math.PI / 4,
    elevation: entry.elevation ?? 0.62,
    pad: entry.pad ?? 1.08,
    grounded: entry.grounded ?? true,
  };
}

/**
 * Build one object by id, standing at the origin.
 *
 * @param {string} id  a catalogue id
 * @returns {THREE.Object3D}
 */
export function buildCatalogueObject(id) {
  const entry = CATALOGUE_BY_ID.get(id);
  if (!entry) {
    throw new Error(`No object called "${id}". Known: ${[...CATALOGUE_BY_ID.keys()].join(', ')}`);
  }
  return entry.build();
}
