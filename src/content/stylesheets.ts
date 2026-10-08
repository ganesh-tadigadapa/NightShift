import type { FetchResponse } from '../shared/messages';
import { customPropertyVariants, mayContainColor, transformValue, type ValueContext } from './css-value';
import type { ColorMapper, Role } from './mapper';

export const OWN_ATTR = 'data-nightshift';

const LONGHANDS: Record<string, Role> = {
  'background-color': 'bg',
  'background-image': 'bg',
  color: 'text',
  'caret-color': 'text',
  'text-decoration-color': 'text',
  'text-emphasis-color': 'text',
  '-webkit-text-fill-color': 'text',
  '-webkit-text-stroke-color': 'text',
  fill: 'text',
  stroke: 'text',
  'border-top-color': 'border',
  'border-right-color': 'border',
  'border-bottom-color': 'border',
  'border-left-color': 'border',
  'border-block-start-color': 'border',
  'border-block-end-color': 'border',
  'border-inline-start-color': 'border',
  'border-inline-end-color': 'border',
  'outline-color': 'border',
  'column-rule-color': 'border',
  'box-shadow': 'shadow',
  'text-shadow': 'shadow',
  'stop-color': 'bg',
  'flood-color': 'bg',
  'lighting-color': 'bg',
};

/** Shorthands only matter when they contain var(): then Chrome leaves their longhands empty. */
const SHORTHANDS: [string, Role][] = [
  ['background', 'bg'],
  ['border', 'border'],
  ['border-color', 'border'],
  ['border-top', 'border'],
  ['border-right', 'border'],
  ['border-bottom', 'border'],
  ['border-left', 'border'],
  ['border-block', 'border'],
  ['border-inline', 'border'],
  ['outline', 'border'],
  ['column-rule', 'border'],
  ['text-decoration', 'text'],
];

export interface SheetHost {
  readonly mapper: ColorMapper;
  /**
   * Dark-theme replacement for a background image: a URL, null for "keep as is",
   * or undefined while it's still being analysed (onReady fires when done).
   */
  mapImage(url: string, onReady: () => void): string | null | undefined;
  scheduleSync(): void;
  onFetchesSettled(): void;
}

type External =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'ready'; sheet: CSSStyleSheet; imports: string[] };

interface Gen {
  ctx: ValueContext;
  /** Set when a rule references an image whose analysis is still in flight (don't cache it). */
  incomplete: boolean;
}

type StyleRoot = Document | ShadowRoot;
const SOURCES = `style:not([${OWN_ATTR}]), link[rel~="stylesheet" i]`;

export class SheetManager {
  private companions = new Map<Element, Element>();
  private memo = new WeakMap<CSSStyleSheet, { fp: string; key: string; text: string }>();
  private ruleCache = new WeakMap<CSSRule, { key: string; text: string }>();
  private external = new Map<string, External>();
  private watchedLinks = new WeakSet<Element>();
  /** The document plus every open shadow root we've found. */
  private roots = new Set<StyleRoot>([document]);
  /** Page constructed sheet → our override sheet (shared by every root that adopts it). */
  private adoptedOverrides = new WeakMap<CSSStyleSheet, CSSStyleSheet>();
  private ownSheets = new Map<CSSStyleSheet, string>();
  /** Base rules adopted into shadow roots (document styles don't reach inside them). */
  private shadowBase: CSSStyleSheet | null = null;
  pendingFetches = 0;

  constructor(private host: SheetHost) {}

  private get key() {
    return this.host.mapper.palette.key;
  }

  addRoot(root: ShadowRoot) {
    this.roots.add(root);
  }

  setShadowBase(css: string) {
    if (!this.shadowBase) {
      this.shadowBase = new CSSStyleSheet();
      this.ownSheets.set(this.shadowBase, '');
    }
    this.writeOwn(this.shadowBase, css);
  }

