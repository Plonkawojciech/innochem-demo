type Bounds = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/** Leave room for the complete focused control and its focus outline. */
export function stickyFocusScrollDelta(
  focused: Bounds,
  bar: Bounds,
  viewport: Bounds,
  gap = 8,
  header: Bounds | null = null,
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
  const safeBottom = Math.max(viewport.top, bar.top) - gap;
  const headerOverlaps =
    header &&
    finite(header) &&
    header.top < viewport.bottom &&
    header.bottom > viewport.top &&
    focused.left < header.right &&
    focused.right > header.left;
  const safeTop = headerOverlaps
    ? Math.min(viewport.bottom, header.bottom) + gap
    : viewport.top;
  // A tall control cannot fit between both overlays; avoid alternating scrolls.
  if (focused.bottom - focused.top > safeBottom - safeTop) return 0;
  if (headerOverlaps && focused.top < safeTop) return focused.top - safeTop;
  return Math.max(0, focused.bottom - safeBottom);
}

/** The measured height already contains wrapped notices and the safe-area inset. */
export function installStickyBuyFocus(bar: HTMLElement): () => void {
  const root = document.documentElement;
  const header = document.querySelector<HTMLElement>("header.site");
  const property = "--sticky-buy-height";
  const headerProperty = "--sticky-focus-header-height";
  const previous = root.style.getPropertyValue(property);
  const priority = root.style.getPropertyPriority(property);
  const previousHeader = root.style.getPropertyValue(headerProperty);
  const headerPriority = root.style.getPropertyPriority(headerProperty);
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
      8,
      focused.closest("footer.site") && header
        ? header.getBoundingClientRect()
        : null,
    );
    // Explicit instant scrolling also cancels a native focus scroll animation.
    if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
  };
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(revealFocus);
  };
  const measure = () => {
    const height = bar.getBoundingClientRect().height;
    if (height > 0) root.style.setProperty(property, `${Math.ceil(height)}px`);
    else root.style.removeProperty(property);
    const headerHeight = header?.getBoundingClientRect().height ?? 0;
    if (headerHeight > 0)
      root.style.setProperty(headerProperty, `${Math.ceil(headerHeight)}px`);
    else root.style.removeProperty(headerProperty);
    schedule();
  };
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  const visibility = new MutationObserver(schedule);
  observer?.observe(bar);
  if (header) observer?.observe(header);
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
    if (previousHeader)
      root.style.setProperty(headerProperty, previousHeader, headerPriority);
    else root.style.removeProperty(headerProperty);
  };
}
