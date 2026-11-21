import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import {CourseWorkspacePage} from "./learning";
import type {CourseWorkspace} from "./api";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
    rpc: vi.fn(),
    upload: vi.fn(),
    workspace: {} as CourseWorkspace,
    error: null as unknown,
    pending: undefined as Promise<unknown> | undefined,
}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "learner-a"}}}),
}));
vi.mock("../../lib/supabase", () => ({db: () => fake}));
vi.mock("../files/api", () => ({acceptedFiles: ".pdf", uploadDocument: fake.upload}));
vi.mock("./destinations", () => ({CourseDestinations: () => null}));
const clients: QueryClient[] = [];

function fixture(): CourseWorkspace {
    return {
        id: "course-a",
        title: "Fictional course",
        description: "Shared safe description",
        syllabus: "Linux practice",
        time_zone: "Europe/Berlin",
        venue: "https://example.invalid/class",
        delivery_type: "online",
        ended: true,
        lms_enabled: true,
        access: {
            manager: false,
            teacher: true,
            learner: false,
            client: false,
            staff: true,
            lms_enabled: true,
        },
        settings_version: 0,
        contact: null,
        contact_options: [],
        sessions: [],
        preparation: [],
        resources: [],
        share_options: [],
        questions: [],
        notebook: {body: "My private draft", version: 2},
        feedback: null,
        feedback_summary: null,
        quiz: null,
        completion: null,
        roster: [],
        attendance_history: [],
        repeat_request: null,
        exams: {required: false, version: null, can_edit: false, documents: []},
    };
}

beforeEach(async () => {
    await i18n.changeLanguage("de");
    fake.workspace = fixture();
    fake.error = null;
    fake.pending = undefined;
    fake.rpc.mockReset().mockImplementation((name: string) => {
        const request = {
            abortSignal: () => request,
            then: (resolve: (v: unknown) => unknown) =>
                name === "course_welcome_content"
                    ? Promise.resolve({data: {
                        version: 0, description: "", objectives: "",
                        joining_instructions: "", published_at: null,
                    }, error: null}).then(resolve)
                    :
                name === "course_workspace"
                    ? Promise.resolve({data: fake.workspace, error: fake.error}).then(
                        resolve,
                    )
                    : name === "course_chat_rooms"
                        ? Promise.resolve({data: [], error: null}).then(resolve)
                    : Promise.resolve(fake.pending ?? {id: null, saved: true}).then(
                        (data) => resolve({data, error: fake.error}),
                    ),
        };
        return request;
    });
    fake.upload.mockReset();
});
afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
});

function setup() {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}},
    });
    clients.push(client);
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/courses/course-a/workspace"]}>
                <Routes>
                    <Route path="/learning" element={<p>Course list</p>}/>
                    <Route
                        path="/courses/:id/workspace"
                        element={<CourseWorkspacePage/>}
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

