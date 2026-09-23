// Getting a face from the gateway's disk to the office.
//
// `Avatar: avatars/florence-nightingclaw.jpg` names a file on the machine OpenClaw runs on.
// The office is a browser somewhere else — often a laptop on another continent — so there
// is nothing to link to and no shortcut: the bytes have to be carried over, once, and named
// in events afterwards.
//
// Two constraints shape all of this, and both come from where it runs:
//
// **A hook may never wait.** Every handler in this plugin is on the agent's clock, so an
// upload cannot happen inside one. `urlFor` is therefore a *question about what we already
// know* — it answers instantly, from a Map, and kicks off the upload in the background if
// there is nothing to answer with yet. The office is built for the consequence: an avatar
// that turns up mid-session is adopted like a late name (spec §3.2).
//
// **Nothing here may be a reason to lose an event.** A missing file, a refused PUT, a
// gateway with no office at all: each is remembered as "no picture" and never retried in a
// loop. An avatar is a nicety.
import crypto from 'node:crypto';
import fs from 'node:fs';

/** The office's own cap (lib/avatar-store.cjs). Checked here so we never send a refusal. */
const MAX_BYTES = 2 * 1024 * 1024;

/** `…/aop/v0/events` → `…/aop/v0/avatars/<hash>`, the office's face route. */
function avatarUrl(eventsUrl, hash) {
  const base = String(eventsUrl ?? '');
  if (!base.endsWith('/events')) return null;
  return `${base.slice(0, -'/events'.length)}/avatars/${hash}`;
}

/**
 * A picture uploader with a memory.
 *
 * @param {object}   opts
 * @param {Function} opts.endpoint  `() => ({ url, token })` — the office to publish to,
 *   asked each time, because an office that starts later should still be found.
 * @param {object}   [opts.logger]  OpenClaw's plugin logger, if there is one.
 */
export function makeAvatarUploader({ endpoint, logger = null, readFile = fs.readFileSync, fetchImpl = fetch } = {}) {
  // path → `{ state, url }`. `state` is 'sending' | 'done' | 'failed', and every one of
  // those is a reason not to start again.
  const known = new Map();

  async function upload(file, record) {
    const target = endpoint?.();
    if (!target?.url || !target?.token) {
      // No office yet. Not a failure — the next session will ask again, by which time
      // `npm run serve` may well have happened.
      known.delete(file);
      return;
    }

    let bytes;
    try {
      bytes = readFile(file);
    } catch (err) {
      record.state = 'failed';
      logger?.debug?.(`roving-office: cannot read avatar ${file}: ${err.message}`);
      return;
    }
    if (!bytes.length || bytes.length > MAX_BYTES) {
      record.state = 'failed';
      logger?.warn?.(
        `roving-office: avatar ${file} is ${bytes.length} bytes; the office accepts 1–${MAX_BYTES}`,
      );
      return;
    }

    // The name *is* the content, so an office that already has this picture — from this
    // agent yesterday, or from another agent using the same file — says so and no bytes
    // move. That is what makes it safe to offer on every gateway restart.
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const url = avatarUrl(target.url, hash);
    if (!url) {
      record.state = 'failed';
      return;
    }

    try {
      const head = await fetchImpl(url, { method: 'HEAD' });
      if (!head.ok) {
        const put = await fetchImpl(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Roving-Office-Token': target.token,
          },
          body: bytes,
        });
        if (!put.ok) {
          record.state = 'failed';
          logger?.warn?.(`roving-office: avatar upload refused (HTTP ${put.status}) for ${file}`);
          return;
        }
      }
    } catch (err) {
      // The office may simply be down. Forget the attempt rather than marking it failed,
      // so the next session tries once more — that is the difference between a transient
      // network and a picture that will never work.
      known.delete(file);
      logger?.debug?.(`roving-office: avatar upload failed for ${file}: ${err.message}`);
      return;
    }

    // Sent as a path rather than the absolute URL it was PUT to: the office page and the
    // avatar route are the same origin by construction, and a stored absolute URL would
    // pin a room to whichever hostname the gateway happened to use.
    record.url = new URL(url).pathname;
    record.state = 'done';
    logger?.info?.(`roving-office: avatar ready for ${file} → ${record.url}`);
  }

  return {
    /**
     * The URL for a local avatar file **if we have one already**, else `undefined` — and
     * an upload started in the background.
     *
     * Synchronous on purpose. See the note at the top of this file: the caller is a hook.
     */
    urlFor(file) {
      if (!file) return undefined;
      const hit = known.get(file);
      if (hit) return hit.url;
      const record = { state: 'sending', url: undefined };
      known.set(file, record);
      // Detached deliberately: nothing waits for this, and a rejection here must not
      // become an unhandled one.
      upload(file, record).catch(() => { record.state = 'failed'; });
      return undefined;
    },

    /** For the status line and for tests: what has been carried over so far. */
    stats() {
      let done = 0;
      let failed = 0;
      for (const record of known.values()) {
        if (record.state === 'done') done += 1;
        if (record.state === 'failed') failed += 1;
      }
      return { known: known.size, done, failed };
    },
  };
}

export { MAX_BYTES, avatarUrl };
