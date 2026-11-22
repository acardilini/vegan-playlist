// The story's first screen: a dimmed mosaic of album art behind the title.
function OpeningPanel({ block }) {
  const tiles = block.art.slice(0, 8);
  return (
    <header className="story-opening">
      <div className="story-mosaic" aria-hidden="true">
        {tiles.map((src, i) => <img key={`${src}-${i}`} src={src} alt="" loading="eager" />)}
      </div>
      <div className="story-opening-text">
        <h1>{block.title}</h1>
        {block.subtitle && <p>{block.subtitle}</p>}
      </div>
      <span className="story-cue" aria-hidden="true">Scroll</span>
    </header>
  );
}

export default OpeningPanel;
