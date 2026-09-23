// Botanical silhouettes, collected into a handful of static instance batches.
// Leaves have a curved midrib and pointed tips; there are no transparent cards,
// per-leaf meshes, animation callbacks or extra lights.
import * as THREE from 'three';
import { seeded } from './outlooks/streetscape.js';

function leafGeometry() {
  const positions = [], indices = [];
  for (let row = 0; row <= 6; row++) {
    const t = row / 6, width = Math.sin(Math.PI * t) * .39;
    for (const side of [-1, 0, 1]) positions.push(side * width, t, Math.sin(Math.PI * t) * (side ? .05 : .19));
  }
  for (let row = 0; row < 6; row++) for (let col = 0; col < 2; col++) {
    const a = row * 3 + col;
    indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

export function planting(parent, { seed = 204, greens = [0x294a2b, 0x456638, 0x64834a, 0x91a45e], shadows = true } = {}) {
  const rand = seeded(seed), leaves = [], branches = [];
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  function leaf(x, y, z, size, azimuth, droop = .6, tone = null) {
    dummy.position.set(x, y, z); dummy.rotation.set(droop, azimuth, (rand() - .5) * .65);
    dummy.scale.set(size * (.75 + rand() * .4), size, size); dummy.updateMatrix();
    leaves.push({ matrix: dummy.matrix.clone(), tone: tone ?? greens[Math.floor(rand() * greens.length)] });
  }
  function branch(from, to, radius, tone = 0x776047) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    dummy.position.copy(a).add(b).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(up, delta.clone().normalize());
    dummy.scale.set(radius, delta.length(), radius); dummy.updateMatrix();
    branches.push({ matrix: dummy.matrix.clone(), tone });
  }
  function fern(x, y, z, size = 1, n = 7) {
    for (let f = 0; f < n; f++) {
      const angle = f / n * Math.PI * 2 + rand() * .3;
      let previous = [x, y, z];
      for (let j = 1; j <= 5; j++) {
        const t = j / 5, reach = size * t;
        const next = [x + Math.cos(angle) * reach, y + size * (.18 + Math.sin(t * Math.PI) * .38), z + Math.sin(angle) * reach];
        branch(previous, next, .012 * size, 0x4d6837);
        for (const side of [-1, 1]) leaf(...next, size * (.34 - t * .14), -angle + side * .7, 1.05);
        previous = next;
      }
    }
  }
  function vine(x, y, z, length = 2, angle = 0) {
    const steps = Math.ceil(length / .23);
    let previous = [x, y, z];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const next = [x + Math.sin(i * .75 + angle) * .13, y - t * length, z + Math.sin(i * .44) * .12];
      if (i) branch(previous, next, .012, 0x486139);
      leaf(...next, .30 + rand() * .20, angle + (i % 2 ? 1.25 : -1.25), 1.6 + rand() * .5);
      previous = next;
    }
  }
  function tree(x, y, z, height = 11, radius = 3.8, leafCount = 24) {
    const crown = [x + radius * .12, y + height * .70, z];
    branch([x, y, z], crown, height * .025);
    for (let arm = 0; arm < 8; arm++) {
      const a = arm * 2.399, r = radius * (.55 + rand() * .45);
      const end = [crown[0] + Math.cos(a) * r, y + height * (.70 + rand() * .24), z + Math.sin(a) * r];
      branch([x, y + height * (.38 + rand() * .2), z], end, height * .009);
      for (let k = 0; k < leafCount; k++) {
        const theta = rand() * Math.PI * 2, spread = Math.sqrt(rand()) * radius * .48;
        leaf(end[0] + Math.cos(theta) * spread, end[1] + (rand() - .5) * radius * .45,
          end[2] + Math.sin(theta) * spread, .65 + rand() * .7, rand() * Math.PI * 2, .8 + rand() * 1.25);
      }
    }
  }
  function finish() {
    for (const [name, items, geometry, material] of [
      ['canopy-leaves', leaves, leafGeometry(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })],
      ['canopy-branches', branches, new THREE.CylinderGeometry(.65, 1, 1, 5), new THREE.MeshLambertMaterial()],
    ]) {
      if (!items.length) { geometry.dispose(); material.dispose(); continue; }
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
      items.forEach((item, i) => { mesh.setMatrixAt(i, item.matrix); mesh.setColorAt(i, colour.setHex(item.tone)); });
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); parent.add(mesh);
    }
  }
  return { leaf, branch, fern, vine, tree, finish, rand };
}
