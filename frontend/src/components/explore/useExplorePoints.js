import { useCallback, useEffect, useState } from 'react';

// One request serves the whole page. Relative URL so it goes through the Vite proxy —
// never hardcode localhost:5000 in new code.
export function useExplorePoints() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analysis/explore/points');
      if (!res.ok) throw new Error('Failed to load the map');
      setData(await res.json());
    } catch (e) {
      setError(e.message || 'Failed to load the map');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
