import { useEffect, useMemo, useRef, useState } from 'react';
import { drawTimeline } from './timelineDraw';
import {
  binForSec, binFromX, activeSample, activeSection, fmtTime, readout, secForBin, stepBin,
} from '../utils/timelineModel';

// "Through the song": the audio analysis laid out over the song's running time. A mirrored loudness ribbon with two
// toggleable curves (Grit solid, Beat Pulse dashed), the analysed sections, and - only when the curator approved the
// samples, which the server enforces by sending none otherwise - the clips of sampled speech or sound, each with its
// speaker only when the analysis was highly confident who it was. Hover (or drag on touch) to inspect a moment, click
// or tap to pin it; arrow keys, Home and End move the cursor.
//
// The two toggles ARE the legend, so nothing repeats under the chart, and nothing here repeats what the page header
// already says (title, artist, tempo, key). Definitions of grit and pulse belong on the About > Reference pages.

function readColours() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grit: v('--tl-grit', '#e8601f'),
    pulse: v('--tl-pulse', '#2a9fdc'),
    sample: v('--tl-sample', '#d94f9d'),
    ribbon: v('--tl-ribbon', '#8a96ad'),
    surface: v('--bg-surface', '#1c1611'),
    grid: v('--border-hairline', 'rgba(255,255,255,0.14)'),
    border: v('--border-hairline', 'rgba(255,255,255,0.14)'),
    text: v('--text-muted', '#9a9088'),
    cursor: v('--text-primary', '#f5f0eb'),
    fmt: fmtTime,
  };
}

const timed = (s) => s && s.startSec != null && s.endSec != null;

function Swatch({ dashed, colour }) {
  return (
    <svg className="tl-swatch" width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
      <line x1="1" y1="4" x2="17" y2="4" stroke={colour} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
    </svg>
  );
}

function AudioTimeline({ audio, heading }) {
  const tl = audio && audio.timeline ? audio.timeline : null;
  const sections = useMemo(() => (audio && Array.isArray(audio.sections) ? audio.sections : []), [audio]);
  const clips = useMemo(
    () => ((audio && audio.samples && Array.isArray(audio.samples.items)) ? audio.samples.items.filter(timed) : []),
    [audio],
  );

  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [showGrit, setShowGrit] = useState(true);
  const [showPulse, setShowPulse] = useState(true);
  const [hoverBin, setHoverBin] = useState(null);
  const [pinnedBin, setPinnedBin] = useState(0);

  // A new song (or a changed analysis) starts on its first clip if it has one, else at the start.
  useEffect(() => {
    if (!tl) return;
    const first = clips[0];
    setHoverBin(null);
    setPinnedBin(first ? binForSec(tl, (first.startSec + first.endSec) / 2) : 0);
  }, [tl, clips]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tl]);

  const bin = tl ? Math.min(tl.bins - 1, Math.max(0, hoverBin ?? pinnedBin)) : 0;
  const sec = tl ? secForBin(tl, bin) : 0;
  const section = tl ? activeSection(sections, sec) : null;
  const under = tl ? activeSample(clips, sec) : null;
  const hitItem = under && under.hit ? under.item : null;
  const untimedNotes = sections.filter((s) => s.startSec == null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !tl || width < 40) return;
    const dpr = window.devicePixelRatio || 1;
    const height = el.getBoundingClientRect().height;
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline(ctx, {
      width, height, timeline: tl, samples: clips, activeSampleItem: hitItem,
      sections, showGrit, showPulse, activeBin: bin, colours: readColours(),
    });
  }, [tl, clips, sections, showGrit, showPulse, bin, width, hitItem]);

  if (!tl) return null;

  const binAt = (e) => binFromX(e.clientX - e.currentTarget.getBoundingClientRect().left, width, tl.bins);
  const onPointerDown = (e) => { setPinnedBin(binAt(e)); setHoverBin(null); };
  const onPointerMove = (e) => {
    if (e.pointerType === 'mouse') setHoverBin(binAt(e));
    else if (e.buttons) setPinnedBin(binAt(e));   // touch / pen: dragging scrubs; vertical drags still scroll the page
  };
  const onKeyDown = (e) => {
    const next = stepBin(pinnedBin, e.key, tl.bins);
    if (next == null) return;
    e.preventDefault();
    setHoverBin(null);
    setPinnedBin(next);
  };
  const goToClip = (s) => { setHoverBin(null); setPinnedBin(binForSec(tl, (s.startSec + s.endSec) / 2)); };

  const r = readout(tl, bin);
  const valueText = `${r.time} of ${r.total}${section && section.label ? `, section ${section.label}` : ''}`;
  const clip = under ? under.item : null;

  return (
    <div className="tl">
      <div className="tl-bar">
        {heading ? <h3 className="la-major-title tl-heading">{heading}</h3> : <span />}
        <div className="tl-toggles">
          <button type="button" className="tl-toggle tl-toggle-grit" aria-pressed={showGrit} onClick={() => setShowGrit((v) => !v)}>
            <Swatch colour="var(--tl-grit)" /> Grit
          </button>
          <button type="button" className="tl-toggle tl-toggle-pulse" aria-pressed={showPulse} onClick={() => setShowPulse((v) => !v)}>
            <Swatch colour="var(--tl-pulse)" dashed /> Beat Pulse
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="tl-canvas"
        tabIndex={0}
        role="slider"
        aria-label="Audio structure timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(tl.duration_sec)}
        aria-valuenow={Math.round(sec)}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverBin(null)}
        onKeyDown={onKeyDown}
      />

      <div className="tl-readout">
        <span className="tl-time">{r.time} / {r.total}</span>
        <span>Loudness <b>{r.loudness}%</b></span>
        <span className={showGrit ? '' : 'tl-off'}>Grit <b>{r.grit}%</b></span>
        <span className={showPulse ? '' : 'tl-off'}>Pulse <b>{r.pulse}%</b></span>
        {clips.length > 1 && (
          <span className="tl-clips" role="group" aria-label="Jump to a clip">
            {clips.map((s, i) => (
              <button key={`${s.type}-${s.startSec}-${i}`} type="button" className="tl-clip-pill"
                aria-current={hitItem === s ? 'true' : undefined} onClick={() => goToClip(s)}>
                Clip {i + 1}
              </button>
            ))}
          </span>
        )}
      </div>

      {section && (
        <p className="tl-section">
          <span className="tl-range">{section.label}</span> {section.text}
        </p>
      )}
      {untimedNotes.length > 0 && (
        <ul className="tl-notes">{untimedNotes.map((s, i) => <li key={i}>{s.text}</li>)}</ul>
      )}

      {clip && (
        <div className={`tl-clip${under.hit ? '' : ' tl-clip-near'}`}>
          <div className="tl-clip-head">
            <span className="tl-clip-key" aria-hidden="true" />
            <span className="tl-clip-type">{clip.label}</span>
            <span className="tl-clip-time">{fmtTime(clip.startSec)}–{fmtTime(clip.endSec)}</span>
            <span className="tl-clip-source">{clip.source || 'Unidentified source'}</span>
          </div>
          {clip.description && <p className="tl-clip-desc">{clip.description}</p>}
          {clip.transcript && <blockquote className="lyrics-passage tl-clip-quote"><p>{clip.transcript}</p></blockquote>}
        </div>
      )}
    </div>
  );
}

export default AudioTimeline;
