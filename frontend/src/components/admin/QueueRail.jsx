// Presentational queue rail. Groups + labels the derived queues; the disabled
// slot (Needs analysis) is reserved for sub-project B.
const GROUPS = [
  ['Capture', [['inbox', 'Inbox', false], ['to-process', 'To be processed', false]]],
  ['Needs work', [
    ['needs-lyrics', 'Needs lyrics', false],
    ['needs-cover', 'Needs cover', false],
    ['needs-album', 'Needs album', false],
    ['needs-released', 'Needs released', false],
    ['needs-language', 'Needs language', false],
    ['needs-genre', 'Needs genre', false],
    ['genre-from-artist', 'Genre from artist', false],
    ['needs-video', 'Needs video', false],
    ['no-video', 'No video available', false],
    ['junk-lyrics', 'Junk lyrics', false],
    ['needs-analysis', 'Needs analysis', true],
  ]],
  ['Parked', [['to-transcribe', 'To transcribe', false], ['lyrics-on-hold', 'Lyrics on hold', false], ['remind-later', 'Remind me later', false]]],
  ['Publish', [['to-finalise', 'To finalise', false], ['live', 'Live', false], ['featured', 'Featured', false]]],
  ['Everything', [['all', 'All songs', false]]],
  ['Spotify', [['spotify', 'Spotify sync', false, true]]], // 4th slot: no count (it is not a queue)
];

function QueueRail({ counts, activeQueue, onSelect, groups = GROUPS }) {
  return (
    <nav className="queue-rail">
      {groups.map(([group, items]) => (
        <div key={group}>
          <div className="rail-group">{group}</div>
          {items.map(([key, label, disabled, noCount]) => (
            <button
              key={key}
              className={`queue-item ${activeQueue === key ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => !disabled && onSelect(key)}
            >
              <span>{label}</span>
              {!noCount && <span className="queue-count">{counts ? (counts[key] ?? 0) : '·'}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
export default QueueRail;
