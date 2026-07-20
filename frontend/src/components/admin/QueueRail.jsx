// Presentational queue rail. Groups + labels the derived queues; disabled slots
// (Inbox, Needs analysis) are reserved for sub-projects C and B.
const GROUPS = [
  ['Capture', [['inbox', 'Inbox', true], ['to-process', 'To be processed', false]]],
  ['Needs work', [
    ['needs-lyrics', 'Needs lyrics', false],
    ['needs-cover', 'Needs cover', false],
    ['needs-video', 'Needs video', false],
    ['needs-analysis', 'Needs analysis', true],
  ]],
  ['Parked', [['awaiting-community', 'Awaiting community', false], ['remind-later', 'Remind me later', false]]],
  ['Publish', [['to-finalise', 'To finalise', false], ['live', 'Live', false]]],
  ['Everything', [['all', 'All songs', false]]],
];

function QueueRail({ counts, activeQueue, onSelect }) {
  return (
    <nav className="queue-rail">
      {GROUPS.map(([group, items]) => (
        <div key={group}>
          <div className="rail-group">{group}</div>
          {items.map(([key, label, disabled]) => (
            <button
              key={key}
              className={`queue-item ${activeQueue === key ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => !disabled && onSelect(key)}
            >
              <span>{label}</span>
              <span className="queue-count">{counts ? (counts[key] ?? 0) : '·'}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
export default QueueRail;
