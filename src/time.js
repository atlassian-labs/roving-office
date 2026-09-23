// The world clock.
//
// Everything that cares about the time of day — the LED panel on the wall, the
// sun's position, the sky colour — reads it from here rather than calling
// `new Date()` directly. That single indirection is what lets the scene panel
// scrub the time: it only has to move the offset, and the whole scene follows.
//
// The offset is kept in milliseconds against real time, so the clock keeps
// *running* while scrubbed rather than freezing at the chosen hour.

let offsetMs = 0;

/** Milliseconds from midnight for a Date. */
function msIntoDay(date) {
  return date.getHours() * 3600e3 + date.getMinutes() * 60e3
    + date.getSeconds() * 1000 + date.getMilliseconds();
}

export const worldClock = {
  /** The current world time, as a Date. */
  now() { return new Date(Date.now() + offsetMs); },

  /** Fractional hours since midnight, e.g. 13.5 for half past one. */
  hours() { return msIntoDay(this.now()) / 3600e3; },

  /** Whether the world time has been pushed away from real time. */
  get shifted() { return offsetMs !== 0; },

  get offsetMs() { return offsetMs; },

  /**
   * Jump the world clock to a given hour of the day, keeping it ticking from
   * there. Wraps, so 25 is 01:00 tomorrow and −1 is 23:00.
   */
  setHours(hours) {
    const target = ((hours % 24) + 24) % 24;
    const real = new Date();
    offsetMs = Math.round(target * 3600e3) - msIntoDay(real);
  },

  /** Hand the clock back to real time. */
  reset() { offsetMs = 0; },
};
