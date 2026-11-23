/** Verify the published HTTP aliases using actual Auth, Edge and PostgREST on the disposable stack. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {testActorHeaders, withApiFixture} from "./testing/api.mjs";

await withApiFixture(async ({actor, url, recoveryEndpoints}) => {
    const owner = await actor("http-view-owner", "lecturer");
    const peer = await actor("http-view-peer", "lecturer");
    const ownerHeaders = await testActorHeaders(owner, recoveryEndpoints.appOrigin);
    const peerHeaders = await testActorHeaders(peer, recoveryEndpoints.appOrigin);

    function request(method, path, headers, args) {
        const endpoint = new URL(path, url);
        const init = {method, headers, redirect: "error", signal: AbortSignal.timeout(15_000)};
        if (args !== undefined) {
            if (method === "GET") {
                endpoint.searchParams.set("input", JSON.stringify(args));
            } else {
                init.headers = {...headers, "Content-Type": "application/json"};
                init.body = JSON.stringify(args);
            }
        }
        return fetch(endpoint, init);
    }

    const prefix = "/functions/v1/portal-api/v1/";
    const list = prefix + "saved_job_views";
    const update = prefix + "save_job_view";
    const remove = prefix + "remove_job_view";

    async function expectJson(response, status) {
        const result = await response;
        assert.equal(result.status, status, `${result.status} ${result.statusText}`);
        return result.json();
    }

    assert.deepEqual(await expectJson(request("GET", list, ownerHeaders, {}), 200), []);
    const args = {
        p_id: randomUUID(),
        p_name: "Fictional scoped HTTP view",
        p_filters: {q: "Überblick + owner"},
        p_expected_version: 0,
    };
    const created = await expectJson(
        request("POST", "/rest/v1/rpc/save_job_view", ownerHeaders, args),
        200,
    );
    assert.equal(created.id, args.p_id);
    assert.equal(created.version, 1);

    assert.deepEqual(
        await expectJson(request("PUT", update, ownerHeaders, {...args, p_id: null}), 400),
        {error: "existing_record_id_required"},
    );
    assert.deepEqual(
        await expectJson(request("PUT", update, ownerHeaders, {...args, p_id: randomUUID()}), 400),
        {error: "existing_record_version_required"},
    );

    const put = await expectJson(
        request("PUT", update, ownerHeaders, {
            ...args,
            p_name: "Fictional saved HTTP view revised",
            p_expected_version: created.version,
        }),
        200,
    );
    assert.equal(put.id, created.id);
    assert.equal(put.version, 2);
    assert.equal(put.name, "Fictional saved HTTP view revised");
    assert.deepEqual(put.filters, created.filters);

    const ownerList = await request("GET", list, ownerHeaders);
    assert.match(ownerList.headers.get("cache-control") ?? "", /no-store/);
    assert.ok(
        [recoveryEndpoints.appOrigin, "*"].includes(ownerList.headers.get("access-control-allow-origin")),
        "The worker or local gateway permits the approved Origin",
    );
    const foreignOrigin = await expectJson(
        request("GET", list, {...ownerHeaders, Origin: "https://unapproved.example.invalid"}),
        403,
    );
    assert.deepEqual(foreignOrigin, {error: "origin_not_allowed"});
    assert.deepEqual(await expectJson(ownerList, 200), [put]);
    assert.deepEqual(await expectJson(request("GET", list, peerHeaders), 200), []);

    const deleteArgs = {p_id: put.id, p_expected_version: put.version};
    const denied = await expectJson(request("DELETE", remove, peerHeaders, deleteArgs), 403);
    assert.equal(denied.code, "42501");

    const stale = await expectJson(
        request("DELETE", remove, ownerHeaders, {...deleteArgs, p_expected_version: created.version}),
        409,
    );
    assert.equal(stale.code, "40001");
    assert.deepEqual(await expectJson(request("GET", list, ownerHeaders), 200), [put]);

    const deleted = await request("DELETE", remove, ownerHeaders, deleteArgs);
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");
    assert.deepEqual(await expectJson(request("GET", list, ownerHeaders), 200), []);
    console.log("Verified live scoped GET, POST, PUT and DELETE through ordinary local Auth.");
});
