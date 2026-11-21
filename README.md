# NightShift

<img src="public/icons/icon-128.png" alt="NightShift icon" width="64" height="64">

Most dark mode extensions I tried either flip the whole page with `invert()` (so photos look like negatives) or give you a panel of sliders you have to tweak on every site. I wanted one switch, a few good themes, and for it to remember what I picked per site.

So I built NightShift, a Chrome extension (Manifest V3) that rewrites a page's colors into a dark theme that's easy on the eyes.

## What it does

- One on/off switch in the popup, plus **Alt+Shift+N** to toggle it everywhere (you can change that at `chrome://extensions/shortcuts`)
- Seven themes: Auto, OLED Black, Carbon, Midnight, Graphite, Forest and Eclipse
- Remembers the theme per site. There's a **Make default** button and a **Reset** button in the popup
- Rewrites colors one by one instead of using a blanket `invert()`, so text stays crisp and photos look normal
- Handles images by type: dark logos on transparent backgrounds get inverted so you can still see them, white diagrams become dark paper, photos are only dimmed a bit
- No white flash while the page loads
- Turning it off removes everything it added, so the page goes back to how it was

New sites use **Auto** until you set a different default. Auto looks at the site's original colors and adapts: it softens glare on sites that are already dark, tints surfaces with the site's brand color, lowers contrast on reading pages, and dims photo-heavy pages less.

I tuned the themes for long reading sessions. Body text is a warm off-white at about 9 to 12:1 contrast instead of pure white on black (about 20:1), which tends to glow on dark screens. Graphite is the softest at around 8.6:1. Bright accent colors are capped so they can't outshine the text, and images get dimmed without any contrast boost.

## Installing

It's not on the Chrome Web Store, so you build it and load it yourself. Needs Chrome 120 or newer.

```bash
npm install
npm run build        # outputs dist/
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `dist/` folder.

## How it works

The content script reads the page's colors and maps each one based on what it's used for:

- **Backgrounds**: white becomes the theme background, light greys become slightly raised surfaces. I used a `sqrt` curve here so the faint difference between, say, a white page and an off-white card doesn't disappear.
- **Text**: dark text becomes light, colored text keeps its hue but gets lighter.
- **Borders and shadows** get their own mapping. Saturated colors like buttons keep their hue and are darkened just enough for light text on top.

The tricky part was getting this to work on real sites. A few things it has to deal with:

- Every page stylesheet gets a companion override sheet placed right after it, so the page's own cascade order still holds. Cross-origin sheets can't be read by the page, so the service worker fetches them.
- `@import`, `@media`, `@supports`, `@layer`, `@container`, nesting, and constructed `adoptedStyleSheets`.
- CSS-in-JS libraries that add rules through `insertRule`. A small script running in the page's own world ([hook.ts](src/content/hook.ts)) catches those.
- CSS variables and design tokens. Each color variable gets a variant per role, and each `var(--x)` is rewritten to the right one. This also covers shadcn-style HSL triplets, Tailwind's `rgb(255 255 255 / var(--tw-bg-opacity))` and `oklch()`.
- Inline `style`, old `bgcolor` / `<font color>` attributes, and SVG `fill` / `stroke`.
- Open shadow roots (web components). Embedded frames use the same theme as the page around them.

Images are sampled on a canvas to decide whether to invert, dim, or leave them alone ([images.ts](src/content/images.ts)).

```
src/
  background/index.ts   service worker: cross-origin fetches, shortcut, toolbar icon
  content/              the theming engine
    mapper.ts           maps each color by role
    stylesheets.ts      companion override sheets
    css-value.ts        CSS values and design tokens
    inline.ts           inline styles and legacy attributes
    images.ts           image sampling
    auto.ts             Auto's site analysis
    base-css.ts         fallback sheet that blocks the white flash
    hook.ts             main-world hook for CSS-in-JS
  popup/                React popup
  shared/               color math, theme presets, storage
```

The popup is React. The content, hook and background scripts are built by Vite as single-file IIFE bundles, because MV3 content scripts can't be ES modules.

## Permissions and privacy

- `storage` to save the switch, your default theme, per-site choices and Auto's cached analysis (capped at 400 sites) in `chrome.storage.local`
- `scripting` to inject into tabs that were already open when you install or update
- `<all_urls>` so it can run on every site, and so the service worker can re-fetch cross-origin stylesheets and images

No analytics, no tracking, no server. The only network requests it makes are re-fetches of stylesheets and images the page already uses.

## Development

```bash
npm run dev          # rebuild on change, then hit reload on the extension card
npm run typecheck
npm run package      # builds and zips dist/ into nightshift.zip
npm run icons        # regenerates the toolbar icons
```

CI runs the typecheck and build on pushes to main and on pull requests.

## Known limits

- Closed shadow roots and canvas-drawn UIs (maps, some editors) can't be restyled. Canvas only gets dimmed.
- Chrome doesn't let extensions run on `chrome://` pages, the Web Store or the built-in PDF viewer.
- Background images are only touched when they're dark icons on a transparent background. Big decorative backgrounds are left alone.
