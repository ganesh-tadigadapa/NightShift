import type { SiteAnalysis, ThemeId } from './themes';

export type FetchRequest = { type: 'ns:fetch'; url: string; as: 'text' | 'dataURL' };
export type FetchResponse = { ok: true; data: string } | { ok: false; error: string };

export type StatusRequest = { type: 'ns:status' };
export interface TabStatus {
  host: string;
  theme: ThemeId;
  /** True when NightShift is actually restyling the page right now. */
  active: boolean;
  /** Auto detected the site is already dark and stepped aside. */
  nativeDark: boolean;
  analysis: SiteAnalysis | null;
}

export type Message = FetchRequest | StatusRequest;
