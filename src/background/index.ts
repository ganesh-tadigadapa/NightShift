import type { FetchResponse, Message } from '../shared/messages';
import { DEFAULT_SETTINGS, getSettings, setEnabled } from '../shared/storage';

const MAX_BYTES = 6 * 1024 * 1024;
const cache = new Map<string, Promise<FetchResponse>>();

/**
 * Content scripts can't read cross-origin stylesheets or images through the CSSOM/canvas,
 * so they ask us (we hold host permissions) to fetch them.
 */
async function fetchResource(url: string, as: 'text' | 'dataURL'): Promise<FetchResponse> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, error: 'too large' };
    if (as === 'text') return { ok: true, data: new TextDecoder().decode(buf) };
    const type = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    return { ok: true, data: `data:${type};base64,${toBase64(new Uint8Array(buf))}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg?.type !== 'ns:fetch') return false;
  const key = `${msg.as}|${msg.url}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchResource(msg.url, msg.as);
    cache.set(key, pending);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    pending.then((r) => !r.ok && cache.delete(key));
  }
  pending.then(sendResponse);
  return true; // async response
});

function updateIcon(enabled: boolean) {
  const prefix = enabled ? 'icon' : 'icon-off';
  chrome.action.setIcon({
    path: { 16: `icons/${prefix}-16.png`, 32: `icons/${prefix}-32.png`, 48: `icons/${prefix}-48.png` },
  });
  chrome.action.setTitle({ title: enabled ? 'NightShift — on' : 'NightShift — off' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateIcon(changes.enabled.newValue !== false);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-nightshift') return;
  const { enabled } = await getSettings();
  await setEnabled(!enabled);
});

chrome.runtime.onStartup.addListener(async () => updateIcon((await getSettings()).enabled));

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const missing = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([k]) => !(k in stored)));
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  updateIcon((await getSettings()).enabled);

  // Tabs that were open before install/update have no content script yet — inject it now.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file://*/*'] });
  for (const tab of tabs) {
    if (tab.id === undefined || tab.discarded) continue;
    const target = { tabId: tab.id, allFrames: true };
    chrome.scripting
      .executeScript({ target, files: ['hook.js'], world: 'MAIN', injectImmediately: true })
      .then(() => chrome.scripting.executeScript({ target, files: ['content.js'], injectImmediately: true }))
      .catch(() => {
        /* restricted page (web store, PDF viewer, …) */
      });
  }
});
