import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {AccountSettings} from "./account-settings";

const updateUser = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({db: () => ({auth: {updateUser}})}));
vi.mock("react-i18next", () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));
beforeEach(() => {
    updateUser.mockReset();
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: true,
    });
});
afterEach(cleanup);

it("reports a requested email as pending rather than changed", async () => {
    updateUser.mockResolvedValue({
        data: {user: {email: "old@example.invalid"}},
        error: null,
    });
    render(
        <MemoryRouter>
            <AccountSettings email="old@example.invalid"/>
        </MemoryRouter>,
    );
    await userEvent.type(
        screen.getByLabelText("newEmail"),
        "new@example.invalid",
    );
    await userEvent.click(screen.getByRole("button", {name: "changeEmail"}));
    expect(updateUser).toHaveBeenCalledWith({email: "new@example.invalid"});
    expect(await screen.findByRole("status")).toHaveTextContent(
        "emailChangePending",
    );
    expect(screen.getByText(/old@example.invalid/)).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "setPassword"})).toHaveAttribute(
        "href",
        "/auth/password",
    );
});

it("rejects invalid or unchanged addresses and exposes an Auth failure", async () => {
    updateUser.mockResolvedValue({
        data: {user: null},
        error: new Error("rejected"),
    });
    render(
        <MemoryRouter>
            <AccountSettings email="old@example.invalid"/>
        </MemoryRouter>,
    );
    const input = screen.getByLabelText("newEmail");
    await userEvent.type(input, "old@example.invalid");
    await userEvent.click(screen.getByRole("button", {name: "changeEmail"}));
    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByText("emailChangeInvalid")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "new@example.invalid");
    await userEvent.click(screen.getByRole("button", {name: "changeEmail"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("error");
});