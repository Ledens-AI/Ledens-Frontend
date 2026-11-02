/* Tables of the platform (.fin-table-wrap) scroll inside their own box, sized
 * to the window, so both scrollbars are on screen at once instead of the
 * horizontal one waiting at the end of a long table.
 *
 * A table that starts in the first screen fills the rest of it (its bottom
 * edge, and so its horizontal scrollbar, is visible as soon as the tab opens);
 * one further down gets the window's height minus the sticky top bar. Tables
 * inside dialogs, or inside another table, keep their natural height. */
const TOP_BAR = 64;      // sticky <header> of /plataforma
const BOTTOM_GAP = 20;   // breathing room above the window edge
const MIN_HEIGHT = 260;

function measure(root) {
  const vh = window.innerHeight;
  for (const el of root.querySelectorAll('.fin-table-wrap')) {
    if (el.parentElement.closest('.fin-table-wrap, .fin-overlay')) {
      if (el.classList.contains('is-fit')) { el.classList.remove('is-fit'); el.style.removeProperty('--fin-fit-h'); }
      continue;
    }
    const top = el.getBoundingClientRect().top + window.scrollY;
    const room = top < vh - MIN_HEIGHT ? vh - top - BOTTOM_GAP : vh - TOP_BAR - 24;
    const h = Math.max(MIN_HEIGHT, Math.round(room)) + 'px';
    if (el.style.getPropertyValue('--fin-fit-h') !== h) el.style.setProperty('--fin-fit-h', h);
    el.classList.add('is-fit');
  }
}

/* Keeps every table under `root` sized while it lives; returns the cleanup. */
export function fitTables(root) {
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(root); }); };
  // Content changes (tab switch, data loaded, a banner above the table) move
  // tables; class/style changes are ignored, so measuring never loops.
  const mo = new MutationObserver(schedule);
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => { cancelAnimationFrame(frame); mo.disconnect(); window.removeEventListener('resize', schedule); };
}
