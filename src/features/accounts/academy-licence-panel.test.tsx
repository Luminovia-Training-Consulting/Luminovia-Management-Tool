import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { AcademyLicencePanel } from "./academy-licence-panel";
import type { AcademyLicenceReceipt } from "./academy-licence-schema";

const { read } = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AcademyLicenceReceipt | null>>(),
}));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("./academy-licence-api", () => ({
  academyLicenceQuery: (actor: string) => ({
    queryKey: ["academy-licence-test", actor],
    queryFn: read,
  }),
}));

const receipt: AcademyLicenceReceipt = {
  state: "active",
  issued_at: "2041-01-01T00:00:00Z",
  starts_at: "2041-02-01T00:00:00Z",
  expires_at: "2041-03-01T10:30:00Z",
  grace_until: "2041-03-07T10:30:00Z",
  seats: { limit: 12, occupied: 8, available: 4 },
  storage: { limit_bytes: 1000, used_bytes: 80, available_bytes: 920 },
  api_requests_per_minute: 75,
};

function setup(actor = "academy-admin") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AcademyLicencePanel actor={actor} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, view };
}

beforeEach(async () => {
  read.mockReset();
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("de");
});

it("shows verified dates and current occupied and available quotas to the authorized administrator", async () => {
  read.mockResolvedValue(receipt);
  setup();
  const panel = await screen.findByRole("region", {
    name: "Academy licence and quotas",
  });
  expect(within(panel).getByText("Active", { exact: true })).toBeVisible();
  expect(
    within(panel).getByRole("link", { name: "Mail transport" }),
  ).toHaveAttribute("href", "/administration/mail");
  expect(
    panel.querySelector('time[datetime="2041-03-01T10:30:00Z"]'),
  ).toHaveTextContent("UTC");
  expect(
    within(panel).getByText("Occupied and reserved seats").nextElementSibling,
  ).toHaveTextContent("8");
  expect(
    within(panel).getByText("Available seats").nextElementSibling,
  ).toHaveTextContent("4");
  expect(
    within(panel).getByText("Used and reserved").nextElementSibling,
  ).toHaveTextContent("80 bytes");
  expect(
    within(panel).getByText("Available storage").nextElementSibling,
  ).toHaveTextContent("920 bytes");
  expect(
    within(panel).getByText("Licensed API requests per minute")
      .nextElementSibling,
  ).toHaveTextContent("75");
});

it("replaces active state in grace and discards the displayed receipt when authority is revoked", async () => {
  read.mockResolvedValue(receipt);
  const { client } = setup();
  expect(await screen.findByText("Active", { exact: true })).toBeVisible();
  read.mockResolvedValue({ ...receipt, state: "grace" });
  await act(() =>
    client.invalidateQueries({
      queryKey: ["academy-licence-test", "academy-admin"],
    }),
  );
  expect(
    await screen.findByText("Grace period", { exact: true }),
  ).toBeVisible();
  read.mockResolvedValue(null);
  await act(() =>
    client.invalidateQueries({
      queryKey: ["academy-licence-test", "academy-admin"],
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Academy licence and quotas" }),
    ).not.toBeInTheDocument(),
  );
});

it("shows no quota values for an unauthorized course manager", async () => {
  read.mockResolvedValue(null);
  setup("course-manager");
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(
    screen.queryByText("Academy licence and quotas"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Mail transport" }),
  ).not.toBeInTheDocument();
});
