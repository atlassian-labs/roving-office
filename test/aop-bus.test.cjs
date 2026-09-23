// The receiver's buffer: accept generously, replay honestly. These rules keep
// every adapter's retry harmless and every office's reload truthful, so they
// get pinned.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAopBus } = require('../lib/aop-bus.cjs');

const ev = (type, sid, extra = {}) => ({
  aop: '0.1', type, session: { id: sid }, harness: { name: 'claude-code' }, ...extra,
});

test('malformed events are dropped, never fatal — a 400 is a hook that gets disabled', () => {
  const bus = createAopBus();
  assert.equal(bus.accept(null), false);
  assert.equal(bus.accept('a string'), false);
  assert.equal(bus.accept({ no: 'type' }), false);
  assert.equal(bus.accept({ type: 'tool.start' }), false, 'no session, not a job event');
});

test('a job event with no session gets the synthetic queue session', () => {
  const bus = createAopBus();
  assert.equal(bus.accept({ aop: '0.1', type: 'job.queued', payload: { title: 'x' } }), true);
  const { events } = bus.replay({});
  assert.equal(events[0].session.id, 'queue');
});

test('another AOP major version is refused; a missing version is tolerated', () => {
  const bus = createAopBus();
  assert.equal(bus.accept({ aop: '1.0', type: 'session.start', session: { id: 'S' } }), false);
  assert.equal(bus.accept({ type: 'session.start', session: { id: 'S' } }), true);
});

// Spec §11 promises a receiver relays a type it has never heard of rather than
// rejecting it, which is the whole reason a new event type is a *minor* bump. The
// promise is only worth having if something checks it, and the cheapest thing to
// check it with is a type that does not exist at all — `step.start` was exactly
// this case for a while, and it reached the office through an unchanged bus.
test('an unknown event type is relayed, not rejected — §11 forward compatibility', () => {
  const bus = createAopBus();
  assert.equal(bus.accept(ev('step.start', 'S1', { payload: { step_id: 's1' } })), true);
  assert.equal(bus.accept(ev('nothing.like.this', 'S1')), true);
  const { events } = bus.replay({});
  assert.deepEqual(events.map((e) => e.type), ['step.start', 'nothing.like.this']);
  assert.equal(events[0].payload.step_id, 's1', 'payload rides through untouched');
});

test('a retrying adapter cannot double-dispatch: ids are deduplicated', () => {
  const bus = createAopBus();
  const e = { ...ev('session.start', 'S1'), id: 'once' };
  assert.equal(bus.accept(e), true);
  assert.equal(bus.accept({ ...e }), false);
});

test('replay filters by harness and resumes after a cursor', () => {
  const bus = createAopBus();
  bus.accept(ev('session.start', 'S1'));
  bus.accept({ ...ev('session.start', 'R1'), harness: { name: 'rovo-cli' } });
  bus.accept(ev('turn.start', 'S1', { payload: { title: 'work' } }));

  const all = bus.replay({});
  assert.equal(all.events.length, 3);

  const claude = bus.replay({ harness: 'claude-code' });
  assert.deepEqual(claude.events.map((e) => e.session.id), ['S1', 'S1']);

  const later = bus.replay({ harness: 'claude-code', after: String(all.cursor - 1) });
  assert.deepEqual(later.events.map((e) => e.type), ['turn.start']);
});

test('the ring holds 2000 events and lets the oldest go', () => {
  const bus = createAopBus();
  for (let i = 0; i < 2100; i++) {
    bus.accept(ev('session.heartbeat', `S${i}`));
  }
  const { events } = bus.replay({});
  assert.equal(events.length, 2000);
  assert.equal(events[0].session.id, 'S100', 'the first hundred aged out');
});

test('events get a timestamp if their adapter sent none', () => {
  const bus = createAopBus();
  bus.accept(ev('session.start', 'S1'));
  const { events } = bus.replay({});
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T/);
});
