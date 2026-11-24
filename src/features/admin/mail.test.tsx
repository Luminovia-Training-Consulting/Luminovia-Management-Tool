/** Test write-only mail settings and safe connection-result display with fake Auth/RPC boundaries. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { installationBrand } from "../../lib/installation-brand";
import { AcademyBrandContext } from "../branding/academy-branding";
import { AdminMailPage, type MailConfiguration } from "./mail";

const fake = vi.hoisted(() => ({
  configuration: {} as MailConfiguration,
  invoke: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: fake.rpc, functions: { invoke: fake.invoke } }),
}));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-admin" } } }),
}));

let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fake.configuration = {
    version: 0,
    smtp: {
      enabled: false,
      host: "smtp.hostinger.com",
      port: 465,
      security: "implicit_tls",
      sender_email: "",
      sender_name: "Luminovia Portal",
      credentials_configured: false,
      last_test: null,
    },
    imap: {
      enabled: false,
      host: "imap.hostinger.com",
      port: 993,
      security: "implicit_tls",
      credentials_configured: false,
      last_test: null,
    },
  };
  fake.rpc.mockImplementation(
    (
      name: string,
      args?: {
        p_smtp: {
          password: string;
          enabled: boolean;
          sender_email: string;
          sender_name: string;
          host: string;
          port: number;
          security: "implicit_tls" | "starttls";
        };
      },
    ) => {
      if (name === "mail_delivery_failures")
        return { abortSignal: async () => ({ data: [], error: null }) };
      if (name === "get_mail_configuration")
        return { data: structuredClone(fake.configuration), error: null };
      if (name === "save_mail_configuration" && args) {
        expect(args.p_smtp.password).toBeTruthy();
        fake.configuration.version++;
        fake.configuration.smtp = {
          ...fake.configuration.smtp,
          enabled: args.p_smtp.enabled,
          sender_email: args.p_smtp.sender_email,
          sender_name: args.p_smtp.sender_name,
          host: args.p_smtp.host,
          port: args.p_smtp.port,
          security: args.p_smtp.security,
          credentials_configured: true,
        };
        return { data: structuredClone(fake.configuration), error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  );
  fake.invoke.mockImplementation(
    async (
      _name: string,
      args: { method: "GET" } | { body: { protocol: "smtp" | "imap" } },
    ) => {
      if ("method" in args)
        return {
          data: { relay_configured: true, invitations_enabled: false },
          error: null,
        };
      const protocol = args.body.protocol;
      fake.configuration.version++;
      fake.configuration[protocol].last_test = {
        status: "succeeded",
        error_code: null,
        created_at: "2026-11-20T12:00:00Z",
        finished_at: "2026-11-20T12:00:01Z",
      };
      return { data: { status: "succeeded", error_code: null }, error: null };
    },
  );
});

it("keeps credentials write-only and tests the saved SMTP configuration through the relay", async () => {
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage />
    </QueryClientProvider>,
  );
  await screen.findByText("Ausgehender SMTP-Transport");
  const user = userEvent.setup();
  const enabled = screen.getAllByLabelText("Aktiviert")[0]!;
  await user.click(enabled);
  await user.type(
    screen.getByLabelText("Absender-E-Mail"),
    "no-reply@example.invalid",
  );
  const username = document.getElementById(
    "mail-smtp-user",
  ) as HTMLInputElement;
  const password = document.getElementById(
    "mail-smtp-password",
  ) as HTMLInputElement;
  await user.type(username, "no-reply@example.invalid");
  await user.type(password, "fictional-provider-secret");
  await user.click(
    screen.getByRole("button", { name: "SMTP-Verbindung testen" }),
  );

  const result = await screen.findByText(/^Erfolgreich/);
  expect(result.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-11-20T12:00:01Z",
  );
  expect(fake.rpc).toHaveBeenCalledWith(
    "save_mail_configuration",
    expect.objectContaining({
      p_expected_version: 0,
      p_smtp: expect.objectContaining({
        username: "no-reply@example.invalid",
        password: "fictional-provider-secret",
      }),
    }),
  );
  expect(fake.invoke).toHaveBeenCalledWith("mail-admin", {
    body: { protocol: "smtp" },
  });
  await waitFor(() => expect(password).toHaveValue(""));
  expect(document.body.textContent).not.toContain("fictional-provider-secret");
  expect(fake.configuration.smtp).not.toHaveProperty("password");
});

it("does not allow a test before credentials are configured or while SMTP is disabled", async () => {
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage />
    </QueryClientProvider>,
  );
  const smtpTest = await screen.findByRole("button", {
    name: "SMTP-Verbindung testen",
  });
  expect(smtpTest).toBeDisabled();
  expect(
    fake.invoke.mock.calls.every(([, args]) => args.method === "GET"),
  ).toBe(true);
});

it("uses the dedicated sender identity, offers SMTP only and saves before testing a changed configuration", async () => {
  fake.configuration.smtp = {
    ...fake.configuration.smtp,
    host: null,
    sender_name: null,
  };
  render(
    <QueryClientProvider client={client}>
      <AcademyBrandContext
        value={{ ...installationBrand, name: "Fictional Academy" }}
      >
        <AdminMailPage academy="active" />
      </AcademyBrandContext>
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText("Server")).toHaveValue("");
  expect(screen.getByLabelText("Absendername")).toHaveValue(
    "Fictional Academy",
  );
  expect(screen.queryByText("Optionaler IMAP-Eingang")).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Aktiviert"));
  await user.type(screen.getByLabelText("Server"), "smtp.example.com");
  await user.type(
    screen.getByLabelText("Absender-E-Mail"),
    "sender@example.com",
  );
  await user.type(screen.getByLabelText("Benutzername"), "sender@example.com");
  await user.type(screen.getByLabelText("Passwort"), "fictional-only");
  await user.click(
    screen.getByRole("button", { name: "SMTP-Verbindung testen" }),
  );
  expect(await screen.findByText(/^Erfolgreich/)).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "save_mail_configuration",
    expect.objectContaining({
      p_imap: { enabled: false },
      p_smtp: expect.objectContaining({ sender_name: "Fictional Academy" }),
    }),
  );
  expect(fake.invoke.mock.calls.filter(([, args]) => args.body)).toEqual([
    ["mail-admin", { body: { protocol: "smtp" } }],
  ]);
  expect(screen.getByLabelText("Passwort")).toHaveValue("");
});

it.each([
  ["de", "Absendername"],
  ["en", "Sender name"],
])(
  "tracks the academy default without replacing a sender edit in %s",
  async (language, senderLabel) => {
    await i18n.changeLanguage(language);
    fake.configuration.smtp = {
      ...fake.configuration.smtp,
      host: null,
      sender_name: null,
    };
    const view = (name: string) => (
      <QueryClientProvider client={client}>
        <AcademyBrandContext value={{ ...installationBrand, name }}>
          <AdminMailPage academy="active" />
        </AcademyBrandContext>
      </QueryClientProvider>
    );
    const user = userEvent.setup();
    const { rerender } = render(view("Signed Academy"));
    const server = await screen.findByLabelText("Server");
    await user.type(server, "smtp.example.com");
    rerender(view("Published Academy"));
    const sender = screen.getByLabelText(senderLabel);
    expect(server).toHaveValue("smtp.example.com");
    expect(sender).toHaveValue("Published Academy");

    await user.clear(sender);
    await user.type(sender, "Admissions Office");
    rerender(view("Renamed Academy"));
    expect(sender).toHaveValue("Admissions Office");
  },
);

it("keeps existing settings visible and read-only during grace", async () => {
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage academy="grace" />
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText("Server")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "SMTP-Verbindung testen" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Einstellungen speichern" }),
  ).not.toBeInTheDocument();
  expect(
    fake.invoke.mock.calls.every(([, args]) => args.method === "GET"),
  ).toBe(true);
});

it("refuses a direct mail settings URL after current server authority is denied", async () => {
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage academy="active" />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(
      "Für die E-Mail-Verwaltung ist Administration erforderlich.",
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText("Server")).not.toBeInTheDocument();
  expect(
    fake.invoke.mock.calls.every(([, args]) => args.method === "GET"),
  ).toBe(true);
});

it("shows server switches and never rewrites an unchanged transport before testing", async () => {
  fake.configuration.smtp = {
    ...fake.configuration.smtp,
    enabled: true,
    credentials_configured: true,
    sender_email: "sender@example.invalid",
  };
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(/E-Mail-Einladungen sind serverseitig gesperrt/),
  ).toBeVisible();
  await userEvent.click(
    await screen.findByRole("button", { name: "SMTP-Verbindung testen" }),
  );
  expect(await screen.findByText(/^Erfolgreich/)).toBeVisible();
  expect(
    fake.rpc.mock.calls.some(([name]) => name === "save_mail_configuration"),
  ).toBe(false);
});

it("saves the selected SMTP port and matching TLS mode before sending a test to the account", async () => {
  render(
    <QueryClientProvider client={client}>
      <AdminMailPage />
    </QueryClientProvider>,
  );
  await screen.findByText("Ausgehender SMTP-Transport");
  const user = userEvent.setup();
  await user.click(screen.getAllByLabelText("Aktiviert")[0]!);
  await user.click(
    screen.getByRole("button", { name: "Hostinger · STARTTLS (587)" }),
  );
  const port = screen.getAllByLabelText("Port")[0]!;
  await user.clear(port);
  await user.type(port, "2525");
  expect(screen.getAllByLabelText("TLS-Verfahren")[0]).toHaveValue("starttls");
  await user.type(
    screen.getByLabelText("Absender-E-Mail"),
    "sender@example.invalid",
  );
  await user.type(
    document.getElementById("mail-smtp-user")!,
    "sender@example.invalid",
  );
  await user.type(
    document.getElementById("mail-smtp-password")!,
    "fictional-provider-secret",
  );
  await user.click(
    screen.getByRole("button", { name: "Testmail an mich senden" }),
  );
  expect(
    await screen.findByText(/SMTP-Server hat die Testmail angenommen/),
  ).toBeVisible();
  expect(fake.invoke).toHaveBeenCalledWith("mail-admin", {
    body: { protocol: "smtp", send_to_self: true },
  });
  expect(screen.getAllByLabelText("Port")[0]).toHaveValue(2525);
  expect(screen.getAllByLabelText("TLS-Verfahren")[0]).toHaveValue("starttls");
  expect(screen.getByLabelText("Absender-E-Mail")).toHaveValue(
    "sender@example.invalid",
  );
  expect(document.getElementById("mail-smtp-password")).toHaveValue("");
  expect(document.getElementById("mail-smtp-password")).toHaveAttribute(
    "placeholder",
    "Gespeichert",
  );
});
