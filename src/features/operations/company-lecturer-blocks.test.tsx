import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CompanyLecturerBlocks } from "./company-lecturer-blocks";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => fake.online,
  requireOnline: () => {
    if (!fake.online) throw new Error("offline");
  },
}));
const organisations = [
  { id: "4c78c43d-b19f-4826-9c25-bfed59e2db6a", name: "Practice Company" },
  {
    id: "9bb31000-28f1-4b9e-a23b-d699138beb6e",
    name: "Second Practice Company",
  },
];
const entry = {
  lecturer_id: "2f309a93-c7a2-4cc5-bd20-f8c8dfe02476",
  display_name: "Alex Example",
  blocked: false,
  version: 0,
};
let client: QueryClient;
let current: typeof entry;
let canWrite: boolean;

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  current = { ...entry };
  canWrite = true;
  fake.online = true;
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "company_lecturer_blocks")
      return {
        abortSignal: async () => ({
          data: {
            organisation_id: args.p_organisation_id,
            can_write: canWrite,
            rows: [current],
            more: false,
          },
          error: null,
        }),
      };
    if (name === "set_company_lecturer_block") {
      if (args.p_expected_version !== current.version)
        return Promise.resolve({ data: null, error: { code: "PT409" } });
      current = {
        ...entry,
        blocked: args.p_blocked === true,
        version: current.version + 1,
      };
      return Promise.resolve({ data: current, error: null });
    }
    throw new Error("Unexpected RPC");
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

function open() {
  render(
    <QueryClientProvider client={client}>
      <CompanyLecturerBlocks
        actor="fictional-manager"
        organisations={organisations}
      />
    </QueryClientProvider>,
  );
}

it("selects the exact company and confirms block and unblock with the latest revision", async () => {
  open();
  expect(fake.rpc).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByText("Dozentensperren"));
  await user.selectOptions(
    await screen.findByLabelText("Unternehmen"),
    organisations[1].id,
  );
  await user.click(
    await screen.findByRole("button", { name: "Sperren Alex Example" }),
  );
  expect(
    fake.rpc.mock.calls.filter(
      ([name]) => name === "set_company_lecturer_block",
    ),
  ).toHaveLength(0);
  const block = screen.getByRole("dialog", { name: "Sperren Alex Example" });
  await user.click(within(block).getByRole("button", { name: "Sperren" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Der Status wurde gespeichert.",
  );
  expect(fake.rpc).toHaveBeenCalledWith("set_company_lecturer_block", {
    p_organisation_id: organisations[1].id,
    p_lecturer_id: entry.lecturer_id,
    p_blocked: true,
    p_expected_version: 0,
  });
  await user.click(
    await screen.findByRole("button", { name: "Freigeben Alex Example" }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Freigeben Alex Example" }),
    ).getByRole("button", { name: "Freigeben" }),
  );
  await screen.findByRole("button", { name: "Sperren Alex Example" });
  expect(fake.rpc).toHaveBeenCalledWith("set_company_lecturer_block", {
    p_organisation_id: organisations[1].id,
    p_lecturer_id: entry.lecturer_id,
    p_blocked: false,
    p_expected_version: 1,
  });
});

it("refreshes after a rejected stale write and also supports a read-only licence", async () => {
  await i18n.changeLanguage("en");
  open();
  const user = userEvent.setup();
  await user.click(screen.getByText("Lecturer restrictions"));
  await user.click(
    await screen.findByRole("button", { name: "Block Alex Example" }),
  );
  current = { ...entry, blocked: true, version: 2 };
  canWrite = false;
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Block Alex Example" }),
    ).getByRole("button", { name: "Block" }),
  );
  expect(
    await screen.findByText(
      "The status has changed. Review the current state.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("Restrictions are currently read-only."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Unblock Alex Example" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Alex Example · Blocked")).toBeVisible();
});
