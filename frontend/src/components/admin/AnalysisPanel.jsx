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
        <p className="admin-stub">Not yet analysed. Coded themes are added by the external analysis process (sub-project B).</p>
      )}
    </section>
  );
}
export default AnalysisPanel;
