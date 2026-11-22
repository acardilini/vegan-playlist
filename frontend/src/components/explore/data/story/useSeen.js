import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Has this element scrolled into view yet? `phase` is 'init' (before the first effect: everything renders visible),
// 'pending' (waiting to be seen: reveal styling applies) and 'seen'. Without IntersectionObserver, or under
// prefers-reduced-motion, it goes straight to 'seen', so nothing is ever hidden when the motion cannot run.
export default function useSeen(threshold = 0.2) {
  const ref = useRef(null);
  const [phase, setPhase] = useState('init');
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setPhase('seen');
      return undefined;
    }
    setPhase('pending');
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setPhase('seen'); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen: phase === 'seen', pending: phase === 'pending' };
}
