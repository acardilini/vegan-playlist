function AnalysisPanel({ wb }) {
  return (
    <section className="wb-panel">
      <h2>Analysis</h2>
      <p className="wb-readonly">
        {wb.analysed ? 'Analysed (gemma4:latest)' : 'Not yet analysed'}
      </p>
      <p className="admin-stub">Coded themes are added by the external analysis process (sub-project B). Read-only here.</p>
    </section>
  );
}
export default AnalysisPanel;
