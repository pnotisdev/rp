/**
 * The stand-in scene art VN mode paints when a background id has no uploaded image — most installs,
 * most of the time. This used to be a hash of the id into a random hue, which is why an unplaced
 * scene rendered as a flat violet slab and a placed one as an arbitrary colour with no relationship
 * to the room it was standing in. Each family below is instead a hand-picked light/sky/ground triple
 * that reads as the *kind* of place: a warm afternoon classroom, a fluorescent convenience store, a
 * dim theatre. Not art, but a believable lighting environment for a sprite to stand in.
 */

interface ScenePalette {
  /** Upper field — sky outdoors, far wall/ceiling indoors. */
  sky: string
  /** Lower field — ground, floor, or desk plane. */
  ground: string
  /** The scene's light source, bloomed in as a soft radial. */
  light: string
  /** Where that light sits, as a `radial-gradient` position. Defaults to a high centre. */
  lightPos?: string
  /** Overrides applied when the world clock says night (`calendar.ts`'s `isNightPhase`). */
  night?: Partial<ScenePalette>
}

const NEUTRAL: ScenePalette = {
  sky: '#2b3040',
  ground: '#171a24',
  light: 'rgb(150 165 200 / 0.30)',
  night: { sky: '#1b1f2c', ground: '#0e1018', light: 'rgb(120 135 175 / 0.22)' },
}

/** Lighting environments, shared by every location that lives in one. */
const PALETTES: Record<string, ScenePalette> = {
  // Warm daylight interiors — windows down one wall, late-afternoon slant.
  'classroom-light': {
    sky: '#c9b48f',
    ground: '#5d4a35',
    light: 'rgb(255 226 170 / 0.55)',
    lightPos: 'ellipse 70% 60% at 78% 22%',
    night: { sky: '#3a3547', ground: '#1d1a26', light: 'rgb(150 160 210 / 0.28)' },
  },
  // Cool, low-light institutional interiors — corridors, stairwells, gyms.
  'hall-light': {
    sky: '#8f9bab',
    ground: '#39414e',
    light: 'rgb(216 232 255 / 0.40)',
    lightPos: 'ellipse 60% 70% at 50% 12%',
    night: { sky: '#2f3746', ground: '#151a22', light: 'rgb(150 175 215 / 0.24)' },
  },
  // Deep wood and paper — libraries, club rooms, studies.
  'wood-light': {
    sky: '#8a6a48',
    ground: '#33241a',
    light: 'rgb(255 214 150 / 0.42)',
    lightPos: 'ellipse 65% 55% at 26% 20%',
    night: { sky: '#3b2c21', ground: '#170f0b', light: 'rgb(230 175 110 / 0.30)' },
  },
  // Open daytime sky over green.
  'outdoor-day': {
    sky: '#8fc4e8',
    ground: '#4d6b45',
    light: 'rgb(255 248 220 / 0.55)',
    lightPos: 'ellipse 70% 55% at 62% 14%',
    night: { sky: '#1f2a44', ground: '#161e1c', light: 'rgb(170 195 255 / 0.24)' },
  },
  // Golden hour — rooftops, the walk home, anything the sun is leaving.
  'sunset-light': {
    sky: '#e8a06a',
    ground: '#3f2c3d',
    light: 'rgb(255 196 130 / 0.65)',
    lightPos: 'ellipse 80% 60% at 72% 28%',
    night: { sky: '#2c2740', ground: '#161320', light: 'rgb(170 160 235 / 0.28)' },
  },
  // Water and pale sand.
  'beach-light': {
    sky: '#8fd0e0',
    ground: '#d8c39b',
    light: 'rgb(255 252 232 / 0.60)',
    lightPos: 'ellipse 75% 55% at 55% 16%',
    night: { sky: '#1d2c40', ground: '#3b3a3c', light: 'rgb(180 205 255 / 0.26)' },
  },
  // Dense canopy — little sky, filtered green light.
  'forest-light': {
    sky: '#5d7a4a',
    ground: '#22301f',
    light: 'rgb(214 255 180 / 0.38)',
    lightPos: 'ellipse 55% 60% at 40% 10%',
    night: { sky: '#1e2a1e', ground: '#0d130d', light: 'rgb(150 195 160 / 0.20)' },
  },
  // Vermilion and moss.
  'shrine-light': {
    sky: '#b8734f',
    ground: '#3d4432',
    light: 'rgb(255 214 168 / 0.45)',
    lightPos: 'ellipse 65% 60% at 50% 18%',
    night: { sky: '#3a2430', ground: '#171b18', light: 'rgb(255 160 120 / 0.30)' },
  },
  // Night with lanterns/fireworks in it — never actually a daytime scene.
  'night-festival': {
    sky: '#2a2450',
    ground: '#1a1428',
    light: 'rgb(255 180 120 / 0.42)',
    lightPos: 'ellipse 75% 60% at 50% 26%',
  },
  // Warm domestic interior.
  'home-light': {
    sky: '#c4a284',
    ground: '#4a3a30',
    light: 'rgb(255 220 175 / 0.48)',
    lightPos: 'ellipse 65% 55% at 30% 22%',
    night: { sky: '#3c3038', ground: '#1a1518', light: 'rgb(255 190 140 / 0.30)' },
  },
  // Soft, low, private — bedrooms.
  'bedroom-light': {
    sky: '#b48c96',
    ground: '#3e2e36',
    light: 'rgb(255 206 200 / 0.42)',
    lightPos: 'ellipse 60% 55% at 70% 24%',
    night: { sky: '#332a3c', ground: '#16121b', light: 'rgb(210 170 235 / 0.28)' },
  },
  // Roasted brown and low pendant light.
  'cafe-light': {
    sky: '#a5764f',
    ground: '#34241b',
    light: 'rgb(255 206 150 / 0.50)',
    lightPos: 'ellipse 60% 50% at 40% 20%',
    night: { sky: '#3d2a22', ground: '#170f0c', light: 'rgb(255 186 120 / 0.34)' },
  },
  // Flat fluorescent — konbini, stations, anywhere lit from a ceiling grid.
  'fluorescent-light': {
    sky: '#d3e2e6',
    ground: '#6c7880',
    light: 'rgb(240 255 255 / 0.55)',
    lightPos: 'ellipse 90% 55% at 50% 8%',
    night: { sky: '#9fb2ba', ground: '#3c464e', light: 'rgb(225 245 250 / 0.45)' },
  },
  // Clinical, drained of warmth.
  'clinical-light': {
    sky: '#dfe6e4',
    ground: '#8d9a99',
    light: 'rgb(250 255 253 / 0.55)',
    lightPos: 'ellipse 85% 55% at 50% 10%',
    night: { sky: '#8d9c9e', ground: '#39454a', light: 'rgb(215 235 235 / 0.40)' },
  },
  // Steam and stone.
  'steam-light': {
    sky: '#b8c4bd',
    ground: '#4f5852',
    light: 'rgb(255 255 250 / 0.48)',
    lightPos: 'ellipse 70% 60% at 50% 30%',
    night: { sky: '#39463f', ground: '#1a201d', light: 'rgb(215 235 225 / 0.30)' },
  },
  // Dark rooms lit by a screen or a neon strip.
  'dark-room': {
    sky: '#2d2340',
    ground: '#140f1e',
    light: 'rgb(160 130 255 / 0.35)',
    lightPos: 'ellipse 80% 55% at 50% 22%',
  },
}

