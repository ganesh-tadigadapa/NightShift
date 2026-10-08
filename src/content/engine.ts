import { SHADOW_EVENT, SHEET_EVENT } from '../shared/constants';
import type { Palette } from '../shared/themes';
import { baseCss, fallbackCss } from './base-css';
import { ImageAnalyzer, ImageTagger } from './images';
import { InlineManager } from './inline';
import { ColorMapper } from './mapper';
import { OWN_ATTR, SheetManager } from './stylesheets';

const INLINE_ATTRS = new Set(['style', 'bgcolor', 'color', 'fill', 'stroke', 'stop-color']);
const OBSERVED_ATTRS = [...INLINE_ATTRS, 'src', 'srcset', 'rel', 'media', 'disabled', 'href'];
const FALLBACK_MAX_MS = 4000;
const OBSERVE: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS };

const isSheetNode = (n: Node | null): boolean =>
  !!n &&
  n.nodeType === 1 &&
  !(n as Element).hasAttribute(OWN_ATTR) &&
  ((n as Element).localName === 'style' ||
    ((n as Element).localName === 'link' && /\bstylesheet\b/i.test((n as Element).getAttribute('rel') ?? '')));

const containsSheet = (el: Element) => isSheetNode(el) || !!el.querySelector?.('style, link[rel~="stylesheet" i]');

/**
 * Owns everything NightShift adds to a document and keeps it in step with the page:
 * a base sheet, one override sheet per page stylesheet, per-element inline overrides and
 * image verdicts. `apply()` swaps palettes in place; `stop()` restores the page exactly.
 */
export class Engine {
  private mapper: ColorMapper | null = null;
  private baseEl: HTMLStyleElement | null = null;
  private fallbackEl: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private pollTimer = 0;
  private fallbackTimer = 0;
  private syncQueued = false;
  private shadowRoots = new Set<ShadowRoot>();
  private readonly analyzer = new ImageAnalyzer();
  private readonly sheets: SheetManager;
  private readonly inline: InlineManager;
  private readonly images: ImageTagger;

  /** Called on each poll; lets the owner detect an orphaned (reloaded) extension. */
  onPoll: (() => void) | null = null;

  constructor() {
    const self = this;
    this.sheets = new SheetManager({
      get mapper() {
        return self.mapper!;
      },
      mapImage: (url, onReady) => this.mapImage(url, onReady),
      scheduleSync: () => this.scheduleSync(),
      onFetchesSettled: () => this.maybeHideFallback(),
    });
    this.inline = new InlineManager(() => this.mapper!);
    this.images = new ImageTagger(this.analyzer, () => this.running);
  }

  get running() {
    return this.mapper !== null;
  }

  apply(palette: Palette) {
    if (this.mapper?.palette.key === palette.key) return;
    const first = !this.mapper;
    this.mapper = new ColorMapper(palette);
    const base = baseCss(palette, this.mapper);
    this.baseEl = this.ensureStyle(this.baseEl, 'base', base);
    this.sheets.setShadowBase(base);
    if (first) {
      if (document.readyState === 'loading') this.showFallback();
      this.start();
    } else if (this.fallbackEl) {
      this.fallbackEl.textContent = fallbackCss(palette, this.mapper);
    }
    if (document.body) this.scanForShadows(document);
    this.sync();
    if (document.body) this.processContent(document);
  }

  /**
   * Removes everything NightShift added. `detach` is for an orphaned instance after an
   * extension reload: it drops only its own sheets and leaves per-element attributes,
   * which the replacement instance shares.
   */
  stop(detach = false) {
    if (!this.mapper) return;
    this.mapper = null;
    this.observer?.disconnect();
    this.observer = null;
    clearInterval(this.pollTimer);
    clearTimeout(this.fallbackTimer);
    document.removeEventListener(SHEET_EVENT, this.onSheetEvent);
    document.removeEventListener(SHADOW_EVENT, this.onShadowEvent, true);
    document.removeEventListener('load', this.onLoadCapture, true);
    document.removeEventListener('DOMContentLoaded', this.onReady);
    this.baseEl?.remove();
    this.fallbackEl?.remove();
    this.baseEl = this.fallbackEl = null;
    const roots = [document, ...this.shadowRoots];
    this.shadowRoots.clear();
    this.sheets.clear();
    if (detach) return;
    this.inline.clear();
    this.images.clear(roots);
  }

  /** Runs `fn` against the page's original styling (used by Auto's analysis). */
  withStylesDisabled<T>(fn: () => T): T {
    const own = [this.baseEl, this.fallbackEl].map((el) => el?.sheet).filter((s): s is CSSStyleSheet => !!s);
    own.forEach((s) => (s.disabled = true));
    this.sheets.setDisabled(true);
    try {
      return fn();
    } finally {
      own.forEach((s) => (s.disabled = false));
      this.sheets.setDisabled(false);
    }
  }

