type Bounds = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/** Leave room for the complete focused control and its focus outline. */
export function stickyFocusScrollDelta(
  focused: Bounds,
  bar: Bounds,
  viewport: Bounds,
  gap = 8,
): number {
  const finite = (rect: Bounds) =>
    [rect.top, rect.bottom, rect.left, rect.right].every(Number.isFinite);
  if (!finite(focused) || !finite(bar) || !finite(viewport)) return 0;
  if (
    bar.top >= viewport.bottom ||
    bar.bottom <= viewport.top ||
    bar.left >= viewport.right ||
    bar.right <= viewport.left ||
    focused.left >= bar.right ||
    focused.right <= bar.left
  )
    return 0;
  return Math.max(0, focused.bottom - Math.max(viewport.top, bar.top) + gap);
}

/** The measured height already contains wrapped notices and the safe-area inset. */
export function installStickyBuyFocus(bar: HTMLElement): () => void {
  const root = document.documentElement;
  const property = "--sticky-buy-height";
  const previous = root.style.getPropertyValue(property);
  const priority = root.style.getPropertyPriority(property);
  const viewport = window.visualViewport;
  let frame: number | null = null;

  const revealFocus = () => {
    frame = null;
    const focused = document.activeElement;
    if (
      !(focused instanceof HTMLElement) ||
      focused === document.body ||
      focused === root ||
      bar.contains(focused) ||
      focused.closest("dialog[open]") ||
      bar.hasAttribute("data-hidden")
    )
      return;
    const style = getComputedStyle(bar);
    if (style.display === "none" || style.visibility !== "visible") return;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const delta = stickyFocusScrollDelta(
      focused.getBoundingClientRect(),
      bar.getBoundingClientRect(),
      {
        top,
        left,
        bottom: top + (viewport?.height ?? window.innerHeight),
        right: left + (viewport?.width ?? window.innerWidth),
      },
    );
    // Explicit instant scrolling also cancels a native focus scroll animation.
    if (delta > 0) window.scrollBy({ top: delta, behavior: "instant" });
  };
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(revealFocus);
  };
  const measure = () => {
    const height = bar.getBoundingClientRect().height;
    if (height > 0) root.style.setProperty(property, `${Math.ceil(height)}px`);
    else root.style.removeProperty(property);
    schedule();
  };
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  const visibility = new MutationObserver(schedule);
  observer?.observe(bar);
  visibility.observe(bar, {
    attributes: true,
    attributeFilter: ["data-hidden"],
  });
  bar.addEventListener("transitionend", schedule);
  document.addEventListener("focusin", schedule);
  window.addEventListener("resize", measure);
  viewport?.addEventListener("resize", measure);
  viewport?.addEventListener("scroll", schedule);
  measure();

  return () => {
    observer?.disconnect();
    visibility.disconnect();
    bar.removeEventListener("transitionend", schedule);
    document.removeEventListener("focusin", schedule);
    window.removeEventListener("resize", measure);
    viewport?.removeEventListener("resize", measure);
    viewport?.removeEventListener("scroll", schedule);
    if (frame !== null) cancelAnimationFrame(frame);
    if (previous) root.style.setProperty(property, previous, priority);
    else root.style.removeProperty(property);
  };
}
