/** Date-only planning aid for one framework assignment and one receipt at a time. */
import { useId, useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { frameworkPaymentDates } from "./framework-payment-dates";
import "./invoice-settlement-i18n";

export function FrameworkPaymentDatesFields() {
  const { t, i18n } = useTranslation("invoiceSettlement");
  const id = useId();
  const [dates, setDates] = useState({
    firstDelivered: "",
    lastAgreed: "",
    customerReceipt: "",
    correctInvoice: "",
  });
  const result = frameworkPaymentDates(
    dates.firstDelivered,
    dates.lastAgreed,
    dates.customerReceipt,
    dates.correctInvoice,
  );
  const inputs = Object.keys(dates) as (keyof typeof dates)[];
  const outputs = ["final", "interim", "customer", "shortNotice"] as const;
  return (
    <details className="invoice-settlement">
      <summary>{t("paymentDates")}</summary>
      <p>{t("paymentDatesScope")}</p>
      <div className="invoice-settlement-fields">
        {inputs.map((name) => (
          <Field key={name} id={`${id}-${name}`} label={t(name)}>
            <input
              type="date"
              value={dates[name]}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDates((current) => ({ ...current, [name]: value }));
              }}
            />
          </Field>
        ))}
      </div>
      {!result.validOrder && <p role="alert">{t("paymentDatesOrder")}</p>}
      <dl className="invoice-settlement-totals" aria-live="polite">
        {outputs.flatMap((key) => {
          const value = result[key];
          if (!value) return [];
          return [
            <div key={key}>
              <dt>{t(`deadline_${key}`)}</dt>
              <dd>
                <time dateTime={value}>
                  {DateTime.fromISO(value, {
                    zone: "UTC",
                    locale: i18n.language,
                  }).toLocaleString(DateTime.DATE_MED)}
                </time>
              </dd>
            </div>,
          ];
        })}
      </dl>
    </details>
  );
}
