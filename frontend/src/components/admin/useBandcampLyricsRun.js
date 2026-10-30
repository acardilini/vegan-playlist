import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './bandCheckApi';

const POLL_MS = 1500;
const IDLE = { phase: 'idle', done: 0, total: 0, results: [], truncated: false, message: '', runId: null };

// Starts a Bandcamp lyrics run (kind: 'artist' | 'song'), polls it until it finishes, and saves one fetched row on request.
// Nothing is saved until save(songId) is called. Polling stops on unmount or when a newer run starts.
export function useBandcampLyricsRun() {
  const [state, setState] = useState(IDLE);
  const timer = useRef(null);
  const alive = useRef(true);
  const gen = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  const current = (g) => alive.current && g === gen.current;

  const poll = useCallback(async (runId, g) => {
    try {
      const r = await api(`/api/admin/bandcamp-lyrics/runs/${runId}`);
      if (!current(g)) return;
      if (r.status === 'running') {
        setState((s) => ({ ...s, done: r.done, total: r.total }));
        timer.current = setTimeout(() => poll(runId, g), POLL_MS);
      } else if (r.status === 'done') {
        setState((s) => ({ ...s, phase: 'done', done: r.done, total: r.total, results: r.results || [], truncated: !!r.truncated }));
      } else {
        setState((s) => ({ ...s, phase: 'error', message: (r.error && r.error.message) || 'The fetch failed' }));
      }
    } catch (e) {
      if (current(g)) setState((s) => ({ ...s, phase: 'error', message: e.message }));
    }
  }, []);

  const start = useCallback(async (kind, id) => {
    const g = ++gen.current;
    clearTimeout(timer.current);
    setState({ ...IDLE, phase: 'running' });
    try {
      const { runId } = await api(`/api/admin/bandcamp-lyrics/${kind}/${id}`, { method: 'POST', body: {} });
      if (!current(g)) return;
      setState((s) => ({ ...s, runId }));
      poll(runId, g);
    } catch (e) {
      if (current(g)) setState({ ...IDLE, phase: 'error', message: e.message });
    }
  }, [poll]);

  const save = useCallback(async (songId) => {
    try {
      await api(`/api/admin/bandcamp-lyrics/runs/${state.runId}/save`, { method: 'POST', body: { songId } });
      setState((s) => ({ ...s, results: s.results.map((r) => (r.songId === songId ? { ...r, saved: true, lyrics: undefined } : r)) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }, [state.runId]);

  const reset = useCallback(() => { gen.current += 1; clearTimeout(timer.current); setState(IDLE); }, []);

  return { start, state, save, reset };
}
