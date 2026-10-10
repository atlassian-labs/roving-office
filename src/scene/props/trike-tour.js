import * as THREE from 'three';
import { ROOM } from '../../config.js';
import { obstacleFootprints, stationsOfKind } from '../../layout.js';
import { NavGrid } from '../../agents/pathfinding.js';

const BERTH = 1.5; // Clears the whole trike even while turning, not just its rider.
const SPEED = 0.85;

/** Resolve live handles: the editor can add the cart after the world was built. */
export function updateTrikeTours(props, dt, options) {
  for (const station of stationsOfKind('happyHourTrike')) props.byStation?.[station.id]?.update(dt, options);
}

/** A wide-berth indoor tour, with a stationary rendezvous for each drink request. */
export function createTrikeTour(obj, refreshments) {
  let nav, signature, route = [], nextStop = 0;
  const reservations = new Map();
  let stopFor = 0;
  let editing = false;
  let lastPosition = obj.position.clone();
  let footprints = [];
  const clearAt = (point, heading) => {
    const hw = Math.abs(Math.cos(heading)) * .7 + Math.abs(Math.sin(heading)) * 1.25;
    const hd = Math.abs(Math.sin(heading)) * .7 + Math.abs(Math.cos(heading)) * 1.25;
    return point.x - hw > 0 && point.x + hw < ROOM.W && point.z - hd > 0 && point.z + hd < ROOM.D
      && !footprints.some((f) => point.x + hw > f.x0 && point.x - hw < f.x1
        && point.z + hd > f.z0 && point.z - hd < f.z1);
  };

  const refresh = () => {
    const spec = obj.userData.movable?.spec;
    if (!spec) return false;
    footprints = obstacleFootprints().filter((f) => !f.soft && f.role !== 'stand' && f.key !== `station:${spec.id}`);
    const key = JSON.stringify([spec.x, spec.z, spec.facing, footprints]);
    if (key === signature) return true;
    signature = key;
    nav = new NavGrid();
    nav.blocked.fill(0);
    nav.furniture.fill(0);
    nav.tight.fill(0);
    nav.block(0, -4, ROOM.W, BERTH);
    nav.block(0, -4, BERTH, ROOM.D);
    nav.block(ROOM.W - BERTH, -4, ROOM.W, ROOM.D);
    nav.block(0, ROOM.D - BERTH, ROOM.W, ROOM.D);
    for (const f of footprints) nav.block(f.x0 - BERTH, f.z0 - BERTH, f.x1 + BERTH, f.z1 + BERTH);
    route = [];
    return true;
  };

  const chooseRoute = () => {
    if (!nav.walkableAt(obj.position.x, obj.position.z)) {
      // Leave a tight parking bay straight ahead/back before trying to turn.
      // nearestFree alone can connect across a desk corner from such a bay.
      for (const sign of [1, -1]) {
        for (let distance = .25; distance <= 8; distance += .25) {
          const point = obj.position.clone();
          point.x += Math.sin(obj.rotation.y) * distance * sign;
          point.z += Math.cos(obj.rotation.y) * distance * sign;
          if (!clearAt(point, obj.rotation.y)) break;
          if (nav.walkableAt(point.x, point.z)) { route = [point]; return; }
        }
      }
      return;
    }
    // Deterministic stops around the room; A* routes around the current furniture.
    const stops = [
      [ROOM.W * .25, ROOM.D * .75], [ROOM.W * .75, ROOM.D * .75],
      [ROOM.W * .75, ROOM.D * .25], [ROOM.W * .25, ROOM.D * .25],
    ];
    for (let attempt = 0; attempt < stops.length; attempt++) {
      const [x, z] = stops[nextStop++ % stops.length];
      const [cx, cz] = nav.nearestFree(x, z);
      const goal = nav.cellToWorld(cx, cz);
      if (goal.distanceTo(obj.position) < 1) continue;
      const candidate = nav.findPath(obj.position, goal);
      if (candidate?.length) { route = candidate; return; }
    }
    // A tightly furnished room may split the wide lanes. Tour the reachable
    // part rather than repeatedly trying a destination behind a narrow aisle.
    const reachable = nav.reachableFrom(obj.position);
    let farthest, distance = 1;
    for (let i = 0; i < reachable.length; i++) {
      if (!reachable[i]) continue;
      const point = nav.cellToWorld(i % nav.cols, Math.floor(i / nav.cols));
      const d = point.distanceToSquared(obj.position);
      if (d > distance) { farthest = point; distance = d; }
    }
    if (farthest) route = nav.findPath(obj.position, farthest) ?? [];
  };

  const serviceStation = (station) => {
    // Find accessible standing room beside the cart, never at its old parking spot.
    const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((angle) => ({
      x: obj.position.x + Math.sin(angle) * 1.85,
      z: obj.position.z + Math.cos(angle) * 1.85,
    }));
    const agentNav = new NavGrid();
    const approach = candidates.find((p) => agentNav.walkableAt(p.x, p.z));
    if (!approach) return null;
    return { ...station, x: obj.position.x, z: obj.position.z, approach,
      lookRotation: Math.atan2(obj.position.x - approach.x, obj.position.z - approach.z) };
  };

  return {
    serviceStation,
    reserve(station, agentId) {
      const rendezvous = serviceStation(station);
      if (!rendezvous) return null;
      reservations.set(agentId, { remaining: 60, walking: false });
      return rendezvous;
    },
    release(agentId) { reservations.delete(agentId); stopFor = 1; },
    update(dt, { paused = false, agents = null } = {}) {
      refreshments.update(dt);
      if (!refresh() || !refreshments.canServe) return;
      // Editor placement is authoritative; dragging must never fight a touring prop.
      if (paused) { editing = true; route = []; return; }
      if (editing) { editing = false; signature = null; refresh(); }
      if (lastPosition.distanceTo(obj.position) > .1) route = [];
      for (const [id, lease] of reservations) {
        const customer = agents?.find((agent) => agent.id === id);
        lease.walking ||= customer?.status === 'walking';
        if (lease.remaining <= dt || (agents && (!customer || (lease.walking && customer.status !== 'walking')))) reservations.delete(id);
        else lease.remaining -= dt;
      }
      stopFor = Math.max(0, stopFor - dt);
      if (reservations.size || stopFor > 0) return;
      if (!route.length) chooseRoute();
      const target = route[0];
      if (!target) return;
      const direction = new THREE.Vector3().subVectors(target, obj.position);
      direction.y = 0;
      const distance = direction.length();
      const step = Math.min(distance, SPEED * dt);
      const next = obj.position.clone().addScaledVector(direction.normalize(), step);
      // A freshly placed cart can fit beside a desk without room to turn yet.
      // Keep its placed heading until it has reached the wider touring lane.
      let angle = nav.walkableAt(obj.position.x, obj.position.z)
        ? Math.atan2(direction.x, direction.z) : obj.rotation.y;
      if (!clearAt(next, angle)) angle = obj.rotation.y;
      if (!clearAt(next, angle)) return;
      // Yield to pedestrians rather than driving the refreshments through them.
      // Use the oriented cart, not a turning-radius circle: a seated colleague
      // beside the aisle must not permanently park a cart that can pass them.
      const hw = Math.abs(Math.cos(angle)) * .7 + Math.abs(Math.sin(angle)) * 1.25 + .45;
      const hd = Math.abs(Math.sin(angle)) * .7 + Math.abs(Math.cos(angle)) * 1.25 + .45;
      if (agents?.some((agent) => Math.abs(agent.position.x - next.x) < hw && Math.abs(agent.position.z - next.z) < hd)) return;
      obj.position.copy(next);
      lastPosition.copy(next);
      if (distance > .01) obj.rotation.y = angle;
      if (step > 0) obj.userData.pedal(dt);
      if (distance <= step + .01) {
        route.shift();
        if (!route.length) stopFor = 2;
      }
    },
  };
}
