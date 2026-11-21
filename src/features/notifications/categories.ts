/** Presentation categories for authorized notification rows; unknown kinds stay in All only. */
export const notificationCategories = [
    "all",
    "messages",
    "courses",
    "tasks",
    "finance",
    "support",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
const groups: Record<
    Exclude<NotificationCategory, "all">,
    readonly string[]
> = {
    messages: ["chat_message", "forum_reply", "portal_announcement"],
    courses: [
        "claim_confirmed",
        "claim_cancelled",
        "assignment_change",
        "assignment_withdrawal_requested",
        "assignment_withdrawal_approved",
        "assignment_withdrawal_rejected",
        "assignment_withdrawal_withdrawn",
        "job_reopened",
        "job_matching",
        "session_reminder",
        "replacement_available",
        "replacement_completed",
        "job_waitlist_available",
        "substitution_proposed",
        "substitution_closed",
        "course_question",
        "course_answer",
        "course_resource_shared",
        "course_quiz_published",
        "course_attendance_updated",
        "course_completion_issued",
        "course_completion_revoked",
        "delivery_submitted",
        "delivery_confirmed",
        "delivery_disputed",
        "delivery_correction_requested",
        "delivery_customer_confirmed",
        "qualification_expiring",
    ],
    tasks: [
        "task_assigned",
        "task_due",
        "readiness_task",
        "course_preparation_updated",
    ],
    finance: [
        "invoice_submitted",
        "invoice_approved",
        "invoice_paid",
        "invoice_rejected",
        "invoice_cancelled",
        "payment_received",
        "timesheet_reviewed",
        "contract_available",
        "contract_expiring",
    ],
    support: ["support_update", "website_enquiry"],
};

/** Exact kinds prevent an unrecognized future event from appearing in the wrong category. */
export function notificationCategory(
    kind: string,
): Exclude<NotificationCategory, "all"> | "other" {
    for (const [category, kinds] of Object.entries(groups))
        if (kinds.includes(kind))
            return category as Exclude<NotificationCategory, "all">;
    return "other";
}
