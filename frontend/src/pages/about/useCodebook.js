import { useEffect, useState } from 'react';

// One request serves both the Reference glossary and the explainer's coverage figures.
// Cached at module scope so moving between the two tabs does not refetch ~35KB of catalogue
// that cannot have changed within a visit. Relative URL — never hardcode localhost:5000.
let cached = null;

export function useCodebook() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!cached) {
      cached = fetch('/api/analysis/codebook')
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load the codebook'))))
        // A failed request must not be cached as a permanent failure — drop it so the next
        // mount retries.
        .catch(err => { cached = null; throw err; });
    }
    cached
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading: !data && !error, error };
}
