import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  deliverySessionSchema,
  deliveryPageSchema,
  deliveryHistorySchema,
  type DeliveryDraft,
  type DeliveryReviewAction,
  type DeliveryScope,
  type DeliverySession,
} from "./delivery-schema";

export type DeliveryAction =
  | { kind: "draft"; draft: DeliveryDraft }
  | { kind: "submit" | "customer_confirm" }
  | { kind: DeliveryReviewAction; note: string };

export const deliveryKey = (actor: string) =>
  ["teaching-delivery", actor] as const;

export const deliveryListQuery = (
  actor: string,
  scope: DeliveryScope,
  before?: {
    scheduled_start: string;
    session_id: string;
  },
) =>
  queryOptions({
    queryKey: [...deliveryKey(actor), "list", scope, before],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("delivery_sessions", {
          p_scope: scope,
          p_before_at: before?.scheduled_start ?? null,
          p_before_id: before?.session_id ?? null,
          p_limit: 25,
        })
        .abortSignal(signal);
      if (error) throw error;
      return deliveryPageSchema.parse(data);
    },
    refetchInterval: 30000,
    retry: false,
  });

export const deliveryDetailQuery = (actor: string, session: string) =>
  queryOptions({
    queryKey: [...deliveryKey(actor), "detail", session],
    queryFn: async ({ signal }) => {
      const [detail, history] = await Promise.all([
        db()
          .rpc("delivery_session", { p_session_id: session })
          .abortSignal(signal),
        db()
          .rpc("delivery_history", { p_session_id: session })
          .abortSignal(signal),
      ]);
      if (detail.error) throw detail.error;
      if (history.error) throw history.error;
      return {
        item: deliverySessionSchema.parse(detail.data),
        history: deliveryHistorySchema.parse(history.data),
      };
    },
    refetchInterval: 30000,
    retry: false,
  });

export async function recordDelivery(
  item: DeliverySession,
  action: DeliveryAction,
  key: string,
) {
  requireOnline();
  const common = {
    p_session_id: item.session_id,
    p_expected_version: item.version,
    p_request_id: key,
  };
  const { data, error } =
    action.kind === "draft"
      ? await db().rpc("save_delivery_draft", {
          ...common,
          p_payload: action.draft,
        })
      : action.kind === "submit"
        ? await db().rpc("submit_delivery", common)
        : action.kind === "customer_confirm"
          ? await db().rpc("confirm_customer_delivery", common)
          : await db().rpc("review_delivery", {
              ...common,
              p_action: action.kind,
              p_note: "note" in action ? action.note : "",
            });
  if (error) throw error;
  return deliverySessionSchema.parse(data);
}
