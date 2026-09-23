// Driving one agent by hand: the room's own behaviours, on buttons.
//
// A test agent runs a loop of its own. The `_idle` roll in AgentManager decides what
// happens next, so the movement you want to look at arrives when the dice say so
// rather than when you ask — and the room is mostly checked by *watching* it. Waiting
// for somebody to choose the couch, or for a checklist to tick along at a desk, is
// how a five-second look at a piece of choreography becomes a five-minute one.
//
// So: the same office, asked directly. Every entry here is **the event a feed would
// have sent**, not a behaviour of its own, and that is the whole point of the file.
// The button drives the room down exactly the path a real harness drives it down, so
// what you check by hand is what a session gets — and a behaviour that only existed
// for the buttons would be a second office, checked instead of the first.
//
// `AgentManager.pilot` runs one: it closes whatever was in hand, applies the event,
// and holds the agent still for a moment afterwards before the loop takes them back.

/**
 * How long a hand-driven agent is left alone once the errand is over, in seconds.
 *
 * The pause is the point of the whole feature. A behaviour that ends by handing
 * straight back to the loop is a behaviour you watched the end of and then lost, and
 * ten seconds is long enough to look at where somebody ended up, take a screenshot of
 * it, and read the panel that describes it.
 */
export const PILOT_HOLD = 10;

/**
 * How long each part of the demonstration checklist is left open, in seconds.
 *
 * Slow enough to read the line in four places — the roster row, the inspector's
 * checklist, the first-person HUD and the name tag — which is what somebody pressing
 * the button is checking.
 */
export const PILOT_PART = 2;

/**
 * The checklist the `checklist` button hands out.
 *
 * Written as a job with visibly different-shaped parts, because the thing being
 * checked is the *drawing* of a plan: a tick, an open part, and the ones not reached
 * yet have to be tellable apart at a glance (see `buildPlan` in ui/overlay.js).
 */
const CHECKLIST = [
  'Pull the branch',
  'Run the tests',
  'Read the diff',
  'Write the notes',
  'Post the summary',
];

/**
 * One button each, in the order they are drawn.
 *
 * `event` is the feed event the press stands in for; `job` is the log entry it
 * opens, so the panel's "Recent jobs" ends up being a record of what you pressed.
 * `plan` is the checklist to hand out, and only one entry has one.
 *
 * Two entries are exceptions, and both are worth their exception.
 *
 * `mail` is the first: a request arriving is an event about the *room* rather than
 * about an agent — it goes into the mailbox, and until somebody opens it the office
 * does not know whose it is or what it says. So an entry carrying one has the envelope
 * posted first, addressed to this agent, and `event` then sends them to fetch it. Two
 * halves of one press, because that is two halves of one thing happening: the flag
 * goes up, and then a person walks over to the box.
 *
 * `beam` is the second, and it carries no `event` at all: being beamed up is the room
 * giving up on a departure rather than anything a harness could ask for. See the entry
 * itself, and `AgentManager.pilot`, which sends it somewhere else entirely.
 *
 * The order is the order the room does things in — a job arrives, is fetched, worked
 * on, looked up, delivered — with the breaks after it, going home last, and being
 * carried out of the room after that, so the row reads as a working day rather than as
 * an alphabet.
 */
