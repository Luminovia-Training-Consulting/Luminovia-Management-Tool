/** Consolidated workspaces retain their current section while feature URL state changes. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter, useSearchParams} from "react-router-dom";
import {SectionHub} from "./section-hubs";
import "../lib/i18n";

vi.mock("../features/auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "company"}}}),
}));
vi.mock("@tanstack/react-query", async (original) => ({
    ...(await original<typeof import("@tanstack/react-query")>()),
    useQuery: () => ({data: ["client"]}),
}));
vi.mock("../features/operations/courses", () => ({
    CoursesPage: () => <p>Course catalogue</p>,
}));
vi.mock("../features/replacements/replacements", () => ({
    ReplacementMarketplacePage: () => <p>Available replacements</p>,
}));
vi.mock("../features/knowledge/wiki", () => ({
    WikiPage: () => <p>Wiki articles</p>,
}));
vi.mock("../features/help/help", () => ({
    HelpCenter: ({embedded}: { embedded?: boolean }) => {
        const [params, setParams] = useSearchParams();
        return (
            <button
                onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("topic", "files");
                    setParams(next);
                }}
            >
                {embedded ? "Embedded help" : "Public help"}
            </button>
        );
    },
}));
afterEach(cleanup);
it("keeps replacement discovery within the course catalogue", async () => {
    render(
        <MemoryRouter>
            <SectionHub kind="courses"/>
        </MemoryRouter>,
    );
    expect(await screen.findByText("Course catalogue")).toBeVisible();
    expect(
        screen.queryByRole("button", {name: /Vertretungen|Replacements/}),
    ).not.toBeInTheDocument();
    await userEvent.click(
        screen.getByText(/Vertretung für einen Kurs|Find or claim a course/),
    );
    expect(await screen.findByText("Available replacements")).toBeVisible();
});
it("embeds help without losing the active knowledge section on topic navigation", async () => {
    render(
        <MemoryRouter initialEntries={["/wiki?section=help"]}>
            <SectionHub kind="knowledge"/>
        </MemoryRouter>,
    );
    const help = await screen.findByRole("button", {name: "Embedded help"});
    await userEvent.click(help);
    expect(
        screen.getByRole("button", {name: "Embedded help"}),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wiki articles")).not.toBeInTheDocument();
});