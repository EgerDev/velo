/**
 * Forward one AbortSignal to a controller, and be able to stop forwarding.
 *
 * The bulk downloader creates ONE `AbortController` for a whole batch and hands
 * that signal to every item, so a listener added per item and never removed
 * accumulates for the life of the batch — each one retaining a controller, the
 * step list and the download closure. A 200-video batch held hundreds of live
 * closures. `{ once: true }` does not help: it only fires on abort, which is
 * exactly the path that does not happen on success.
 *
 * Always call the returned detach when the operation settles.
 */
export function linkAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}
