/**
 * Real Auth/HTTP checks for scanned avatars and current viewing permissions.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import sharp from "sharp";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({service, actor, passwordOnly, defer, checked, sql, url}) => {
    const origin = new URL(process.env.E2E_BASE_URL).origin;
    const users = [];
    const org = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        claim = randomUUID();
    let courseCreated = false;

    /** Creates and signs in the specific fictional identity for the real avatar-permission check. */
    async function identity(role) {
        const who = await actor(`avatar-${role}-${users.length}`, role);
        users.push(who.id);
        return who;
    }

    /** Reads the test actor's current session token for actual authenticated gateway requests. */
    async function headers(who) {
        const {session} = await checked(
            who.client.auth.getSession(),
            "Current actual session",
        );
        return {
            Origin: origin,
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.SUPABASE_ANON_KEY,
        };
    }

    /** Sends the actual test request as the selected identity; its response is asserted separately. */
    async function request(who, body) {
        return await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: {...(await headers(who)), "Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
    }

    /** Sends real fixture bytes through the authenticated file endpoint; scanning and release remain server responsibilities. */
    async function upload(who, bytes, mime = "image/png", name = "avatar.png") {
        const form = new FormData();
        form.set("file", new File([bytes], name, {type: mime}));
        form.set("scope", "personal");
        form.set("kind", "avatar");
        form.set("client_id", randomUUID());
        const response = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: await headers(who),
            body: form,
        });
        return {status: response.status, body: await response.json()};
    }

    defer(async () => {
        if (users.length) {
            await checked(
                service.from("profile_avatars").delete().in("user_id", users),
                "Clean scoped avatar pointers",
            );
            const docs = await checked(
                service.from("documents").select("id").in("owner_id", users),
                "List scoped documents",
            );
            const ids = docs.map((d) => d.id);
            if (ids.length) {
                const versions = await checked(
                        service
                            .from("document_versions")
                            .select("object_path")
                            .in("document_id", ids),
                        "Scoped avatar objects",
                    ),
                    paths = versions.map((v) => v.object_path);
                await checked(
                    service.storage.from("portal-clean").remove(paths),
                    "Clean scoped image bytes",
                );
                await checked(
                    service.storage.from("portal-quarantine").remove(paths),
                    "Clean scoped quarantine bytes",
                );
                await checked(
                    service
                        .from("documents")
                        .update({current_version_id: null})
                        .in("id", ids),
                    "Release scoped pointers",
                );
                await checked(
                    service.from("document_versions").delete().in("document_id", ids),
                    "Clean scoped image versions",
                );
                await checked(
                    service.from("documents").delete().in("id", ids),
                    "Clean scoped image documents",
                );
            }
        }
        if (courseCreated) {
            await checked(
                service.from("course_enrolments").delete().eq("course_run_id", run),
                "Clean enrolment",
            );
            await checked(
                service.from("job_claims").delete().eq("id", claim),
                "Clean claim",
            );
            await checked(service.from("jobs").delete().eq("id", job), "Clean job");
            await checked(
                service.from("course_sessions").delete().eq("course_run_id", run),
                "Clean intervals",
            );
            await checked(
                service.from("course_runs").delete().eq("id", run),
                "Clean course",
            );
            await checked(
                service.from("course_templates").delete().eq("id", template),
                "Clean template",
            );
            await checked(
                service
                    .from("client_organisation_memberships")
                    .delete()
                    .eq("organisation_id", org),
                "Clean client scope",
            );
            await sql(`delete from private.company_premium_audit where organisation_id='${org}'`);
            await checked(
                service.from("organisations").delete().eq("id", org),
                "Clean org",
            );
        }
    });
    const teacher = await identity("lecturer"),
        peer = await identity("lecturer"),
        admin = await identity("admin"),
        learner = await identity("participant"),
        outsider = await identity("participant"),
        customer = await identity("client");
    await passwordOnly(admin.client);
    const png = await sharp({
        create: {
            width: 40,
            height: 40,
            channels: 4,
            background: {r: 30, g: 70, b: 180, alpha: 1},
        },
    })
        .png()
        .toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const metadata = await sharp(png).withMetadata().png().toBuffer();
    assert.equal(
        (await upload(teacher, jpeg, "image/jpeg", "avatar.jpg")).status,
        400,
        "API avatars require the documented canonical PNG",
    );
    assert.equal(
        (await upload(teacher, metadata)).status,
        400,
        "Embedded EXIF/profile metadata is rejected server-side",
    );
    const oversized = await sharp({
        create: {width: 513, height: 1, channels: 4, background: "red"},
    })
        .png()
        .toBuffer();
    assert.equal(
        (await upload(teacher, oversized)).status,
        400,
        "Image dimensions are checked before scan/storage reservation",
    );
    const stored = await upload(teacher, png);
    assert.equal(stored.status, 200, JSON.stringify(stored.body));
    const doc = stored.body.document;
    const version = await checked(
        teacher.client
            .from("document_versions")
            .select("*")
            .eq("id", doc.current_version_id)
            .single(),
        "Read own actual scanned image version",
    );
    assert.match(version.scanner_version, /^ClamAV /);
    assert.equal(version.sha256, createHash("sha256").update(png).digest("hex"));
    await checked(
        teacher.client.rpc("set_profile_avatar", {p_version_id: version.id}),
        "Select exact clean image",
    );
    const profile = await checked(
        peer.client.rpc("profile_avatar", {p_user_id: teacher.id}),
        "Allowed peer selected reference",
    );
    assert.equal(profile.version_id, version.id);
    assert.deepEqual(Object.keys(profile).sort(), ["updated_at", "version_id"]);
    for (const who of [peer, admin]) {
        const result = await request(who, {
            action: "avatar",
            user_id: teacher.id,
        });
        assert.equal(result.status, 200);
        assert.deepEqual(Buffer.from(await result.arrayBuffer()), png);
        assert.equal(result.headers.get("Content-Type"), "image/png");
        assert.match(result.headers.get("Cache-Control"), /no-store/);
        assert.deepEqual(
            await checked(
                who.client.from("documents").select("id").eq("id", doc.id),
                "Personal metadata remains private",
            ),
            [],
        );
        assert.equal(
            (await request(who, {action: "download", id: doc.id})).status,
            403,
            "Avatar access cannot download personal document versions",
        );
    }
    assert.ok(
        (
            await peer.client.storage
                .from("portal-clean")
                .download(version.object_path)
        ).error,
    );
    assert.ok(
        (
            await teacher.client.storage
                .from("portal-clean")
                .createSignedUrl(version.object_path, 60)
        ).error,
    );
    assert.equal(
        (await request(outsider, {action: "avatar", user_id: teacher.id})).status,
        403,
    );
    assert.ok(
        (await peer.client.rpc("set_profile_avatar", {p_version_id: version.id}))
            .error,
        "Cannot select another owner image",
    );
    courseCreated = true;
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: `Fictional avatar academy ${org}`}),
        "Create scoped org",
    );
    await checked(
        service
            .from("course_templates")
            .insert({id: template, title: `Fictional avatar course ${template}`}),
        "Create scoped template",
    );
    await checked(
        service.from("course_runs").insert({
            id: run,
            template_id: template,
            organisation_id: org,
            published: false,
        }),
        "Create scoped course",
    );
    const starts = new Date(Date.now() - 2 * 86400000).toISOString(),
        ends = new Date(Date.now() - 86400000).toISOString();
    await checked(
        service
            .from("course_sessions")
            .insert({course_run_id: run, starts_at: starts, ends_at: ends}),
        "Scoped course interval",
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title: "Fictional avatar assignment",
            customer_name: "Fictional academy",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "filled",
            amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            total_amount: 100,
            terms: "Fictional terms",
        }),
        "Scoped job",
    );
    await checked(
        service.from("job_claims").insert({
            id: claim,
            job_id: job,
            lecturer_id: teacher.id,
            idempotency_key: randomUUID(),
            amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            total_amount: 100,
            terms: "Fictional terms",
            terms_version: 1,
        }),
        "Scoped accepted assignment",
    );
    const completedEnrolment = {
        p_course_run_id: run,
        p_user_id: learner.id,
        p_status: "completed",
    };
    const deniedWhileOff = await admin.client.rpc("manage_course_enrolment", completedEnrolment);
    assert.equal(deniedWhileOff.error?.code, "42501");
    assert.match(deniedWhileOff.error?.message ?? "", /Company Premium LMS is OFF/);
    const premium = await checked(
        admin.client.rpc("set_company_premium", {
            p_organisation_id: org,
            p_enabled: true,
            p_expected_version: 0,
            p_request_id: randomUUID(),
        }),
        "Enable Premium for the fictional organisation only",
    );
    assert.equal(premium.enabled, true);

    await checked(
        admin.client.rpc("manage_client_organisation", {
            p_user_id: customer.id,
            p_organisation_id: org,
            p_remove: false,
        }),
        "Explicit client org",
    );
    assert.equal(
        (await admin.client.rpc("manage_course_enrolment", completedEnrolment)).error?.code,
        "42501",
        "Premium does not replace participant consent",
    );
    const learnerProfile = await checked(
        service.from("profiles").select("luminovia_user_id").eq("id", learner.id).single(),
        "Read only the fictional learner's public identifier",
    );
    await checked(
        customer.client.rpc("request_company_participant_link", {
            p_organisation_id: org,
            p_luminovia_user_id: learnerProfile.luminovia_user_id,
            p_request_id: randomUUID(),
        }),
        "Request the company-scoped participant link",
    );
    const invitations = await checked(
        learner.client.rpc("my_company_participant_invitations"),
        "Read the invited participant's own pending link",
    );
    const invitation = invitations.find(({organisation_id}) => organisation_id === org);
    assert.ok(invitation);
    const accepted = await checked(
        learner.client.rpc("accept_company_participant_invitation", {
            p_organisation_id: org,
            p_expected_version: invitation.version,
            p_request_id: randomUUID(),
        }),
        "Accept the exact organisation invitation as the participant",
    );
    assert.equal(accepted.status, "accepted");
    await checked(
        admin.client.rpc("manage_course_enrolment", completedEnrolment),
        "Record completed enrolment after the verified participant link",
    );
    assert.equal(
        (await request(learner, {action: "avatar", user_id: teacher.id})).status,
        403,
        "Historical enrolment does not grant operational access to retired participant accounts",
    );
    assert.equal(
        (await request(customer, {action: "avatar", user_id: teacher.id})).status,
        200,
        "Current organisation membership grants only the scoped avatar projection",
    );
    await checked(
        admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: run,
            p_user_id: learner.id,
            p_status: "removed",
        }),
        "Revoke enrolment",
    );
    await checked(
        admin.client.rpc("manage_client_organisation", {
            p_user_id: customer.id,
            p_organisation_id: org,
            p_remove: true,
        }),
        "Revoke organisation",
    );
    for (const who of [learner, customer])
        assert.equal(
            (await request(who, {action: "avatar", user_id: teacher.id})).status,
            403,
            "Old actor/session cannot reuse avatar access after revoke",
        );
    const replacement = await upload(
        teacher,
        await sharp(png).tint("green").png().toBuffer(),
    );
    assert.equal(replacement.status, 200);
    await checked(
        teacher.client.rpc("set_profile_avatar", {
            p_version_id: replacement.body.document.current_version_id,
        }),
        "Select replacement",
    );
    const next = await request(peer, {action: "avatar", user_id: teacher.id});
    assert.equal(next.status, 200);
    assert.notDeepEqual(Buffer.from(await next.arrayBuffer()), png);
    await checked(
        teacher.client.rpc("set_profile_avatar", {p_version_id: null}),
        "Remove selected picture",
    );
    assert.equal(
        (await request(peer, {action: "avatar", user_id: teacher.id})).status,
        404,
    );
    await checked(
        teacher.client.rpc("set_profile_avatar", {p_version_id: version.id}),
        "Restore known clean version",
    );
    await checked(
        admin.client.rpc("set_user_active", {
            p_user_id: teacher.id,
            p_active: false,
        }),
        "Suspend owner",
    );
    assert.equal(
        (await request(peer, {action: "avatar", user_id: teacher.id})).status,
        403,
    );
    assert.equal(
        (await request(teacher, {action: "avatar", user_id: teacher.id})).status,
        403,
    );
    console.log(
        "PASS: actual Auth/password-only authentication/Edge/Storage/ClamAV avatars: bounded metadata-free PNG, exact clean bytes/hash, peer profile projection without personal document/storage bypass, own replacement/removal, scoped learner/client access and immediate revocation/suspension.",
    );
});