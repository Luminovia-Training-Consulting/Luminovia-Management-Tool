/** Only explicit Auth request rejections exclude uncertainty about SMTP acceptance. */
export function definiteInvitationRejection(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("status" in error) || !("code" in error)) {
        return false;
    }
    return (error.status === 429 && error.code === "over_email_send_rate_limit") ||
        ((error.status === 400 || error.status === 422) &&
            (error.code === "email_address_invalid" || error.code === "email_address_not_authorized"));
}
