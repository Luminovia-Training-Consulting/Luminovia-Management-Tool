import { useRef } from "react";

/** Keep an unchanged uncertain write bound to the same request UUID. */
export function useRequest() {
  const key = useRef<{ payload: string; id: string } | null>(null);
  return (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (key.current?.payload !== serialized)
      key.current = { payload: serialized, id: crypto.randomUUID() };
    return key.current.id;
  };
}
