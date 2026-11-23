import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AcademyApiExplorer } from "./academy-explorer";
import { ApiExplorer } from "./portal-explorer";
import type { ExplorerRequest } from "./request-boundary";

const fake = vi.hoisted(() => ({
  actor: "academy-user" as string | null,
  language: "en",
  getSession: vi.fn(),
  swagger: vi.fn(),
}));
vi.mock("../../lib/installation-brand", async (load) => {
  const source = await load<typeof import("../../lib/installation-brand")>();
  return {
    ...source,
    installationBrand: {
      ...source.internalInstallationBrand,
      edition: "customer-self-hosted",
      installationId: "b2656a34-5f19-460d-8e8b-d90b33c5dca2",
      name: "Fictional training academy",
    },
  };
});
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: fake.actor && { user: { id: fake.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ auth: { getSession: fake.getSession } }),
}));
vi.mock("./swagger-view", () => ({
  SwaggerView: (props: unknown) => {
    fake.swagger(props);
    return <div aria-label="Swagger" />;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: fake.language } }),
}));

const backend = "https://academy.example.invalid/backend";
const workspace = {
  url: `${backend}/rest/v1/rpc/course_workspace`,
  method: "POST",
};
const session = {
  data: { session: { user: { id: "academy-user" }, access_token: "fixture" } },
};
const latest = () =>
  fake.swagger.mock.lastCall?.[0] as {
    spec: {
      info: { title: string };
      paths: Record<string, unknown>;
      components: Record<string, unknown>;
    };
    supportedSubmitMethods: string[];
    requestInterceptor: (request: ExplorerRequest) => Promise<ExplorerRequest>;
  };

