// The post model owns the mailbox's edge cases — addressed post, races for
// unaddressed envelopes, planes that never land — and was written scene-free
// precisely so these rules could be tested without a browser in the room.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Post, ARRIVALS, arrivalFor } from '../src/agents/post.js';

// --- how work arrives --------------------------------------------------------
//
// There used to be eighty lines here about whether work was big or small, read off
// word lists and a square-rooted lean on the title's length. It was deleted:
// the guess was wrong often enough to notice, and a room that labels work "big" is
// making a claim nobody can check. What is left is a coin toss that says nothing.

test('an arrival is one of the ways in, and nothing about the work decides it', () => {
  for (const title of ['Refactor the auth layer', 'Fix a typo', '', null]) {
    // The same title can come out either way: there is no inference left to pin.
    assert.equal(arrivalFor(() => 0), ARRIVALS[0]);
    assert.equal(arrivalFor(() => 0.99), ARRIVALS[ARRIVALS.length - 1]);
    // And it does not consult the title at all — this call passes none.
    assert.ok(ARRIVALS.includes(arrivalFor()), `arrival for ${JSON.stringify(title)}`);
  }
});

test('every arrival in the list can actually come up', () => {
  // A weighted draw down the list, so adding a fax to `ARRIVALS` is still the whole
  // change needed to have faxes arrive — an unlisted channel weighs 1. Asserted by
  // sweeping the toss rather than by hammering Math.random, so it cannot flake.
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) seen.add(arrivalFor(() => i / 1000));
  assert.deepEqual([...seen].sort(), [...ARRIVALS].sort());
});

test('the mailbox is drawn twice as often as the courier or the fax', () => {
  // The window is what people watch for work arriving, and an even
  // three-way split had it arriving a third of the time. Swept rather than sampled:
  // a share asserted off Math.random is a flaky test waiting for a bad afternoon.
  const share = (channels) => {
    const n = 12000;
    const tally = {};
    for (let i = 0; i < n; i += 1) {
      const a = arrivalFor(() => i / n, channels);
      tally[a] = (tally[a] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v / n]));
  };

  const all = share(['letter', 'package', 'fax']);
  assert.ok(Math.abs(all.letter - 0.5) < 0.001, `letter ${all.letter}`);
  // The other two split what is left, evenly — they are alternatives to the plane,
  // not rivals to each other.
  assert.ok(Math.abs(all.package - 0.25) < 0.001, `package ${all.package}`);
  assert.ok(Math.abs(all.fax - 0.25) < 0.001, `fax ${all.fax}`);

  // The shares renormalise over what the room has rather than leaving a hole where
  // an absent channel used to be: courier off is two-thirds letters, not a half.
  const noCourier = share(['letter', 'fax']);
  assert.ok(Math.abs(noCourier.letter - 2 / 3) < 0.001, `letter ${noCourier.letter}`);
  assert.ok(Math.abs(noCourier.fax - 1 / 3) < 0.001, `fax ${noCourier.fax}`);

  // And a one-sided coin is still not a special case.
  assert.deepEqual(share(['letter']), { letter: 1 });
});

test('a channel nobody has weighted still draws', () => {
  // The extensibility claim in ARRIVALS is load-bearing: a new way in should arrive
  // on the day its string is added, not on the day somebody remembers the weights.
  const shares = { printout: 0 };
  const n = 6000;
  for (let i = 0; i < n; i += 1) {
    const a = arrivalFor(() => i / n, ['letter', 'printout']);
    shares[a] = (shares[a] ?? 0) + 1;
  }
  // Weight 1 against the mailbox's 2.
  assert.ok(Math.abs(shares.printout / n - 1 / 3) < 0.001, `printout ${shares.printout / n}`);
});

test('a toss of exactly 1 does not fall off the end of the list', () => {
  // Math.random() never returns 1, but an injected rng in a test might, and an
  // undefined arrival would reach the scene as a channel nothing renders.
  assert.ok(ARRIVALS.includes(arrivalFor(() => 1)));
});

test('an envelope with no stated arrival is given one', () => {
  const post = new Post();
  post.post(null);
  post.land({ job: 'Something' });
  assert.ok(ARRIVALS.includes(post.pending[0].arrival));
});

test('a stated arrival is kept, which is what the pilot buttons rely on', () => {
  const post = new Post();
  post.post(null);
  post.land({ job: 'By courier, please', arrival: 'package' });
  assert.equal(post.pending[0].arrival, 'package');
  assert.equal(post.countByArrival('package'), 1);
  assert.equal(post.countByArrival('letter'), 0);
});

// --- Post: ownership ---------------------------------------------------------

