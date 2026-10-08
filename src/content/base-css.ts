import type { Palette } from '../shared/themes';
import { inlineCss } from './inline';
import type { ColorMapper } from './mapper';

/**
 * Rules for things no page stylesheet mentions: the canvas, UA defaults, selection,
 * scrollbars, media. Everything that should yield to the page is wrapped in :where()
 * (zero specificity), so any rule the page has — and our mapped copy of it — wins.
 */
export function baseCss(p: Palette, m: ColorMapper): string {
  const c = (color: string, role: 'bg' | 'text' | 'border') => m.mapString(color, role) ?? color;
  const surface = c('#f1f1f1', 'bg');
  const border = c('#cfcfcf', 'border');
  const thumb = c('#9a9a9a', 'border');
  const mark = c('#ffff00', 'bg');
  const img = p.images;
  const imgFilter =
    img.brightness < 1 || img.contrast !== 1 ? `brightness(${img.brightness}) contrast(${img.contrast})` : 'none';

  return `
:root{color-scheme:dark !important;--ns-bg:${p.background};--ns-text:${p.text};--ns-link:${p.link}}
:where(html){background-color:${p.background};color:${p.text}}
html{scrollbar-color:${thumb} ${p.background}}
::selection{background-color:${p.selection} !important;color:${p.text} !important}
:where(a:any-link){color:${p.link}}
:where(a:visited){color:${p.visited}}
:where(mark){background-color:${mark};color:${p.text}}
:where(input,textarea,select,button){border-color:${border}}
:where(input,textarea,select)::placeholder{color:${c('#8a8a8a', 'text')}}
:where(hr){border-color:${border}}
:where(table,th,td){border-color:${border}}
:where(dialog){background-color:${surface};color:${p.text}}
:where(img:not([data-ns-img]),canvas){filter:${imgFilter}}
${p.video < 1 ? `:where(video){filter:brightness(${p.video})}` : ''}
img[data-ns-img="invert"]{filter:invert(0.88) hue-rotate(180deg) !important}
img[data-ns-img="dim"]{filter:brightness(${Math.min(0.75, img.brightness)}) !important}
${inlineCss()}
`;
}

/**
 * Shown from document_start until the page's own (possibly cross-origin) stylesheets have been
 * processed, so a light page never flashes white while we catch up.
 */
export function fallbackCss(p: Palette, m: ColorMapper): string {
  const border = m.mapString('#cfcfcf', 'border') ?? p.text;
  return `html,body,body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){background-color:${p.background} !important;border-color:${border} !important;color:${p.text} !important}`;
}
