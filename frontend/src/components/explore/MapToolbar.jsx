// The floating controls over the map: a pill with 2D | 3D (the top-level switch) and, in 3D, a smaller
// pill under it with the camera presets and drift. Two pills so the 2D|3D switch never changes width.
// The Labels / Lines toggles live with the zoom buttons (OverlayToggles), apart from this switch.
// Presentational only - ExploreMap owns the state and passes it down.
const PRESET_LABELS = [['iso', 'Iso'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side']];

function MapToolbar({
  dim, has3d, onDim, activePreset, onPreset, drift, onDrift, reduceMotion,
}) {
  return (
    <div className="explore-maptools">
      <div className="explore-maptools-pill" role="toolbar" aria-label="Map view">
        <div className="explore-maptools-group" role="group" aria-label="Dimensions">
          <button
            type="button"
            className={`explore-maptool ${dim === '2d' ? 'on' : ''}`}
            aria-pressed={dim === '2d'}
            onClick={() => onDim('2d')}
          >
            2D
          </button>
          <button
            type="button"
            className={`explore-maptool ${dim === '3d' ? 'on' : ''}`}
            aria-pressed={dim === '3d'}
            disabled={!has3d}
            title={has3d ? undefined : 'This space has no 3D positions'}
            onClick={() => onDim('3d')}
          >
            3D
          </button>
        </div>
      </div>
      {dim === '3d' && (
        <div className="explore-maptools-pill explore-maptools-pill--sub" role="toolbar" aria-label="Camera">
          <div className="explore-maptools-group" role="group" aria-label="Camera angle">
            {PRESET_LABELS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`explore-maptool ${activePreset === key ? 'on' : ''}`}
                aria-pressed={activePreset === key}
                onClick={() => onPreset(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {!reduceMotion && (
            <button
              type="button"
              className={`explore-maptool ${drift ? 'on' : ''}`}
              aria-pressed={drift}
              onClick={() => onDrift(!drift)}
            >
              Drift
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Labels / Lines on-off switches: a small pill under the zoom buttons.
export function OverlayToggles({ labels, onLabels, lines, onLines }) {
  return (
    <div className="explore-maptools-pill explore-maptools-pill--sub" role="group" aria-label="Overlays">
      <button
        type="button"
        className={`explore-maptool ${labels ? 'on' : ''}`}
        aria-pressed={labels}
        onClick={() => onLabels(!labels)}
      >
        Labels
      </button>
      <button
        type="button"
        className={`explore-maptool ${lines ? 'on' : ''}`}
        aria-pressed={lines}
        onClick={() => onLines(!lines)}
      >
        Lines
      </button>
    </div>
  );
}

export default MapToolbar;
