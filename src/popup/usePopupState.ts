import { useCallback, useEffect, useState } from 'react';
import type { TabStatus } from '../shared/messages';
import { DEFAULT_SETTINGS, getSettings, siteKeyFromUrl, type Settings } from '../shared/storage';

export interface PopupState {
  loaded: boolean;
  settings: Settings;
  /** Site key for the active tab, or null on pages extensions can't touch. */
  site: string | null;
  /** What the content script reports; null if it isn't running in this tab. */
  status: TabStatus | null;
}

async function queryStatus(tabId: number): Promise<TabStatus | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: 'ns:status' }, { frameId: 0 })) ?? null;
  } catch {
    return null;
  }
}

export function usePopupState(): PopupState {
  const [state, setState] = useState<PopupState>({
    loaded: false,
    settings: DEFAULT_SETTINGS,
    site: null,
    status: null,
  });
  const [tabId, setTabId] = useState<number | null>(null);

  const refresh = useCallback(async (id: number | null) => {
    const settings = await getSettings();
    const status = id === null ? null : await queryStatus(id);
    setState((s) => ({ ...s, loaded: true, settings, status }));
  }, []);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const site = tab?.url ? siteKeyFromUrl(tab.url) : null;
      const id = tab?.id ?? null;
      setTabId(id);
      setState((s) => ({ ...s, site }));
      refresh(id);
    });
  }, [refresh]);

  useEffect(() => {
    let timer = 0;
    const onChange = (_: unknown, area: string) => {
      if (area !== 'local') return;
      // Settings update instantly; give the page a beat to re-render before asking for its status.
      getSettings().then((settings) => setState((s) => ({ ...s, settings })));
      clearTimeout(timer);
      timer = window.setTimeout(() => refresh(tabId), 300);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      clearTimeout(timer);
    };
  }, [refresh, tabId]);

  return state;
}
