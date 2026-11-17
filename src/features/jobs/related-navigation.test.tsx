import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { JobRelatedNavigation } from "./related-navigation";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const job = "a1000000-0000-4000-8000-000000000001";
const course = "a1000000-0000-4000-8000-000000000002";
const room = "a1000000-0000-4000-8000-000000000003";
afterEach(() => {
  cleanup();
  rpc.mockReset();
});
it("shows exact authorized destinations and removes retained links on revocation", async () => {
  await i18n.changeLanguage("de");
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({
      data: {
        course_id: course,
        rooms: [{ id: room, kind: "lecturer_course" }],
      },
      error: null,
    }),
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobRelatedNavigation actor="actor" jobId={job} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("link", { name: "Kursarbeitsraum öffnen" }),
  ).toHaveAttribute("href", `/courses/${course}/workspace`);
  expect(
    screen.getByRole("link", { name: "Dozierenden-Chat öffnen" }),
  ).toHaveAttribute("href", `/chats?room=${room}`);
  expect(rpc).toHaveBeenCalledWith("job_related_navigation", { p_job_id: job });
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({ data: null, error: { code: "42501" } }),
  }));
  await client.invalidateQueries({
    queryKey: ["job-related-navigation", "actor", job],
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Kursarbeitsraum öffnen" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("link", { name: "Dozierenden-Chat öffnen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Erneut versuchen" }),
  ).toBeVisible();
  client.clear();
});
it("does not fabricate links for an unassigned actor and supports English", async () => {
  await i18n.changeLanguage("en");
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({
      data: { course_id: null, rooms: [] },
      error: null,
    }),
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobRelatedNavigation actor="actor" jobId={job} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Related areas" }),
    ).not.toBeInTheDocument(),
  );
  client.clear();
});