  /** Brings every override sheet in line with the page's current stylesheets, in every root. */
  sync() {
    const seen = new Set<Element>();
    for (const root of this.roots) {
      if (root !== document && !(root as ShadowRoot).host.isConnected) continue;
      for (const el of root.querySelectorAll(SOURCES)) {
        if (el instanceof HTMLLinkElement && /\balternate\b/i.test(el.rel)) continue;
        seen.add(el);
        this.place(el, this.generateFor(el) ?? '');
      }
      this.syncAdopted(root);
    }
    for (const [el, comp] of this.companions) {
      if (!seen.has(el)) {
        comp.remove();
        this.companions.delete(el);
      }
    }
  }

  setDisabled(disabled: boolean) {
    for (const comp of this.companions.values()) {
      const sheet = (comp as HTMLStyleElement).sheet;
      if (sheet) sheet.disabled = disabled;
    }
    for (const sheet of this.ownSheets.keys()) sheet.disabled = disabled;
  }

  clear() {
    for (const comp of this.companions.values()) comp.remove();
    this.companions.clear();
    for (const root of this.roots) {
      const list = root.adoptedStyleSheets;
      if (list.some((s) => this.ownSheets.has(s))) root.adoptedStyleSheets = list.filter((s) => !this.ownSheets.has(s));
    }
    this.roots = new Set([document]);
    this.ownSheets.clear();
    this.adoptedOverrides = new WeakMap();
    this.shadowBase = null;
  }

  private generateFor(el: Element): string | null {
    const sheet = (el as HTMLStyleElement | HTMLLinkElement).sheet as CSSStyleSheet | null;
    if (!sheet) {
      if (el instanceof HTMLLinkElement && !this.watchedLinks.has(el)) {
        this.watchedLinks.add(el);
        el.addEventListener('load', () => this.host.scheduleSync());
        el.addEventListener('error', () => this.host.scheduleSync());
      }
      return null;
    }
    if (sheet.disabled) return '';
    try {
      sheet.cssRules;
    } catch {
      // Cross-origin: the CSSOM won't let us read it, so fetch the text and parse it ourselves.
      const href = sheet.href ?? (el as HTMLLinkElement).href;
      return href ? this.generateExternal(href) : null;
    }
    return this.generateSheet(sheet);
  }

  /** Override text for a readable sheet, memoised until its rules or the palette change. */
  private generateSheet(sheet: CSSStyleSheet): string {
    const rules = sheet.cssRules;
    const fp = fingerprint(rules);
    const memo = this.memo.get(sheet);
    if (memo && memo.fp === fp && memo.key === this.key) return memo.text;
    const gen = this.newGen(sheet.href);
    const text = this.genRules(rules, gen);
    if (!gen.incomplete) this.memo.set(sheet, { fp, key: this.key, text });
    else this.memo.delete(sheet);
    return text;
  }

  /**
   * Constructed sheets (adoptedStyleSheets) can't have a DOM sibling, so each gets an override
   * sheet adopted right after it: [page1, ours1, page2, ours2, …, shadowBase].
   */
  private syncAdopted(root: StyleRoot) {
    const list = root.adoptedStyleSheets;
    if (!list.length && (root === document || !this.shadowBase)) return;
    const desired: CSSStyleSheet[] = [];
    for (const sheet of list) {
      if (this.ownSheets.has(sheet)) continue;
      desired.push(sheet);
      const override = this.overrideFor(sheet);
      if (override) desired.push(override);
    }
    if (root !== document && this.shadowBase) desired.push(this.shadowBase);
    if (desired.length !== list.length || desired.some((s, i) => s !== list[i])) root.adoptedStyleSheets = desired;
  }

  private overrideFor(sheet: CSSStyleSheet): CSSStyleSheet | null {
    let text: string;
    try {
      text = this.generateSheet(sheet);
    } catch {
      return null;
    }
    let override = this.adoptedOverrides.get(sheet);
    if (!text && !override) return null;
    if (!override) {
      override = new CSSStyleSheet();
      this.ownSheets.set(override, '');
      this.adoptedOverrides.set(sheet, override);
    }
    this.writeOwn(override, text);
    return override;
  }

