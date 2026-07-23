import { useEffect, useRef, useState } from 'react';

export function SaveTag({ status }) {
  if (!status || status === 'idle') return null;
  const text = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  return <span className={`wb-save wb-save-${status}`}>{text}</span>;
}

// Self-contained autosaving text field. onSave(value) → { ok, error? }.
export function AutoText({ label, initial, onSave, multiline = false, rows = 3, placeholder, monospace = false, disabled = false, inputRef, ariaLabel = undefined }) {
  const [val, setVal] = useState(initial ?? '');
  const [status, setStatus] = useState('idle');
  // A successful save round-trips through a full workbench swap, which changes
  // `initial` to the value we just saved. Without this flag the re-seed effect
  // below would immediately stomp the 'saved' status back to 'idle' before it's
  // ever visible. Only reset to 'idle' when `initial` changes for some other
  // reason (e.g. navigating to a different song).
  const savedByUs = useRef(false);

  // Re-seed when the upstream value changes (e.g. after a full-workbench swap).
  useEffect(() => {
    setVal(initial ?? '');
    if (savedByUs.current) savedByUs.current = false;
    else setStatus('idle');
  }, [initial]);

  const commit = async () => {
    if (disabled) return; // guarded field — never fire onSave
    if ((val ?? '') === (initial ?? '')) return; // unchanged — no request
    setStatus('saving');
    const res = await onSave(val);
    if (res && res.ok) savedByUs.current = true;
    setStatus(res && res.ok ? 'saved' : 'error');
  };

  const common = {
    ref: inputRef,
    className: `input${monospace ? ' wb-mono' : ''}`,
    value: val,
    placeholder,
    disabled,
    onChange: (e) => { if (disabled) return; setVal(e.target.value); if (status !== 'idle') setStatus('idle'); },
    onBlur: commit,
    style: { width: '100%' },
    'aria-label': ariaLabel,
  };

  return (
    <label className="wb-field">
      <span className="wb-field-label">{label} <SaveTag status={status} /></span>
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
    </label>
  );
}
