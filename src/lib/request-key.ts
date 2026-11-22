import { useRef } from "react";

/** Retain a request ID across uncertain retries of the last submitted input. */
export function useRequestKey() {
  const request = useRef<{ signature: string; id: string } | null>(null);

  return {
    forInput(signature: string) {
      if (request.current?.signature !== signature) {
        request.current = { signature, id: crypto.randomUUID() };
      }
      return request.current.id;
    },
    clear() {
      request.current = null;
    },
  };
}
