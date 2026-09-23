// Where an office's agents come from.
//
// Four of these are live harness feeds arriving over the Agent Office Protocol
// (docs/developer/protocol/aop-spec.md); the fifth invents its own traffic so the room can be
// watched, styled and debugged with nothing installed and nothing running.
//
// An office subscribes to as many of them as it likes and shows the results in
// one room — see src/data/feeds.js for the fan-in, and the office record's
// `sources` for what was chosen.
//
// Adding a harness means adding a record here — the picker, the badge and the
// switcher all read this list, so none of them need to know the roster.

import { agentCapacity } from '../layout.js';
import { MockSource } from './MockSource.js';
import { AopSource } from './AopSource.js';
import { officePath } from '../office/keycard.js';
import { rovoMark, claudeMark, codexMark, cursorMark, openclawMark, testDataMark } from '../ui/marks.js';

/**
 * @typedef {object} SourceDef
 * @property {string} id       stable key, stored with the office
 * @property {string} label    shown on the picker button and the badge
 * @property {string} blurb    one line under the label
 * @property {string} accent   CSS colour for the source mark
 * @property {string} mark     inline SVG glyph (src/ui/marks.js)
 * @property {'aop'|'mock'} kind
 * @property {?string} harness AOP `harness.name` this source subscribes to
 * @property {(ctx: {project: object, manager: object, onStatus: Function}) => object} create
 */

/** @type {SourceDef[]} */
export const SOURCES = [
  {
    id: 'rovo-cli',
    label: 'Rovo CLI',
    blurb: 'Atlassian’s terminal agent',
    accent: '#4a9bff',
    mark: rovoMark,
    kind: 'aop',
    harness: 'rovo-cli',
    create: aopFactory('rovo-cli'),
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    blurb: 'Hooks, plugins, subagents',
    accent: '#d97757',
    mark: claudeMark,
    kind: 'aop',
    harness: 'claude-code',
    create: aopFactory('claude-code'),
  },
  {
    id: 'codex-cli',
    label: 'Codex',
    blurb: 'OpenAI’s coding agent',
    // A dark neutral, to sit under OpenAI's black mark without fighting it. The
    // mark itself is not tinted from this — see src/ui/marks.js.
    accent: '#29323c',
    mark: codexMark,
    kind: 'aop',
    harness: 'codex-cli',
    create: aopFactory('codex-cli'),
  },
  {
    id: 'cursor', label: 'Cursor', blurb: 'Cursor agent hooks', accent: '#8f7cff', mark: cursorMark,
    kind: 'aop', harness: 'cursor', create: aopFactory('cursor'),
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    blurb: 'Gateway for other agents',
    accent: '#e8853f',
    mark: openclawMark,
    kind: 'aop',
    harness: 'openclaw',
    create: aopFactory('openclaw'),
  },
  {
    id: 'test-data',
    label: 'Test Data',
    blurb: 'Simulated agents, no setup',
    accent: '#8ba888',
    mark: testDataMark,
    kind: 'mock',
    harness: null,
    create: ({ project, onStatus }) => {
      // How many file in at opening is per-project; how many the room can hold is not
      // a matter of opinion, it is the number of desks (see `agentCapacity()`), asked
      // live so that adding one in the editor makes room for somebody to sit at it.
      // Everything else the simulation needs it already knows, because it is the thing
      // keeping the room busy (see MockSource).
      const source = new MockSource({ ...project.agents, capacity: agentCapacity });
      // Nothing to connect to, so it is live the moment it starts.
      onStatus?.({ state: 'live', detail: 'simulated' });
      return source;
    },
  },
];

/** Every AOP source is the same class with a different subscription. */
function aopFactory(harness) {
  return ({ project, onStatus }) => new AopSource({
    harness,
    endpoint: aopEndpoint(),
    projectId: project?.id ?? null,
    onStatus,
  });
}

/**
 * Which receiver to listen to: this office's, not the server's.
 *
 * Every office has its own ring buffer, because a keycard is a private address and
 * two visitors holding different ones must not see each other's agents. The office
 * is named by the page's own URL, so there is nothing to configure and nothing that
 * can point a room at the wrong feed.
 *
 * The bare path is the fallback for a page opened outside an office — a test
 * harness, say — where the server routes it to whichever office holds the local
 * endpoint's claim.
 */
export function aopEndpoint() {
  const at = officePath(window.location?.pathname ?? '');
  return at ? `/office/${at.keycard}/aop/v0` : '/aop/v0';
}

/** The source a fresh install opens with: no harness, no adapter, no waiting. */
export const DEFAULT_SOURCE_ID = 'test-data';

/** @returns {?SourceDef} */
export function getSource(id) {
  return SOURCES.find((s) => s.id === id) ?? null;
}

/**
 * The definitions behind a set of ids, in the order given.
 *
 * Ids with no definition are dropped: an office persisted in `localStorage` can
 * name a source that has since been retired from the registry, and that is not a
 * reason to refuse to open the room.
 * @returns {SourceDef[]}
 */
export function getSources(ids) {
  return (ids ?? []).map(getSource).filter(Boolean);
}

/**
 * Build one feed.
 *
 * Returns `null` for an unknown id, which is how an office with nothing chosen
 * yet — a legitimate state, waiting on the picker — ends up with no feeds at all.
 */
export function createSource(sourceId, ctx) {
  const def = getSource(sourceId);
  if (!def) return null;
  return def.create(ctx);
}

/**
 * How a harness's front door is spelled for a reader (spec §4.7).
 *
 * Acronyms are shouted because that is how they are written everywhere else in
 * the room's vocabulary; anything unrecognised is title-cased rather than
 * dropped, so a harness we have never met still labels itself sensibly.
 */
const VARIANT_LABELS = { cli: 'CLI', desktop: 'Desktop', sdk: 'SDK', vm: 'VM' };

/** @param {?string} variant @returns {?string} `null` when there is nothing to add. */
export function variantLabel(variant) {
  if (typeof variant !== 'string' || !variant.trim()) return null;
  const key = variant.trim().toLowerCase();
  if (VARIANT_LABELS[key]) return VARIANT_LABELS[key];
  return key.split('-').filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A source's label with the variant appended: "Claude Code - Desktop".
 *
 * One string for every place that names an agent's feed, so the roster, the
 * inspector and a future badge cannot drift apart.
 */
export function sourceLabel(def, variant = null) {
  const base = def?.label ?? 'No source';
  const suffix = variantLabel(variant);
  return suffix ? `${base} - ${suffix}` : base;
}
