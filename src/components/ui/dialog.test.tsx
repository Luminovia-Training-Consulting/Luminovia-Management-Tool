import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import "../../lib/i18n";
import { Dialog } from "./dialog";

afterEach(cleanup);

it("keeps a pending dialog open for Escape and restores focus after saving", async () => {
  function Example() {
    const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(true);
    return (
      <>
        <button
          onClick={(event) => {
            setTrigger(event.currentTarget);
            setOpen(true);
          }}
        >
          Open
        </button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Edit settings"
          description="Update the selected settings."
          returnFocusTo={trigger}
          closeDisabled={pending}
        >
          <button onClick={() => setPending(false)}>Finish saving</button>
        </Dialog>
      </>
    );
  }

  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Edit settings" });
  expect(dialog).toHaveAccessibleDescription("Update the selected settings.");
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Finish saving" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("returns keyboard focus to the opener when no destination is supplied", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Edit settings"
          description="Update the selected settings."
        >
          <button>First action</button>
        </Dialog>
      </>
    );
  }

  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  await user.tab();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog", { name: "Edit settings" })).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
