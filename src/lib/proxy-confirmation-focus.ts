type FocusTarget = { readonly focus: () => void } | null;
type ScheduleFocus = (callback: () => void) => void;

function nextPaint(callback: () => void): void {
  if (typeof window === "undefined") {
    callback();
    return;
  }
  window.requestAnimationFrame(callback);
}

/** Returns keyboard focus to the control that opened an inline confirmation. */
export function restoreFocusAfterCancel(
  trigger: FocusTarget,
  schedule: ScheduleFocus = nextPaint,
): void {
  schedule(() => trigger?.focus());
}
