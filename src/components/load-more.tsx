import { useLoadOnIntersection } from "../lib/use-load-on-intersection";
import { Button } from "./ui/button";

export function LoadMore({
  children,
  disabled = false,
  onLoad,
  pageKey,
  root,
}: {
  children: string;
  disabled?: boolean;
  onLoad: () => void;
  pageKey?: string | number;
  root?: Element | null;
}) {
  const sentinel = useLoadOnIntersection<HTMLDivElement>({
    enabled: !disabled,
    pageKey,
    onIntersect: onLoad,
    root,
  });
  return (
    <div ref={sentinel}>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={onLoad}
      >
        {children}
      </Button>
    </div>
  );
}
