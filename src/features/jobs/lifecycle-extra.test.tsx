/** Waitlist regressions with isolated SDK and query fixtures. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { JobWaitlist, MyJobWaitlist } from "./lifecycle-extra";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  responses: {} as Record<string, unknown>,
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "replacement" } } }),
}));
let client: QueryClient;
const job = "1722aa1e-16be-4ca3-8064-fe81e49752ae";
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryDefaults(["user-roles", "replacement"], {
    staleTime: Infinity,
  });
  client.setQueryData(["user-roles", "replacement"], ["lecturer"]);
  fake.responses = {
    job_waitlist: {
      job_id: job,
      title: "Fictional full offer",
      joined: false,
      can_join: true,
      available: false,
    },
  };
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (done: (value: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          done({ data, error: null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  // The real offline event pauses SDK queries as well as disabling the UI.
  // Restore that global fixture state before another isolated case mounts.
  onlineManager.setOnline(true);
});

function mount(child: React.ReactNode) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// Private offers retain only the actor's removable interest; their blank title
// is intentional redaction, not a broken API response or a navigation target.
const hiddenInterest = () => ({
  job_id: job,
  title: "",
  joined: true,
  can_join: false,
  available: false,
  joined_at: "2047-05-01T08:00:00Z",
});
const visibleInterest = () => ({
  ...hiddenInterest(),
  job_id: "d3a0753c-54dc-4c39-94fc-355209cb3077",
  title: "Fictional visible waitlist offer",
  available: true,
});
const hiddenLabel = "Derzeit nicht verfügbarer Auftrag";
const hiddenLeave = `Warteliste verlassen: ${hiddenLabel}`;

it("shows a bilingual removable hidden interest without exposing an empty or private job link", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest(), visibleInterest()];
  const foreign = [
    { ...hiddenInterest(), title: "Other actor's private interest" },
  ];
  client.setQueryData(["my-job-waitlist", "another-actor"], foreign);
  mount(<MyJobWaitlist />);
  expect(await screen.findByText(hiddenLabel)).toBeVisible();
  expect(screen.queryByRole("link", { name: "" })).not.toBeInTheDocument();
  expect(document.querySelector(`a[href="/jobs/${job}"]`)).toBeNull();
  expect(
    screen.getByRole("link", { name: visibleInterest().title }),
  ).toHaveAttribute("href", `/jobs/${visibleInterest().job_id}`);
  expect(screen.getByRole("button", { name: hiddenLeave })).toBeEnabled();
  expect(
    screen.queryByText("Other actor's private interest"),
  ).not.toBeInTheDocument();
  const reads = fake.rpc.mock.calls.filter(
    ([name]) => name === "my_job_waitlist",
  ).length;
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByText("Currently unavailable job")).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Leave waitlist: Currently unavailable job",
    }),
  ).toBeEnabled();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "my_job_waitlist"),
  ).toHaveLength(reads);
  expect(client.getQueryData(["my-job-waitlist", "replacement"])).toEqual([
    hiddenInterest(),
    visibleInterest(),
  ]);
  expect(client.getQueryData(["my-job-waitlist", "another-actor"])).toEqual(
    foreign,
  );
});

it("withdraws exactly the hidden interest after server confirmation and scopes cache changes to its actor", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest(), visibleInterest()];
  const foreign = [{ ...hiddenInterest(), title: "Foreign cached interest" }];
  client.setQueryData(["my-job-waitlist", "another-actor"], foreign);
  client.setQueryData(["job-waitlist", "another-actor", job], foreign[0]);
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  let resolve!: (value: unknown) => void;
  fake.responses.set_job_waitlist = new Promise((done) => {
    resolve = done;
  });
  await userEvent.click(leave);
  expect(leave).toBeDisabled();
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toEqual([["set_job_waitlist", { p_job_id: job, p_join: false }]]);
  const receipt = {
    job_id: job,
    title: "",
    joined: false,
    can_join: false,
    available: false,
  };
  fake.responses.my_job_waitlist = [visibleInterest()];
  await act(async () => resolve(receipt));
  await waitFor(() =>
    expect(screen.queryByText(hiddenLabel)).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("link", { name: visibleInterest().title }),
  ).toBeVisible();
  expect(client.getQueryData(["job-waitlist", "replacement", job])).toEqual(
    receipt,
  );
  expect(client.getQueryData(["my-job-waitlist", "another-actor"])).toEqual(
    foreign,
  );
  expect(client.getQueryData(["job-waitlist", "another-actor", job])).toEqual(
    foreign[0],
  );
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toHaveLength(1);
});

it("keeps a hidden interest removable when the server refuses its withdrawal", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest()];
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  fake.rpc.mockImplementationOnce(() =>
    Promise.resolve({
      data: null,
      error: { code: "42501", message: "Fictional refusal" },
    }),
  );
  await userEvent.click(leave);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Die Änderung wurde nicht bestätigt.",
  );
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(leave).toBeEnabled();
  expect(client.getQueryData(["my-job-waitlist", "replacement"])).toEqual([
    hiddenInterest(),
  ]);
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toHaveLength(1);
});

it("disables hidden-interest withdrawal offline without calling the mutation", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest()];
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(leave).toBeDisabled();
  await userEvent.click(leave);
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(
    fake.rpc.mock.calls.some(([name]) => name === "set_job_waitlist"),
  ).toBe(false);
});

it("waitlist membership is shown only after the real server confirms and reserves nothing", async () => {
  const user = userEvent.setup();
  mount(<JobWaitlist jobId={job} />);
  const join = await screen.findByRole("button", {
    name: "Auf Warteliste setzen",
  });
  let resolve!: (value: unknown) => void;
  fake.responses.set_job_waitlist = new Promise((done) => {
    resolve = done;
  });
  await user.click(join);
  expect(join).toBeDisabled();
  expect(
    screen.queryByText("Du stehst auf der Warteliste."),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenLastCalledWith("set_job_waitlist", {
    p_job_id: job,
    p_join: true,
  });
  await act(async () =>
    resolve({ ...(fake.responses.job_waitlist as object), joined: true }),
  );
  expect(
    await screen.findByText("Du stehst auf der Warteliste."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Warteliste verlassen" }),
  ).toBeEnabled();
});
