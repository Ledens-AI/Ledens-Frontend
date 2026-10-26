import { useState, useEffect } from 'react';

/* Scroll-spy for the legal pages' table of contents. */
export default function useTocHighlight(ids) {
  const [activeId, setActiveId] = useState(ids[0] || '');
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(e => { if (e.isIntersecting) setActiveId(e.target.id); });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );
    ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return activeId;
}
