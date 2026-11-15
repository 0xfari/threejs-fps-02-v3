// Zenith Observatory: a night look plan. Six values and one accent hue; the
// lighting makes every shade the game needs, so no other colour appears in code.
// The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0a1120', // night sky / fog
  surface: '#1c2739', // concrete and steel, light enough to read at night
  hairline: '#33445e', // crates, trim
  ink: '#e9eff8', // cold off-white
  muted: '#8fa3bd', // dust and distant walls
  accent: '#58e6c8', // aurora teal: sites, tracers, CTAs
  ally: '#8fb8ff', // friendly markers and tracers
  enemy: '#ff5340', // hostile markers
};

export function shade(name) {
  return PALETTE[name];
}
