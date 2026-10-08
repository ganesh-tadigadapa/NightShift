import type { FetchResponse } from '../shared/messages';

/**
 * - invert: dark artwork on a transparent background (logos, icons) that would vanish against
 *           a dark page, and white line art (diagrams, charts, equations) that would glare.
 * - dim:    other opaque, mostly-white images (screenshots, scans) — inverting those would
 *           turn photos into negatives, so they're only toned down.
 */
export type ImageVerdict = 'invert' | 'dim' | 'none';

const SAMPLE = 64;
const MAX_CONCURRENT = 4;
const MAX_INVERT_SIDE = 1024;

function sameOrigin(url: string) {
  if (/^(data|blob):/i.test(url)) return true;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Loads an image so it can be drawn to an untainted canvas (cross-origin goes via the background worker). */
async function loadImage(url: string): Promise<HTMLImageElement> {
  let src = url;
  if (!sameOrigin(url)) {
    const res: FetchResponse = await chrome.runtime.sendMessage({ type: 'ns:fetch', url, as: 'dataURL' });
    if (!res?.ok) throw new Error(res?.error ?? 'fetch failed');
    src = res.data;
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

function classify(img: HTMLImageElement): ImageVerdict {
  const w = img.naturalWidth || SAMPLE;
  const h = img.naturalHeight || SAMPLE;
  const scale = Math.min(1, SAMPLE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'none';
  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  let transparent = 0, opaque = 0, lum = 0, sat = 0, white = 0, mid = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.1) {
      transparent++;
      continue;
    }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    opaque++;
    lum += l;
    sat += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (l > 0.9) white++;
    else if (l > 0.4) mid++;
  }
  const total = transparent + opaque;
  if (!opaque) return 'none';
  const tRatio = transparent / total;
  const avgLum = lum / opaque;
  const avgSat = sat / opaque;
  if (tRatio > 0.2 && avgLum < 0.32 && avgSat < 0.3) return 'invert';
  if (tRatio < 0.05 && w * h > 96 * 96) {
    // Line art is bimodal: paper and ink, with few midtones. Photos are full of midtones.
    const lineArt = white / opaque > 0.55 && mid / opaque < 0.22 && avgSat < 0.15;
    if (lineArt) return 'invert';
    if (avgLum > 0.82) return 'dim';
  }
  return 'none';
}

export class ImageAnalyzer {
  private verdicts = new Map<string, ImageVerdict>();
  private jobs = new Map<string, Promise<ImageVerdict>>();
  private inverted = new Map<string, string | null>();
  private invertJobs = new Map<string, Promise<string | null>>();
  private queue: Array<() => void> = [];
  private active = 0;

  /** Cached verdict, or undefined if the image hasn't been analysed yet. */
  peek(url: string): ImageVerdict | undefined {
    return this.verdicts.get(url);
  }

  analyze(url: string): Promise<ImageVerdict> {
    const done = this.verdicts.get(url);
    if (done) return Promise.resolve(done);
    let job = this.jobs.get(url);
    if (!job) {
      job = this.limit(async () => {
        try {
          return classify(await loadImage(url));
        } catch {
          return 'none' as const;
        }
      }).then((v) => {
        this.verdicts.set(url, v);
        this.jobs.delete(url);
        return v;
      });
      this.jobs.set(url, job);
    }
    return job;
  }

  /** Data URL of a colour-inverted copy (for CSS background images), undefined while pending. */
  peekInverted(url: string): string | null | undefined {
    return this.inverted.get(url);
  }

  invert(url: string): Promise<string | null> {
    if (this.inverted.has(url)) return Promise.resolve(this.inverted.get(url)!);
    let job = this.invertJobs.get(url);
    if (!job) {
      job = this.limit(async () => {
        try {
          const img = await loadImage(url);
          const w = img.naturalWidth || 64, h = img.naturalHeight || 64;
          if (Math.max(w, h) > MAX_INVERT_SIDE) return null;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.filter = 'invert(0.88) hue-rotate(180deg)';
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL();
        } catch {
          return null;
        }
      }).then((u) => {
        this.inverted.set(url, u);
        this.invertJobs.delete(url);
        return u;
      });
      this.invertJobs.set(url, job);
    }
    return job;
  }

  private limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      const run = () => {
        this.active++;
        task()
          .then(resolve)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < MAX_CONCURRENT) run();
      else this.queue.push(run);
    });
  }
}

const IMG_ATTR = 'data-ns-img';
const MAX_PIXELS = 4_000_000;

/** Tags <img> elements with a verdict; the base stylesheet turns verdicts into filters. */
export class ImageTagger {
  constructor(
    private analyzer: ImageAnalyzer,
    private isActive: () => boolean,
  ) {}

  processTree(root: Element | Document | ShadowRoot) {
    if (root instanceof HTMLImageElement) this.process(root);
    root.querySelectorAll?.('img').forEach((img) => this.process(img));
  }

  process(img: HTMLImageElement) {
    if (!img.complete || !img.naturalWidth) return; // the engine's capture-phase load listener retries
    const src = img.currentSrc || img.src;
    if (!src || img.naturalWidth * img.naturalHeight > MAX_PIXELS) return this.tag(img, 'none');
    if (/\.gif(\?|$)/i.test(src)) return this.tag(img, 'none');
    const known = this.analyzer.peek(src);
    if (known) return this.tag(img, known);
    this.analyzer.analyze(src).then((v) => {
      if (this.isActive() && (img.currentSrc || img.src) === src) this.tag(img, v);
    });
  }

  private tag(img: HTMLImageElement, verdict: ImageVerdict) {
    if (verdict === 'none') {
      if (img.hasAttribute(IMG_ATTR)) img.removeAttribute(IMG_ATTR);
    } else if (img.getAttribute(IMG_ATTR) !== verdict) img.setAttribute(IMG_ATTR, verdict);
  }

  clear(roots: Iterable<Document | ShadowRoot>) {
    for (const root of roots) root.querySelectorAll(`[${IMG_ATTR}]`).forEach((el) => el.removeAttribute(IMG_ATTR));
  }
}
