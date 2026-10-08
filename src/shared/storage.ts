import type { SiteAnalysis, ThemeId } from './themes';

export interface Settings {
  enabled: boolean;
  /** Theme for sites the user hasn't picked one for. */
  defaultTheme: ThemeId;
  /** Per-site theme choice, keyed by siteKeyFromUrl(). */
  sites: Record<string, ThemeId>;
  /** Auto's per-site analysis cache, so revisits render the right palette instantly. */
  analysis: Record<string, SiteAnalysis>;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  defaultTheme: 'auto',
  sites: {},
  analysis: {},
};

const MAX_ANALYSIS_ENTRIES = 400;

/** The key a theme choice is remembered under: the hostname without "www.", or "file://" for local files. */
export function siteKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'file://';
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    /* not a URL */
  }
  return null;
}

export async function getSettings(): Promise<Settings> {
  // Passing the defaults object fills in any keys that haven't been stored yet.
  return chrome.storage.local.get<Settings>(DEFAULT_SETTINGS);
}

export function themeForHost(settings: Settings, host: string): ThemeId {
  return settings.sites[host] ?? settings.defaultTheme;
}

export async function setEnabled(enabled: boolean) {
  await chrome.storage.local.set({ enabled });
}

export async function setSiteTheme(host: string, theme: ThemeId) {
  const { sites } = await getSettings();
  await chrome.storage.local.set({ sites: { ...sites, [host]: theme } });
}

export async function clearSiteTheme(host: string) {
  const { sites } = await getSettings();
  const next = { ...sites };
  delete next[host];
  await chrome.storage.local.set({ sites: next });
}

export async function setDefaultTheme(theme: ThemeId) {
  await chrome.storage.local.set({ defaultTheme: theme });
}

export async function saveAnalysis(host: string, analysis: SiteAnalysis) {
  const current = (await getSettings()).analysis;
  const entries = Object.entries({ ...current, [host]: analysis })
    .sort((a, b) => b[1].analyzedAt - a[1].analyzedAt)
    .slice(0, MAX_ANALYSIS_ENTRIES);
  await chrome.storage.local.set({ analysis: Object.fromEntries(entries) });
}