test('unaddressed post goes to whoever reaches it first', () => {
  const post = new Post();
  post.post(null);
  post.land({ job: 'Queued ticket', arrival: 'letter' });

  assert.ok(post.canCollect('a'));
  assert.ok(post.canCollect('b'));
  assert.equal(post.take('a')?.job, 'Queued ticket');
  // The race is real: the loser finds nothing.
  assert.equal(post.take('b'), null);
  assert.equal(post.size, 0);
});

test('addressed post can only be opened by its recipient', () => {
  const post = new Post();
  post.post('alice');
  post.land({ job: 'For Alice', forId: 'alice', arrival: 'letter' });

  assert.equal(post.canCollect('bob'), false);
  assert.equal(post.take('bob'), null);
  assert.equal(post.take('alice')?.job, 'For Alice');
});

test('oldest first: an agent takes the first envelope they may open', () => {
  const post = new Post();
  post.land({ job: 'first', arrival: 'letter' });
  post.land({ job: 'for-bob', forId: 'bob', arrival: 'letter' });
  post.land({ job: 'second', arrival: 'letter' });

  assert.equal(post.take('alice')?.job, 'first');
  // Bob's first openable envelope is the one addressed to him.
  assert.equal(post.take('bob')?.job, 'for-bob');
  assert.equal(post.take('bob')?.job, 'second');
});

test('a late concise title updates matching addressed mail already in the box', () => {
  const post = new Post();
  post.land({ job: 'Can you test this locally?', forId: 'alice', arrival: 'letter' });
  post.land({ job: 'Keep this wording', forId: 'alice', arrival: 'letter' });
  post.land({ job: 'Can you test this locally?', forId: 'bob', arrival: 'letter' });

  assert.equal(post.retitleFor('alice', 'Can you test this locally?', 'Local Test'), 1);
  assert.equal(post.take('alice')?.job, 'Local Test');
  assert.equal(post.take('alice')?.job, 'Keep this wording');
  assert.equal(post.take('bob')?.job, 'Can you test this locally?');
});

// --- Post: in-flight expectations -------------------------------------------

test('hasOwn is true from posting, before the plane lands', () => {
  const post = new Post();
  post.post('alice');
  assert.ok(post.hasOwn('alice'), 'the request exists the moment it is made');
  assert.equal(post.canCollect('alice'), false, 'but there is nothing to open yet');

  post.land({ job: 'Landed', forId: 'alice', arrival: 'letter' });
  assert.ok(post.canCollect('alice'));
  post.take('alice');
  assert.equal(post.hasOwn('alice'), false);
});

test('unaddressed in-flight post drags nobody to the box', () => {
  const post = new Post();
  post.post(null);
  assert.equal(post.hasOwn('alice'), false);
});

test('unpost clears an expectation for a flight that never took off', () => {
  const post = new Post();
  post.post('alice');
  post.unpost('alice');
  assert.equal(post.hasOwn('alice'), false);
});

test('a recipient who left mid-flight gets their envelope binned', () => {
  const post = new Post();
  post.post('ghost');
  const delivered = post.land(
    { job: 'Too late', forId: 'ghost', arrival: 'letter' },
    (id) => id !== 'ghost',
  );
  assert.equal(delivered, false);
  assert.equal(post.size, 0);
  assert.equal(post.hasOwn('ghost'), false);
});

test('abandon clears expectations but not envelopes already in the box', () => {
  const post = new Post();
  post.post('alice');
  post.post('alice');
  assert.equal(post.abandon('alice'), 2);
  assert.equal(post.hasOwn('alice'), false);

  // A plane that lands late still delivers — one in the box is enough to bring
  // its recipient back.
  post.land({ job: 'Late plane', forId: 'alice', arrival: 'letter' });
  assert.ok(post.hasOwn('alice'));
});

test('dropFor bins box and air alike, and reports what left the box', () => {
  const post = new Post();
  post.post('alice');
  post.land({ job: 'one', forId: 'alice', arrival: 'letter' });
  post.post('alice');                                   // still in the air
  post.land({ job: 'keep', arrival: 'letter' });          // unaddressed, stays

  assert.equal(post.dropFor('alice'), 1);
  assert.equal(post.size, 1);
  assert.equal(post.hasOwn('alice'), false);
});

test('countByArrival tallies the box, which is what the mailbox draws itself from', () => {
  // The tally is per channel because the mailbox shows letters in the slot and
  // parcels on the pile beside it. Stated rather than tossed for, so the assertion
  // is about counting and not about the coin.
  const post = new Post();
  post.land({ job: 'One', arrival: 'package' });
  post.land({ job: 'Two', arrival: 'letter' });
  post.land({ job: 'Three', arrival: 'letter' });
  assert.equal(post.countByArrival('package'), 1);
  assert.equal(post.countByArrival('letter'), 2);
  assert.equal(post.countByArrival('fax'), 0, 'a channel the room has none of counts nought');
});
