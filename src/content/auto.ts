import { luminance, parseColor, rgbToHsl, type RGBA } from '../shared/color';
import type { SiteAnalysis } from '../shared/themes';

/**
 * Looks at the page as its authors designed it (callers must disable NightShift's styles first)
 * and works out how Auto should treat it.
 */
export function analyzePage(): SiteAnalysis {
  const bgLum = median(sampleBackgrounds().map(luminance));
  const textLum = median(sampleText().map(luminance));
  return {
    nativeDark: bgLum < 0.16 && (Number.isNaN(textLum) || textLum > 0.25),
    accentHue: findAccentHue(),
    imageHeavy: mediaCoverage() > 0.35,
    textHeavy: isReadingPage(),
    analyzedAt: Date.now(),
  };
}

const opaque = (c: RGBA | null): c is RGBA => !!c && c.a > 0.6;

function computedBg(el: Element): RGBA | null {
  return parseColor(getComputedStyle(el).backgroundColor);
}

/** The colour the user actually sees behind content, sampled across the viewport. */
function sampleBackgrounds(): RGBA[] {
  const root = document.documentElement;
  const body = document.body;
  const rootScheme = getComputedStyle(root).colorScheme;
  const canvas =
    [body, root].map((el) => el && computedBg(el)).find(opaque) ??
    (/\bdark\b/.test(rootScheme) && !/\blight\b/.test(rootScheme)
      ? { r: 18, g: 18, b: 18, a: 1 }
      : { r: 255, g: 255, b: 255, a: 1 });

  const w = innerWidth, h = innerHeight;
  const out: RGBA[] = [];
  if (!w || !h) return [canvas];
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.25, 0.5, 0.75]) {
      const stack = document.elementsFromPoint(w * fx, h * fy);
      let found: RGBA | null = null;
      for (const el of stack) {
        if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement) break;
        const bg = computedBg(el);
        if (opaque(bg)) {
          found = bg;
          break;
        }
      }
      out.push(found ?? canvas);
    }
  }
  return out;
}

function sampleText(): RGBA[] {
  const out: RGBA[] = [];
  const els = document.querySelectorAll('p, li, td, h1, h2, h3, span, a');
  for (let i = 0; i < els.length && out.length < 40; i++) {
    const el = els[i];
    if (!el.textContent?.trim() || !(el as HTMLElement).offsetParent) continue;
    const c = parseColor(getComputedStyle(el).color);
    if (c && c.a > 0.5) out.push(c);
  }
  if (!out.length && document.body) {
    const c = parseColor(getComputedStyle(document.body).color);
    if (c) out.push(c);
  }
  return out;
}

/** Brand hue from <meta name="theme-color">, else the most common saturated hue in links/buttons/headers. */
function findAccentHue(): number | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media*="dark"])');
  const metaHue = meta ? saturatedHue(parseColor(meta.content)) : null;
  if (metaHue !== null) return metaHue;

  const bins = new Array<number>(24).fill(0);
  const sums = new Array<number>(24).fill(0);
  const vote = (c: RGBA | null, weight: number) => {
    const hue = saturatedHue(c);
    if (hue === null) return;
    const bin = Math.floor(hue / 15) % 24;
    bins[bin] += weight;
    sums[bin] += hue * weight;
  };
  const take = (sel: string, max: number, fn: (cs: CSSStyleDeclaration) => void) => {
    const els = document.querySelectorAll(sel);
    for (let i = 0; i < els.length && i < max; i++) fn(getComputedStyle(els[i]));
  };
  take('header, nav, [role="banner"]', 6, (cs) => vote(parseColor(cs.backgroundColor), 3));
  take('button, [role="button"], input[type="submit"], .btn, .button', 40, (cs) => vote(parseColor(cs.backgroundColor), 2));
  take('a[href]', 80, (cs) => vote(parseColor(cs.color), 1));

  let best = -1;
  for (let i = 0; i < 24; i++) if (best < 0 || bins[i] > bins[best]) best = i;
  return bins[best] >= 4 ? Math.round(sums[best] / bins[best]) : null;
}

function saturatedHue(c: RGBA | null): number | null {
  if (!c || c.a < 0.5) return null;
  const { h, s, l } = rgbToHsl(c);
  const chroma = s * (1 - Math.abs(2 * l - 1));
  return chroma > 0.25 ? h : null;
}

/** Fraction of the first screen covered by photos/video. */
function mediaCoverage(): number {
  const vw = innerWidth, vh = innerHeight;
  if (!vw || !vh) return 0;
  let area = 0;
  document.querySelectorAll('img, video, picture, canvas').forEach((el) => {
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (w * h > 120 * 120) area += w * h;
  });
  return Math.min(1, area / (vw * vh));
}

function isReadingPage(): boolean {
  const scope = document.querySelector('article, main, [role="main"]') ?? document.body;
  if (!scope) return false;
  let chars = 0, paragraphs = 0;
  scope.querySelectorAll('p').forEach((p) => {
    const n = p.textContent?.trim().length ?? 0;
    if (n > 80) {
      paragraphs++;
      chars += n;
    }
  });
  return paragraphs >= 6 && chars > 2500;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
