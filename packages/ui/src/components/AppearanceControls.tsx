import { useTheme } from '../theme/ThemeProvider';
import { CONTRASTS, SCALE_LABELS, THEMES, UI_SCALES } from '../theme/constants';

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' } as const;

/** Text-size chooser (native radios). Scaling the root font-size scales the whole UI. */
export function TextSizeControl() {
  const { scale, setScale } = useTheme();
  return (
    <fieldset className="ccn-field">
      <legend className="ccn-legend">Text size</legend>
      <div className="ccn-chips">
        {UI_SCALES.map((s) => (
          <label key={s} className="ccn-chip" data-scale={s}>
            <input
              type="radio"
              name="ccn-text-size"
              value={s}
              checked={scale === s}
              onChange={() => setScale(s)}
            />
            {SCALE_LABELS[s]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Light / Dark / System (native radios). */
export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset className="ccn-field">
      <legend className="ccn-legend">Theme</legend>
      <div className="ccn-chips">
        {THEMES.map((t) => (
          <label key={t} className="ccn-chip">
            <input
              type="radio"
              name="ccn-theme"
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
            />
            {THEME_LABELS[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** High-contrast toggle (native checkbox). */
export function ContrastControl() {
  const { contrast, setContrast } = useTheme();
  return (
    <label className="ccn-switch">
      <input
        type="checkbox"
        checked={contrast === 'high'}
        onChange={(e) => setContrast(e.target.checked ? CONTRASTS[1] : CONTRASTS[0])}
      />
      Higher contrast
    </label>
  );
}

/** All three appearance controls together (header/settings menu). */
export function AppearanceControls() {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
      <TextSizeControl />
      <ThemeControl />
      <ContrastControl />
    </div>
  );
}
