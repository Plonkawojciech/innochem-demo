/** Keep the native tab order, but uncover page controls when focus leaves the header. */
export function subscribeMenuFocusDismiss(
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  contains: (target: EventTarget | null) => boolean,
  dismiss: () => void,
) {
  const focus = (event: Event) => {
    if (!contains(event.target)) dismiss();
  };
  events.addEventListener("focusin", focus);
  return () => events.removeEventListener("focusin", focus);
}
