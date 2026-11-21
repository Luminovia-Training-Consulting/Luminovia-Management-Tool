/** Test write-only mail settings and safe connection-result display with fake Auth/RPC boundaries. */
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {AdminMailPage, type MailConfiguration} from "./mail";

const fake = vi.hoisted(() => ({
    configuration: {} as MailConfiguration,
    invoke: vi.fn(),
    rpc: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
    db: () => ({rpc: fake.rpc, functions: {invoke: fake.invoke}}),
}));
vi.mock("../../lib/online", () => ({
    requireOnline: () => undefined,
    useOnline: () => true,
}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "fictional-admin"}}}),
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
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
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
        async (name: string, args?: {p_smtp: {password: string; enabled: boolean; sender_email: string; sender_name: string}}) => {
            if (name === "get_mail_configuration")
                return {data: structuredClone(fake.configuration), error: null};
            if (name === "save_mail_configuration" && args) {
                expect(args.p_smtp.password).toBeTruthy();
                fake.configuration.version++;
                fake.configuration.smtp = {
                    ...fake.configuration.smtp,
                    enabled: args.p_smtp.enabled,
                    sender_email: args.p_smtp.sender_email,
                    sender_name: args.p_smtp.sender_name,
                    credentials_configured: true,
                };
                return {data: structuredClone(fake.configuration), error: null};
            }
            return {data: null, error: {code: "unexpected_rpc"}};
        },
    );
    fake.invoke.mockImplementation(
        async (_name: string, args: { body: { protocol: "smtp" | "imap" } }) => {
            const protocol = args.body.protocol;
            fake.configuration.version++;
            fake.configuration[protocol].last_test = {
                status: "succeeded",
                error_code: null,
                created_at: "2026-11-20T12:00:00Z",
                finished_at: "2026-11-20T12:00:01Z",
            };
            return {data: {status: "succeeded", error_code: null}, error: null};
        },
    );
});

it("keeps credentials write-only and tests the saved SMTP configuration through the relay", async () => {
    render(
        <QueryClientProvider client={client}>
            <AdminMailPage/>
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
        screen.getByRole("button", {name: "SMTP-Verbindung testen"}),
    );

    await screen.findByText("Erfolgreich");
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
        body: {protocol: "smtp"},
    });
    await waitFor(() => expect(password).toHaveValue(""));
    expect(document.body.textContent).not.toContain("fictional-provider-secret");
    expect(fake.configuration.smtp).not.toHaveProperty("password");
});

it("does not allow a test before credentials are configured or while SMTP is disabled", async () => {
    render(
        <QueryClientProvider client={client}>
            <AdminMailPage/>
        </QueryClientProvider>,
    );
    const smtpTest = await screen.findByRole("button", {
        name: "SMTP-Verbindung testen",
    });
    expect(smtpTest).toBeDisabled();
    expect(fake.invoke).not.toHaveBeenCalled();
});