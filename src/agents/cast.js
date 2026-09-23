// Who is in the office: one AOP session, one character, one name.
//
// `names.js` turns strings into names. This turns *sessions* into people, which is a
// different job and the one both the room and the log need answered identically: the
// room draws a character called Ada Renamer, and a debug log that called the same
// session `…8f21c4a3` would be describing a different office. So the rules live here
// once — who wins the naming, what a rename is allowed to change, and when a name
// becomes free again — and `AopSource` and the debug log both read them rather than
// each keeping their own copy.
//
// Four rules, in order of authority:
//
//   1. **A harness-chosen `session.label` wins, always.** An adapter that named the
//      session knows something we do not, and nothing here ever second-guesses it.
//   2. **Then `session.actor`, the identity behind the session** (spec §3.2) — a
//      configured OpenClaw agent, say, who exists apart from any one session and will
//      be back tomorrow under a new id. A whole name is kept whole and never
//      re-surnamed; a single word is a first name and still gets a job. See
//      `actorName` for why, and note this may arrive *after* the session does.
//   3. **Failing both, the first name comes from the session key**, so it survives a
//      reload, a reconnect and a replay: the same session is the same person all day.
//   4. **The surname is the job, so it follows the work** — from the git branch
//      before there is a prompt, then from each prompt after (see `rename`). The
//      first name never moves, which is what makes a colleague followable across it.

import {
  nameForSession, firstNameFor, actorName, surnameFromPrompt, surnameOf, fullName,
} from './names.js';

/**
 * How many departed characters are remembered.
 *
 * Retired records are kept rather than deleted so that a session which comes back —
 * resumed after a reap, or replayed into a log — comes back as the same person
 * instead of being renamed behind your back. They are capped because an office left
 * open for a week would otherwise remember every agent that ever visited it, and
 * beyond a couple of hundred nobody is scrolling back that far anyway.
 */
const REMEMBER_RETIRED = 200;

/**
 * A cast of characters, keyed by session.
 *
 * One cast per harness, matching the office, which runs one `AopSource` per source:
 * the taken-name set that keeps two agents from both being Ada is per-harness there,
 * so a cast shared across harnesses would resolve collisions differently and the log
 * would disagree with the room about who is who.
 */
