/** Categories do not guess unknown notification kinds or expose a fake complete-inbox filter. */
import { expect, it } from "vitest";
import { notificationCategory } from "./categories";

it.each([
  ["chat_message", "messages"],
  ["forum_reply", "messages"],
  ["portal_announcement", "messages"],
  ["claim_confirmed", "courses"],
  ["session_reminder", "courses"],
  ["course_resource_shared", "courses"],
  ["course_schedule_changed", "courses"],
  ["readiness_task", "tasks"],
  ["course_preparation_updated", "tasks"],
  ["invoice_review_requested", "finance"],
  ["invoice_exception_available", "finance"],
  ["invoice_exception_revoked", "finance"],
  ["invoice_series_available", "finance"],
  ["invoice_series_revoked", "finance"],
  ["invoice_correction_proposed", "finance"],
  ["invoice_correction_acknowledged", "finance"],
  ["invoice_correction_disputed", "finance"],
  ["invoice_correction_withdrawn", "finance"],
  ["invoice_correction_repayment_recorded", "finance"],
  ["invoice_correction_repayment_voided", "finance"],
  ["invoice_submitted", "finance"],
  ["invoice_approved", "finance"],
  ["invoice_paid", "finance"],
  ["invoice_fully_credited", "finance"],
  ["invoice_rejected", "finance"],
  ["invoice_cancelled", "finance"],
  ["payment_received", "finance"],
  ["support_update", "support"],
  ["unknown_invoice_prefix", "other"],
  ["chat_secret_future_kind", "other"],
])("maps exact kind %s to %s", (kind, category) =>
  expect(notificationCategory(kind)).toBe(category),
);
