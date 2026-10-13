import LyricalAnalysis from '../LyricalAnalysis';

function AnalysisPanel({ wb }) {
  return (
    <section className="wb-panel">
      <h2>Analysis</h2>
      {wb.analysis ? (
        <>
          <p className="wb-readonly">Read-only — added by the external analysis process.</p>
          <LyricalAnalysis analysis={wb.analysis} />
        </>
      ) : (
        wb.analysed
          ? <p className="admin-stub">Analysis hidden on the public site: it was coded from lyrics that are flagged as junk, or from lyrics that have since been replaced. It returns when the lyrics are fixed and the song is re-analysed (or you mark the lyrics Not junk).</p>
          : <p className="admin-stub">Not yet analysed. Coded themes are added by the external analysis process (sub-project B).</p>
      )}
    </section>
  );
}
export default AnalysisPanel;
