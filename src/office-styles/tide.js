// Tide Wharf is deliberately cool and horizontal: ash, linen, ink and open water.
// Plain data keeps theme selection independent of three.js and the renderer.
export const building = {
  label: 'Tide Wharf',
  subtitle: 'An airy studio on a working harbour',
  storeysBelow: 0,
  plinth: false,
  entrance: 'stoop',
  lowerWalls: 'solid',
  serviceYard: false,
  elevation: 'ground',
  outside: 'tide-harbour',
  palette: {},
};

export const theme = {
  label: 'Tide Wharf · ash and harbour blue',
  floor: { kind: 'ash' },
  season: 'summer',
  building: 'tide',
  sky: 0xb9d9e4,
  light: {
    hemi: { sky: 0xd8efff, ground: 0x889ca6, intensity: .66 },
    fill: { color: 0xf0f4f2, intensity: .27, position: [20, 13, 17] },
  },
  fittings: { cols: 3, rows: 2, colour: 0xffdfb1, intensity: 48, poolRadius: 6.6, poolOpacity: .15 },
  palette: {
    wallSage: 0x7f9daa, wallWhite: 0xe5e6da, baseboard: 0x344b57,
    frame: 0x273f4c, glass: 0xc6e4e9, woodDark: 0x655d4c,
    woodMid: 0xc4b79a, rugSage: 0x7397aa, couch: 0x597f91,
    terracotta: 0xbc7968, floorWood: 0xd9d1bc, floorWoodAlt: 0xcac4b2,
  },
};
