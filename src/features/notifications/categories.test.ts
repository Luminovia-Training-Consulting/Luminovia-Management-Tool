/** Categories do not guess unknown notification kinds or expose a fake complete-inbox filter. */
import {expect, it} from "vitest";
import {notificationCategory} from "./categories";

it.each([
    ["chat_message", "messages"],
    ["forum_reply", "messages"],
    ["portal_announcement", "messages"],
    ["claim_confirmed", "courses"],
    ["session_reminder", "courses"],
    ["course_resource_shared", "courses"],
    ["readiness_task", "tasks"],
    ["course_preparation_updated", "tasks"],
    ["invoice_submitted", "finance"],
    ["invoice_approved", "finance"],
    ["invoice_paid", "finance"],
    ["invoice_rejected", "finance"],
    ["invoice_cancelled", "finance"],
    ["payment_received", "finance"],
    ["support_update", "support"],
    ["unknown_invoice_prefix", "other"],
    ["chat_secret_future_kind", "other"],
])("maps exact kind %s to %s", (kind, category) =>
    expect(notificationCategory(kind)).toBe(category),
);