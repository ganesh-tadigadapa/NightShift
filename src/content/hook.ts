/**
 * Runs in the page's MAIN world. CSS-in-JS libraries (emotion, styled-components, …) add
 * rules through the CSSOM, which fires no DOM mutations. We wrap those APIs and ping the
 * isolated-world engine with a DOM event so it can restyle the new rules. Likewise for new
 * open shadow roots, whose styles document-level overrides can't reach.
 */
import { SHADOW_EVENT, SHEET_EVENT } from '../shared/constants';

(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w[SHEET_EVENT]) return;
  w[SHEET_EVENT] = true;

  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      document.dispatchEvent(new Event(SHEET_EVENT));
    }, 0);
  };

  const proto = CSSStyleSheet.prototype as unknown as Record<string, unknown>;
  for (const name of ['insertRule', 'deleteRule', 'addRule', 'removeRule', 'replace', 'replaceSync']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    const wrapped = {
      [name](this: CSSStyleSheet, ...args: unknown[]) {
        const result = (original as (...a: unknown[]) => unknown).apply(this, args);
        notify();
        return result;
      },
    }[name];
    Object.defineProperty(proto, name, { value: wrapped, writable: true, configurable: true, enumerable: true });
  }

  for (const target of [Document.prototype, ShadowRoot.prototype]) {
    const desc = Object.getOwnPropertyDescriptor(target, 'adoptedStyleSheets');
    if (!desc?.set) continue;
    Object.defineProperty(target, 'adoptedStyleSheets', {
      ...desc,
      set(this: Document | ShadowRoot, value: CSSStyleSheet[]) {
        desc.set!.call(this, value);
        notify();
      },
    });
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Object.defineProperty(Element.prototype, 'attachShadow', {
    value: function attachShadow(this: Element, init: ShadowRootInit) {
      const root = originalAttachShadow.call(this, init);
      if (init?.mode === 'open') {
        // Hosts still being constructed aren't connected yet; the engine finds those on insertion.
        queueMicrotask(() => this.dispatchEvent(new Event(SHADOW_EVENT, { bubbles: true, composed: true })));
      }
      return root;
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
})();
