import { customPropertyVariants, mayContainColor, transformValue, type ValueContext } from './css-value';
import type { ColorMapper, Role } from './mapper';

/**
 * Inline styles beat any stylesheet, so they're overridden per element: the mapped value is
 * stored in a custom property on the element and a matching `[data-ns-i-*]` rule in the base
 * sheet applies it with !important. Turning NightShift off just removes the attributes.
 */
interface InlineSpec {
  prop: string;
  role: Role;
  key: string;
  /** Shorthands are only needed when they contain var() (their longhands are then empty). */
  shorthand?: boolean;
  /** Legacy presentational attribute that maps to the same property. */
  attr?: string;
}

export const INLINE_SPECS: InlineSpec[] = [
  { prop: 'background', role: 'bg', key: 'bg', shorthand: true },
  { prop: 'background-color', role: 'bg', key: 'bgc', attr: 'bgcolor' },
  { prop: 'background-image', role: 'bg', key: 'bgi' },
  { prop: 'color', role: 'text', key: 'c', attr: 'color' },
  { prop: 'border', role: 'border', key: 'b', shorthand: true },
  { prop: 'border-color', role: 'border', key: 'bc', shorthand: true },
  { prop: 'border-top-color', role: 'border', key: 'btc' },
  { prop: 'border-right-color', role: 'border', key: 'brc' },
  { prop: 'border-bottom-color', role: 'border', key: 'bbc' },
  { prop: 'border-left-color', role: 'border', key: 'blc' },
  { prop: 'outline-color', role: 'border', key: 'oc' },
  { prop: 'fill', role: 'text', key: 'f', attr: 'fill' },
  { prop: 'stroke', role: 'text', key: 's', attr: 'stroke' },
  { prop: 'stop-color', role: 'bg', key: 'sc', attr: 'stop-color' },
  { prop: 'box-shadow', role: 'shadow', key: 'bs' },
];

export const INLINE_SELECTOR = '[style],[bgcolor],font[color],[fill],[stroke],[stop-color]';
const attrName = (key: string) => `data-ns-i-${key}`;
const varName = (key: string) => `--ns-i-${key}`;

/** CSS for the base sheet that applies the per-element values. */
export function inlineCss(): string {
  return INLINE_SPECS.map((s) => `[${attrName(s.key)}]{${s.prop}:var(${varName(s.key)}) !important}`).join('');
}

export class InlineManager {
  /** What we last wrote per element (read back from the CSSOM) so re-processing is a no-op. */
  private written = new WeakMap<Element, Map<string, string>>();
  private touched = new Set<WeakRef<Element>>();

  constructor(private getMapper: () => ColorMapper) {}

  processTree(root: Element | Document | ShadowRoot) {
    if (root instanceof Element && root.matches(INLINE_SELECTOR)) this.process(root);
    root.querySelectorAll(INLINE_SELECTOR).forEach((el) => this.process(el));
  }

  process(el: Element) {
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (!style) return;
    const ctx: ValueContext = { mapper: this.getMapper(), base: null };
    const desired = new Map<string, string>();

    for (const spec of INLINE_SPECS) {
      let value = style.getPropertyValue(spec.prop);
      if (spec.shorthand && !value.includes('var(')) continue;
      if (!value && spec.attr && !style.getPropertyValue(spec.prop)) value = legacyAttr(el, spec.attr) ?? '';
      if (!value || !mayContainColor(value)) continue;
      if (spec.prop === 'background-image' && !/gradient\(/i.test(value)) continue;
      const mapped = transformValue(value, spec.role, ctx);
      if (mapped !== value) desired.set(varName(spec.key), mapped);
    }

    // Inline custom properties (`style="--brand: #fff"`) need their role variants too.
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (!prop.startsWith('--') || prop.startsWith('--ns-')) continue;
      const variants = customPropertyVariants(prop, style.getPropertyValue(prop).trim(), ctx);
      if (variants) for (const [name, value] of variants) desired.set(name, value);
    }

    this.apply(el, style, desired);
  }

  private apply(el: Element, style: CSSStyleDeclaration, desired: Map<string, string>) {
    const prev = this.written.get(el);
    if (!desired.size && !prev) return;
    const next = new Map<string, string>();

    for (const [name, value] of desired) {
      const current = style.getPropertyValue(name);
      const last = prev?.get(name);
      if (last === undefined || current !== last) style.setProperty(name, value);
      next.set(name, style.getPropertyValue(name));
      const key = name.startsWith('--ns-i-') ? name.slice(7) : null;
      if (key && !el.hasAttribute(attrName(key))) el.setAttribute(attrName(key), '');
    }
    if (prev) {
      for (const name of prev.keys()) {
        if (next.has(name)) continue;
        style.removeProperty(name);
        if (name.startsWith('--ns-i-')) el.removeAttribute(attrName(name.slice(7)));
      }
    }
    if (next.size) {
      if (!prev) {
        this.touched.add(new WeakRef(el));
        // Long-lived single-page apps churn through elements; drop refs to collected ones.
        if (this.touched.size > 5000) for (const ref of this.touched) if (!ref.deref()) this.touched.delete(ref);
      }
      this.written.set(el, next);
    } else this.written.delete(el);
  }

  clear() {
    for (const ref of this.touched) {
      const el = ref.deref();
      const map = el && this.written.get(el);
      if (!el || !map) continue;
      const style = (el as HTMLElement).style;
      for (const name of map.keys()) {
        style.removeProperty(name);
        if (name.startsWith('--ns-i-')) el.removeAttribute(attrName(name.slice(7)));
      }
      if (style.length === 0 && el.getAttribute('style') === '') el.removeAttribute('style');
      this.written.delete(el);
    }
    this.touched.clear();
  }
}

function legacyAttr(el: Element, attr: string): string | null {
  if (attr === 'color' && el.localName !== 'font') return null;
  if ((attr === 'fill' || attr === 'stroke' || attr === 'stop-color') && !(el instanceof SVGElement)) return null;
  const v = el.getAttribute(attr)?.trim();
  if (!v || v === 'none' || v.startsWith('url(')) return null;
  // Legacy HTML colour attributes accept bare hex ("ffffff").
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : v;
}
