import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Tells a table when it has less room than its columns need, so it can switch to a stacked layout
 * instead of scrolling sideways. Follows the table's own width (window resizes, sidebar collapsing,
 * the records panel moving beside or below it), not the screen's. Attach `ref` to the scroll
 * container and set `data-compact` from `compact`.
 */
export function useCompactTable(minWidth: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el) return;
    const check = () => setCompact(el.clientWidth < minWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, minWidth]);

  return { ref, compact };
}
