/** Actual Auth/REST opt-in, current stored contacts and role revocation. */
import assert from "node:assert/strict";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({actor, checked, service}) => {
    const owner = await actor("staff-contact-owner", "lecturer"),
        peer = await actor("staff-contact-peer", "senior_lecturer"),
        admin = await actor("staff-contact-admin", "admin"),
        learner = await actor("staff-contact-learner", "participant"),
        client = await actor("staff-contact-client", "client");
    await checked(
        service
            .from("profiles")
            .update({phone: "+49 40 123456"})
            .eq("id", owner.id),
    );
    const contact = (who) =>
        checked(who.client.rpc("person_contact", {p_user_id: owner.id}));
    assert.deepEqual(await contact(admin), {email: null, phone: null});
    const initial = await checked(
        owner.client.rpc("contact_visibility_preferences"),
    );
    assert.equal(initial.version, 0);
    assert.equal(initial.email_address, owner.email);
    const payload = {email_visible: true, phone_visible: true};
    const attempts = await Promise.all(
        [1, 2].map(() =>
            owner.client.rpc("save_contact_visibility_preferences", {
                p_payload: payload,
                p_expected_version: 0,
            }),
        ),
    );
    assert.equal(attempts.filter((r) => !r.error).length, 1);
    assert.equal(attempts.find((r) => r.error).error.code, "40001");
    assert.deepEqual(await contact(peer), {
        email: owner.email,
        phone: "+49 40 123456",
    });
    assert.equal(
        (await learner.client.rpc("person_contact", {p_user_id: owner.id})).error
            ?.code,
        "42501",
        "Retired participant has no operational contact API access",
    );
    assert.deepEqual(await contact(client), {email: null, phone: null});
    assert.equal(
        (
            await owner.client.rpc("save_contact_visibility_preferences", {
                p_payload: {...payload, user_id: peer.id},
                p_expected_version: 1,
            })
        ).error?.code,
        "22023",
    );
    const minimal = await checked(
        peer.client.rpc("person_profile", {p_user_id: owner.id}),
    );
    assert.equal(Object.hasOwn(minimal, "email"), false);
    assert.equal(Object.hasOwn(minimal, "phone"), false);
    await checked(
        owner.client.rpc("save_contact_visibility_preferences", {
            p_payload: {email_visible: false, phone_visible: false},
            p_expected_version: 1,
        }),
    );
    assert.deepEqual(await contact(admin), {email: null, phone: null});
    await checked(
        owner.client.rpc("save_contact_visibility_preferences", {
            p_payload: payload,
            p_expected_version: 2,
        }),
    );
    await checked(service.from("user_roles").delete().eq("user_id", peer.id));
    assert.equal(
        (await peer.client.rpc("person_contact", {p_user_id: owner.id})).error
            ?.code,
        "42501",
        "Revoked staff role loses access through the operational REST boundary",
    );
    await checked(
        service.from("profiles").update({active: false}).eq("id", owner.id),
    );
    assert.deepEqual(await contact(admin), {email: null, phone: null});
    assert.equal(
        (await owner.client.rpc("contact_visibility_preferences")).error?.code,
        "42501",
    );
    console.log(
        "PASS: actual Auth/REST private-by-default staff contacts, current source opt-in, one concurrent CAS winner, client/learner/admin boundaries, forged actor rejection, retained minimal profile and immediate role/suspension revocation.",
    );
});