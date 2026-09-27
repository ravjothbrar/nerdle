// Colour palettes. "classic" mirrors nerdlegame.com (plum + teal on white);
// "mathlete" mirrors Nerdle's mathlete spin-off (navy + hot magenta).

export const THEMES = {
  classic: {
    name: 'classic',
    accent: '#7A1F4B', // nerdle plum
    correct: '#4E9E8E', // nerdle teal
    wrong: '#7A1F4B',
    // runner scene
    skyTop: '#1d0a17',
    skyBottom: '#4b1839',
    horizonGlow: 'rgba(222, 120, 176, 0.35)',
    ground: '#180812',
    trackTile: '#34122b',
    trackTileEdge: '#4d1c3f',
    rail: '#8f3a6a',
    laneLine: 'rgba(255, 214, 236, 0.18)',
    floaters: 'rgba(255, 200, 230, 0.10)',
    signTile: '#ffffff',
    signTileEdge: '#d7c2cf',
    signText: '#2a0f22',
    signBoard: 'rgba(20, 6, 16, 0.55)',
    post: '#6d2a55',
    obstacle: '#161803', // nerdle "not in solution" black
    obstacleEdge: '#3a3c2a',
    obstacleText: '#ffffff',
    hazard: '#f3c14b',
    shadow: 'rgba(0,0,0,0.35)',
  },
  mathlete: {
    name: 'mathlete',
    accent: '#c8447a',
    correct: '#4E9E8E',
    wrong: '#c8447a',
    skyTop: '#101019',
    skyBottom: '#252538',
    horizonGlow: 'rgba(200, 68, 122, 0.30)',
    ground: '#0d0d15',
    trackTile: '#20202f',
    trackTileEdge: '#2f2f45',
    rail: '#c8447a',
    laneLine: 'rgba(200, 68, 122, 0.30)',
    floaters: 'rgba(200, 68, 122, 0.12)',
    signTile: '#2c2c42',
    signTileEdge: '#4a4a68',
    signText: '#f4f4fb',
    signBoard: 'rgba(0, 0, 0, 0.45)',
    post: '#3c3c58',
    obstacle: '#0b0b12',
    obstacleEdge: '#c8447a',
    obstacleText: '#ffffff',
    hazard: '#ffcf5a',
    shadow: 'rgba(0,0,0,0.45)',
  },
};
