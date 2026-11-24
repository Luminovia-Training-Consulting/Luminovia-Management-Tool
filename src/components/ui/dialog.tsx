/**
 * Controlled Radix dialog shared across features. The caller owns open state and content; Radix
 * manages dialog semantics and focus.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Connect controlled opening, accessible title and content to the modal focus boundary. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  returnFocusTo,
  closeDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  returnFocusTo?: HTMLElement | null;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !closeDisabled) onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          onOpenAutoFocus={() => {
            const focused = document.activeElement;
            opener.current = focused instanceof HTMLElement ? focused : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusTo?.isConnected
              ? returnFocusTo
              : opener.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <header className="dialog-header">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="dialog-close"
              aria-label={t("close")}
              disabled={closeDisabled}
            >
              <X size={20} aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className="dialog-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
