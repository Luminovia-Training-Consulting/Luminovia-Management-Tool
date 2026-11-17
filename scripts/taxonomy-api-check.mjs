/** Actual local Auth/password-only authentication/REST taxonomy journey, guarded by the canonical fixture. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(
  async ({ service, actor, passwordOnly, checked, defer, suffix }) => {
    const manager = await actor("taxonomy-manager", "management"),
      lecturer = await actor("taxonomy-lecturer", "lecturer"),
      client = await actor("taxonomy-client", "client"),
      peer = await actor("taxonomy-peer", "lecturer");
    const ids = [],
      template = randomUUID();
    defer(async () => {
      await checked(
        service
          .from("course_template_topics")
          .delete()
          .eq("template_id", template),
        "Remove own template links",
      );
      await checked(
        service.from("course_templates").delete().eq("id", template),
        "Remove own template",
      );
      if (ids.length) {
        await checked(
          service.from("lecturer_topics").delete().in("topic_id", ids),
          "Remove own expertise links",
        );
        await checked(
          service.from("topics").delete().in("id", ids),
          "Remove own taxonomy graph",
        );
      }
    });
    /** Creates this module's fictional inputs; authoritative validation remains on the server. */
    const payload = (label) => ({
      label_de: label,
      label_en: `EN ${label}`,
      kind: "tool",
      parent_id: null,
      aliases: [`Alias-${suffix}`, " second "],
      description_de: "Fiktive Beschreibung",
      description_en: "Fictional description",
    });
    assert.ok(
      (
        await manager.client.rpc("save_taxonomy_topic", {
          p_id: null,
          p_payload: payload("password-only AAL1 denied"),
          p_version: 0,
        })
      ).error,
      "Real password-only AAL1 manager must not mutate",
    );
    assert.ok(
      (
        await lecturer.client.rpc("save_taxonomy_topic", {
          p_id: null,
          p_payload: payload("Lecturer denied"),
          p_version: 0,
        })
      ).error,
    );
    await passwordOnly(manager.client);
    // Parent/child records are created through the real API; their references must stay stable after later archival.
    const parent = await checked(
      manager.client.rpc("save_taxonomy_topic", {
        p_id: null,
        p_payload: payload(`Parent-${suffix}`),
        p_version: 0,
      }),
      "Create actual root catalogue entry",
    );
    ids.push(parent);
    const child = await checked(
      manager.client.rpc("save_taxonomy_topic", {
        p_id: null,
        p_payload: { ...payload(`Child-${suffix}`), parent_id: parent },
        p_version: 0,
      }),
      "Create actual child catalogue entry",
    );
    ids.push(child);
    await checked(
      lecturer.client
        .from("lecturer_topics")
        .insert({ user_id: lecturer.id, topic_id: child }),
      "Select active topic through actual RLS",
    );
    await checked(
      service
        .from("course_templates")
        .insert({ id: template, title: `Private taxonomy template ${suffix}` }),
      "Create private linked template",
    );
    await checked(
      service
        .from("course_template_topics")
        .insert({ template_id: template, topic_id: child }),
      "Link same real topic identity",
    );
    // Discovery combines alias filtering with current resource permissions without revealing private templates.
    const query = {
      p_search: `Alias-${suffix}`,
      p_kind: "tool",
      p_include_archived: false,
    };
    const own = await checked(
      manager.client.rpc("taxonomy_catalogue", query),
      "Search normalized aliases over REST",
    );
    assert.equal(own.length, 2);
    assert.equal(
      own.find((row) => row.id === child).related_courses[0].id,
      template,
    );
    for (const person of [lecturer, client]) {
      const scoped = await checked(
        person.client.rpc("taxonomy_catalogue", query),
        "Read permission-filtered catalogue",
      );
      assert.equal(scoped.length, 2);
      assert.ok(scoped.every((row) => row.related_courses.length === 0));
    }
    assert.ok(
      (
        await manager.client.rpc("save_taxonomy_topic", {
          p_id: parent,
          p_payload: { ...payload(`Parent-${suffix}`), parent_id: child },
          p_version: 1,
        })
      ).error,
      "REST hierarchy cycle denied",
    );
    const renamed = `Renamed-${suffix}`;
    await checked(
      manager.client.rpc("save_taxonomy_topic", {
        p_id: child,
        p_payload: { ...payload(renamed), parent_id: parent },
        p_version: 1,
      }),
      "Rename while preserving identity",
    );
    assert.ok(
      (
        await manager.client.rpc("save_taxonomy_topic", {
          p_id: child,
          p_payload: payload("Stale"),
          p_version: 1,
        })
      ).error,
      "Stale real writer denied",
    );
    await checked(
      manager.client.rpc("set_taxonomy_topic_archived", {
        p_id: child,
        p_archived: true,
        p_version: 2,
      }),
      "Archive exact observed version",
    );
    assert.deepEqual(
      await checked(
        lecturer.client.rpc("taxonomy_catalogue", {
          p_search: renamed,
          p_kind: "",
          p_include_archived: false,
        }),
        "Archived hidden from discovery",
      ),
      [],
    );
    const oldRefs = await checked(
      lecturer.client
        .from("lecturer_topics")
        .select("topic_id")
        .eq("topic_id", child),
      "Historical expertise remains",
    );
    assert.equal(oldRefs.length, 1);
    const archivedSelection = await peer.client
      .from("lecturer_topics")
      .insert({ user_id: peer.id, topic_id: child });
    assert.equal(
      archivedSelection.error?.code,
      "23514",
      "Eligible peer's new archived selection is denied by the actual archive guard",
    );
    assert.ok(
      (
        await lecturer.client.rpc("taxonomy_catalogue", {
          p_include_archived: true,
        })
      ).error,
    );
    await checked(
      manager.client.rpc("set_taxonomy_topic_archived", {
        p_id: child,
        p_archived: false,
        p_version: 3,
      }),
      "Restore versioned entry",
    );
    assert.ok(
      (
        await manager.client
          .from("topics")
          .update({ label_de: "Direct forged mutation" })
          .eq("id", child)
      ).error,
      "Even password-only authentication managers cannot bypass CRUD RPC",
    );
    await checked(
      service.from("profiles").update({ active: false }).eq("id", manager.id),
      "Suspend test manager",
    );
    assert.ok(
      (
        await manager.client.rpc("save_taxonomy_topic", {
          p_id: null,
          p_payload: payload("Suspended"),
          p_version: 0,
        })
      ).error,
      "Existing suspended token immediately denied",
    );
    console.log(
      "PASS: actual Auth/password-only authentication/REST taxonomy creation/search/hierarchy, private related-template projection, optimistic conflict, archive/restore and preserved historic expertise, direct-write and existing-token suspension denial.",
    );
  },
);
