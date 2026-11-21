/** Finance decision support. Private input stays in memory; only lecturer totals may be shared. */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { money } from "../../lib/dates";
import { FrameworkPaymentDatesFields } from "./framework-payment-dates-fields";
import {
  calculateInvoiceSettlement,
  maximumSettlementUnits,
  settlementReasons,
  type SettlementUnit,
} from "./invoice-settlement";
import "./invoice-settlement-i18n";
import "./invoice-settlement.css";

type WorksheetUnit = SettlementUnit & { id: number };

/** Create a blank item without assuming a contracted rate or an exception reason. */
function blankUnit(id: number): WorksheetUnit {
  return {
    id,
    kind: "teaching",
    day: "",
    assessmentReference: "",
    reason: "",
    agreedFee: "",
    credited: "0",
    scheduled: "",
    receivedNotice: "",
    originalCustomerFee: "",
    receivedCustomerCompensation: "",
  };
}

type InputName = Exclude<keyof SettlementUnit, "kind" | "reason">;

/** Render and validate one item in the worksheet. Changes invalidate previous consent. */
function UnitFields({
  unit,
  position,
  currency,
  canRemove,
  onEdit,
  onRemove,
}: {
  unit: WorksheetUnit;
  position: number;
  currency: string;
  canRemove: boolean;
  onEdit: (patch: Partial<SettlementUnit>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("invoiceSettlement");
  const id = useId();
  const notice = unit.reason === "timely" || unit.reason === "shortNotice";
  const input = (
    name: InputName,
    options?: { hint?: string; monetary?: "lecturer" | "customer" },
  ) => (
    <Field
      key={name}
      id={`${id}-${name}`}
      label={
        options?.monetary === "lecturer" ? `${t(name)} (${currency})` : t(name)
      }
      hint={options?.hint}
    >
      <input
        type={name === "day" ? "date" : "text"}
        inputMode={options?.monetary ? "decimal" : undefined}
        maxLength={options?.monetary ? 12 : 120}
        value={unit[name]}
        onChange={(event) => onEdit({ [name]: event.currentTarget.value })}
      />
    </Field>
  );
  return (
    <fieldset className="invoice-settlement-unit">
      <legend>{t("unit", { count: position })}</legend>
      <div className="invoice-settlement-fields">
        <Field id={`${id}-kind`} label={t("kind")}>
          <select
            value={unit.kind}
            onChange={(event) =>
              onEdit({
                kind: event.currentTarget.value as SettlementUnit["kind"],
              })
            }
          >
            <option value="teaching">{t("teaching")}</option>
            <option value="assessment">{t("assessment")}</option>
          </select>
        </Field>
        {input("day")}
        {unit.kind === "assessment" && input("assessmentReference")}
        <Field id={`${id}-reason`} label={t("reason")}>
          <select
            value={unit.reason}
            onChange={(event) =>
              onEdit({
                reason: event.currentTarget.value as SettlementUnit["reason"],
              })
            }
          >
            <option value="">{t("choose")}</option>
            {settlementReasons.map((reason) => (
              <option value={reason} key={reason}>
                {t(reason)}
              </option>
            ))}
          </select>
        </Field>
        {unit.reason && unit.reason !== "manual" && (
          <>
            {input("agreedFee", { monetary: "lecturer" })}
            {input("credited", { monetary: "lecturer", hint: t("creditHint") })}
          </>
        )}
        {notice && (
          <>
            {input("scheduled", { hint: t("offsetHint") })}
            {input("receivedNotice", { hint: t("offsetHint") })}
          </>
        )}
        {unit.reason === "customer" && (
          <>
            {input("originalCustomerFee", { monetary: "customer" })}
            {input("receivedCustomerCompensation", {
              monetary: "customer",
              hint: t("customerHint"),
            })}
          </>
        )}
      </div>
      {canRemove && (
        <Button type="button" variant="ghost" onClick={onRemove}>
          {t("remove", { count: position })}
        </Button>
      )}
    </fieldset>
  );
}

/** Evaluate explicitly reviewed amounts without sending revenue inputs to the server. */
export function InvoiceSettlementWorksheet({
  currency,
  attached,
  onSummary,
}: {
  currency: "AUD" | "EUR";
  attached: boolean;
  onSummary: (text: string) => void;
}) {
  const { t, i18n } = useTranslation("invoiceSettlement");
  const id = useId();
  const [zone, setZone] = useState("");
  const [units, setUnits] = useState<WorksheetUnit[]>([blankUnit(1)]);
  const [lastId, setLastId] = useState(1);
  const [result, setResult] =
    useState<ReturnType<typeof calculateInvoiceSettlement>>();
  const [verified, setVerified] = useState(false);

  function clearReview() {
    setResult(undefined);
    setVerified(false);
    onSummary("");
  }

  const totals = result?.ok
    ? [
        [t("deliveredTotal"), result.deliveredCents],
        [t("cancellationTotal"), result.cancellationCents],
        [t("creditTotal"), result.creditedCents],
        [t("openTotal"), result.openCents],
      ].map(([label, amount]) => [
        String(label),
        money(Number(amount) / 100, currency, i18n.language),
      ])
    : [];

  return (
    <details className="invoice-settlement">
      <summary>{t("title")}</summary>
      <p>{t("scope")}</p>
      <FrameworkPaymentDatesFields />
      <Field id={`${id}-zone`} label={t("zone")}>
        <input
          value={zone}
          placeholder="Europe/Berlin"
          maxLength={100}
          onChange={(event) => {
            setZone(event.currentTarget.value);
            clearReview();
          }}
        />
      </Field>
      {units.map((unit, index) => (
        <UnitFields
          key={unit.id}
          unit={unit}
          position={index + 1}
          currency={currency}
          canRemove={units.length > 1}
          onEdit={(patch) => {
            setUnits((current) =>
              current.map((item) =>
                item.id === unit.id ? { ...item, ...patch } : item,
              ),
            );
            clearReview();
          }}
          onRemove={() => {
            setUnits((current) =>
              current.filter((item) => item.id !== unit.id),
            );
            clearReview();
          }}
        />
      ))}
      <div className="invoice-settlement-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={units.length >= maximumSettlementUnits}
          onClick={() => {
            setUnits((current) => [...current, blankUnit(lastId + 1)]);
            setLastId(lastId + 1);
            clearReview();
          }}
        >
          {t("add")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setResult(calculateInvoiceSettlement(units, zone.trim()))
          }
        >
          {t("check")}
        </Button>
      </div>
      {result && !result.ok && (
        <Notice kind="error">
          {result.row
            ? t("rowIssue", { count: result.row, issue: t(result.error) })
            : t(result.error)}
        </Notice>
      )}
      {result?.ok && (
        <>
          <dl className="invoice-settlement-totals" aria-live="polite">
            {totals.map(([label, shown]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{shown}</dd>
              </div>
            ))}
          </dl>
          <label className="invoice-settlement-confirm">
            <input
              type="checkbox"
              checked={verified}
              onChange={(event) => {
                setVerified(event.currentTarget.checked);
                if (!event.currentTarget.checked) onSummary("");
              }}
            />
            {t("confirm")}
          </label>
          {attached ? (
            <>
              <p role="status">{t("attached")}</p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onSummary("")}
              >
                {t("detach")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={!verified}
              onClick={() =>
                onSummary(
                  totals
                    .map(([label, amount]) => `${label}: ${amount}`)
                    .join("\n"),
                )
              }
            >
              {t("attach")}
            </Button>
          )}
        </>
      )}
    </details>
  );
}
