/**
 * Regression tests for permission-filtered, revision-scoped wiki template references. RPC fixtures
 * model only results the current actor is authorized to receive; SQL tests verify that boundary.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { WikiCourseTemplates } from "./wiki-course-templates";
import type { WikiPageRecord } from "./types";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), templates: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
vi.mock("../operations/data", () => ({
  templatesQuery: (actor: string) => ({
    queryKey: ["operations", "templates", actor],
    queryFn: fake.templates,
  }),
}));

const draft = {
  id: "wiki-page",
  version: 2,
  published_version: 1,
  status: "published",
  owner_id: "actor",
} as WikiPageRecord;
const readableTemplate = {
  id: "template-readable",
  title: "Fictional accessible template",
  archived_at: null,
};

function view(page = draft, canEdit = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WikiCourseTemplates actor="actor" page={page} canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("adds and removes one authorized template reference using exact revision identity", async () => {
  await i18n.changeLanguage("de");
  let linked: { template_id: string; title: string; archived: boolean }[] = [];
  fake.templates.mockResolvedValue([
    readableTemplate,
    {
      id: "archived-choice",
      title: "Archived and not addable",
      archived_at: "now",
    },
  ]);
  fake.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "wiki_course_templates")
        return { data: linked, error: null };
      if (name === "manage_wiki_course_template") {
        expect(args).toEqual({
          p_page_id: "wiki-page",
          p_revision: 2,
          p_template_id: "template-readable",
          p_remove: linked.length > 0,
        });
        linked = linked.length
          ? []
          : [
              {
                template_id: "template-readable",
                title: "Fictional accessible template",
                archived: false,
              },
            ];
        return { error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  );
  view();
  const user = userEvent.setup();
  const section = screen.getByRole("region", { name: "Kursvorlagen" });
  const chooser = await within(section).findByLabelText(
    "Lesbare Kursvorlage auswählen",
  );
  expect(within(section).queryByText("Archived and not addable")).toBeNull();
  await user.selectOptions(chooser, "template-readable");
  await user.click(
    within(section).getByRole("button", { name: "Verknüpfung hinzufügen" }),
  );
  const link = await within(section).findByRole("link", {
    name: "Fictional accessible template",
  });
  expect(link).toHaveAttribute("href", "/courses?template=template-readable");
  await user.click(
    within(section).getByRole("button", {
      name: "Verknüpfung zu Fictional accessible template entfernen",
    }),
  );
  expect(
    await within(section).findByText("Keine Kursvorlagen verknüpft."),
  ).toBeVisible();
  expect(
    fake.rpc.mock.calls.filter(
      ([name]) => name === "manage_wiki_course_template",
    ),
  ).toHaveLength(2);
});

it("shows authorized archived references as archived and keeps published revisions read-only", async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockResolvedValue({
    data: [
      {
        template_id: "template-archived",
        title: "Readable archived template",
        archived: true,
      },
    ],
    error: null,
  });
  view({ ...draft, version: 1, published_version: 1 }, false);
  const section = screen.getByRole("region", { name: "Course templates" });
  expect(await within(section).findByText("Archived")).toBeVisible();
  expect(
    within(section).getByRole("link", { name: "Readable archived template" }),
  ).toHaveAttribute("href", "/courses?template=template-archived");
  expect(
    within(section).queryByLabelText("Choose a readable course template"),
  ).toBeNull();
  expect(
    within(section).queryByRole("button", { name: /Remove reference/ }),
  ).toBeNull();
  expect(fake.templates).not.toHaveBeenCalled();
});

it("does not report stale changes as saved and refreshes the actor-visible state", async () => {
  await i18n.changeLanguage("en");
  fake.templates.mockResolvedValue([readableTemplate]);
  fake.rpc.mockImplementation(async (name: string) => {
    if (name === "wiki_course_templates") return { data: [], error: null };
    if (name === "manage_wiki_course_template")
      return { error: { code: "40001", message: "revision changed" } };
    throw new Error(`Unexpected RPC ${name}`);
  });
  view();
  const section = screen.getByRole("region", { name: "Course templates" });
  const user = userEvent.setup();
  await user.selectOptions(
    await within(section).findByLabelText("Choose a readable course template"),
    "template-readable",
  );
  await user.click(
    within(section).getByRole("button", { name: "Add reference" }),
  );
  expect(
    await within(section).findByText(/The article changed in the meantime/),
  ).toBeVisible();
  expect(
    within(section).queryByRole("link", { name: readableTemplate.title }),
  ).toBeNull();
});
