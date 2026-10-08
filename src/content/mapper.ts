import { colorToHsl, hslToRgb, luminance, parseColor, rgbToHsl, rgbToString, type HSLA, type RGBA } from '../shared/color';
import type { Palette } from '../shared/themes';

/** What a colour is used for decides how it gets darkened. */
export type Role = 'bg' | 'text' | 'border' | 'shadow';

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

/** HSL chroma: low for greys, and for near-white/near-black tints too. */
const chromaOf = ({ s, l }: HSLA) => s * (1 - Math.abs(2 * l - 1));

/** Greys, including the faintly tinted "slate"/"zinc" greys design systems use for text and surfaces. */
const isNeutral = (c: HSLA) => {
  const chroma = chromaOf(c);
  return chroma < 0.06 || (c.s < 0.32 && chroma < 0.16);
};

/** Saturation that yields `chroma` at lightness `l`. */
const satFor = (chroma: number, l: number) => clamp(chroma / Math.max(0.001, 1 - Math.abs(2 * l - 1)), 0, 1);

/**
 * Moves a colour's lightness until its *perceived* brightness (relative luminance) lands in
 * [min, max]. HSL lightness alone lies: a yellow or green at l=0.6 glows far brighter than a
 * blue at l=0.6, and those glowing accents are what tire the eyes on dark pages.
 */
function fitLuminance(c: HSLA, min: number, max: number): HSLA {
  const lum = luminance(hslToRgb(c));
  if (lum >= min && lum <= max) return c;
  const target = lum > max ? max : min;
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToRgb({ ...c, l: mid })) < target) lo = mid;
    else hi = mid;
  }
  return { ...c, l: (lo + hi) / 2 };
}

/** Perceived-brightness ceiling for coloured fills (≈ a #383838 grey): deep, never vivid. */
const MAX_FILL_LUM = 0.04;
/** Coloured borders: visible structure, no neon outlines. */
const MAX_BORDER_LUM = 0.09;

/**
 * Maps a colour to its dark-theme counterpart for a palette. Tuned for long sessions:
 * text sits around 9–12:1 contrast rather than the 18–21:1 of white-on-black (which causes
 * halation), and nothing coloured is ever brighter than body text.
 *
 * - Backgrounds: white → palette background, light greys → slightly raised surfaces,
 *   colourful fills keep their hue but become deep and muted.
 * - Text: dark → light; already-light text is pulled down to the palette's text level;
 *   coloured text keeps its hue, desaturated and luminance-capped.
 * - Borders: sit just above surfaces so structure stays visible without glare.
 * - Shadows: stay dark; glows become shadows.
 *
 * Works on already-dark pages too: their colours land in the same comfortable ranges.
 */
export class ColorMapper {
  private readonly bgL: number;
  private readonly textL: number;
  private readonly textLum: number;
  private readonly range: number;
  private readonly tintH: number;
  private readonly tintS: number;
  private readonly cache = new Map<string, string | null>();

  constructor(readonly palette: Palette) {
    this.bgL = colorToHsl(palette.background).l;
    this.textL = colorToHsl(palette.text).l;
    this.textLum = luminance(parseColor(palette.text) ?? { r: 200, g: 200, b: 200, a: 1 });
    this.range = palette.surfaceRange;
    this.tintH = palette.tintHue;
    this.tintS = palette.tintSat;
  }

  /** Maps a single CSS colour token. Returns null if it isn't a colour we understand. */
  mapString(value: string, role: Role): string | null {
    const key = role + value;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const rgb = parseColor(value);
    const out = rgb ? (rgb.a === 0 ? value : rgbToString(this.map(rgb, role))) : null;
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  map(rgb: RGBA, role: Role): RGBA {
    const hsl = rgbToHsl(rgb);
    switch (role) {
      case 'bg':
        return hslToRgb(this.bg(hsl));
      case 'text':
        return hslToRgb(this.text(hsl));
      case 'border':
        return hslToRgb(this.border(hsl));
      case 'shadow':
        return hslToRgb(this.shadow(hsl));
    }
  }

  private neutral(l: number, a: number, satScale = 1): HSLA {
    return { h: this.tintH, s: this.tintS * satScale, l: clamp(l, 0, 1), a };
  }

  private bg(c: HSLA): HSLA {
    if (isNeutral(c)) {
      // Faint dark washes (hover states, zebra stripes) only read on a dark page as faint light washes.
      if (c.a < 0.3 && c.l < 0.5) return this.neutral(1 - c.l * 0.5, c.a * 0.8, 0.5);
      // sqrt() exaggerates the tiny steps between near-white surfaces (#fff page, #f9fafb card)
      // so layering survives the trip into a narrow dark range.
      const l =
        c.l >= 0.5
          ? this.bgL + this.range * Math.sqrt((1 - c.l) / 0.5)
          : this.bgL + this.range * (c.l / 0.5);
      return this.neutral(l, c.a);
    }
    const chroma = chromaOf(c);
    const l = clamp(this.bgL + 0.06 + (c.l < 0.5 ? c.l : 1 - c.l) * 0.3, this.bgL + 0.04, 0.3);
    return fitLuminance({ h: c.h, s: satFor(Math.min(chroma, 0.28), l), l, a: c.a }, 0, MAX_FILL_LUM);
  }

  private text(c: HSLA): HSLA {
    if (isNeutral(c)) {
      const floor = 0.56;
      let l: number;
      if (c.l < 0.5) l = this.textL - (c.l / 0.5) * (this.textL - floor);
      else if (c.l <= this.textL) l = Math.max(c.l, floor);
      // Pure white headings/text on dark pages: pull them down to body-text level.
      else l = this.textL;
      return this.neutral(l, c.a, 0.5);
    }
    const l = c.l < 0.5 ? 0.66 + (0.5 - c.l) * 0.2 : Math.max(c.l, 0.66);
    const soft = { h: c.h, s: Math.min(c.s, 0.45), l: clamp(l, 0, 0.85), a: c.a };
    // Readable (≥ ~5:1 on the background) but always a step dimmer than body text.
    return fitLuminance(soft, Math.min(0.2, this.textLum * 0.5), this.textLum * 0.75);
  }

  private border(c: HSLA): HSLA {
    if (isNeutral(c)) {
      if (c.a < 0.5 && c.l < 0.5) return this.neutral(1 - c.l * 0.5, c.a * 0.8, 0.5);
      const dist = c.l >= 0.5 ? 1 - c.l : c.l;
      return this.neutral(Math.min(0.36, this.bgL + this.range * (0.5 + dist * 0.7)), c.a);
    }
    const l = c.l > 0.5 ? 0.28 + (1 - c.l) * 0.3 : clamp(c.l, 0.26, 0.4);
    return fitLuminance({ h: c.h, s: Math.min(c.s, 0.45), l, a: c.a }, 0, MAX_BORDER_LUM);
  }

  private shadow(c: HSLA): HSLA {
    if (isNeutral(c)) return { h: 0, s: 0, l: c.l < 0.5 ? c.l * 0.5 : this.bgL * 0.5, a: c.a };
    return this.bg(c);
  }
}
