// The floating controls over the map: a pill with 2D | 3D, and (in 3D) a second pill under it
// with the camera presets and drift. Two pills so the 2D|3D switch never changes width.
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
        <div className="explore-maptools-pill" role="toolbar" aria-label="Camera">
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

export default MapToolbar;
