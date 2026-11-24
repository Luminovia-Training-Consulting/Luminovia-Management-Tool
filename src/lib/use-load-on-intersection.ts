import { useEffect, useEffectEvent, useRef } from "react";

/** Prefetch a bounded batch near its control and let the caller handle errors and retries. */
export function useLoadOnIntersection<T extends HTMLElement>({
  enabled,
  onIntersect,
  root,
  pageKey,
  rootMargin = "160px 0px",
}: {
  enabled: boolean;
  onIntersect: () => void;
  root?: Element | null;
  pageKey?: string | number;
  rootMargin?: string;
}) {
  const target = useRef<T>(null);
  const load = useEffectEvent(onIntersect);
  useEffect(() => {
    if (
      !enabled ||
      !target.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !requested &&
          entries.some(({ isIntersecting }) => isIntersecting)
        ) {
          requested = true;
          load();
        }
      },
      { root, rootMargin },
    );
    observer.observe(target.current);
    return () => {
      requested = true;
      observer.disconnect();
    };
  }, [enabled, pageKey, root, rootMargin]);
  return target;
}