export function createCast() {
  /** @type {Map<string, {key: string, name: string, first: string, namedFrom: string, retired: boolean}>} */
  const people = new Map();
  /** Retired keys, oldest first, so the cap can forget the ones nobody is reading. */
  const retired = [];

  /** First names in the room *now*, so two live sessions are never both Ada. */
  function taken() {
    const names = new Set();
    for (const rec of people.values()) if (!rec.retired) names.add(rec.first);
    return names;
  }

  return {
    /**
     * Find or create the character behind an event.
     *
     * Creating on any event rather than only on `session.start` is deliberate and
     * matches the office: hook-based adapters are lossy and a reconnect replays from
     * wherever the buffer starts, so the first event seen for a session frequently
     * is not its start. A character that only appeared for a well-formed opening
     * would be missing exactly when the harness was misbehaving.
     *
     * @param {string} key  the session key — `${harness}:${session.id}`
     * @param {object} ev   an AOP envelope
     * @returns {{key: string, name: string, first: string, namedFrom: string, fresh: boolean}}
     */
    note(key, ev) {
      const existing = people.get(key);
      if (existing) {
        // Back from the dead: a resumed or replayed session keeps the name it had.
        if (existing.retired) {
          existing.retired = false;
          const at = retired.indexOf(key);
          if (at !== -1) retired.splice(at, 1);
        }
        return { ...existing, fresh: false };
      }

      const label = ev?.session?.label ?? null;
      const actor = ev?.session?.actor ?? null;
      const name = label || nameForSession({
        key,
        actor,
        branch: ev?.project?.repo?.branch ?? null,
        taken: taken(),
      });
      const rec = {
        key,
        name,
        // The person, kept apart from the surname because the surname is the job and
        // the job changes (see `rename`).
        first: String(name).split(' ')[0],
        // Where the surname came from, which decides whether we may replace it. An
        // identity that brought its own surname is as untouchable as a harness label:
        // both are somebody else's choice.
        namedFrom: label ? 'harness' : (actorName(actor)?.surname ? 'actor' : 'branch'),
        // The identity we have already accounted for, so a later event repeating it is
        // not mistaken for news — and the first event that *does* carry one is.
        actor,
        retired: false,
      };
      people.set(key, rec);
      return { ...rec, fresh: true };
    },

    /**
     * Re-surname a character from the work they have just been given.
     *
     * Returns the new name, or `null` when nothing should change — which is the
     * common case and covers all of: a harness-chosen name and an identity's own
     * surname (neither ours to touch), a title that describes no job, and a title that
     * describes the job they already have. Callers announce a rename exactly when this
     * returns a string, so the flicker-avoidance lives in one place rather than at
     * every call site.
     *
     * @param {string} key
     * @param {?string} title  the prompt, as `turn.start` reported it
     * @returns {?string}
     */
    rename(key, title) {
      const rec = people.get(key);
      if (!rec || !title) return null;
      if (rec.namedFrom === 'harness' || rec.namedFrom === 'actor') return null;
      const surname = surnameFromPrompt(title);
      if (!surname) return null;
      const first = rec.first || firstNameFor(key, taken());
      const next = fullName(first, surname);
      if (next === rec.name) return null;
      rec.first = first;
      rec.name = next;
      rec.namedFrom = 'prompt';
      return next;
    },

    /**
     * Learn who somebody is after they have already sat down.
     *
     * An adapter can only name an identity once it knows one, and for OpenClaw that
     * arrives with the *agent* context rather than the session — so a session's first
     * event may well be anonymous and its second one Albus. The alternative to acting on
     * that is a colleague who keeps a pool name for the whole run because the office
     * happened to meet them a beat early.
     *
     * How much of the name changes depends on how much of one arrived. An identity with a
     * surname of its own replaces the whole thing — `Priya Kettle-Mender` becomes `Albus
     * Dumbledclaw`, and no job is written over it again. A single-word identity changes
     * only the person, so `Priya Kettle-Mender` becomes `Bobster Kettle-Mender` and the
     * desk carries on. A name the harness set outright is never touched at all.
     *
     * Returns the new name or `null`, on the same contract as `rename`.
     *
     * @param {string} key
     * @param {?string} actor
     * @returns {?string}
     */
    adoptActor(key, actor) {
      const rec = people.get(key);
      if (!rec) return null;
      rec.actor = actor;
      if (rec.namedFrom === 'harness' || rec.namedFrom === 'actor') return null;
      const person = actorName(actor);
      if (!person) return null;
      // Recorded even when the name does not change, so a second event carrying the same
      // identity is not treated as another arrival.
      rec.first = person.first;
      if (person.surname) rec.namedFrom = 'actor';
      const next = fullName(person.first, person.surname ?? surnameOf(rec.name));
      if (next === rec.name) return null;
      rec.name = next;
      return next;
    },

    /** The character behind a key, present or departed, or null if never seen. */
    get(key) {
      const rec = people.get(key);
      return rec ? { ...rec } : null;
    },

    /**
     * This session has gone.
     *
     * The name is freed for the next arrival, but the record is kept: the log still
     * has their rows on screen and must go on naming them, and a session that
     * returns should return as itself.
     */
    retire(key) {
      const rec = people.get(key);
      if (!rec || rec.retired) return;
      rec.retired = true;
      retired.push(key);
      while (retired.length > REMEMBER_RETIRED) people.delete(retired.shift());
    },

    /** Everyone still here. */
    present() {
      return [...people.values()].filter((rec) => !rec.retired).map((rec) => ({ ...rec }));
    },
  };
}
