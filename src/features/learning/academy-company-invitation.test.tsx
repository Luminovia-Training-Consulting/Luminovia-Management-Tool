import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import "./i18n";
import { AcademyCompanyInvitation } from "./academy-company-invitation";

const send = vi.hoisted(() => vi.fn());
vi.mock("../accounts/academy-api", () => ({ inviteAcademyLearner: send }));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));

it("sends only course-scoped fields, keeps the request ID across retries and acknowledges the German result", async () => {
  await i18n.changeLanguage("de");
  const course = "6b0b7d6b-47c6-4f36-9bb4-39a03aedb3d7";
  send
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "requested" });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AcademyCompanyInvitation courseId={course} />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("Anzeigename"), "Fictional Learner");
  await user.type(
    screen.getByLabelText("E-Mail-Adresse"),
    "STUDENT@example.invalid",
  );
  const button = screen.getByRole("button", { name: "Teilnehmende einladen" });
  await user.click(button);
  expect(
    await screen.findByText(/Einladung konnte nicht angefordert/),
  ).toBeVisible();
  expect(send.mock.calls[0]?.[0]).toEqual({
    course_id: course,
    display_name: "Fictional Learner",
    email: "student@example.invalid",
    idempotency_key: expect.any(String),
  });
  await user.click(button);
  expect(
    await screen.findByText(/Kurseinschreibung erfolgt separat/),
  ).toBeVisible();
  expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
  expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("");
});
