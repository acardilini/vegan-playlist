import { useEffect, useState } from 'react';

export function SaveTag({ status }) {
  if (!status || status === 'idle') return null;
  const text = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  return <span className={`wb-save wb-save-${status}`}>{text}</span>;
}

// Self-contained autosaving text field. onSave(value) → { ok, error? }.
export function AutoText({ label, initial, onSave, multiline = false, rows = 3, placeholder, monospace = false }) {
  const [val, setVal] = useState(initial ?? '');
  const [status, setStatus] = useState('idle');

  // Re-seed when the upstream value changes (e.g. after a full-workbench swap).
  useEffect(() => { setVal(initial ?? ''); setStatus('idle'); }, [initial]);

  const commit = async () => {
    if ((val ?? '') === (initial ?? '')) return; // unchanged — no request
    setStatus('saving');
    const res = await onSave(val);
    setStatus(res && res.ok ? 'saved' : 'error');
  };

  const common = {
    className: `input${monospace ? ' wb-mono' : ''}`,
    value: val,
    placeholder,
    onChange: (e) => { setVal(e.target.value); if (status !== 'idle') setStatus('idle'); },
    onBlur: commit,
    style: { width: '100%' },
  };

  return (
    <label className="wb-field">
      <span className="wb-field-label">{label} <SaveTag status={status} /></span>
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
    </label>
  );
}
