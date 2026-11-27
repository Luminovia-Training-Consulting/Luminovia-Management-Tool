/** Show the offer's effective travel requirements without loading restricted meeting data. */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { offerDelivery } from "./delivery-schema";
import "./delivery-i18n";

export default function OfferDeliverySummary({
  actor,
  id,
  fallback,
}: {
  actor: string;
  id: string;
  fallback: ReactNode;
}) {
  const { t } = useTranslation("trainingDelivery");
  const details = useQuery({
    queryKey: ["training-offer-delivery", actor, id],
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("training_offer_delivery", { p_job_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return offerDelivery.nullable().parse(data);
    },
  });
  if (!details.data) return fallback;
  return (
    <>
      <span>{t(details.data.mode)}</span>
      {details.data.locations.map(({ city, country }) => (
        <span key={`${city}:${country}`}>
          <MapPin size={17} aria-hidden="true" />
          {[city, country].filter(Boolean).join(", ")}
        </span>
      ))}
    </>
  );
}
