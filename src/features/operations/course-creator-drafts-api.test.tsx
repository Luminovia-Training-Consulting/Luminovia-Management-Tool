/** Reproduce a committed draft save whose response was lost, without a live API. */
import { type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useCourseCreatorDraftSaver } from "./course-creator-drafts-api";
import type { CourseCreatorSnapshot } from "./course-creator-drafts-schema";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

it("replays the exact unconfirmed save before writing newer edits", async () => {
  const id = "c3490000-0000-4000-8000-000000000001";
  const snapshot = (title: string): CourseCreatorSnapshot => ({
    content: {
      title,
      description: "",
      syllabus: "",
      prerequisites: "",
      topic_ids: [],
      archived: false,
    },
    run: {
      template_id: "",
      organisation_id: "",
      time_zone: "Europe/Berlin",
      delivery_type: "online",
      venue: "",
      archived: false,
      sessions: [{ starts_at: "", ends_at: "" }],
    },
  });
  const first = snapshot("Fictional first edit");
  const second = snapshot("Fictional later edit");
  let revision = 0;
  let stored: CourseCreatorSnapshot | undefined;
  rpc.mockImplementation(async (_name, args) => {
    if (args.p_expected_revision === revision) {
      revision++;
      stored = args.p_payload;
      if (revision === 1) {
        return { status: 0, error: { code: "", message: "Lost response" } };
      }
    } else if (
      args.p_expected_revision !== revision - 1 ||
      JSON.stringify(args.p_payload) !== JSON.stringify(stored)
    ) {
      return { status: 409, error: { code: "40001" } };
    }
    return {
      status: 200,
      error: null,
      data: {
        id,
        revision,
        state: "editing",
        title: stored?.content.title,
        payload: stored,
        updated_at: "2030-01-01T00:00:00Z",
        course_run_id: null,
        next_action: null,
      },
    };
  });
  const client = new QueryClient();
  const { result, unmount } = renderHook(
    () => useCourseCreatorDraftSaver("actor", id),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await act(async () => {
    await expect(result.current.write(first)).rejects.toBeDefined();
  });
  expect(result.current.status).toBe("error");
  await act(async () => {
    await result.current.write(second);
  });
  expect(result.current.status).toBe("saved");
  expect(stored).toEqual(second);
  expect(
    rpc.mock.calls.map(([, args]) => [
      args.p_expected_revision,
      args.p_payload,
    ]),
  ).toEqual([
    [0, first],
    [0, first],
    [1, second],
  ]);
  unmount();
  client.clear();
});
