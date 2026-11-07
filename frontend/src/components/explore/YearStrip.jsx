import { useEffect, useRef, useState } from 'react';
import { yearRangeLabel } from './exploreUrlState';

// A year step is long enough to see songs arrive, short enough that the whole span plays in ~15s.
const STEP_MS = 350;

// A period of time on the map: a strip along the bottom with a two-handle range (start and end
// year) and a Play button. With the start handle at the first year and the end handle at the last
// there is no filter. Play sweeps the end handle from the start year up to where it was when Play
// was pressed, so the chosen period is what plays, then leaves that period showing.
// Controlled by props; the only local state is whether it is playing, and every path that stops
// playing (pause, manual drag, reaching the end, unmount) clears the interval.
function YearStrip({ bounds, year, from, onYear, onFrom }) {
  const [playing, setPlaying] = useState(false);
  const yearRef = useRef(year);
  const fromRef = useRef(from);
  const playEndRef = useRef(null);
  const onYearRef = useRef(onYear);
  useEffect(() => { yearRef.current = year; }, [year]);
  useEffect(() => { fromRef.current = from; }, [from]);
  useEffect(() => { onYearRef.current = onYear; }, [onYear]);

  useEffect(() => {
    if (!playing || !bounds) return undefined;
    const id = setInterval(() => {
      const cur = yearRef.current;
      const next = cur == null ? (fromRef.current ?? bounds.min) : cur + 1;
      const end = playEndRef.current ?? bounds.max;
      if (next >= end) {
        setPlaying(false);
        onYearRef.current(end >= bounds.max ? null : end);
        return;
      }
      yearRef.current = next;
      onYearRef.current(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, bounds]);

  if (!bounds) return null;
  const flat = bounds.min === bounds.max;
  const startVal = from ?? bounds.min;
  const endVal = year ?? bounds.max;
  const span = bounds.max - bounds.min || 1;
  const pct = (v) => ((v - bounds.min) / span) * 100;

  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    // The sweep runs from the start handle up to where the end handle sits now.
    playEndRef.current = endVal;
    yearRef.current = startVal;
    onYear(startVal);
    setPlaying(true);
  };

  // The handles cannot cross: dragging one stops at the other.
  const onStart = (e) => {
    setPlaying(false);
    const v = Math.min(Number(e.target.value), endVal);
    onFrom(v <= bounds.min ? null : v);
  };
  const onEnd = (e) => {
    setPlaying(false);
    const v = Math.max(Number(e.target.value), startVal);
    onYear(v >= bounds.max ? null : v);
  };

  // When both handles sit together, the one that can still move away must be the one on top.
  const startOnTop = startVal > bounds.min + span / 2;

  return (
    <div className="explore-yearstrip">
      <button
        type="button"
        className="explore-yearstrip-play"
        onClick={togglePlay}
        disabled={flat || (!playing && startVal >= endVal)}
        aria-label={playing ? 'Pause the year sweep' : 'Play songs in over the chosen years'}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <div className="explore-yearstrip-dual">
        <div className="explore-yearstrip-track" aria-hidden="true">
          <div
            className="explore-yearstrip-fill"
            style={{ left: `${pct(startVal)}%`, width: `${pct(endVal) - pct(startVal)}%` }}
          />
        </div>
        <input
          type="range"
          className="explore-yearstrip-range"
          style={{ zIndex: startOnTop ? 3 : 2 }}
          min={bounds.min}
          max={bounds.max}
          step={1}
          value={startVal}
          disabled={flat}
          onChange={onStart}
          aria-label="Show songs released from this year"
        />
        <input
          type="range"
          className="explore-yearstrip-range"
          style={{ zIndex: startOnTop ? 2 : 3 }}
          min={bounds.min}
          max={bounds.max}
          step={1}
          value={endVal}
          disabled={flat}
          onChange={onEnd}
          aria-label="Show songs released up to this year"
        />
      </div>
      <span className="explore-yearstrip-label">{yearRangeLabel(from, year, bounds)}</span>
      {bounds.missing > 0 && (
        <span className="explore-yearstrip-note">
          {bounds.missing} {bounds.missing === 1 ? 'song has' : 'songs have'} no release year
        </span>
      )}
    </div>
  );
}

export default YearStrip;
