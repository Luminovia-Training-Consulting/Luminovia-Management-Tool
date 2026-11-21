/** Board-specific extension of the real dnd-kit keyboard sensor; publication remains a versioned server request made by OfferBoard only after a completed drop. */
import {
  type Draggable,
  KeyboardSensor,
  type KeyboardSensorOptions,
} from "@dnd-kit/dom";

const columns = ["draft", "published", "archived"] as const;

/** Keep dnd-kit's activation, cancellation and announcements, but navigate
 * actual publication destinations rather than moving ten pixels per key. */
export class OfferBoardKeyboardSensor extends KeyboardSensor {
  protected override handleStart(
    event: KeyboardEvent,
    source: Draggable,
    options: KeyboardSensorOptions | undefined,
  ) {
    super.handleStart(event, source, options);
    if (this.manager.dragOperation.status.idle) return;
    const column = source.element?.closest<HTMLElement>("[data-board-column]");
    const status = column?.dataset.boardColumn;
    if (columns.some((candidate) => candidate === status)) {
      void this.manager.actions.setDropTarget(status);
    }
  }

  /** Select the next valid column directly. Pointer gestures still use spatial collision detection. */
  protected override handleMove(
    direction: "up" | "down" | "left" | "right",
    event: KeyboardEvent,
  ) {
    event.preventDefault();
    const { source, target, status } = this.manager.dragOperation;
    if (!status.dragging || !source || source.disabled) return;
    const current =
      target?.id ??
      source.element
        ?.closest("[data-board-column]")
        ?.getAttribute("data-board-column");
    const index = columns.findIndex((column) => column === current);
    if (index < 0) return;
    const step = direction === "left" || direction === "up" ? -1 : 1;
    const destinations = columns.slice();
    let next = index + step;
    while (next >= 0 && next < destinations.length) {
      const destination = this.manager.registry.droppables.get(
        destinations[next],
      );
      const element = destination?.element;
      if (
        destination &&
        !destination.disabled &&
        destination.accepts(source) &&
        element
      ) {
        // A column may extend over many viewports. Its heading remains a stable,
        // visible destination on wide, two-column and vertically stacked boards.
        const heading = element.querySelector("h3") ?? element;
        heading.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        // Keyboard selection must remain stable when a tall column scrolls its
        // original handle off-screen. The completed-drop handler verifies and
        // publishes the selected target through the normal server path.
        void this.manager.actions.setDropTarget(destination.id);
        return;
      }
      next += step;
    }
  }

  /** After cancellation, return the visible viewport to the original handle. */
  protected override handleEnd(event: Event, canceled: boolean) {
    const handle = event.target;
    super.handleEnd(event, canceled);
    if (canceled && handle instanceof HTMLElement) {
      void this.manager.renderer.rendering.then(() => {
        if (handle.isConnected && handle.ownerDocument.activeElement === handle)
          handle.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
      });
    }
  }
}
