import { flushSync } from "react-dom";
let active: ViewTransition | undefined;
/** Animate explicit layout changes only; streamed content keeps updating normally. */
export async function transitionView<T>(change: () => T): Promise<Awaited<T>> {
  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.visibilityState !== "visible"
  ) {
    return Promise.resolve(change());
  }
  active?.skipTransition();
  let result: T;
  const transition = document.startViewTransition(() => {
    flushSync(() => {
      result = change();
    });
  });
  active = transition;
  void transition.finished
    .catch(() => {})
    .finally(() => {
      if (active === transition) active = undefined;
    });
  await transition.updateCallbackDone;
  return await result!;
}
