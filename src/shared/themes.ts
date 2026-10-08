import { colorToHsl, hslToString } from './color';

export type PresetId = 'oled' | 'carbon' | 'midnight' | 'graphite' | 'forest' | 'eclipse';
export type ThemeId = 'auto' | PresetId;

/**
 * Everything the engine needs to darken a page. There are deliberately no
 * user-facing knobs: each preset bakes in its own contrast, tint and media treatment.
 */
export interface Palette {
  /** Stable identity, used to skip redundant re-renders. */
  key: string;
  background: string;
  text: string;
  link: string;
  visited: string;
  selection: string;
  /** Neutral greys on the page pick up this hue/saturation. */
  tintHue: number;
  tintSat: number;
  /** How much lighter (HSL lightness) the most elevated surfaces may get above `background`. */
  surfaceRange: number;
  images: { brightness: number; contrast: number };
  video: number;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
}

/*
 * Tuned for long, low-strain sessions: warm off-white text at ~9–12:1 contrast (never pure
 * white), muted link colours, no contrast boost on images, and a gentle dim on media.
 */
export const PRESETS: Record<PresetId, Palette> = {
  oled: {
    key: 'oled',
    background: '#000000',
    text: '#c9c6c0',
    link: '#8aa9d6',
    visited: '#a99bd0',
    selection: '#2a3a52',
    tintHue: 0,
    tintSat: 0,
    surfaceRange: 0.12,
    images: { brightness: 0.8, contrast: 1 },
    video: 0.9,
  },
  carbon: {
    key: 'carbon',
    background: '#161616',
    text: '#cfccc6',
    link: '#8fadd9',
    visited: '#ad9fd4',
    selection: '#34404f',
    tintHue: 40,
    tintSat: 0.03,
    surfaceRange: 0.14,
    images: { brightness: 0.86, contrast: 1 },
    video: 0.95,
  },
  midnight: {
    key: 'midnight',
    background: '#111723',
    text: '#c8cfda',
    link: '#86a5d9',
    visited: '#a597d6',
    selection: '#283a5a',
    tintHue: 220,
    tintSat: 0.3,
    surfaceRange: 0.13,
    images: { brightness: 0.85, contrast: 1 },
    video: 0.95,
  },
  graphite: {
    key: 'graphite',
    background: '#1f2022',
    text: '#bfbdb8',
    link: '#94aacd',
    visited: '#aea2c9',
    selection: '#3e4148',
    tintHue: 40,
    tintSat: 0.03,
    surfaceRange: 0.13,
    images: { brightness: 0.88, contrast: 1 },
    video: 1,
  },
  forest: {
    key: 'forest',
    background: '#101814',
    text: '#c3cfc6',
    link: '#7fbf9c',
    visited: '#a9bf86',
    selection: '#22402f',
    tintHue: 148,
    tintSat: 0.25,
    surfaceRange: 0.12,
    images: { brightness: 0.86, contrast: 1 },
    video: 0.95,
  },
  eclipse: {
    key: 'eclipse',
    background: '#15131b',
    text: '#cdc6d6',
    link: '#a99ad8',
    visited: '#cf9bbd',
    selection: '#3a3054',
    tintHue: 262,
    tintSat: 0.22,
    surfaceRange: 0.13,
    images: { brightness: 0.86, contrast: 1 },
    video: 0.95,
  },
};

export const THEMES: ThemeMeta[] = [
  { id: 'auto', name: 'Auto', blurb: 'Adapts to each site' },
  { id: 'oled', name: 'OLED Black', blurb: 'True black, dimmed text' },
  { id: 'carbon', name: 'Carbon', blurb: 'Warm neutral charcoal' },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep navy blue' },
  { id: 'graphite', name: 'Graphite', blurb: 'Softest contrast, least glare' },
  { id: 'forest', name: 'Forest', blurb: 'Calm evergreen' },
  { id: 'eclipse', name: 'Eclipse', blurb: 'Dusky violet' },
];

/** What Auto learned about a site, measured against the page's original colours. */
export interface SiteAnalysis {
  /** The site already ships a dark design (Auto softens it rather than re-darkening it). */
  nativeDark: boolean;
  /** Dominant brand hue, if the site has a clear one. */
  accentHue: number | null;
  /** The page is dominated by photos/media, so dim them less. */
  imageHeavy: boolean;
  /** Long-form reading page (articles, docs) — use softer, warmer contrast. */
  textHeavy: boolean;
  analyzedAt: number;
}

/** Builds a palette tailored to a site from its analysis. */
export function buildAutoPalette(a: SiteAnalysis | null): Palette {
  const hue = a?.accentHue ?? null;
  const reading = a?.textHeavy ?? false;
  // No brand hue: a faint warm tint, which is easier on the eyes than cold grey.
  const tintHue = hue ?? 40;
  const tintSat = hue === null ? 0.03 : 0.12;
  const linkHue = hue === null || isHarshLinkHue(hue) ? 214 : hue;
  return {
    key: `auto:${hue === null ? 'n' : Math.round(hue)}:${a?.imageHeavy ? 'i' : ''}${reading ? 'r' : ''}`,
    background: hslToString({ h: tintHue, s: tintSat, l: reading ? 0.12 : 0.1, a: 1 }),
    text: hslToString({ h: hue === null ? 40 : tintHue, s: hue === null ? 0.06 : tintSat * 0.5, l: reading ? 0.78 : 0.8, a: 1 }),
    link: hslToString({ h: linkHue, s: 0.5, l: 0.7, a: 1 }),
    visited: hslToString({ h: (linkHue + 50) % 360, s: 0.38, l: 0.72, a: 1 }),
    selection: hslToString({ h: linkHue, s: 0.3, l: 0.28, a: 1 }),
    tintHue,
    tintSat,
    surfaceRange: 0.13,
    images: a?.imageHeavy ? { brightness: 0.92, contrast: 1 } : { brightness: 0.86, contrast: 1 },
    video: 0.95,
  };
}

/** Reds and yellows read as warnings when used for every link; fall back to blue. */
function isHarshLinkHue(h: number) {
  return h < 25 || h > 335 || (h > 45 && h < 70);
}

/** Colours used by the popup's mini previews. */
export function previewColors(p: Palette) {
  const bg = colorToHsl(p.background);
  return {
    background: p.background,
    surface: hslToString({ ...bg, l: Math.min(1, bg.l + p.surfaceRange * 0.55) }),
    border: hslToString({ ...bg, l: Math.min(1, bg.l + p.surfaceRange * 0.9) }),
    text: p.text,
    link: p.link,
  };
}
