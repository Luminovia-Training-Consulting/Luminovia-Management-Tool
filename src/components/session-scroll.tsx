import type { ReactNode } from "react";

/** Keep long schedules within the surrounding view and reachable by keyboard. */
export function SessionScroll({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="session-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
