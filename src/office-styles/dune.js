// An earthen courtyard studio: deep shade, warm clay and pale sculpted plaster.
export const building = {
  label: 'Dune Atelier',
  subtitle: 'Earth walls, shaded alleys and desert light',
  storeysBelow: 0,
  plinth: false,
  entrance: 'stoop',
  lowerWalls: 'solid',
  serviceYard: false,
  elevation: 'ground',
  outside: 'dune-courtyard',
  palette: {},
};

export const theme = {
  label: 'Dune Atelier · clay and sunlight',
  floor: { kind: 'terracotta' },
  season: 'summer',
  building: 'dune',
  sky: 0xe9d4b6,
  light: {
    hemi: { sky: 0xffedd0, ground: 0xaf6542, intensity: .54 },
    fill: { color: 0xffdeb0, intensity: .24, position: [19, 13, 16] },
  },
  fittings: { cols: 3, rows: 2, colour: 0xffcc87, intensity: 47, poolRadius: 6.5, poolOpacity: .20 },
  palette: {
    wallWhite: 0xe4cda5, wallSage: 0xe4cda5, baseboard: 0xbe865c,
    frame: 0x71523c, glass: 0xc6c3a2, woodDark: 0x74462f,
    woodMid: 0xb07843, floorWood: 0xb76a46, floorWoodAlt: 0xa95f3d,
    rugSage: 0xc49066, couch: 0xb64e35, terracotta: 0xb76c48,
    houseLeaf: 0x788c54, houseLeafDark: 0x526941, houseLeafLight: 0xa4ae75,
    leaf: 0x84926b, leafDark: 0x5f744f, pot: 0xc89467,
    metalDark: 0x493c31, mailbox: 0x986641,
  },
};
