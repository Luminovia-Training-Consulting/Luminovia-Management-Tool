/**
 * Zentrale Schaltfläche mit Brand-Varianten und optionaler Radix-Slot-Komposition. Native Button-Attribute bleiben beim tatsächlichen interaktiven Element, auch wenn ein Link als Kind verwendet wird.
 */
// shadcn/ui Button pattern (Radix Slot + class-variance-authority), brand adapted.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
/** Zentrale Klassenzuordnung für Varianten und Größen; Fachseiten müssen keine eigene Buttonfarblogik duplizieren. */
const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
/** Wählt die gemeinsame Variante und reicht Attribute an den nativen Button beziehungsweise das Slot-Kind weiter. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