export const PILOT_ACTIONS = [
  {
    // The one button that exercises the whole delivery path: posted, flown in,
    // announced, waited for at the box, opened, and carried to a desk. `Work` cannot
    // stand in for it — with an empty mailbox that button goes to the inbox stack
    // instead, and an agent who already has material does not fetch anything at all.
    key: 'letter',
    label: 'Job by air',
    title: 'A request flies in by air, addressed to them: they fetch it from the mailbox and take it to a desk',
    mail: { job: 'A request that came by air', arrival: 'letter' },
    event: { type: 'status', status: 'working' },
  },
  {
    // Same trip, different arrival — the two buttons exist so each channel can be
    // door with the courier and up the stairs onto the pile — and the two channels
    // are separate scenery, so a button that only ever posted letters would leave
    // half of it unpressable.
    key: 'package',
    label: 'Job by courier',
    title: 'A request brought by courier to the door, fetched from the mailbox like any other',
    mail: { job: 'A request that came by courier', arrival: 'package' },
    event: { type: 'status', status: 'working' },
  },
  {
    // The letter channel's other vehicle, pinned rather than left to the toss —
    // the birds are rare on purpose, and a button that only sometimes shows a
    // bird is a button that mostly shows a plane.
    key: 'bird',
    label: 'Job by bird',
    title: 'The same letter, carried in by bird — mostly the owl, and mostly at night',
    mail: { job: 'A request that came by bird', arrival: 'letter', vehicle: 'bird' },
    event: { type: 'status', status: 'working' },
  },
  {
    key: 'work',
    label: 'Work',
    title: 'Get the work and sit down at a desk with it: the mailbox if there is post, the inbox stack if not',
    job: 'Working at the desk',
    event: { type: 'status', status: 'working' },
  },
  {
    key: 'checklist',
    label: 'Checklist',
    title: 'Work through a five-part checklist at the desk',
    job: 'Release checks',
    event: { type: 'status', status: 'working' },
    plan: CHECKLIST,
  },
  {
    key: 'wait',
    label: 'Wait',
    title: 'Waiting on input: stay at the desk, screens down',
    job: 'Waiting for an answer',
    event: { type: 'status', status: 'waiting' },
  },
  {
    key: 'lookup',
    label: 'Look up',
    title: 'Take a book off the shelf and read it',
    event: { type: 'research', topic: 'the filing conventions', scope: 'graph' },
  },
  {
    key: 'web',
    label: 'Search web',
    title: 'Go outside for the answer: the globe on the shelf turns',
    event: { type: 'research', topic: 'the state of the art', scope: 'web' },
  },
  {
    key: 'post',
    label: 'Post run',
    title: 'Take something to the mailbox mid-job and come back to the desk',
    event: { type: 'status', status: 'delivering' },
  },
  {
    key: 'dispatch',
    label: 'Deliver',
    title: 'Finish: carry the work to the mailbox and post it',
    job: 'Work to deliver',
    event: { type: 'dispatch', summary: 'Delivered by hand' },
  },
  {
    key: 'bin',
    label: 'Bin it',
    title: 'Error: crumple the work up and drop it in the bin',
    job: 'Work to bin',
    event: { type: 'status', status: 'error' },
  },
  {
    key: 'drink',
    label: 'Drink',
    title: 'Fetch a drink and take it wherever this one takes it',
    event: { type: 'activity', activity: 'drink' },
  },
  {
    key: 'sofa',
    label: 'Sofa',
    title: 'Sit down on the couch for a while',
    event: { type: 'activity', activity: 'couch' },
  },
  {
    // The one movement the room could already do and nobody had ever seen: the pose
    // was written with the agent and nothing asked for it, so it was reachable only by
    // hand. A button, because a celebration has no feed event that implies it —
    // finishing work delivers, and delivering is its own errand.
    key: 'dance',
    label: 'Dance',
    title: 'A happy dance, on the spot: arms overhead, off the floor, out of whatever they were sitting in',
    event: { type: 'activity', activity: 'dance' },
  },
  {
    key: 'wander',
    label: 'Wander',
    title: 'Nothing on: walk somewhere else in the room',
    event: { type: 'status', status: 'idle' },
  },
  {
    key: 'home',
    label: 'Go home',
    title: 'Coat off the stand, out through the door, and gone',
    event: { type: 'exit' },
  },
  {
    // The second exception, and the only entry here that stands in for no event at
    // all. Nothing a harness can send asks to be beamed up: the cone of light is the
    // *room* giving up on a departure that has not finished, thirty seconds after it
    // was asked for (see `LEAVE_GRACE` in AgentManager). So what this button stands in
    // for is the thirty seconds, which is the one thing about the feature nobody would
    // sit through to look at — and the alternative to a button is backgrounding the
    // tab for half a minute and hoping you catch the tail of it.
    //
    // Last in the row, after `home`, because that is when it happens: this is what
    // going home looks like when going home does not work.
    key: 'beam',
    label: 'Beam up',
    title: 'Give up on the walk out: a cone of light comes down and takes them, as it does thirty seconds after a departure gets stuck',
    beam: true,
  },
];

const BY_KEY = new Map(PILOT_ACTIONS.map((a) => [a.key, a]));

/** The action a button names, or null for a key we do not have. */
export const pilotAction = (key) => BY_KEY.get(key) ?? null;

/**
 * Whether this agent is one the buttons should be drawn for.
 *
 * Simulated agents and nobody else. For a test agent the press replaces a dice roll,
 * which is exactly what the feature is for; for a live session it would put a
 * movement on screen that the session never reported, and the room being an honest
 * picture of what the harnesses are doing is the point of the room. An agent with no
 * source at all is not simulated either — nothing here is claiming they are.
 *
 * @param {?{kind?: string}} source  the agent's SourceDef (src/data/sources.js), if any
 */
export const canPilot = (source) => source?.kind === 'mock';

/**
 * The checklist an action hands out, in the shape the office draws.
 *
 * Built fresh on every press rather than shared: the entries are marked off as the
 * parts are worked through, so one object handed to two agents would have the second
 * of them start halfway through the first one's afternoon.
 *
 * @param {object} action  an entry from PILOT_ACTIONS
 * @returns {?{items: Array<{id: string, title: string, status: string}>, more: number}}
 */
export function pilotPlan(action) {
  if (!action?.plan?.length) return null;
  return {
    items: action.plan.map((title, i) => ({ id: `part-${i + 1}`, title, status: 'pending' })),
    more: 0,
  };
}
