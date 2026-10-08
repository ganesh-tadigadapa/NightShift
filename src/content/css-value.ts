import { NAMED_COLORS, parseColor, rgbToHsl } from '../shared/color';
import type { ColorMapper, Role } from './mapper';

/**
 * CSS custom properties can't be mapped in place — the same `--brand` might be used as a
 * background in one rule and as text in another. So for every colour-valued custom property
 * we emit one variant per role (`--ns-bg--brand`, `--ns-text--brand`, …) and rewrite each
 * usage to the variant matching where it's used, falling back to the original variable.
 */
export const ROLES: Role[] = ['bg', 'text', 'border', 'shadow'];
export const nsVar = (role: Role, name: string) => `--ns-${role}${name}`;

export interface ValueContext {
  mapper: ColorMapper;
  /** Base URL for resolving relative url()s (stylesheet href); null keeps them as-is. */
  base: string | null;
  /** Lets the caller substitute background images (e.g. inverted dark icons). */
  mapImage?: (absoluteUrl: string) => string | null;
}

const IDENT = /-?[a-zA-Z_][\w-]*/y;
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/y;
const COLOR_FN = /^(rgba?|hsla?|oklch|oklab)$/;
const SKIP_IDENTS = new Set(['transparent', 'currentcolor']);

/** Index of the `)` matching the `(` at `open`, honouring nested parens and quotes. */
function findClose(s: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return s.length;
}

/** Splits on `sep` only at the top level (outside parentheses). */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === sep && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

/** Cheap pre-check so we don't tokenise values that can't contain colours. */
export function mayContainColor(value: string): boolean {
  if (/[#(]/.test(value)) return true;
  const words = value.toLowerCase().match(/[a-z]+/g);
  return !!words?.some((w) => NAMED_COLORS.has(w));
}

/** Rewrites every colour (and colour variable) in a CSS value for the given role. */
export function transformValue(value: string, role: Role, ctx: ValueContext): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const ch = value[i];

    if (ch === '#') {
      HEX.lastIndex = i;
      const m = HEX.exec(value);
      if (m) {
        out += ctx.mapper.mapString(m[0], role) ?? m[0];
        i += m[0].length;
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < value.length && value[j] !== ch) j += value[j] === '\\' ? 2 : 1;
      out += value.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    IDENT.lastIndex = i;
    const id = /[a-zA-Z_-]/.test(ch) ? IDENT.exec(value) : null;
    if (!id) {
      out += ch;
      i++;
      continue;
    }

    const ident = id[0];
    const lower = ident.toLowerCase();
    i += ident.length;

    if (value[i] !== '(') {
      out += NAMED_COLORS.has(lower) && !SKIP_IDENTS.has(lower) ? ctx.mapper.mapString(lower, role) ?? ident : ident;
      continue;
    }

    const close = findClose(value, i);
    const inner = value.slice(i + 1, close);
    i = close + 1;

    if (lower === 'url') out += transformUrl(inner, role, ctx);
    else if (lower === 'var') out += transformVar(inner, role, ctx);
    else if (COLOR_FN.test(lower)) out += transformColorFn(lower, inner, role, ctx);
    else out += `${ident}(${transformValue(inner, role, ctx)})`;
  }
  return out;
}

function transformUrl(inner: string, role: Role, ctx: ValueContext): string {
  const raw = inner.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!raw || raw.startsWith('#')) return `url(${inner})`;
  let abs = raw;
  if (ctx.base && !/^(data|blob):/i.test(raw)) {
    try {
      abs = new URL(raw, ctx.base).href;
    } catch {
      /* keep raw */
    }
  }
  const replaced = role === 'bg' && ctx.mapImage ? ctx.mapImage(abs) : null;
  return replaced || abs !== raw ? `url("${(replaced ?? abs).replace(/"/g, '%22')}")` : `url(${inner})`;
}

