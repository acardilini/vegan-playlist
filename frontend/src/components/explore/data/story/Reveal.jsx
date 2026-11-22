import useSeen from './useSeen';

// Fades and lifts its children into view the first time they scroll on screen. The hidden state only exists while the
// observer is waiting (class is-pending), so if it cannot run the content is simply visible.
function Reveal({ as = 'div', className = '', children }) {
  const { ref, pending } = useSeen(0.15);
  const Tag = as;
  return <Tag ref={ref} className={`story-reveal ${pending ? 'is-pending' : ''} ${className}`.trim()}>{children}</Tag>;
}

export default Reveal;
