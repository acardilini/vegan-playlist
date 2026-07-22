import { useState, useRef, useEffect, useId } from 'react';

// Hover/focus tooltip wrapping its trigger. Replaces the native `title` attribute, which
// waits about a second before appearing and cannot be styled. Shows fast on hover,
// immediately on keyboard focus.
//
// There was an "i" icon mode; the curator found the icons cluttered both the sidebar and
// the song page, so it was removed rather than left as an unused branch. That explanatory
// copy is headed for the About pages instead.
const SHOW_DELAY_MS = 120;

function InfoTip({ text, children }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!text) return children;

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
      <span className="infotip-trigger" tabIndex={0} aria-describedby={open ? id : undefined}>
        {children}
      </span>
      {open && <span role="tooltip" id={id} className="infotip-bubble">{text}</span>}
    </span>
  );
}

export default InfoTip;
