import { clearSiteTheme, setDefaultTheme, setEnabled, setSiteTheme, themeForHost } from '../shared/storage';
import { buildAutoPalette, PRESETS, THEMES, type PresetId, type SiteAnalysis, type ThemeId } from '../shared/themes';
import { CheckIcon, MoonIcon, SparkleIcon } from './components/icons';
import { PowerSwitch } from './components/PowerSwitch';
import { ThemePreview } from './components/ThemePreview';
import { usePopupState, type PopupState } from './usePopupState';

const themeName = (id: ThemeId) => THEMES.find((t) => t.id === id)?.name ?? id;

export function App() {
  const state = usePopupState();
  const { loaded, settings, site } = state;
  const enabled = settings.enabled;
  const theme = site ? themeForHost(settings, site) : settings.defaultTheme;
  const remembered = !!site && settings.sites[site] !== undefined;
  const analysis = state.status?.analysis ?? (site ? settings.analysis[site] : undefined) ?? null;

  const choose = async (id: ThemeId) => {
    if (!enabled) await setEnabled(true);
    if (site) await setSiteTheme(site, id);
    else await setDefaultTheme(id);
  };

  return (
    <main className={`app ${enabled ? '' : 'is-off'} ${loaded ? 'is-loaded' : ''}`}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <MoonIcon />
          </span>
          <div className="brand-text">
            <h1>NightShift</h1>
            <p className="site" title={site ?? undefined}>
              {site ?? 'Browser page'}
            </p>
          </div>
        </div>
        <PowerSwitch on={enabled} onChange={setEnabled} />
      </header>

      <StatusLine state={state} theme={theme} />

      <section className="themes" aria-label="Themes">
        <button
          type="button"
          className={`card card-auto ${theme === 'auto' ? 'is-selected' : ''}`}
          aria-pressed={theme === 'auto'}
          onClick={() => choose('auto')}
        >
          <ThemePreview palette={buildAutoPalette(analysis)} />
          <div className="card-auto-body">
            <div className="card-title">
              <span className="sparkle">
                <SparkleIcon />
              </span>
              <span>Auto</span>
              {theme === 'auto' && <Selected />}
            </div>
            <AutoInsights analysis={analysis} />
          </div>
        </button>

        <div className="grid">
          {THEMES.filter((t) => t.id !== 'auto').map((t) => (
            <button
              key={t.id}
              type="button"
              className={`card ${theme === t.id ? 'is-selected' : ''}`}
              aria-pressed={theme === t.id}
              title={t.blurb}
              onClick={() => choose(t.id)}
            >
              <ThemePreview palette={PRESETS[t.id as PresetId]} />
              <div className="card-title">
                <span>{t.name}</span>
                {theme === t.id && <Selected />}
              </div>
            </button>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span className="footer-note">
          {site ? (remembered ? <>Remembered for {site}</> : <>Using your default theme</>) : 'Sets your default theme'}
        </span>
        <span className="footer-actions">
          {remembered && theme !== settings.defaultTheme && (
            <button type="button" className="link" onClick={() => site && clearSiteTheme(site)}>
              Reset
            </button>
          )}
          {theme !== settings.defaultTheme ? (
            <button type="button" className="link link-accent" onClick={() => setDefaultTheme(theme)}>
              Make default
            </button>
          ) : (
            <span className="footer-default">Default: {themeName(settings.defaultTheme)}</span>
          )}
        </span>
      </footer>
    </main>
  );
}

function Selected() {
  return (
    <span className="selected-badge" aria-label="Selected">
      <CheckIcon />
    </span>
  );
}

function StatusLine({ state, theme }: { state: PopupState; theme: ThemeId }) {
  const { loaded, settings, site, status } = state;
  let tone: 'ok' | 'muted' | 'warn' = 'ok';
  let text: string;
  if (!loaded) return <p className="status status-muted">&nbsp;</p>;
  if (!site) {
    tone = 'warn';
    text = "Chrome doesn't allow extensions on this page";
  } else if (!settings.enabled) {
    tone = 'muted';
    text = 'Paused on every site';
  } else if (!status) {
    tone = 'warn';
    text = 'Not available on this page';
  } else if (status.nativeDark) {
    text = 'Site was already dark. Auto softened its glare';
  } else {
    text = `${themeName(theme)} is active`;
  }
  return (
    <p className={`status status-${tone}`} role="status">
      <span className="status-dot" />
      {text}
    </p>
  );
}

function AutoInsights({ analysis }: { analysis: SiteAnalysis | null }) {
  if (!analysis) return <p className="card-sub">Learns each site's colors and adapts</p>;
  const chips: { label: string; hue?: number }[] = [];
  if (analysis.nativeDark) chips.push({ label: 'Glare softened' });
  if (analysis.accentHue !== null) chips.push({ label: 'Brand tint', hue: analysis.accentHue });
  if (analysis.textHeavy) chips.push({ label: 'Reading' });
  if (analysis.imageHeavy) chips.push({ label: 'Photo-friendly' });
  if (!chips.length) chips.push({ label: 'Neutral' });
  return (
    <div className="chips">
      {chips.map((c) => (
        <span key={c.label} className="chip">
          {c.hue !== undefined && <i className="chip-dot" style={{ background: `hsl(${c.hue} 70% 62%)` }} />}
          {c.label}
        </span>
      ))}
    </div>
  );
}
