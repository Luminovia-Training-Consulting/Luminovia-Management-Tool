/** Auth-free presentational navigation links shared by the protected shell and fictional demo. */
import type { FocusEvent, MouseEvent } from "react";
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export type PortalNavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

/** Render only the caller-supplied entries; authorization and fixture scoping stay with the caller. */
export function PortalNavigation({
  items,
  ariaLabel,
  ariaDescribedBy,
  className,
  id,
  collapsed = false,
  onItemFocus,
  onItemMouseLeave,
  onItemBlur,
  onItemClick,
  renderLabel = (label: string) => label,
}: {
  items: PortalNavigationItem[];
  ariaLabel: string;
  ariaDescribedBy?: string;
  className?: string;
  id?: string;
  collapsed?: boolean;
  onItemFocus?: (label: string, element: HTMLAnchorElement) => void;
  onItemMouseLeave?: (
    event: MouseEvent<HTMLAnchorElement>,
    label: string,
  ) => void;
  onItemBlur?: (event: FocusEvent<HTMLAnchorElement>, label: string) => void;
  onItemClick?: () => void;
  renderLabel?: (label: string) => string;
}) {
  return (
    <nav
      id={id}
      className={className}
      aria-label={ariaLabel}
      aria-describedby={collapsed ? ariaDescribedBy : undefined}
    >
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? to === "/"}
          aria-label={collapsed ? renderLabel(label) : undefined}
          aria-describedby={collapsed ? ariaDescribedBy : undefined}
          onMouseEnter={(event) => onItemFocus?.(label, event.currentTarget)}
          onMouseLeave={(event) => onItemMouseLeave?.(event, label)}
          onFocus={(event) => onItemFocus?.(label, event.currentTarget)}
          onBlur={(event) => onItemBlur?.(event, label)}
          onClick={onItemClick}
        >
          <Icon size={20} aria-hidden="true" />
          <span className="sidebar-link-label">{renderLabel(label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
