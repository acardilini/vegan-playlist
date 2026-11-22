import { useEffect, useState } from 'react';

// One fetch of the whole Data payload; every tab, filter and chart works from it client-side.
export default function useDataset() {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let live = true;
    fetch('/api/analytics/dataset')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => { if (live) setState({ status: 'ready', data }); })
      .catch(() => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
  }, []);
  return state;
}
