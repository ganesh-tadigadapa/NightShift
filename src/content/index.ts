import type { Message, TabStatus } from '../shared/messages';
import { getSettings, saveAnalysis, siteKeyFromUrl, themeForHost, type Settings } from '../shared/storage';
import { buildAutoPalette, PRESETS, type SiteAnalysis } from '../shared/themes';
import { analyzePage } from './auto';
import { Engine } from './engine';
import { OWN_ATTR } from './stylesheets';

const INSTANCE_FLAG = '__nightshift_engine__';

/** Frames inherit the top-level site's choice, so an embedded widget matches its page. */
function resolveSite(): string {
  const origins = location.ancestorOrigins;
  if (window !== window.top && origins?.length) {
    return siteKeyFromUrl(origins[origins.length - 1]) ?? '';
  }
  return siteKeyFromUrl(location.href) ?? '';
}

function isStylableDocument() {
  const type = document.contentType;
  return type.includes('html') || type === 'text/plain';
}

async function main() {
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTANCE_FLAG] || !isStylableDocument()) return;
  w[INSTANCE_FLAG] = true;

  // A previous instance (before an extension reload) may have left its styles behind.
  document.querySelectorAll(`[${OWN_ATTR}]`).forEach((el) => el.remove());

  const site = resolveSite();
  const isTop = window === window.top;
  const engine = new Engine();
  let settings: Settings = await getSettings();
  let analysis: SiteAnalysis | null = settings.analysis[site] ?? null;
  let analysisScheduled = false;

  const currentTheme = () => themeForHost(settings, site);

  const render = () => {
    if (!settings.enabled) return engine.stop();
    const theme = currentTheme();
    if (theme !== 'auto') return engine.apply(PRESETS[theme]);
    // Already-dark sites still get restyled: their glaring whites and neon accents are
    // pulled into the same comfortable ranges as everything else.
    engine.apply(buildAutoPalette(analysis));
    scheduleAnalysis();
  };

  const runAnalysis = () => {
    if (!settings.enabled || currentTheme() !== 'auto' || !document.body) return;
    const result = engine.running ? engine.withStylesDisabled(analyzePage) : analyzePage();
    const strip = (a: SiteAnalysis | null) => a && JSON.stringify({ ...a, analyzedAt: 0 });
    const changed = strip(result) !== strip(analysis);
    analysis = result;
    if (changed) {
      render();
      if (isTop && site) saveAnalysis(site, result).catch(() => {});
    }
  };

  function scheduleAnalysis() {
    if (analysisScheduled) return;
    analysisScheduled = true;
    const whenLoaded = () => setTimeout(runAnalysis, 600);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(runAnalysis, 50), { once: true });
      window.addEventListener('load', whenLoaded, { once: true });
    } else if (document.readyState === 'interactive') {
      setTimeout(runAnalysis, 50);
      window.addEventListener('load', whenLoaded, { once: true });
    } else {
      setTimeout(runAnalysis, 50);
    }
  }

  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!(changes.enabled || changes.defaultTheme || changes.sites)) return;
    getSettings().then((next) => {
      settings = next;
      render();
    });
  });

  chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    if (msg?.type !== 'ns:status' || !isTop) return false;
    const theme = currentTheme();
    const status: TabStatus = {
      host: site,
      theme,
      active: engine.running,
      nativeDark: settings.enabled && theme === 'auto' && !!analysis?.nativeDark,
      analysis,
    };
    sendResponse(status);
    return false;
  });

  // After the extension is reloaded/updated this script is orphaned; clean up so the new one takes over.
  engine.onPoll = () => {
    if (!chrome.runtime?.id) engine.stop(true);
  };
}

main().catch(() => {
  /* extension context invalidated mid-start, or storage unavailable */
});
