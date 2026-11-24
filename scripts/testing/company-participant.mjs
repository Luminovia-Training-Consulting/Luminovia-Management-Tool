/** Connect a fictional participant-only Auth session to a Premium fixture organisation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

/** @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient */
/** @typedef {{id: string, email: string, client: SupabaseClient}} TestActor */
/** @typedef {{organisation_id: string, organisation_name: string, version: number, expires_at: string, source: "email" | "luminovia_user_id"}} ParticipantInvitation */
/** @typedef {import("./api.mjs").CheckedRequest} CheckedRequest */

/** Turn on Premium, request the company link and accept it as the participant.
 * @param {{admin: TestActor, company: TestActor, learner: TestActor, organisation: string, service: SupabaseClient, checked: CheckedRequest}} fixture
 */
export async function enablePremiumAndLinkParticipant({
    admin,
    company,
    learner,
    organisation,
    service,
    checked,
}) {
    await checked(
        admin.client.rpc("set_company_premium", {
            p_organisation_id: organisation,
            p_enabled: true,
            p_expected_version: 0,
            p_request_id: randomUUID(),
        }),
        "Enable fictional company's Premium LMS",
    );
    const identity = await checked(
        service
            .from("profiles")
            .select("luminovia_user_id")
            .eq("id", learner.id)
            .single(),
        "Read fictional participant's Luminovia User ID",
    );
    assert.ok(identity?.luminovia_user_id, "The fictional participant must have a Luminovia User ID.");
    assert.deepEqual(
        await checked(
            company.client.rpc("request_company_participant_link", {
                p_organisation_id: organisation,
                p_luminovia_user_id: identity.luminovia_user_id,
                p_request_id: randomUUID(),
            }),
            "Request scoped participant association",
        ),
        {status: "request_submitted"},
    );
    const invitations = await checked(
        learner.client.rpc("my_company_participant_invitations"),
        "Read own current company association request",
    );
    assert.ok(Array.isArray(invitations), "The participant invitation RPC returns a JSON array.");
    /** @type {ParticipantInvitation[]} */
    const participantInvitations = invitations;
    const invitation = participantInvitations.find(
        (row) => row.organisation_id === organisation,
    );
    assert.ok(invitation, "The submitted participant association must appear in own invitations.");
    assert.equal(invitation.source, "luminovia_user_id");
    assert.deepEqual(
        await checked(
            learner.client.rpc("accept_company_participant_invitation", {
                p_organisation_id: organisation,
                p_expected_version: invitation.version,
                p_request_id: randomUUID(),
            }),
            "Accept association as the actual participant",
        ),
        {
            status: "accepted",
            organisation_id: organisation,
            version: invitation.version + 1,
        },
    );
}
