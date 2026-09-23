import test from 'node:test';
import assert from 'node:assert/strict';

import { AopSource } from '../src/data/AopSource.js';

class FakeEventSource {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, event) {
    this.listeners.get(type)?.({
      data: JSON.stringify(event),
      lastEventId: String(event.seq),
    });
  }

  close() {}
}

function envelope(type, seq, payload) {
  return {
    aop: '0.1',
    id: `event-${seq}`,
    seq,
    type,
    harness: { name: 'rovo-cli' },
    session: { id: 'session-1', kind: 'main' },
    payload,
  };
}

test('the live stream hears named step events, not only snapshot replay', () => {
  const stream = new FakeEventSource();
  const out = [];
  const source = new AopSource({
    harness: 'rovo-cli',
    eventSourceFactory: () => stream,
  });
  source.onEvent = (event) => out.push(event);
  source._subscribe();

  stream.emit('step.start', envelope('step.start', 1, {
    step_id: 'design',
    title: 'Design the standing desk',
    index: 2,
    of: 4,
  }));
  stream.emit('step.end', envelope('step.end', 2, {
    step_id: 'design',
    status: 'completed',
  }));

  assert.deepEqual(out.map((event) => event.type), ['spawn', 'step', 'step']);
  assert.equal(out[1].step.title, 'Design the standing desk');
  assert.equal(out[2].step, null);
  source.stop();
});

test('the live stream hears a mid-turn retitle', () => {
  // The same trap as the test above, and the reason both exist: every type is heard
  // through a listener of its own, so a type the reducer handles perfectly is still
  // invisible in the real app until it is named in `AOP_EVENT_TYPES`. Nothing but a
  // subscribe-and-emit test can tell the difference.
  const stream = new FakeEventSource();
  const out = [];
  const source = new AopSource({
    harness: 'rovo-cli',
    eventSourceFactory: () => stream,
  });
  source.onEvent = (event) => out.push(event);
  source._subscribe();

  stream.emit('turn.start', envelope('turn.start', 1, {
    turn_id: 'p1',
    title: 'Have a look at the standing desk and see what you think of it',
  }));
  stream.emit('turn.title', envelope('turn.title', 2, {
    turn_id: 'p1',
    title: 'Standing desk review',
  }));

  const retitle = out.find((event) => event.type === 'retitle');
  assert.ok(retitle, 'turn.title reached the reducer through its own listener');
  assert.equal(retitle.job, 'Standing desk review');
  assert.equal(retitle.from, 'Have a look at the standing desk and see what you think of it');
  source.stop();
});
