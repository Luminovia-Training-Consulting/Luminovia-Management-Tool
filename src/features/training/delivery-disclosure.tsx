/** Defer online-only venue and delivery queries until the workspace panel opens. */
import { lazy, Suspense, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Loading } from "../../components/common";
import "./delivery-i18n";

const Delivery = lazy(() => import("./structured-delivery"));

export default function TrainingDeliveryDisclosure(
  props: ComponentProps<typeof Delivery>,
) {
  const { t } = useTranslation("trainingDelivery");
  const [open, setOpen] = useState(false);
  return (
    <details
      className="training-delivery-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("delivery")}</summary>
      {open && (
        <Suspense fallback={<Loading />}>
          <Delivery {...props} />
        </Suspense>
      )}
    </details>
  );
}
