import type { ComponentProps } from "react";
import { Link } from "react-router-dom";

type CardCopy = { title: string; description: string };

function CardContent({ title, description }: CardCopy) {
  return (
    <>
      <strong>{title}</strong> <small>{description}</small>
    </>
  );
}

export function SectionLink({
  title,
  description,
  ...props
}: Omit<ComponentProps<typeof Link>, "children"> & CardCopy) {
  return (
    <Link {...props}>
      <CardContent title={title} description={description} />
    </Link>
  );
}

export function SectionButton({
  title,
  description,
  ...props
}: Omit<ComponentProps<"button">, "children"> & CardCopy) {
  return (
    <button {...props} type="button">
      <CardContent title={title} description={description} />
    </button>
  );
}
