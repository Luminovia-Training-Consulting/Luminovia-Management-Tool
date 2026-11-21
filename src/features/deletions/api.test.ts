import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  confirmDeletion,
  deletionPreviewQuery,
  deletionResourcesQuery,
  refreshAfterDeletion,
  resumeDeletion,
} from "./api";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../accounts/api", () => ({ accountRequest: request }));
afterEach(() => request.mockReset());
const plan = {
  plan_id: "plan-a",
  kind: "job",
  id: "job-a",
  label: "Fictional workshop",
  counts: { jobs: 1 },
  blockers: [],
  can_confirm: true,
  expires_at: "2099-01-01T00:00:00Z",
};
describe("deletion HTTP adapter", () => {
  it("rejects a preview or operation belonging to another target", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    request.mockResolvedValue({ ...plan, id: "foreign" });
    await expect(
      client.fetchQuery(deletionPreviewQuery("actor", "job", "job-a")),
    ).rejects.toThrow("preview_target_mismatch");
    request.mockResolvedValue({
      operation_id: "operation",
      kind: "job",
      id: "foreign",
      status: "completed",
    });
    await expect(confirmDeletion(plan, "stable-request")).rejects.toThrow(
      "operation_target_mismatch",
    );
  });
  it("rejects unknown statuses instead of assuming cleanup completed", async () => {
    request.mockResolvedValue({
      operation_id: "operation",
      kind: "job",
      id: "job-a",
      status: "accepted",
    });
    await expect(confirmDeletion(plan, "stable-request")).rejects.toThrow();
  });
  it("encodes resource filters and partitions cache by actor", async () => {
    request.mockResolvedValue({ items: [], next_cursor: null });
    const client = new QueryClient();
    await client.fetchQuery(
      deletionResourcesQuery("actor-a", "job", "a&b", "page/token"),
    );
    const path = request.mock.calls[0][0] as string;
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("q")).toBe("a&b");
    expect(params.get("cursor")).toBe("page/token");
    expect(
      client.getQueryData(
        deletionResourcesQuery("actor-b", "job", "a&b", "page/token").queryKey,
      ),
    ).toBeUndefined();
  });
  it("omits a null first-page cursor rather than submitting an invalid empty UUID", async () => {
    request.mockResolvedValue({ items: [], next_cursor: null });
    await new QueryClient().fetchQuery(
      deletionResourcesQuery("actor", "account", "", null),
    );
    expect(
      new URLSearchParams(request.mock.calls[0][0].split("?")[1]).has("cursor"),
    ).toBe(false);
  });
  it("does not publish an initial stale read after post-completion invalidation", async () => {
    const client = new QueryClient();
    let release!: (value: string[]) => void;
    const old = client.fetchQuery({
      queryKey: ["documents", "actor"],
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          release = resolve;
        }),
    });
    const caught = old.catch(() => undefined);
    await refreshAfterDeletion(client);
    release(["deleted-file"]);
    await caught;
    expect(client.getQueryData(["documents", "actor"])).toBeUndefined();
  });
  it("resumes the exact acknowledged operation with an empty body", async () => {
    const operation = {
      operation_id: "operation/a",
      kind: "document",
      id: "doc-a",
      status: "pending" as const,
    };
    request.mockResolvedValue({ ...operation, status: "completed" });
    expect((await resumeDeletion(operation)).status).toBe("completed");
    expect(request).toHaveBeenCalledWith(
      "deletions/operations/operation%2Fa",
      "POST",
      {},
    );
  });
});