beforeEach(() => {
  fake.actor = "academy-user";
  fake.language = "en";
  fake.swagger.mockClear();
  fake.getSession.mockReset().mockResolvedValue(session);
  vi.stubEnv("VITE_SUPABASE_URL", backend);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "fictional-publishable");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("shows the academy RPCs and full JSON download, with live requests off until approved", async () => {
  const user = userEvent.setup();
  render(<AcademyApiExplorer />);
  expect(latest().spec.info.title).toBe("Fictional training academy API");
  expect(
    Object.keys(latest().spec.paths).every(
      (path) =>
        path.startsWith("/rest/v1/rpc/") ||
        path.startsWith("/functions/v1/portal-api/v1/"),
    ),
  ).toBe(true);
  expect(screen.getByRole("link", { name: "OpenAPI JSON" })).toHaveAttribute(
    "href",
    "/api/openapi.json",
  );
  expect(latest().supportedSubmitMethods).toEqual([]);
  await expect(latest().requestInterceptor(workspace)).rejects.toThrow(
    "api_session_required",
  );
  expect(fake.getSession).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Authorize with my account" }),
  );
  expect(
    screen.getByRole("button", { name: "Disable requests" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(latest().supportedSubmitMethods).toEqual([
    "get",
    "post",
    "put",
    "delete",
  ]);
  for (const operation of [
    "job_discovery",
    "finance_earnings",
    "invoice_payment_ledger",
  ]) {
    const url = `${backend}/rest/v1/rpc/${operation}`;
    expect(latest().spec.paths).not.toHaveProperty(
      new URL(url).pathname.replace("/backend", ""),
    );
    await expect(
      latest().requestInterceptor({ url, method: "POST" }),
    ).rejects.toThrow("api_request_destination_denied");
  }
  expect(fake.getSession).not.toHaveBeenCalled();
  await expect(latest().requestInterceptor(workspace)).resolves.toMatchObject({
    headers: { Authorization: "Bearer fixture" },
  });
});

it("stops a pending authorisation when requests are disabled and clears opt-in on account changes", async () => {
  const user = userEvent.setup();
  const view = render(<AcademyApiExplorer />);
  await user.click(
    screen.getByRole("button", { name: "Authorize with my account" }),
  );
  let resolve: (value: typeof session) => void = () => undefined;
  fake.getSession.mockImplementationOnce(
    () =>
      new Promise((confirmed) => {
        resolve = confirmed;
      }),
  );
  const interceptor = latest().requestInterceptor;
  const rejected = expect(interceptor(workspace)).rejects.toThrow(
    "api_session_required",
  );
  await user.click(screen.getByRole("button", { name: "Disable requests" }));
  await user.click(
    screen.getByRole("button", { name: "Authorize with my account" }),
  );
  resolve(session);
  await rejected;
  fake.actor = "another-academy-user";
  view.rerender(<AcademyApiExplorer />);
  expect(latest().supportedSubmitMethods).toEqual([]);
  fake.actor = "academy-user";
  view.rerender(<AcademyApiExplorer />);
  expect(latest().supportedSubmitMethods).toEqual([]);
});

it("preserves the internal explorer catalogue and interactive methods", async () => {
  const user = userEvent.setup();
  render(<ApiExplorer />);
  expect(latest().spec.info.title).toBe("Luminovia Portal API");
  expect(latest().spec.paths).toHaveProperty("/functions/v1/accounts/v1/me");
  await user.click(
    screen.getByRole("button", { name: "Authorize with my account" }),
  );
  expect(latest().supportedSubmitMethods).toEqual([
    "get",
    "post",
    "patch",
    "put",
    "delete",
  ]);
});

it("filters operations by method and path without changing the downloaded catalogue", async () => {
  const user = userEvent.setup();
  render(<ApiExplorer />);
  const search = screen.getByRole("searchbox", { name: "Search operations" });
  await user.type(search, "GET /functions/v1/accounts/v1/me{Enter}");
  expect(Object.keys(latest().spec.paths)).toEqual([
    "/functions/v1/accounts/v1/me",
  ]);
  expect(
    Object.keys(latest().spec.paths["/functions/v1/accounts/v1/me"] as object),
  ).toEqual(["get"]);
  expect(screen.getByRole("link", { name: "OpenAPI JSON" })).toHaveAttribute(
    "href",
    "/api/openapi.json",
  );
  expect(latest().supportedSubmitMethods).toEqual([]);
});

it.each([
  ["GET", "course_workspace"],
  ["PUT", "save_ui_preferences"],
  ["DELETE", "delete_forum_post"],
] as const)(
  "filters the live catalogue to its %s gateway operation",
  async (method, operation) => {
    const user = userEvent.setup();
    render(<ApiExplorer />);
    const path = "/functions/v1/portal-api/v1/" + operation;
    const search = screen.getByRole("searchbox", { name: "Search operations" });
    await user.type(search, `${method} ${path}{Enter}`);
    const paths = Object.entries(latest().spec.paths);
    expect(latest().spec.paths).toHaveProperty(path);
    for (const [candidate, operations] of paths) {
      expect(candidate.startsWith(path)).toBe(true);
      expect(Object.keys(operations as object)).toEqual([method.toLowerCase()]);
    }
  },
);

it("keeps referenced article schemas when filtering PUT while suppressing credential schemes", async () => {
  const user = userEvent.setup();
  render(<ApiExplorer />);
  const path = "/functions/v1/portal-api/v1/save_wiki_page";
  await user.type(
    screen.getByRole("searchbox", { name: "Search operations" }),
    `PUT ${path}{Enter}`,
  );
  expect(latest().spec.paths[path]).toMatchObject({
    put: {
      requestBody: {
        content: {
          "application/json": {
            schema: {
              allOf: expect.arrayContaining([
                expect.objectContaining({
                  properties: expect.objectContaining({
                    p_content: {
                      $ref: "#/components/schemas/KnowledgeDocument",
                    },
                  }),
                }),
              ]),
            },
          },
        },
      },
    },
  });
  expect(Object.keys(latest().spec.components)).toEqual(["schemas"]);
  expect(latest().spec.components.schemas).toHaveProperty("KnowledgeDocument");
});

it("provides a German empty state and restores the search focus when clearing it", async () => {
  fake.language = "de";
  const user = userEvent.setup();
  render(<AcademyApiExplorer />);
  const search = screen.getByRole("searchbox", {
    name: "Schnittstellen suchen",
  });
  await user.type(search, "no-such-academy-endpoint{Enter}");
  expect(
    screen.getByText("Keine passende Schnittstelle gefunden."),
  ).toBeVisible();
  expect(screen.queryByLabelText("Swagger")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(screen.getByLabelText("Swagger")).toBeVisible();
});