/** Every background id in `backgrounds.ts`, mapped to the lighting environment it lives in. */
const BACKGROUND_PALETTE: Record<string, string> = {
  classroom: 'classroom-light',
  'school-hallway': 'hall-light',
  'school-rooftop': 'sunset-light',
  'school-gate': 'outdoor-day',
  'school-courtyard': 'outdoor-day',
  library: 'wood-light',
  'club-room': 'wood-light',
  gymnasium: 'hall-light',
  'school-nurse-office': 'clinical-light',
  cafeteria: 'hall-light',
  'city-street': 'fluorescent-light',
  'train-station': 'fluorescent-light',
  'convenience-store': 'fluorescent-light',
  restaurant: 'cafe-light',
  cafe: 'cafe-light',
  karaoke: 'dark-room',
  'movie-theater': 'dark-room',
  hospital: 'clinical-light',
  rooftop: 'sunset-light',
  park: 'outdoor-day',
  forest: 'forest-light',
  beach: 'beach-light',
  shrine: 'shrine-light',
  onsen: 'steam-light',
  festival: 'night-festival',
  'fireworks-viewing': 'night-festival',
  'living-room': 'home-light',
  bedroom: 'bedroom-light',
  kitchen: 'home-light',
  shower: 'steam-light',
  office: 'fluorescent-light',
}

/** Resolves a background id to its palette, applying the night overrides when the world clock is dark. A world's own custom background id has no authored palette, so it falls back to the neutral one rather than a random hue. */
function paletteFor(tag: string | undefined, night: boolean): ScenePalette {
  const family = tag ? BACKGROUND_PALETTE[tag] : undefined
  const base = (family && PALETTES[family]) || NEUTRAL
  return night && base.night ? { ...base, ...base.night } : base
}

/**
 * A layered CSS `background` standing in for a real photo: the light source bloomed over a
 * sky/ground split, with a soft horizon band where the two meet so a sprite has something to
 * stand on rather than floating in a flat wash.
 */
export function sceneGradient(tag?: string, options?: { night?: boolean }): string {
  const p = paletteFor(tag, !!options?.night)
  return [
    `radial-gradient(${p.lightPos ?? 'ellipse 70% 55% at 50% 15%'}, ${p.light}, transparent 70%)`,
    // The horizon: a narrow darkening right where the two fields meet, which is what makes the
    // split read as a room/landscape instead of a two-stop gradient.
    'linear-gradient(to bottom, transparent 52%, rgb(0 0 0 / 0.22) 62%, transparent 74%)',
    `linear-gradient(to bottom, ${p.sky} 0%, ${p.sky} 38%, ${p.ground} 72%, ${p.ground} 100%)`,
  ].join(', ')
}

/** @deprecated The old name for `sceneGradient` — new code should call that directly. */
export const placeholderGradient = sceneGradient
