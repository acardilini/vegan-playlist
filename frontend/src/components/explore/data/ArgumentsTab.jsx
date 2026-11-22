import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { PRESETS, buildFlow, firstOrderFor, flowEmptyMessage, strongestSentence, flowTable } from './flowModel';
import ChartFrame from './ChartFrame';
import FlowChart from './FlowChart';
import PathwayList from './PathwayList';
import FlowDetail from './FlowDetail';
import ThemePairs from './ThemePairs';

const PHONE_MAX_WIDTH = 640; // below this the flow becomes a list of pathways

// Explore > Data > Arguments: how genre, tone and advocacy action (and two other trios of fields) line up on a song.
function ArgumentsTab() {
  const { songs, allSongs, labels, state, setState, bounds } = useOutletContext();
  // The pin is a column position plus codes, tagged with the preset it was made on; a pin from another preset is ignored
  // (a URL change such as Back), and the picker also clears it, so A to B to A never restores an old pin.
  const [pinState, setPinState] = useState(null);
  const preset = PRESETS.find(p => p.id === state.flow) || PRESETS[0];
  const pin = pinState && pinState.preset === preset.id ? pinState.pin : null;
  const onPin = next => setPinState(next ? { preset: preset.id, pin: next } : null);

  // Colours follow the entity: the column-0 ranking comes from the WHOLE catalogue, so filtering never repaints a code.
  const firstOrder = useMemo(() => firstOrderFor(preset, allSongs, { labels }), [allSongs, preset, labels]);
  const flow = useMemo(() => buildFlow(songs, preset, { labels, firstOrder }), [songs, preset, labels, firstOrder]);
  const emptyMessage = flowEmptyMessage(flow); // too thin a flow is not drawn: no chart, no sentence
  const sentence = useMemo(() => (emptyMessage ? null : strongestSentence(flow)), [flow, emptyMessage]);

  const names = preset.columns.map(c => c.name.toLowerCase());
  const caption = `Based on ${flow.n} of ${songs.length} songs in this slice: those with a first-listed code in all three of ${names[0]}, ${names[1]} and ${names[2]}. Each column uses a song's first-listed code.`;

  const picker = (
    <div className="data-controls">
      <div className="data-toggle" role="group" aria-label="Fields to compare">
        {PRESETS.map(p => (
          <button key={p.id} type="button" aria-pressed={p.id === preset.id} className={p.id === preset.id ? 'active' : ''}
            onClick={() => { setPinState(null); setState({ flow: p.id }); }}>{p.label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="data-tab">
      <ChartFrame
        title="How the fields line up"
        controls={picker}
        empty={emptyMessage}
        table={emptyMessage ? { head: [], rows: [] } : flowTable(flow)}
        caption={caption}
      >
        {width => (
          <>
            {width < PHONE_MAX_WIDTH
              ? <PathwayList flow={flow} pin={pin} onPin={onPin} />
              : <FlowChart width={width} flow={flow} pin={pin} onPin={onPin} />}
            <FlowDetail flow={flow} pin={pin} state={state} bounds={bounds} onClear={() => onPin(null)} />
          </>
        )}
      </ChartFrame>
      {sentence && <div className="data-insights"><p>{sentence}</p></div>}
      <ThemePairs songs={songs} labels={labels} state={state} bounds={bounds} />
    </div>
  );
}

export default ArgumentsTab;