  private start() {
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(document, OBSERVE);
    document.addEventListener(SHEET_EVENT, this.onSheetEvent);
    document.addEventListener(SHADOW_EVENT, this.onShadowEvent, true);
    document.addEventListener('load', this.onLoadCapture, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', this.onReady, { once: true });
    this.pollTimer = window.setInterval(() => {
      this.onPoll?.();
      if (this.running && document.visibilityState === 'visible') this.sync();
    }, 2000);
  }

  private sync() {
    if (!this.mapper) return;
    if (this.baseEl && !this.baseEl.isConnected) this.attach(this.baseEl);
    if (this.fallbackEl && !this.fallbackEl.isConnected) this.attach(this.fallbackEl);
    this.sheets.sync();
  }

  private processContent(root: Element | Document | ShadowRoot) {
    this.inline.processTree(root);
    this.images.processTree(root);
  }

  /** Finds open shadow roots under `root` (document styles can't reach inside them). */
  private scanForShadows(root: Node): boolean {
    let found = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
      const sr = (n as Element).shadowRoot;
      if (sr && !this.shadowRoots.has(sr)) {
        this.addShadowRoot(sr);
        found = true;
      }
    }
    return found;
  }

  private addShadowRoot(sr: ShadowRoot) {
    this.shadowRoots.add(sr);
    this.sheets.addRoot(sr);
    this.observer?.observe(sr, OBSERVE);
    this.processContent(sr);
    this.scanForShadows(sr);
  }

  private onShadowEvent = (e: Event) => {
    const host = e.composedPath()[0] as Element;
    if (!this.running || !host?.shadowRoot || this.shadowRoots.has(host.shadowRoot)) return;
    this.addShadowRoot(host.shadowRoot);
    this.sync();
  };

  private scheduleSync() {
    if (this.syncQueued) return;
    this.syncQueued = true;
    const run = () => {
      if (!this.syncQueued) return;
      this.syncQueued = false;
      this.sync();
    };
    requestAnimationFrame(run);
    setTimeout(run, 250); // rAF doesn't fire in background tabs
  }

  private mapImage(url: string, onReady: () => void): string | null | undefined {
    if (/\.gif(?:[?#]|$)/i.test(url) || /^data:image\/gif/i.test(url)) return null;
    const verdict = this.analyzer.peek(url);
    if (verdict === undefined) {
      this.analyzer.analyze(url).then(onReady);
      return undefined;
    }
    if (verdict !== 'invert') return null;
    const inverted = this.analyzer.peekInverted(url);
    if (inverted === undefined) {
      this.analyzer.invert(url).then(onReady);
      return undefined;
    }
    return inverted;
  }

  private onMutations = (records: MutationRecord[]) => {
    if (!this.mapper) return;
    if (!chrome.runtime?.id) return this.stop(true);
    let sheetsDirty = false;
    for (const r of records) {
      if (r.type === 'childList') {
        // Text replaced inside a <style> shows up as a child-list change on the style element.
        if (isSheetNode(r.target)) sheetsDirty = true;
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1 || (n as Element).hasAttribute(OWN_ATTR)) return;
          const el = n as Element;
          if (containsSheet(el)) sheetsDirty = true;
          this.processContent(el);
          // Re-attached hosts need their shadow sheets re-synced too.
          if (this.scanForShadows(el) || (el.shadowRoot && this.shadowRoots.has(el.shadowRoot))) sheetsDirty = true;
        });
        r.removedNodes.forEach((n) => {
          if (n.nodeType === 1 && ((n as Element).hasAttribute(OWN_ATTR) || containsSheet(n as Element)))
            sheetsDirty = true;
        });
      } else {
        const el = r.target as Element;
        const name = r.attributeName!;
        if (INLINE_ATTRS.has(name)) this.inline.process(el);
        else if (name === 'src' || name === 'srcset') {
          if (el instanceof HTMLImageElement) this.images.process(el);
        } else if (isSheetNode(el)) sheetsDirty = true;
      }
    }
    // Synchronous (we're in a microtask) so new page styles never paint un-darkened.
    if (sheetsDirty) this.sync();
  };

  private onSheetEvent = () => this.scheduleSync();

  private onLoadCapture = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLImageElement) this.images.process(t);
    else if (t instanceof HTMLLinkElement) this.scheduleSync();
  };

  private onReady = () => {
    if (!this.running) return;
    this.scanForShadows(document);
    this.sync();
    this.processContent(document);
    this.maybeHideFallback();
  };

  private showFallback() {
    this.fallbackEl = this.ensureStyle(this.fallbackEl, 'fallback', fallbackCss(this.mapper!.palette, this.mapper!));
    this.fallbackTimer = window.setTimeout(() => this.hideFallback(), FALLBACK_MAX_MS);
  }

  private maybeHideFallback() {
    if (!this.fallbackEl || document.readyState === 'loading' || this.sheets.pendingFetches > 0) return;
    // Let the freshly generated overrides apply first.
    requestAnimationFrame(() => this.hideFallback());
    setTimeout(() => this.hideFallback(), 100);
  }

  private hideFallback() {
    clearTimeout(this.fallbackTimer);
    this.fallbackEl?.remove();
    this.fallbackEl = null;
  }

  private ensureStyle(el: HTMLStyleElement | null, role: string, css: string): HTMLStyleElement {
    if (!el) {
      el = document.createElement('style');
      el.setAttribute(OWN_ATTR, role);
      this.attach(el);
    }
    if (el.textContent !== css) el.textContent = css;
    return el;
  }

  private attach(el: HTMLStyleElement) {
    (document.head ?? document.documentElement).appendChild(el);
  }
}
