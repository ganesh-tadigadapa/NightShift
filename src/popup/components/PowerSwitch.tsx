interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
}

export function PowerSwitch({ on, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Dark mode"
      title={`Turn ${on ? 'off' : 'on'} (Alt+Shift+N)`}
      className={`switch ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="switch-track">
        <span className="switch-label switch-label-on">ON</span>
        <span className="switch-label switch-label-off">OFF</span>
        <span className="switch-thumb" />
      </span>
    </button>
  );
}
