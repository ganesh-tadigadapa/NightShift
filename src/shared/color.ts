export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface HSLA {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
  a: number; // 0-1
}

const NAMED_SRC =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,' +
  'black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,' +
  'chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,' +
  'darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
  'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,' +
  'dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,' +
  'ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,' +
  'honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
  'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,' +
  'mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,' +
  'mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,' +
  'midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,' +
  'oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,' +
  'palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,' +
  'pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,' +
  'royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,' +
  'sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,' +
  'violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32,' +
  // CSS system colors, resolved to their light-scheme values (what the page was designed against).
  'canvas:ffffff,canvastext:000000,linktext:0000ee,visitedtext:551a8b,buttonface:efefef,buttontext:000000,' +
  'buttonborder:767676,field:ffffff,fieldtext:000000,graytext:6d6d6d,highlight:3390ff,highlighttext:ffffff,' +
  'window:ffffff,windowtext:000000';

export const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  NAMED_SRC.split(',').map((pair) => pair.split(':') as [string, string]),
);

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

function parseHex(hex: string): RGBA | null {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1,
  };
}

function parseChannel(token: string, scale: number): number {
  return token.endsWith('%') ? (parseFloat(token) / 100) * scale : parseFloat(token);
}

function parseAlpha(token: string | undefined): number {
  if (token === undefined) return 1;
  return clamp(token.endsWith('%') ? parseFloat(token) / 100 : parseFloat(token), 0, 1);
}

function parseHue(token: string): number {
  const v = parseFloat(token);
  if (token.endsWith('turn')) return v * 360;
  if (token.endsWith('rad')) return (v * 180) / Math.PI;
  if (token.endsWith('grad')) return v * 0.9;
  return v;
}

/** Splits "a, b, c" / "a b c / d" function arguments into channel tokens + alpha. */
function splitArgs(inner: string): { channels: string[]; alpha?: string } | null {
  const [main, slashAlpha] = inner.split('/');
  const channels = main.split(/[\s,]+/).filter(Boolean);
  if (slashAlpha !== undefined) return { channels, alpha: slashAlpha.trim() };
  if (channels.length === 4) return { channels: channels.slice(0, 3), alpha: channels[3] };
  if (channels.length !== 3) return null;
  return { channels };
}

/** Parses hex, rgb[a](), hsl[a](), oklch(), oklab() and named colours. Returns null for anything else. */
export function parseColor(input: string): RGBA | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value[0] === '#') return parseHex(value);
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS.get(value);
  if (named) return parseHex('#' + named);

  const fn = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/.exec(value);
  if (!fn) return null;
  const args = splitArgs(fn[2]);
  if (!args || args.channels.some((c) => c === 'none' || Number.isNaN(parseFloat(c)))) return null;
  const a = parseAlpha(args.alpha);
  if (Number.isNaN(a)) return null;
  const [c1, c2, c3] = args.channels;

  if (fn[1] === 'oklch' || fn[1] === 'oklab') return oklabToRgb(fn[1], c1, c2, c3, a);
  if (fn[1].startsWith('rgb')) {
    return {
      r: clamp(parseChannel(c1, 255), 0, 255),
      g: clamp(parseChannel(c2, 255), 0, 255),
      b: clamp(parseChannel(c3, 255), 0, 255),
      a,
    };
  }
  return hslToRgb({
    h: parseHue(c1),
    s: clamp(parseFloat(c2) / 100, 0, 1),
    l: clamp(parseFloat(c3) / 100, 0, 1),
    a,
  });
}

function oklabToRgb(space: string, c1: string, c2: string, c3: string, alpha: number): RGBA {
  const L = c1.endsWith('%') ? parseFloat(c1) / 100 : parseFloat(c1);
  const pct = (t: string) => (t.endsWith('%') ? (parseFloat(t) / 100) * 0.4 : parseFloat(t));
  let A: number, B: number;
  if (space === 'oklch') {
    const C = pct(c2);
    const h = (parseHue(c3) * Math.PI) / 180;
    A = C * Math.cos(h);
    B = C * Math.sin(h);
  } else {
    A = pct(c2);
    B = pct(c3);
  }
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const enc = (v: number) =>
    clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055, 0, 1) * 255;
  return {
    r: enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

export function rgbToHsl({ r, g, b, a }: RGBA): HSLA {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l, a };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l, a };
}

export function hslToRgb({ h, s, l, a }: HSLA): RGBA {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v, a };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: conv(hue + 1 / 3) * 255, g: conv(hue) * 255, b: conv(hue - 1 / 3) * 255, a };
}

export function rgbToString({ r, g, b, a }: RGBA): string {
  const R = Math.round(r), G = Math.round(g), B = Math.round(b);
  if (a >= 1) return `rgb(${R}, ${G}, ${B})`;
  return `rgba(${R}, ${G}, ${B}, ${Math.round(a * 1000) / 1000})`;
}

export const hslToString = (hsl: HSLA) => rgbToString(hslToRgb(hsl));

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance({ r, g, b }: RGBA): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Parses any supported colour straight to HSL (black if unparseable). */
export function colorToHsl(color: string): HSLA {
  return rgbToHsl(parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 });
}
