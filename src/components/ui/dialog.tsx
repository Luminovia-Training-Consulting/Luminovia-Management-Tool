/**
 * Controlled Radix dialog shared across features. The caller owns open state and content; Radix
 * manages dialog semantics and focus.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
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
          onCloseAutoFocus={(event) => {
            if (returnFocusTo?.isConnected) {
              event.preventDefault();
              returnFocusTo.focus();
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
