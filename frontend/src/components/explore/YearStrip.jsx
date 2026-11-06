import { useEffect, useRef, useState } from 'react';

// A year step is long enough to see songs arrive, short enough that the whole span plays in ~15s.
const STEP_MS = 350;

// "Songs released up to this year": a strip along the bottom of the map with a range handle and a
// Play button that sweeps the cutoff forward. The thumb at the far right means all years (no
// filter). Controlled by props; the only local state is whether it is playing, and every path
// that stops playing (pause, manual drag, reaching the end, unmount) clears the interval.
function YearStrip({ bounds, year, onYear }) {
  const [playing, setPlaying] = useState(false);
  const yearRef = useRef(year);
  const onYearRef = useRef(onYear);
  useEffect(() => { yearRef.current = year; }, [year]);
  useEffect(() => { onYearRef.current = onYear; }, [onYear]);

  useEffect(() => {
    if (!playing || !bounds) return undefined;
    const id = setInterval(() => {
      const cur = yearRef.current;
      const next = cur == null ? bounds.min : cur + 1;
      if (next >= bounds.max) {
        setPlaying(false);
        onYearRef.current(null);
        return;
      }
      yearRef.current = next;
      onYearRef.current(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, bounds]);

  if (!bounds) return null;
  const flat = bounds.min === bounds.max;

  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    // Starting from "all years" rewinds to the earliest year so the sweep has something to show.
    if (year == null) {
      yearRef.current = bounds.min;
      onYear(bounds.min);
    }
    setPlaying(true);
  };

  const onRange = (e) => {
    setPlaying(false);
    const v = Number(e.target.value);
    onYear(v >= bounds.max ? null : v);
  };

  return (
    <div className="explore-yearstrip">
      <button
        type="button"
        className="explore-yearstrip-play"
        onClick={togglePlay}
        disabled={flat}
        aria-label={playing ? 'Pause the year sweep' : 'Play songs in by year'}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        className="explore-yearstrip-range"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={year == null ? bounds.max : year}
        disabled={flat}
        onChange={onRange}
        aria-label="Show songs released up to this year"
      />
      <span className="explore-yearstrip-label">
        {year == null ? 'All years' : `Up to ${year}`}
      </span>
      {bounds.missing > 0 && (
        <span className="explore-yearstrip-note">
          {bounds.missing} {bounds.missing === 1 ? 'song has' : 'songs have'} no release year
        </span>
      )}
    </div>
  );
}

export default YearStrip;
