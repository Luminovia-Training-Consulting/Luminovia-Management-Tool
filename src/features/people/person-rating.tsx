import { lazy, Suspense, useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { portalInternalEdition } from "../../lib/installation-brand";
import { Button } from "../../components/ui/button";
import i18n from "../../lib/i18n";

i18n.addResourceBundle("de", "personRating", {
  rate: "Person bewerten",
  rateShort: "Bewerten",
  rateName: "{{name}} bewerten",
  receivedTitle: "Erhaltene Bewertungen",
});
i18n.addResourceBundle("en", "personRating", {
  rate: "Rate person",
  rateShort: "Rate",
  rateName: "Rate {{name}}",
  receivedTitle: "Ratings received",
});

const PersonRatingDialog = lazy(async () => {
  const { PersonRatingDialog } = await import("./person-rating-dialog");
  return { default: PersonRatingDialog };
});

export function PersonRatingButton({
  actor,
  person,
  name,
  compact,
}: {
  actor: string;
  person: string;
  name?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation("personRating");
  const [open, setOpen] = useState(false);
  const own = actor === person;
  if (!portalInternalEdition) return null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={own ? undefined : t("rateName", { name })}
      >
        <Star size={16} aria-hidden="true" />
        {t(own ? "receivedTitle" : compact ? "rateShort" : "rate")}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <PersonRatingDialog
            actor={actor}
            person={person}
            name={name}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
