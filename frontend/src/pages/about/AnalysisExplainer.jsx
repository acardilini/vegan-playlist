import MarkdownPage from '../../components/MarkdownPage';
import { tokenValues } from '../../utils/contentTokens';
import { useCodebook } from './useCodebook';
import fallback from '../../../../backend/data/analysis.md?raw';

function AnalysisExplainer() {
  const { data } = useCodebook();
  // Before coverage arrives the tokens render as em-dashes rather than as raw {{braces}}.
  return (
    <div className="about-container">
      <MarkdownPage slug="analysis" fallback={fallback} tokens={tokenValues(data?.coverage)} />
    </div>
  );
}

export default AnalysisExplainer;
