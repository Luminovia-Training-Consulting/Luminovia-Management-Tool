import { useId, type ComponentProps } from "react";
import { Link } from "react-router-dom";

type CardCopy = { title: string; description: string };

function CardContent({ title, description, id }: CardCopy & { id: string }) {
  return (
    <>
      <strong>{title}</strong>
      <small id={id}>{description}</small>
    </>
  );
}

export function SectionLink({
  title,
  description,
  ...props
}: Omit<ComponentProps<typeof Link>, "children"> & CardCopy) {
  const id = useId();
  return (
    <Link {...props} aria-label={title} aria-describedby={id}>
      <CardContent title={title} description={description} id={id} />
    </Link>
  );
}

export function SectionButton({
  title,
  description,
  ...props
}: Omit<ComponentProps<"button">, "children"> & CardCopy) {
  const id = useId();
  return (
    <button {...props} type="button" aria-label={title} aria-describedby={id}>
      <CardContent title={title} description={description} id={id} />
    </button>
  );
}
