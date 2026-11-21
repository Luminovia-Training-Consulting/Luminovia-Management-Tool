/** Connect a fictional participant-only Auth session to a Premium fixture organisation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

/** Turn on Premium, request the company link and accept it as the participant. */
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
    const invitation = invitations.find(
        (row) => row.organisation_id === organisation,
    );
    assert.equal(invitation?.source, "luminovia_user_id");
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
