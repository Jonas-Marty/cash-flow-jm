import type * as React from "react";

/** Arrow keys, Enter/Tab to pick, Escape to close: the same in every field. */
export function listKeyHandler({
  open,
  count,
  setActive,
  pickActive,
  close,
  openList,
  tab = "pick-and-move",
}: {
  open: boolean;
  count: number;
  setActive: React.Dispatch<React.SetStateAction<number>>;
  pickActive: () => void;
  close: () => void;
  openList?: () => void;
  /**
   * What Tab does while the list is open. A description is one value, so Tab
   * takes the highlight and moves on as usual; a tag field holds several, so
   * Tab takes the tag and stays for the next one.
   */
  tab?: "pick-and-move" | "pick-and-stay";
}) {
  return (e: React.KeyboardEvent) => {
    if (!open || count === 0) {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && openList) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickActive();
    } else if (e.key === "Tab") {
      if (tab === "pick-and-stay") e.preventDefault();
      pickActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
}
