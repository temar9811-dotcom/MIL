// MIL groups v3 - corrected rosters (Rook + HICs are cyno-capable)
const CAPITALS = [
  // Carriers
  'Archon', 'Aeon', 'Chimera', 'Nidhoggur', 'Thanatos', 'Wyvern',
  // Dreads
  'Moros', 'Phoenix', 'Revelation', 'Naglfar',
  // Force auxiliaries
  'Apostle', 'Guardian', 'Confessor', 'Deacon',
  // Titans
  'Avatar', 'Erebus', 'Leviathan', 'Ragnarok',
  // Supers
  'Nyx', 'Hel', 'Vanquisher', 'Subjugator',
];

const BLOPS = ['Redeemer', 'Widow', 'Sin', 'Panther'];

const COVOPS = ['Anathema', 'Buzzard', 'Cheetah', 'Helios'];
const RECONS = ['Pilgrim', 'Falcon', 'Arazu', 'Rapier'];
const FORCE_RECONS = ['Huginn', 'Lachesis', 'Curse', 'Rook'];
const HICS = ['Onyx', 'Phobos', 'Devoter', 'Broadsword'];
const INTERDICTORS = ['Sabre', 'Eris', 'Flycatcher', 'Heretic'];

const GROUPS = [
  {
    id: 'cynos',
    label: 'Cynos (covops / recon / force recon / HIC)',
    color: '#22d3ee',
    ships: [...COVOPS, ...RECONS, ...FORCE_RECONS, ...HICS],
  },
  {
    id: 'cyno',
    label: 'Cyno-capable (capitals + blops)',
    color: '#c084fc',
    ships: [...CAPITALS, ...BLOPS],
  },
  {
    id: 'dictors',
    label: 'Dictors (interdictors + HIC)',
    color: '#fb923c',
    ships: [...INTERDICTORS, ...HICS],
  },
  {
    id: 'capitals',
    label: 'Capitals only',
    color: '#f472b6',
    ships: CAPITALS,
  },
];

module.exports = { GROUPS };