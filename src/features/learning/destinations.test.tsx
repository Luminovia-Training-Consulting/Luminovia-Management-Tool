/** Course relationships remain scoped to the current successful server response. */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CourseDestinations } from "./destinations";
import "../../lib/i18n";

const state = vi.hoisted(() => ({ error: null as unknown }));
const run = "11111111-1111-4111-8111-111111111111",
  job = "22222222-2222-4222-8222-222222222222",
  room = "33333333-3333-4333-8333-333333333333";
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: () => ({
      abortSignal: async () => ({
        error: state.error,
        data: {
          organisation: { id: run, name: "Fictional Academy" },
          lecturers: [{ id: run, name: "Fictional Teacher" }],
          jobs: [{ id: job, title: "Course assignment" }],
          rooms: [{ id: room, name: "Teaching team" }],
        },
      }),
    }),
  }),
}));
afterEach(() => {
  cleanup();
  state.error = null;
});
it("links only exact permitted jobs and chat rooms, removes cached relationships after denial", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CourseDestinations actor="actor" courseId={run} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Fictional Academy")).toBeVisible();
  expect(screen.getByRole("link", { name: "Teaching team" })).toHaveAttribute(
    "href",
    `/chats?room=${room}`,
  );
  expect(
    screen.getByRole("link", { name: "Course assignment" }),
  ).toHaveAttribute("href", `/jobs/${job}`);
  state.error = { code: "42501" };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["course-operation-destinations"],
    });
  });
  await waitFor(() =>
    expect(screen.queryByText("Fictional Academy")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("link", { name: "Teaching team" }),
  ).not.toBeInTheDocument();
  client.clear();
});
