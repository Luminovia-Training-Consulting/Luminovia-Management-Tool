import { KeyboardSensor } from "@dnd-kit/dom";

const columns = ["draft", "published", "archived"] as const;

/** Keep dnd-kit's activation, cancellation and announcements, but navigate
 * actual publication destinations rather than moving ten pixels per key. */
export class OfferBoardKeyboardSensor extends KeyboardSensor {
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
        // Scrolling changes every registered viewport rectangle. Refresh before
        // dnd-kit's normal collision detection selects the real destination.
        for (const column of this.manager.registry.droppables)
          column.refreshShape();
        const rect = heading.getBoundingClientRect();
        this.manager.actions.move({
          event,
          to: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        });
        return;
      }
      next += step;
    }
  }
}
