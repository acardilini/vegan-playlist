import { useState, useRef, useEffect, useId } from 'react';

// Hover/focus tooltip. Replaces the native `title` attribute, which waits about a second
// before appearing and cannot be styled. Either wraps its trigger (default) or renders a
// small "i" button (icon). Shows fast on hover, immediately on keyboard focus.
const SHOW_DELAY_MS = 120;

function InfoTip({ text, label, icon = false, children }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!text) return icon ? null : children;

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="infotip"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {icon ? (
        <button type="button" className="infotip-icon" aria-label={label}
          aria-describedby={open ? id : undefined}>i</button>
      ) : (
        <span className="infotip-trigger" tabIndex={0} aria-describedby={open ? id : undefined}>
          {children}
        </span>
      )}
      {open && <span role="tooltip" id={id} className="infotip-bubble">{text}</span>}
    </span>
  );
}

export default InfoTip;