describe("connected course workspace", () => {
    it("connects learner quiz, feedback and completion without staff controls", async () => {
        fake.workspace.access = {
            manager: false, learner: true, teacher: false, client: false,
            staff: false, lms_enabled: true,
        };
        fake.workspace.quiz = {
            version: 4, published: true, attempts: 0, max_attempts: 2,
            pass_percent: 75, questions: [{prompt: "Fictional quiz?", options: ["Yes", "No"]}],
            last_score: null, passed: false,
        };
        const user = userEvent.setup();
        setup();
        expect(await screen.findByRole("heading", {name: "Mini-Quiz"})).toBeVisible();
        expect(screen.getByRole("link", {name: "Alle Kurse"})).toHaveAttribute("href", "/learning");
        expect(screen.queryByRole("link", {name: "Kurs verwalten"})).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Neue Quizfassung speichern"})).not.toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Kursfeedback speichern"})).toBeVisible();
        expect(screen.getByRole("heading", {name: "Mein Abschlussdokument"})).toBeVisible();
        await user.click(screen.getByRole("radio", {name: "Yes"}));
        await user.click(screen.getByRole("button", {name: "Antworten verbindlich abgeben"}));
        await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith(
            "course_workspace_action", expect.objectContaining({
                p_action: "quiz_attempt", p_expected_version: 4,
                p_payload: expect.objectContaining({answers: [0]}),
            }),
        ));
    });

    it("shows operational course details without retired learner and delivery workflows", async () => {
        setup();
        expect(
            await screen.findByRole("heading", {name: "Kursübersicht & Termine"}),
        ).toBeVisible();
        expect(
            screen.getByRole("link", {name: "Kurs verwalten"}),
        ).toHaveAttribute("href", "/courses?run=course-a");
        expect(
            screen.getByRole("link", {name: "Kursbereitschaft"}),
        ).toHaveAttribute("href", "/readiness/course-a");
        expect(
            screen.queryByLabelText("Persönliche Kursnotizen"),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", {name: "Kursteilnahme stornieren"}),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", {name: "Anwesenheit bestätigen"}),
        ).not.toBeInTheDocument();
    });

    it("shares an authorized file version with operational audiences only", async () => {
        fake.workspace.access.manager = true;
        fake.workspace.share_options = [
            {id: "clean-version", name: "Course notes", version: 2},
        ];
        const user = userEvent.setup();
        setup();
        const versions = await screen.findByRole("combobox", {
            name: "Geprüfte Dateifassung",
        });
        await user.selectOptions(versions, "clean-version");
        const audience = document.getElementById("resource-audience") as HTMLSelectElement;
        expect(audience.querySelector('option[value="participants"]')).not.toBeNull();
        await user.selectOptions(audience, "staff");
        await user.click(screen.getByRole("button", {name: "Fassung freigeben"}));
        await waitFor(() =>
            expect(fake.rpc).toHaveBeenCalledWith(
                "course_workspace_action",
                expect.objectContaining({
                    p_action: "resource_share",
                    p_payload: expect.objectContaining({
                        version_id: "clean-version",
                        audience: "staff",
                    }),
                }),
            ),
        );
    });
    it("uploads a clean lecturer file and shares exactly its returned version", async () => {
        fake.upload.mockResolvedValue({current_version_id: "new-clean-version"});
        const user = userEvent.setup();
        setup();
        await user.upload(await screen.findByLabelText("Datei auswählen"),
            new File(["fictional PDF bytes"], "Fictional-course.pdf", {type: "application/pdf"}));
        expect((screen.getByLabelText("Datei auswählen") as HTMLInputElement).files).toHaveLength(1);
        expect(screen.getByRole("button", {name: "Datei prüfen und freigeben"})).toBeEnabled();
        await user.selectOptions(document.getElementById("upload-resource-audience") as HTMLSelectElement, "participants");
        fireEvent.submit((screen.getByLabelText("Datei auswählen") as HTMLInputElement).form!);
        await waitFor(() => expect(fake.upload).toHaveBeenCalledWith(
            expect.objectContaining({name: "Fictional-course.pdf"}),
            {scope: "personal", kind: "material"}, expect.any(Function),
        ));
        await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith("course_workspace_action", expect.objectContaining({
            p_action: "resource_share",
            p_payload: {version_id: "new-clean-version", audience: "participants", category: "material"},
        })));
    });
    it("does not offer removal of a company-owned course file to a lecturer", async () => {
        fake.workspace.resources = [{id: "company-file", name: "Fictional company handout", version_id: "clean-version", version: 1,
            sha256: "a".repeat(64), category: "material", audience: "all", acknowledged: false,
            ownership_kind: "company", can_remove: false}];
        setup();
        expect(await screen.findByText("Fictional company handout")).toBeVisible();
        expect(screen.queryByRole("button", {name: "Freigabe zurücknehmen"})).not.toBeInTheDocument();
    });
    it("does not create a course share when the scanner rejects an upload", async () => {
        fake.upload.mockRejectedValue(new Error("scan_rejected"));
        const user = userEvent.setup();
        setup();
        await user.upload(await screen.findByLabelText("Datei auswählen"),
            new File(["fictional contents"], "Rejected.pdf", {type: "application/pdf"}));
        fireEvent.submit((screen.getByLabelText("Datei auswählen") as HTMLInputElement).form!);
        expect(await screen.findByText(/Upload oder Freigabe wurde nicht bestätigt/)).toBeVisible();
        expect(fake.rpc.mock.calls.some(([name, args]) => name === "course_workspace_action" && args.p_action === "resource_share")).toBe(false);
    });
    it("renders no course workspace content when the Premium projection is OFF", async () => {
        fake.workspace.lms_enabled = false;
        fake.workspace.access.lms_enabled = false;
        fake.workspace.resources = [
            {
                id: "retained-resource",
                name: "Fictional retained resource",
                version_id: "retained-version",
                version: 1,
                sha256: "a".repeat(64),
                category: "material",
                audience: "all",
                acknowledged: false,
            },
        ] as CourseWorkspace["resources"];
        fake.workspace.preparation = [
            {
                id: "retained-preparation",
                label: "Fictional retained checklist",
                done: false,
                client_visible: false,
                version: 1,
            },
        ] as CourseWorkspace["preparation"];
        fake.workspace.roster = [
            {user_id: "fictional-participant", name: "Fictional participant", status: "enrolled", completion_id: null, sessions: []},
        ];
        setup();
        expect(
            await screen.findByText(/Lernmodul dieses Unternehmens ist derzeit deaktiviert/),
        ).toBeVisible();
        expect(screen.queryByText("Fictional course")).not.toBeInTheDocument();
        expect(screen.queryByText("Shared safe description")).not.toBeInTheDocument();
        expect(screen.queryByText("Linux practice")).not.toBeInTheDocument();
        expect(screen.queryByText("Fictional retained resource")).not.toBeInTheDocument();
        expect(screen.queryByText("Fictional retained checklist")).not.toBeInTheDocument();
        expect(screen.queryByText("Fictional participant")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Fassung freigeben"})).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Antwort speichern"})).not.toBeInTheDocument();
    });
    it("copies only the authorized validated teaching link after clipboard confirmation, and explains failure", async () => {
        const user = userEvent.setup();
        const writeText = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("denied"));
        vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
        setup();
        await user.click(
            await screen.findByRole("button", {name: "Unterrichtslink kopieren"}),
        );
        expect(writeText).toHaveBeenCalledWith("https://example.invalid/class");
        expect(await screen.findByRole("status")).toHaveTextContent(
            "Unterrichtslink kopiert.",
        );
        await user.click(
            screen.getByRole("button", {name: "Unterrichtslink kopieren"}),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent("manuell");
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    it("offers English copy controls only for valid HTTPS online courses", async () => {
        await i18n.changeLanguage("en");
        const user = userEvent.setup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
        setup();
        await user.click(
            await screen.findByRole("button", {name: "Copy teaching link"}),
        );
        expect(await screen.findByRole("status")).toHaveTextContent(
            "Teaching link copied.",
        );
        expect(writeText).toHaveBeenCalledWith("https://example.invalid/class");
    });
    it("does not offer copying for an unsafe teaching URL", async () => {
        fake.workspace.venue = "javascript:alert(1)";
        setup();
        expect(await screen.findByText("Shared safe description")).toBeVisible();
        expect(
            screen.queryByRole("button", {name: "Unterrichtslink kopieren"}),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", {name: "Unterrichtslink öffnen"}),
        ).not.toBeInTheDocument();
    });
    it("does not offer a copy action for a physical course", async () => {
        fake.workspace.delivery_type = "onsite";
        setup();
        expect(await screen.findByText("Shared safe description")).toBeVisible();
        expect(
            screen.queryByRole("button", {name: "Unterrichtslink kopieren"}),
        ).not.toBeInTheDocument();
    });
    it("does not expose a copy control when the server denies workspace access", async () => {
        fake.error = {code: "42501"};
        setup();
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(
            screen.queryByRole("button", {name: "Unterrichtslink kopieren"}),
        ).not.toBeInTheDocument();
    });
    it("waits for committed shared preparation state and exposes read-only progress to a client", async () => {
        fake.workspace.access = {
            manager: false,
            teacher: true,
            learner: false,
            client: false,
            staff: true,
            lms_enabled: true,
        };
        fake.workspace.preparation = [
            {
                id: "task-a",
                label: "Lab accounts ready",
                done: false,
                client_visible: true,
                version: 1,
            },
        ];
        const user = userEvent.setup();
        setup();
        const checkbox = await screen.findByRole("checkbox", {
            name: "Lab accounts ready",
        });
        let resolve!: (value: unknown) => void;
        fake.pending = new Promise((r) => (resolve = r));
        await user.click(checkbox);
        expect(checkbox).not.toBeChecked();
        expect(checkbox).toBeDisabled();
        fake.workspace = {
            ...fake.workspace,
            preparation: [
                {...fake.workspace.preparation[0], done: true, version: 2},
            ],
        };
        await act(async () => resolve({saved: true}));
        await waitFor(() => expect(checkbox).toBeChecked());
    });
    it("never renders retained private workspace data after a revoked read", async () => {
        const client = setup();
        expect(await screen.findByText("Shared safe description")).toBeVisible();
        fake.error = {code: "42501"};
        await act(async () => {
            await client.invalidateQueries({queryKey: ["course-workspace"]});
        });
        await waitFor(() =>
            expect(
                screen.queryByLabelText("Persönliche Kursnotizen"),
            ).not.toBeInTheDocument(),
        );
        expect(
            screen.queryByText("Shared safe description"),
        ).not.toBeInTheDocument();
    });
});

it("hides the loaded Premium workspace offline and rechecks it on reconnect", async () => {
    const connectivity = vi.spyOn(window.navigator, "onLine", "get");
    connectivity.mockReturnValue(true);
    try {
        setup();
        expect(await screen.findByText("Shared safe description")).toBeVisible();
        connectivity.mockReturnValue(false);
        act(() => window.dispatchEvent(new Event("offline")));
        expect(screen.queryByText("Shared safe description")).not.toBeInTheDocument();
        fake.error = new Error("company_premium_lms_off");
        connectivity.mockReturnValue(true);
        act(() => window.dispatchEvent(new Event("online")));
        expect(await screen.findByRole("heading", {name: "Lernarbeitsbereich deaktiviert"})).toBeVisible();
        expect(screen.queryByText("Shared safe description")).not.toBeInTheDocument();
    } finally {
        connectivity.mockRestore();
    }
});
