import { Link } from 'react-router-dom';
import FilterSection from '../../components/FilterSection';
import { termHref } from '../../utils/browseUrlState';
import { useCodebook } from './useCodebook';

// One term: its label, its definition, and how many songs currently carry it. The count links
// through to a browse filtered to exactly that code — a zero-count term renders the count as
// plain text, because a link to an empty result set is a dead end. `threshold` is optional —
// only acoustic codes carry it.
function Term({ filterKey, code, label, definition, count, threshold }) {
  return (
    <li className="reference-term">
      <span className="reference-term-label">{label}</span>
      {count > 0 ? (
        <Link className="reference-term-count" to={termHref(filterKey, code)}>
          {count.toLocaleString()} songs
        </Link>
      ) : (
        <span className="reference-term-count is-empty">0 songs</span>
      )}
      <p className="reference-term-def">{definition}</p>
      {threshold && <p className="reference-threshold">{threshold}</p>}
    </li>
  );
}

function ThematicDimension({ dimension }) {
  return (
    <FilterSection title={dimension.label}>
      <p className="reference-dimension-desc">{dimension.description}</p>
      {dimension.sub_dimensions.map(sub => (
        <FilterSection key={sub.id} title={sub.label}>
          {sub.groups.map(group => (
            <div key={group.id} className="reference-group">
              <h4 className="reference-group-title">{group.label}</h4>
              <ul className="reference-terms">
                {group.terms.map(t => (
                  <Term key={t.code} filterKey={dimension.key} {...t} />
                ))}
              </ul>
            </div>
          ))}
        </FilterSection>
      ))}
    </FilterSection>
  );
}

function CodedComponent({ component, extra }) {
  return (
    <FilterSection title={component.heading}>
      <p className="reference-dimension-desc">{component.description}</p>
      {extra}
      <ul className="reference-terms">
        {component.codes.map(c => (
          <Term key={c.code} filterKey={component.key} {...c} />
        ))}
      </ul>
    </FilterSection>
  );
}

function AnalysisReference() {
  const { data, error } = useCodebook();

  if (error) return <div className="about-container"><p>{error}</p></div>;
  if (!data) return <div className="about-container" />;

  return (
    <div className="about-container reference-page">
      <p className="reference-intro">
        Every word the site uses to describe a song, with its definition and how many songs
        currently carry it. Terms no song carries yet are listed too — the vocabulary is
        larger than the part of the collection that has been coded. How these are produced is
        on <Link to="/about/analysis">How the analysis works</Link>.
      </p>

      <nav className="reference-jump" aria-label="Jump to a section">
        <a href="#themes">Themes</a>
        <a href="#lyric-metadata">Lyric metadata</a>
        <a href="#sound">Sound</a>
      </nav>

      <section id="themes" className="reference-family">
        <h2>Themes</h2>
        {data.thematic.map(d => <ThematicDimension key={d.key} dimension={d} />)}
      </section>

      <section id="lyric-metadata" className="reference-family">
        <h2>Lyric metadata</h2>
        {data.metadata.map(m => <CodedComponent key={m.key} component={m} />)}
      </section>

      <section id="sound" className="reference-family">
        <h2>Sound</h2>
        {data.acoustic.map(a => (
          <CodedComponent
            key={a.key}
            component={a}
            extra={a.derivation_source && (
              <p className="reference-derivation">Measured from: {a.derivation_source}</p>
            )}
          />
        ))}
      </section>
    </div>
  );
}

export default AnalysisReference;
