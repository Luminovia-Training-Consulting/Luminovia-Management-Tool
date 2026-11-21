/**
 * Regressions for failed sign-in, recovery and password changes. Controlled SDK responses test
 * error/retry presentation, not real Auth delivery.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {Login} from "./login";
import {Password} from "./password";
import {AuthCallback} from "./callback";

const fake = vi.hoisted(() => ({
    invoke: vi.fn(),
    setSession: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    verifyOtp: vi.fn(),
}));
const language = vi.hoisted(() => ({prefix: ""}));
vi.mock("./auth-context", () => ({
    useAuth: () => ({session: null, loading: false, error: null}),
}));
vi.mock("../../lib/supabase", () => ({
    isConfigured: true,
    db: () => ({auth: fake, functions: {invoke: fake.invoke}}),
}));
vi.mock("react-i18next", () => ({
    useTranslation: () => ({t: (key: string) => `${language.prefix}${key}`}),
}));

beforeEach(() => {
    language.prefix = "";
    Object.values(fake).forEach((method) => method.mockReset());
    Object.values(fake).forEach((method) =>
        method.mockResolvedValue({data: {}, error: null}),
    );
    fake.invoke.mockResolvedValue({
        data: {access_token: "access", refresh_token: "refresh"},
        error: null,
    });
    fake.setSession.mockResolvedValue({
        data: {session: {access_token: "access"}},
        error: null,
    });
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: true,
    });
    window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

/** Render the subject with the local providers required by this test. */
function view(element: React.ReactNode) {
    return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("recoverable Auth request failures", () => {
    it("translates an existing recovery notice after language switching without resending", async () => {
        const page = view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "person@example.invalid",
        );
        await userEvent.click(screen.getByRole("button", {name: "forgot"}));
        await userEvent.click(screen.getByRole("button", {name: "recover"}));
        expect(await screen.findByRole("status")).toHaveTextContent(
            "recoverSent",
        );
        language.prefix = "en:";
        page.rerender(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        );
        expect(screen.getByRole("status")).toHaveTextContent("en:recoverSent");
        expect(screen.getByLabelText("en:email")).toHaveValue(
            "person@example.invalid",
        );
        expect(fake.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    });
    it("translates the saved-password notice after language switching without repeating the mutation", async () => {
        const page = view(<Password />);
        await userEvent.type(
            screen.getByLabelText("newPassword"),
            "ExamplePassword42!",
        );
        await userEvent.click(
            screen.getByRole("button", {name: "setPassword"}),
        );
        expect(await screen.findByRole("status")).toHaveTextContent(
            "passwordSaved",
        );
        language.prefix = "en:";
        page.rerender(
            <MemoryRouter>
                <Password />
            </MemoryRouter>,
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "en:passwordSaved",
        );
        expect(fake.updateUser).toHaveBeenCalledTimes(1);
    });
    it("rejects a seven-character password without calling Auth", async () => {
        view(<Password />);
        await userEvent.type(screen.getByLabelText("newPassword"), "Aa1!aaa");
        await userEvent.click(
            screen.getByRole("button", {name: "setPassword"}),
        );
        expect(fake.updateUser).not.toHaveBeenCalled();
    });
    it("accepts an eight-character password through the password setup form", async () => {
        view(<Password />);
        await userEvent.type(screen.getByLabelText("newPassword"), "Aa1!aaaa");
        await userEvent.click(
            screen.getByRole("button", {name: "setPassword"}),
        );
        expect(await screen.findByRole("status")).toHaveTextContent(
            "passwordSaved",
        );
        expect(fake.updateUser).toHaveBeenCalledWith({password: "Aa1!aaaa"});
    });
    it("does not impose the new-password minimum on existing-account sign-in", async () => {
        view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "legacy@example.invalid",
        );
        await userEvent.type(screen.getByLabelText("password"), "Old7!Aa");
        await userEvent.click(screen.getByRole("button", {name: "login"}));
        expect(fake.invoke).toHaveBeenCalledWith("human-login", {
            body: {
                identifier: "legacy@example.invalid",
                password: "Old7!Aa",
            },
        });
        expect(fake.setSession).toHaveBeenCalledWith({
            access_token: "access",
            refresh_token: "refresh",
        });
    });
    it("signs in by username through the same session exchange", async () => {
        view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "course.lead",
        );
        await userEvent.type(
            screen.getByLabelText("password"),
            "ExamplePassword42!",
        );
        await userEvent.click(screen.getByRole("button", {name: "login"}));
        expect(fake.invoke).toHaveBeenCalledWith("human-login", {
            body: {
                identifier: "course.lead",
                password: "ExamplePassword42!",
            },
        });
        expect(fake.setSession).toHaveBeenCalledTimes(1);
    });
    it("submits recovery with Enter instead of trying password sign-in", async () => {
        view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "person@example.invalid",
        );
        await userEvent.click(screen.getByRole("button", {name: "forgot"}));
        await userEvent.type(screen.getByLabelText("email"), "{Enter}");
        await waitFor(() =>
            expect(fake.resetPasswordForEmail).toHaveBeenCalledWith(
                "person@example.invalid",
                expect.objectContaining({
                    redirectTo: expect.stringContaining("/auth/callback"),
                }),
            ),
        );
        expect(fake.invoke).not.toHaveBeenCalled();
        expect(await screen.findByRole("status")).toHaveTextContent(
            "recoverSent",
        );
    });

    it("keeps one recovery request in flight and permits a retry after transport rejection", async () => {
        let reject!: (reason: Error) => void;
        fake.resetPasswordForEmail.mockReturnValueOnce(
            new Promise((_resolve, fail) => {
                reject = fail;
            }),
        );
        view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "person@example.invalid",
        );
        await userEvent.click(screen.getByRole("button", {name: "forgot"}));
        const send = screen.getByRole("button", {name: "recover"});
        await userEvent.click(send);
        expect(send).toBeDisabled();
        await userEvent.click(send);
        expect(fake.resetPasswordForEmail).toHaveBeenCalledTimes(1);
        reject(new Error("Transport unavailable"));
        expect(await screen.findByRole("alert")).toHaveTextContent("error");
        expect(send).toBeEnabled();
        await userEvent.click(send);
        expect(await screen.findByRole("status")).toHaveTextContent(
            "recoverSent",
        );
    });

    it("turns a rejected sign-in promise into a visible retryable failure", async () => {
        fake.invoke.mockRejectedValueOnce(new Error("Transport unavailable"));
        view(<Login />);
        await userEvent.type(
            screen.getByLabelText("usernameOrEmail"),
            "person@example.invalid",
        );
        await userEvent.type(
            screen.getByLabelText("password"),
            "ExamplePassword42!",
        );
        await userEvent.click(screen.getByRole("button", {name: "login"}));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "loginFailed",
        );
        expect(screen.getByRole("button", {name: "login"})).toBeEnabled();
    });

    it("clears an old password success before a rejected subsequent request", async () => {
        view(<Password />);
        await userEvent.type(
            screen.getByLabelText("newPassword"),
            "ExamplePassword42!",
        );
        await userEvent.click(
            screen.getByRole("button", {name: "setPassword"}),
        );
        expect(await screen.findByRole("status")).toHaveTextContent(
            "passwordSaved",
        );
        fake.updateUser.mockRejectedValueOnce(
            new Error("Transport unavailable"),
        );
        await userEvent.click(
            screen.getByRole("button", {name: "setPassword"}),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent("error");
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.getByRole("button", {name: "setPassword"})).toBeEnabled();
    });

    it("releases the invitation button after rejected verification without restoring the token URL", async () => {
        const token = "A".repeat(32);
        window.history.replaceState(
            null,
            "",
            `/auth/callback?type=invite&token_hash=${token}`,
        );
        fake.verifyOtp.mockRejectedValueOnce(
            new Error("Transport unavailable"),
        );
        view(<AuthCallback />);
        expect(window.location.search).toBe("");
        await userEvent.click(
            screen.getByRole("button", {name: "acceptInvite"}),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "inviteInvalid",
        );
        expect(
            screen.getByRole("button", {name: "acceptInvite"}),
        ).toBeEnabled();
        expect(window.location.search).toBe("");
        expect(fake.verifyOtp).toHaveBeenCalledWith({
            token_hash: token,
            type: "invite",
        });
    });
});

describe("local preview username", () => {
    it("translates the alias only for the exact loopback preview and backend", async () => {
        const {previewLoginEmail} = await import("./preview-login");
        expect(
            previewLoginEmail(
                "admin",
                "http://127.0.0.1:5373",
                "http://127.0.0.1:56321",
            ),
        ).toBe("local-preview-admin@example.invalid");
        expect(
            previewLoginEmail(
                "admin",
                "https://cms.luminovia.org",
                "https://cms.luminovia.org/backend",
            ),
        ).toBe("admin");
        expect(
            previewLoginEmail(
                "admin",
                "http://127.0.0.1:5373",
                "https://cms.luminovia.org/backend",
            ),
        ).toBe("admin");
        expect(
            previewLoginEmail(
                "other@example.invalid",
                "http://127.0.0.1:5373",
                "http://127.0.0.1:56321",
            ),
        ).toBe("other@example.invalid");
    });
});
