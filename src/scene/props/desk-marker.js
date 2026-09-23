import * as THREE from 'three';

/** A blank nameplate attached to the lifting surface in desk-local coordinates. */
export function buildDeskMarker({ topY, x, z }) {
  const root = new THREE.Group();
  root.name = 'desk-marker:nameplate';
  root.position.set(x, topY, z);
  // Turn the complete holder and card on the tabletop, toward the keyboard.
  root.rotation.y = Math.PI / 6;
  root.visible = false;
  // Own materials: recolouring one desk must never repaint another. A little self-fill
  // preserves the identity colour in evening shade without casting light on the room.
  const colour = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: .62, emissive: 0xffffff, emissiveIntensity: .12,
  });
  const neutral = new THREE.MeshStandardMaterial({ color: 0xd9d6c8, roughness: .82 });
  const holder = new THREE.Mesh(new THREE.BoxGeometry(.70, .045, .25), neutral);
  holder.position.y = .025;
  root.add(holder);
  const card = new THREE.Mesh(new THREE.BoxGeometry(.62, .21, .055), colour);
  card.position.y = .145;
  card.rotation.x = -.22;
  root.add(card);

  return {
    id: 'nameplate', label: 'Blank nameplate', root, colour,
    setAssignment(agent) {
      root.visible = !!agent;
      if (agent) {
        colour.color.setHex(agent.color);
        colour.emissive.setHex(agent.color);
      }
    },
  };
}
