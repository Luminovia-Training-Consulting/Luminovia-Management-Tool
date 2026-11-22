import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

/** Let a header disclosure follow pointer and keyboard navigation. */
export function useDismissibleDisclosure(
  navigationKey?: string,
  restoreFocusOnNavigation = false,
) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = useCallback((focusSummary = false) => {
    const disclosure = ref.current;
    if (!disclosure?.open) return;
    disclosure.open = false;
    if (focusSummary) disclosure.querySelector("summary")?.focus();
  }, []);

  useEffect(() => {
    close(
      restoreFocusOnNavigation &&
        Boolean(ref.current?.contains(document.activeElement)),
    );
  }, [close, navigationKey, restoreFocusOnNavigation]);

  useEffect(() => {
    function dismissOutside(event: Event) {
      const disclosure = ref.current;
      if (
        disclosure?.open &&
        event.target instanceof Node &&
        !disclosure.contains(event.target)
      ) {
        disclosure.open = false;
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      !event.currentTarget.open
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }

  return { attributes: { ref, onKeyDown }, close };
}
