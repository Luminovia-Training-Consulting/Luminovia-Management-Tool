import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PersonDetails } from "./api";
import i18n from "../../lib/i18n";
import { PeopleDirectory, PersonProfile } from "./people";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), avatar: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fixture.rpc }) }));
vi.mock("../../lib/queries", () => ({
  topicsQuery: {
    queryKey: ["topics"],
    queryFn: async () => [],
  },
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "viewer" } } }),
}));
vi.mock("../profile/avatar", () => ({
  Avatar: ({ userId }: { userId: string }) => {
    fixture.avatar(userId);
    return null;
  },
}));
vi.mock("../accounts/person-actions", () => ({
  PersonManagementActions: () => null,
}));
vi.mock("../accounts/person-expertise", () => ({
  PersonExpertise: () => null,
}));
vi.mock("../accounts/unavailable-person", () => ({
  UnavailablePerson: () => <p>Profile unavailable</p>,
}));
vi.mock("./person-contact", () => ({ PersonContact: () => null }));

const clients: QueryClient[] = [];
const person: PersonDetails = {
  id: "target",
  luminovia_user_id: "fictional-ref",
  display_name: "Fictional profile",
  bio_de: "",
  bio_en: "",
  time_zone: "UTC",
  country: "",
  languages: [],
  labels: [],
  topics: [],
  teaching_experience: "",
  teaching_minutes: 0,
  can_moderate: false,
};

function setup(path = "/people") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15000 } },
  });
  clients.push(client);
  function show() {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/people" element={<PeopleDirectory />} />
            <Route path="/people/:id" element={<PersonProfile />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  return { client, show };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
  vi.useRealTimers();
});

it("debounces the directory request and aborts a superseded server read", async () => {
  const signals = new Map<string, AbortSignal>();
  fixture.rpc.mockImplementation(
    (_name: string, { p_search: search }: { p_search: string }) => {
      const response =
        search === "First"
          ? new Promise(() => {})
          : Promise.resolve({ data: [], error: null });
      return Object.assign(response, {
        abortSignal: (signal: AbortSignal) => {
          signals.set(search, signal);
          return response;
        },
      });
    },
  );
  setup().show();
  await screen.findByText("No matching profiles.");
  const search = screen.getByRole("searchbox", { name: "Search people" });
  vi.useFakeTimers();
  for (const value of ["F", "Fi", "Fir", "Firs", "First"]) {
    fireEvent.change(search, { target: { value } });
    await act(() => vi.advanceTimersByTimeAsync(15));
  }
  expect(fixture.rpc.mock.calls).toHaveLength(1);
  expect([...signals.keys()]).toEqual([""]);
  await act(() => vi.advanceTimersByTimeAsync(235));
  expect([...signals.keys()]).toEqual(["", "First"]);
  fireEvent.change(search, { target: { value: "Final" } });
  await act(() => vi.advanceTimersByTimeAsync(251));
  expect([...signals.keys()]).toEqual(["", "First", "Final"]);
  expect(signals.get("First")?.aborted).toBe(true);
  expect(signals.get("Final")?.aborted).toBe(false);
});

it("mounts avatars for 24 results at a time without refetching the directory", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    ...person,
    id: "instructor-" + i,
    display_name: "Fictional instructor " + i,
    rating_average: 0,
    review_count: 0,
  }));
  fixture.rpc.mockImplementation(() => {
    const response = Promise.resolve({ data: rows, error: null });
    return Object.assign(response, { abortSignal: () => response });
  });
  setup().show();
  await screen.findByRole("heading", { name: "Fictional instructor 0" });
  expect(screen.getAllByRole("article")).toHaveLength(24);
  expect(new Set(fixture.avatar.mock.calls.flat())).toHaveLength(24);
  fireEvent.click(screen.getByRole("button", { name: "Show more profiles" }));
  expect(screen.getAllByRole("article")).toHaveLength(48);
  expect(new Set(fixture.avatar.mock.calls.flat())).toHaveLength(48);
  fireEvent.click(screen.getByRole("button", { name: "Show more profiles" }));
  expect(screen.getAllByRole("article")).toHaveLength(50);
  expect(
    screen.queryByRole("button", { name: "Show more profiles" }),
  ).toBeNull();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});

it("uses the active chat contact cache for a verified person", async () => {
  fixture.rpc.mockImplementation(async (name: string) => ({
    data: name === "person_profile" ? person : [],
    error: null,
  }));
  const { client, show } = setup("/people/target");
  client.setQueryData(["chat-contacts", "viewer"], [{ id: "target" }]);
  show();
  expect(
    await screen.findByRole("link", { name: "Send message" }),
  ).toHaveAttribute("href", "/chats?contact=target");
  expect(fixture.rpc.mock.calls.map(([name]) => name)).not.toContain(
    "chat_contacts",
  );

  fixture.rpc.mockImplementation(async (name: string) => ({
    data: name === "person_profile" ? person : null,
    error: name === "chat_contacts" ? new Error("forbidden") : null,
  }));
  await act(() =>
    client.invalidateQueries({ queryKey: ["chat-contacts", "viewer"] }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Send message" }),
    ).not.toBeInTheDocument(),
  );
});

it.each([
  ["/people/viewer", false],
  ["/people/target", true],
] as const)(
  "skips contact discovery for %s when it cannot offer messaging",
  async (path, denied) => {
    fixture.rpc.mockImplementation(async (name: string) => ({
      data: name === "person_profile" ? person : [],
      error:
        name === "person_profile" && denied ? new Error("forbidden") : null,
    }));
    setup(path).show();
    await screen.findByText(
      denied ? "Profile unavailable" : "Fictional profile",
    );
    expect(fixture.rpc.mock.calls.map(([name]) => name)).not.toContain(
      "chat_contacts",
    );
  },
);