function transformVar(inner: string, role: Role, ctx: ValueContext): string {
  const comma = inner.indexOf(',');
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  if (!name.startsWith('--') || name.startsWith('--ns-')) return `var(${inner})`;
  const fallback = comma < 0 ? '' : `,${transformValue(inner.slice(comma + 1), role, ctx)}`;
  return `var(${nsVar(role, name)}, var(${name}${fallback}))`;
}

function transformColorFn(fn: string, inner: string, role: Role, ctx: ValueContext): string {
  if (!inner.includes('var(')) return ctx.mapper.mapString(`${fn}(${inner})`, role) ?? `${fn}(${inner})`;

  // Utility frameworks write `rgb(255 255 255 / var(--tw-bg-opacity))`: literal channels with a
  // variable alpha. Map the channels and keep the alpha expression.
  const slash = splitTop(inner, '/');
  const commas = splitTop(inner, ',');
  let channels: string | null = null;
  let alpha = '';
  if (slash.length === 2 && !slash[0].includes('var(')) [channels, alpha] = slash;
  else if (commas.length === 4 && !commas.slice(0, 3).join().includes('var(')) {
    channels = commas.slice(0, 3).join(',');
    alpha = commas[3];
  }
  if (channels !== null) {
    const rgb = parseColor(`${fn.startsWith('hsl') ? 'hsl' : fn.startsWith('rgb') ? 'rgb' : fn}(${channels})`);
    if (rgb) {
      const m = ctx.mapper.map(rgb, role);
      return `rgb(${Math.round(m.r)} ${Math.round(m.g)} ${Math.round(m.b)} / ${transformValue(alpha, role, ctx).trim()})`;
    }
  }
  // Channels come from variables (`hsl(var(--background))`); the role variants hold mapped channels.
  return `${fn}(${transformValue(inner, role, ctx)})`;
}

const RGB_TRIPLET = /^\s*(\d{1,3}(?:\.\d+)?)(\s*,\s*|\s+)(\d{1,3}(?:\.\d+)?)\2(\d{1,3}(?:\.\d+)?)\s*$/;
const HSL_TRIPLET = /^\s*(-?\d*\.?\d+)(?:deg)?(\s*,\s*|\s+)(\d*\.?\d+)%\2(\d*\.?\d+)%\s*$/;

/** Bare channel lists (`255 255 255`, `210 40% 98%`) used as `rgb(var(--x))` / `hsl(var(--x))`. */
function transformTriplet(value: string, role: Role, mapper: ColorMapper): string | null {
  let m = RGB_TRIPLET.exec(value);
  if (m) {
    const [r, g, b] = [m[1], m[3], m[4]].map(Number);
    if (r > 255 || g > 255 || b > 255) return null;
    const c = mapper.map({ r, g, b, a: 1 }, role);
    return [c.r, c.g, c.b].map(Math.round).join(m[2]);
  }
  m = HSL_TRIPLET.exec(value);
  if (m) {
    const rgb = parseColor(`hsl(${m[1]} ${m[3]}% ${m[4]}%)`);
    if (!rgb) return null;
    const h = rgbToHsl(mapper.map(rgb, role));
    const f = (n: number) => Math.round(n * 10) / 10;
    return `${f(h.h)}${m[2]}${f(h.s * 100)}%${m[2]}${f(h.l * 100)}%`;
  }
  return null;
}

/** Role variants (`[name, value]` pairs) for a custom property, or null if it doesn't hold a colour. */
export function customPropertyVariants(name: string, value: string, ctx: ValueContext): [string, string][] | null {
  if (name.startsWith('--ns-')) return null;
  const isTriplet = RGB_TRIPLET.test(value) || HSL_TRIPLET.test(value);
  if (!isTriplet && !value.includes('var(') && !mayContainColor(value)) return null;
  const plain = { ...ctx, mapImage: undefined };
  return ROLES.map((role) => [
    nsVar(role, name),
    (isTriplet && transformTriplet(value, role, ctx.mapper)) || transformValue(value, role, plain).trim(),
  ]);
}
