// A colour key for a chart: always present for two or more series, in ink colours with a coloured swatch.
function Legend({ items }) {
  return (
    <ul className="data-legend">
      {items.map(it => (
        <li key={it.key}>
          <span className="data-swatch" style={{ background: it.colour }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export default Legend;