  private writeOwn(sheet: CSSStyleSheet, text: string) {
    if (this.ownSheets.get(sheet) === text) return;
    sheet.replaceSync(text);
    this.ownSheets.set(sheet, text);
  }

  private newGen(base: string | null): Gen {
    const gen: Gen = {
      incomplete: false,
      ctx: {
        mapper: this.host.mapper,
        base,
        mapImage: (url) => {
          const out = this.host.mapImage(url, () => this.host.scheduleSync());
          if (out === undefined) gen.incomplete = true;
          return out ?? null;
        },
      },
    };
    return gen;
  }

  private generateExternal(href: string, depth = 0): string | null {
    const ext = this.fetchExternal(href);
    if (ext.status !== 'ready') return ext.status === 'pending' ? null : '';
    let text = '';
    if (depth < 4) for (const url of ext.imports) text += this.generateExternal(url, depth + 1) ?? '';
    const gen = this.newGen(href);
    return text + this.genRules(ext.sheet.cssRules, gen);
  }

  private fetchExternal(url: string): External {
    const known = this.external.get(url);
    if (known) return known;
    const pending: External = { status: 'pending' };
    this.external.set(url, pending);
    this.pendingFetches++;
    chrome.runtime
      .sendMessage({ type: 'ns:fetch', url, as: 'text' })
      .then((res: FetchResponse) => {
        if (!res?.ok) throw new Error('fetch failed');
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(res.data); // drops @import rules; we follow them ourselves below
        const imports = [...res.data.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)].map(
          (m) => new URL(m[1], url).href,
        );
        this.external.set(url, { status: 'ready', sheet, imports });
      })
      .catch(() => this.external.set(url, { status: 'failed' }))
      .finally(() => {
        this.pendingFetches--;
        this.host.scheduleSync();
        if (this.pendingFetches === 0) this.host.onFetchesSettled();
      });
    return pending;
  }

  private genRules(rules: CSSRuleList, gen: Gen): string {
    let out = '';
    for (let i = 0; i < rules.length; i++) out += this.genRule(rules[i], gen);
    return out;
  }

  private genRule(rule: CSSRule, gen: Gen): string {
    if (rule instanceof CSSStyleRule) {
      const leaf = !rule.cssRules?.length;
      if (leaf) {
        const hit = this.ruleCache.get(rule);
        if (hit && hit.key === this.key) return hit.text;
      }
      const before = gen.incomplete;
      gen.incomplete = false;
      const decls = genDeclarations(rule.style, gen.ctx);
      const nested = leaf ? '' : this.genRules(rule.cssRules, gen);
      const text = decls || nested ? `${rule.selectorText}{${decls}${nested}}` : '';
      if (leaf && !gen.incomplete) this.ruleCache.set(rule, { key: this.key, text });
      gen.incomplete ||= before;
      return text;
    }
    if (rule instanceof CSSImportRule) {
      try {
        const sheet = rule.styleSheet;
        if (!sheet) return '';
        return this.genRules(sheet.cssRules, { ...gen, ctx: { ...gen.ctx, base: sheet.href } });
      } catch {
        const href = rule.styleSheet?.href ?? rule.href;
        const text = this.generateExternal(new URL(href, gen.ctx.base ?? location.href).href);
        if (text === null) gen.incomplete = true;
        return text ?? '';
      }
    }
    if (rule instanceof CSSKeyframesRule) return genKeyframes(rule, gen.ctx);
    if (rule instanceof CSSGroupingRule) {
      const inner = this.genRules(rule.cssRules, gen);
      if (!inner) return '';
      let prelude: string | null;
      if (rule instanceof CSSMediaRule) prelude = `@media ${rule.media.mediaText}`;
      else if (rule instanceof CSSSupportsRule) prelude = `@supports ${rule.conditionText}`;
      else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule)
        prelude = rule.name ? `@layer ${rule.name}` : null;
      else prelude = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
      return prelude ? `${prelude}{${inner}}` : inner;
    }
    // CSS nesting: bare declarations interleaved with nested rules.
    if (rule.constructor.name === 'CSSNestedDeclarations') return genDeclarations((rule as CSSStyleRule).style, gen.ctx);
    return '';
  }

  /** Inserts/updates the override sheet immediately after its source so cascade order is preserved. */
  private place(source: Element, text: string) {
    let comp = this.companions.get(source);
    if (!comp) {
      if (!text) return;
      comp = document.createElementNS(source.namespaceURI ?? 'http://www.w3.org/1999/xhtml', 'style');
      comp.setAttribute(OWN_ATTR, 'override');
      this.companions.set(source, comp);
    }
    if (comp.textContent !== text) comp.textContent = text;
    const media = source.getAttribute('media');
    if (media !== comp.getAttribute('media')) {
      if (media) comp.setAttribute('media', media);
      else comp.removeAttribute('media');
    }
    if (source.nextSibling !== comp && source.parentNode) {
      try {
        source.after(comp);
      } catch {
        /* exotic parent; skip */
      }
    }
  }
}

