import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { CompanyIntegrations } from "../operations/company-integrations";
import { CompanyWebhooks } from "../operations/company-webhooks";

export function AcademyWebhookPanel({
  actor,
  organisations,
}: {
  actor: string;
  organisations: { id: string; name: string; time_zone: string }[];
}) {
  const { i18n } = useTranslation();
  const german = i18n.language.startsWith("de");
  const [organisation, setOrganisation] = useState("");
  const selected = organisations.find((item) => item.id === organisation);
  return (
    <section className="panel" aria-labelledby="academy-webhook-heading">
      <h2 id="academy-webhook-heading">
        {german ? "Kursintegrationen" : "Course integrations"}
      </h2>
      <Field
        id="academy-webhook-organisation"
        label={german ? "Unternehmen für Webhooks" : "Webhook organisation"}
      >
        <select
          value={selected?.id ?? ""}
          onChange={(event) => setOrganisation(event.target.value)}
        >
          <option value="">{german ? "Auswählen" : "Select"}</option>
          {organisations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      {selected && (
        <div key={selected.id}>
          <CompanyIntegrations
            actor={actor}
            organisation={selected.id}
            zone={selected.time_zone}
            archived={false}
            showWebhooks={false}
          />
          <CompanyWebhooks
            key={selected.id}
            actor={actor}
            organisation={selected.id}
            zone={selected.time_zone}
            archived={false}
            academy
          />
        </div>
      )}
    </section>
  );
}
