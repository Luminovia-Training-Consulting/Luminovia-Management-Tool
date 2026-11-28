/** A late write response belongs to one course visit even when the author returns to the same course. */
import { useContext } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  CourseDraftContext,
  type LocalCourseDraft,
} from "./course-draft-context";
import { CourseDraftSession } from "./course-draft-session";

const draft: LocalCourseDraft = {
  content: { modules: [] },
  base: { modules: [] },
  published_version: 0,
  draft_version: 0,
};

function EditorProbe({
  onPending,
}: {
  onPending: (settle: () => void) => void;
}) {
  const [current, update] = useContext(CourseDraftContext)!;
  return (
    <>
      <p>{current ? "Unsaved draft" : "No local draft"}</p>
      <button onClick={() => update(draft)}>Edit</button>
      <button onClick={() => onPending(() => update(null))}>Start save</button>
    </>
  );
}

afterEach(cleanup);

it("ignores a response from an earlier visit without remounting the Academy gate", () => {
  let finishPreviousSave!: () => void;
  const route = (scope: string) => (
    <CourseDraftSession scope={scope}>
      <EditorProbe onPending={(settle) => (finishPreviousSave = settle)} />
    </CourseDraftSession>
  );

  const app = render(route("teacher:course-a"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Start save" }));
  app.rerender(route("teacher:course-b"));
  expect(screen.getByText("No local draft")).toBeVisible();
  app.rerender(route("teacher:course-a"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  act(() => finishPreviousSave());
  expect(screen.getByText("Unsaved draft")).toBeVisible();
});
