// Quiet, horizontal and precisely framed: the Japanese garden pavilion.
// Plain data keeps scene selection and server-side consumers free of Three.js.
export const building = {
  label: 'Lantern Court', storeysBelow: 0, plinth: false, entrance: 'stoop',
  subtitle: 'Dark timber overlooking a Japanese garden',
  lowerWalls: 'solid', serviceYard: false, elevation: 'ground',
  outside: 'lantern-garden', palette: {},
};

export const theme = {
  label: 'Lantern Court · paper and dark timber',
  floor: { kind: 'tatami' }, season: 'summer', building: 'lantern',
  fittings: { cols: 3, rows: 2, colour: 0xffd79c, intensity: 42, poolRadius: 6.3, poolOpacity: .18 },
  sky: 0xc7cbd0,
  light: {
    hemi: { sky: 0xe8e9e1, ground: 0x777e71, intensity: .66 },
    fill: { color: 0xf5e7cd, intensity: .25, position: [18, 12, 20] },
  },
  palette: {
    wallSage: 0x4a4239, wallWhite: 0xe4dcc6, baseboard: 0x39302b,
    frame: 0x332e2a, glass: 0xc4d3cd, woodDark: 0x392e26, woodMid: 0x75604b,
    floorWood: 0xc9bb8d, floorWoodAlt: 0xb9ad84,
    rugSage: 0xb9b493, couch: 0x495b67, terracotta: 0x825044, pot: 0x59594d,
    houseLeaf: 0x62785d, houseLeafDark: 0x3c5b47, houseLeafLight: 0x92a178,
    metalDark: 0x343a3d, mailbox: 0x53636b,
  },
};