/** Cheap change detector for a rule list (CSS-in-JS mutates sheets in place). */
function fingerprint(rules: CSSRuleList): string {
  const n = rules.length;
  if (!n) return '0';
  const sig = (r: CSSRule) =>
    r instanceof CSSStyleRule ? r.selectorText : `${r.constructor.name}${(r as CSSGroupingRule).cssRules?.length ?? ''}`;
  return `${n}|${sig(rules[0])}|${sig(rules[n - 1])}`;
}

function decl(prop: string, value: string, priority: string) {
  return `${prop}:${value}${priority ? ' !important' : ''};`;
}

export function genDeclarations(style: CSSStyleDeclaration, ctx: ValueContext): string {
  let out = '';
  for (const [prop, role] of SHORTHANDS) {
    const v = style.getPropertyValue(prop);
    if (v && v.includes('var(')) out += decl(prop, transformValue(v, role, ctx), style.getPropertyPriority(prop));
  }
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (!prop) continue;
    if (prop.startsWith('--')) {
      const variants = customPropertyVariants(prop, style.getPropertyValue(prop).trim(), ctx);
      if (variants) {
        const pr = style.getPropertyPriority(prop);
        for (const [name, value] of variants) out += decl(name, value, pr);
      }
      continue;
    }
    const role = LONGHANDS[prop];
    if (!role) continue;
    const v = style.getPropertyValue(prop);
    if (!v || !mayContainColor(v)) continue;
    const t = transformValue(v, role, ctx);
    if (t !== v) out += decl(prop, t, style.getPropertyPriority(prop));
  }
  return out;
}

/** Re-declares a @keyframes block with colours mapped (a later same-named block replaces it wholesale). */
function genKeyframes(rule: CSSKeyframesRule, ctx: ValueContext): string {
  let hasColor = false;
  let body = '';
  for (let i = 0; i < rule.cssRules.length; i++) {
    const frame = rule.cssRules[i] as CSSKeyframeRule;
    let decls = '';
    for (let j = 0; j < frame.style.length; j++) {
      const prop = frame.style[j];
      const v = frame.style.getPropertyValue(prop);
      const role = LONGHANDS[prop];
      if (role && mayContainColor(v)) {
        const t = transformValue(v, role, ctx);
        hasColor ||= t !== v;
        decls += `${prop}:${t};`;
      } else decls += `${prop}:${v};`;
    }
    body += `${frame.keyText}{${decls}}`;
  }
  return hasColor ? `@keyframes ${rule.name}{${body}}` : '';
}
