import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { MailDeliveryRecovery } from "./mail-delivery-recovery";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), accountRequest: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
vi.mock("../accounts/api", () => ({ accountRequest: fake.accountRequest }));

const invitation = "4937a7f2-9257-4dd6-89f7-103644f557a9";
const course = "0eceb58d-368e-4efc-8b40-f4e4fd62dcc9";
const ambiguous = "f7f4d068-43de-44d7-a5ff-abf6ac525a9a";
const ended = "2026-11-20T09:00:00Z";
const row = {
  failed_at: ended,
  created_at: ended,
  error_code: null,
  status: "failed",
  retry_allowed: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(readOnly = false, academy = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MailDeliveryRecovery
        actor="fixture-admin"
        readOnly={readOnly}
        academy={academy}
      />
    </QueryClientProvider>,
  );
}

function prepare() {
  fake.rpc.mockImplementation((name: string) =>
    name === "mail_delivery_failures"
      ? {
          abortSignal: vi.fn().mockResolvedValue({
            data: [
              {
                ...row,
                id: invitation,
                kind: "invitation",
                recipient: "mistyped@example.invalid",
              },
              {
                ...row,
                id: course,
                kind: "course",
                recipient: "verified@example.invalid",
              },
              {
                ...row,
                id: ambiguous,
                kind: "invitation",
                status: "uncertain",
                recipient: "unknown@example.invalid",
              },
            ],
            error: null,
          }),
        }
      : Promise.resolve({ data: course, error: null }),
  );
  fake.accountRequest.mockResolvedValue({ status: "sent" });
}

it("edits only invitation addresses, queues a course retry and locks uncertainty even if a positive flag arrived", async () => {
  await i18n.changeLanguage("de");
  prepare();
  mount();
  const user = userEvent.setup();
  const wrong = await screen.findByDisplayValue("mistyped@example.invalid");
  await user.clear(wrong);
  await user.type(wrong, "corrected@example.invalid");
  const buttons = screen.getAllByRole("button", {
    name: "Zustellung erneut anstoßen",
  });
  expect(buttons).toHaveLength(2);
  await user.click(buttons[0]);
  expect(
    await screen.findByText("Der Einladungsdienst hat den Versand bestätigt."),
  ).toBeVisible();
  expect(fake.accountRequest).toHaveBeenCalledWith(
    `invitations/${invitation}/retry`,
    "POST",
    {
      email: "corrected@example.invalid",
      idempotency_key: expect.any(String),
    },
  );
  await user.click(buttons[1]);
  expect(
    await screen.findByText(
      "Die Kursmail wurde erneut in die Warteschlange gestellt.",
    ),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("retry_course_mail_delivery", {
    p_delivery_id: course,
    p_failed_at: ended,
    p_request_id: expect.any(String),
  });
});

it("reads recovery status with English copy during an Academy grace period", async () => {
  await i18n.changeLanguage("en");
  prepare();
  mount(true, true);
  const region = screen.getByRole("region", { name: "Failed deliveries" });
  expect(
    await within(region).findByText(/Mail server acceptance is uncertain/),
  ).toBeVisible();
  expect(
    within(region).queryByRole("button", { name: "Retry delivery" }),
  ).toBeNull();
});
