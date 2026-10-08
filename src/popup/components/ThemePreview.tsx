import { previewColors, type Palette } from '../../shared/themes';

/** A miniature page rendered in the palette: a header bar, two text lines and a link. */
export function ThemePreview({ palette }: { palette: Palette }) {
  const c = previewColors(palette);
  return (
    <div className="preview" style={{ background: c.background, borderColor: c.border }} aria-hidden>
      <div className="preview-bar" style={{ background: c.surface }}>
        <span style={{ background: c.link }} />
      </div>
      <div className="preview-body">
        <span className="preview-line" style={{ background: c.text, width: '78%' }} />
        <span className="preview-line" style={{ background: c.text, width: '56%', opacity: 0.55 }} />
        <span className="preview-line" style={{ background: c.link, width: '34%' }} />
      </div>
    </div>
  );
}
