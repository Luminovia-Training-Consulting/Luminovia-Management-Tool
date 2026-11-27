/** Finance-only commercial editor and a separate self-service accepted projection. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dateTime, money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  changeTrainingCommercialPreset,
  commissionTreatments,
  componentBases,
  componentKinds,
  trainingAssignmentCompensation,
  trainingCommercialPresets,
  trainingCommercialPresetsKey,
  trainingOfferCompensation,
  trainingOfferCompensationKey,
  type CommercialPreset,
  type CompensationProjection,
  type TrainingComponent,
  type TrainingPlan,
} from "./training-commercial-api";
import "./training-commercial-i18n";
import "./training-commercial.css";

const newComponent: TrainingComponent = {
  kind: "on_site",
  label: "",
  basis: "physical_day",
  treatment: "pass_through",
  customer_rate: "",
  reason: "",
};
const physicalBases = [
  "physical_day",
  "physical_session",
  "assignment",
  "fixed_total",
] as const;
const usesManualQuantity = (basis: TrainingComponent["basis"]) =>
  basis === "kilometre" || basis === "night" || basis === "agreed_quantity";
const usesAgreedRate = (treatment: TrainingComponent["treatment"]) =>
  treatment === "custom" || treatment === "fixed_platform";
const allowsSessionRates = ({ kind, basis, treatment }: TrainingComponent) =>
  kind === "on_site" &&
  basis === "physical_session" &&
  !usesAgreedRate(treatment);

type OfferCompensation = NonNullable<
  Awaited<ReturnType<typeof trainingOfferCompensation>>
>;
type EditableComponent = { key: string; value: TrainingComponent };

function toFormRows(rows: TrainingComponent[]): EditableComponent[] {
  return rows.map((value) => ({ key: crypto.randomUUID(), value }));
}

function Breakdown({
  projection,
  accepted,
}: {
  projection: CompensationProjection;
  accepted?: boolean;
}) {
  const { t, i18n } = useTranslation("trainingCommercial");
  const formattedMoney = (value: number) =>
    money(value, projection.currency, i18n.language);
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 4,
  });
  return (
    <section className="training-amounts">
      <h4>{t(accepted ? "accepted" : "preview")}</h4>
      {!accepted && <p className="muted">{t("previewDefault")}</p>}
      <dl className="training-summary">
        <div>
          <dt>{t("teachingDays")}</dt>
          <dd>{projection.teaching_days}</dd>
        </div>
        <div>
          <dt>{t("physicalDays")}</dt>
          <dd>{projection.physical_days}</dd>
        </div>
        <div>
          <dt>{t("teachingMinutes")}</dt>
          <dd>{number.format(projection.paid_teaching_minutes)}</dd>
        </div>
      </dl>
      <div
        className="training-amount-table"
        tabIndex={0}
        role="region"
        aria-label={t("components")}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{t("line")}</th>
              <th scope="col">{t("units")}</th>
              <th scope="col">{t("customer")}</th>
              <th scope="col">{t("lecturer")}</th>
              <th scope="col">{t("platform")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("base")}</th>
              <td>—</td>
              <td>{formattedMoney(projection.base_customer)}</td>
              <td>{formattedMoney(projection.base_lecturer)}</td>
              <td>
                {formattedMoney(
                  projection.base_customer - projection.base_lecturer,
                )}
              </td>
            </tr>
            {projection.components.map((line, index) => (
              <tr key={index}>
                <th scope="row">{line.label || t(`kind.${line.kind}`)}</th>
                <td>
                  {number.format(line.units)}{" "}
                  <small>{t(`basis.${line.basis}`)}</small>
                </td>
                <td>{formattedMoney(line.customer_amount)}</td>
                <td>{formattedMoney(line.lecturer_amount)}</td>
                <td>{formattedMoney(line.platform_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("total")}</th>
              <td></td>
              <td>{formattedMoney(projection.customer_total)}</td>
              <td>{formattedMoney(projection.lecturer_total)}</td>
              <td>{formattedMoney(projection.platform_total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function ComponentFields({
  value,
  number,
  disabled,
  onChange,
  onRemove,
  physicalSessions,
  zone,
}: {
  value: TrainingComponent;
  number: number;
  disabled: boolean;
  onChange: (value: TrainingComponent) => void;
  onRemove: () => void;
  physicalSessions: OfferCompensation["sessions"];
  zone: string;
}) {
  const { t, i18n } = useTranslation("trainingCommercial");
  const id = useId();
  const availableBases =
    value.kind === "on_site" ? physicalBases : componentBases;
  return (
    <fieldset className="training-component" disabled={disabled}>
      <legend>{t("component", { number })}</legend>
      <div className="form-row">
        <Field id={`${id}-type`} label={t("type")}>
          <select
            id={`${id}-type`}
            value={value.kind}
            onChange={(event) => {
              const kind = event.target.value as TrainingComponent["kind"];
              onChange({
                ...value,
                kind,
                basis:
                  kind === "on_site" &&
                  !physicalBases.some((basis) => basis === value.basis)
                    ? "physical_day"
                    : value.basis,
              });
            }}
          >
            {componentKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-label`} label={t("label")}>
          <input
            id={`${id}-label`}
            maxLength={160}
            required={value.kind === "other"}
            value={value.label}
            onChange={(event) =>
              onChange({ ...value, label: event.target.value })
            }
          />
        </Field>
        <Field id={`${id}-basis`} label={t("basis")}>
          <select
            id={`${id}-basis`}
            value={value.basis}
            onChange={(event) =>
              onChange({
                ...value,
                basis: event.target.value as TrainingComponent["basis"],
              })
            }
          >
            {availableBases.map((basis) => (
              <option key={basis} value={basis}>
                {t(`basis.${basis}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field id={`${id}-rate`} label={t("customerRate")}>
          <input
            id={`${id}-rate`}
            type="number"
            required
            min="0"
            max="9999999999.99"
            step="0.01"
            value={value.customer_rate}
            onChange={(event) =>
              onChange({ ...value, customer_rate: event.target.value })
            }
          />
        </Field>
        <Field id={`${id}-treatment`} label={t("treatment")}>
          <select
            id={`${id}-treatment`}
            value={value.treatment}
            onChange={(event) =>
              onChange({
                ...value,
                treatment: event.target.value as TrainingComponent["treatment"],
              })
            }
          >
            {commissionTreatments.map((treatment) => (
              <option key={treatment} value={treatment}>
                {t(`treatment.${treatment}`)}
              </option>
            ))}
          </select>
        </Field>
        {usesAgreedRate(value.treatment) && (
          <Field
            id={`${id}-agreed`}
            label={t(
              value.treatment === "custom" ? "agreedRate" : "platformRate",
            )}
          >
            <input
              id={`${id}-agreed`}
              type="number"
              required
              min="0"
              max="9999999999.99"
              step="0.01"
              value={value.agreed_rate ?? ""}
              onChange={(event) =>
                onChange({ ...value, agreed_rate: event.target.value })
              }
            />
          </Field>
        )}
        {usesManualQuantity(value.basis) && (
          <Field id={`${id}-quantity`} label={t("quantity")}>
            <input
              id={`${id}-quantity`}
              type="number"
              required
              min={value.basis === "night" ? "1" : "0.001"}
              max="100000"
              step={value.basis === "night" ? "1" : "0.001"}
              value={value.quantity ?? ""}
              onChange={(event) =>
                onChange({ ...value, quantity: event.target.value })
              }
            />
          </Field>
        )}
      </div>
      {allowsSessionRates(value) && physicalSessions.length > 0 && (
        <details className="training-commercial-group">
          <summary>{t("overrideRates")}</summary>
          <p className="muted">{t("overrideHint")}</p>
          <div className="form-row">
            {physicalSessions.map((slot) => (
              <Field
                key={slot.id}
                id={`${id}-rate-${slot.id}`}
                label={t("overrideRate", {
                  time: dateTime(slot.starts_at, i18n.language, zone),
                })}
              >
                <input
                  id={`${id}-rate-${slot.id}`}
                  type="number"
                  min="0"
                  max="9999999999.99"
                  step="0.01"
                  value={value.session_rates?.[slot.id] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      session_rates: {
                        ...value.session_rates,
                        [slot.id]: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </details>
      )}
      {(usesAgreedRate(value.treatment) ||
        usesManualQuantity(value.basis) ||
        (allowsSessionRates(value) &&
          Object.values(value.session_rates ?? {}).some(Boolean))) && (
        <Field id={`${id}-reason`} label={t("reason")}>
          <textarea
            id={`${id}-reason`}
            maxLength={500}
            required
            rows={2}
            value={value.reason}
            onChange={(event) =>
              onChange({ ...value, reason: event.target.value })
            }
          />
        </Field>
      )}
      <Button type="button" variant="ghost" onClick={onRemove}>
        {t("remove")}
      </Button>
    </fieldset>
  );
}

function CompensationForm({
  actor,
  offer,
  zone,
  onDone,
}: {
  actor: string;
  offer: OfferCompensation;
  zone: string;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation("trainingCommercial");
  const client = useQueryClient();
  const id = useId();
  const online = useOnline();
  const [unitMinutes, setUnitMinutes] = useState(
    String(offer.plan?.configuration.unit_minutes ?? 45),
  );
  const [components, setComponents] = useState(() =>
    toFormRows(offer.plan?.configuration.components ?? []),
  );
  const [breaks, setBreaks] = useState(() =>
    Object.fromEntries(
      offer.sessions.map(({ id }) => [id, offer.plan?.unpaid_breaks[id] ?? 0]),
    ),
  );
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [copiedPreset, setCopiedPreset] = useState("");
  const physicalSessions = offer.sessions.filter((slot) => slot.physical);
  const configured = {
    unit_minutes: Number(unitMinutes),
    components: components.map(({ value }): TrainingComponent => {
      const roomRates = Object.fromEntries(
        physicalSessions.flatMap(({ id }) => {
          const rate = value.session_rates?.[id];
          return rate ? [[id, rate]] : [];
        }),
      );
      return {
        ...value,
        agreed_rate: usesAgreedRate(value.treatment)
          ? (value.agreed_rate ?? "")
          : undefined,
        quantity: usesManualQuantity(value.basis)
          ? (value.quantity ?? "")
          : undefined,
        session_rates:
          allowsSessionRates(value) && Object.keys(roomRates).length
            ? roomRates
            : undefined,
      };
    }),
  };
  const plan: TrainingPlan = {
    configuration: configured,
    unpaid_breaks: Object.fromEntries(
      Object.entries(breaks).filter(([, minutes]) => minutes > 0),
    ),
  };
  const versionKey = JSON.stringify(plan);
  const presetsKey = trainingCommercialPresetsKey(actor, offer.organisation_id);
  const presets = useQuery({
    queryKey: presetsKey,
    queryFn: () => trainingCommercialPresets(offer.organisation_id),
    retry: false,
  });
  const selectedPreset = presets.data?.find(({ id }) => presetId === id);
  const matchingPreset =
    selectedPreset?.currency === offer.currency ? selectedPreset : undefined;

  const verify = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: "preview" | "save";
      payload: TrainingPlan;
    }) => {
      requireOnline();
      const confirmation = await trainingOfferCompensation(
        offer.job_id,
        action,
        offer.terms_version,
        payload,
      );
      if (!confirmation) throw new Error("missing_compensation_receipt");
      return {
        confirmation,
        request: JSON.stringify(payload),
        action,
        hasComponents: payload.configuration.components.length > 0,
      };
    },
    onSuccess: async ({ confirmation, action }) => {
      if (action !== "save") return;
      client.setQueryData(
        trainingOfferCompensationKey(actor, offer.job_id),
        confirmation,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["jobs"] }),
        client.invalidateQueries({ queryKey: ["job-board"] }),
        client.invalidateQueries({
          queryKey: ["job-lifecycle", actor, offer.job_id],
        }),
        client.invalidateQueries({
          queryKey: ["commission-offer-policy", actor, offer.job_id],
        }),
      ]);
      onDone();
    },
  });
  const presetMutation = useMutation({
    mutationFn: async ({
      action,
      original,
    }: {
      action: "save" | "archive";
      original?: CommercialPreset;
    }) => {
      requireOnline();
      const result = await changeTrainingCommercialPreset(
        offer.organisation_id,
        action,
        original,
        action === "save"
          ? {
              currency: offer.currency,
              name: presetName.trim(),
              configuration: {
                ...configured,
                components: configured.components.map((line) => ({
                  ...line,
                  session_rates: undefined,
                })),
              },
              base_rate: offer.base_rate,
              rate_unit: offer.rate_unit,
            }
          : null,
      );
      return { result, action };
    },
    onSuccess: async ({ result, action }) => {
      await client.invalidateQueries({ queryKey: presetsKey });
      setPresetId(action === "archive" ? "" : result.id);
      if (action === "archive") setPresetName("");
    },
  });
  const reviewed =
    verify.data?.request === versionKey && verify.data?.action === "preview";
  const pending = verify.isPending || presetMutation.isPending;
  const canWritePreset =
    online && !pending && reviewed && presetName.trim().length > 0;
  return (
    <form
      className="training-commercial-form"
      onSubmit={(event) => {
        event.preventDefault();
        verify.mutate({ action: "preview", payload: plan });
      }}
    >
      <details className="training-commercial-group">
        <summary>{t("presets")}</summary>
        {presets.isPending && <Loading />}
        {presets.isError && <Notice kind="error">{t("presetFailed")}</Notice>}
        <div className="form-row">
          <Field id={`${id}-template`} label={t("choosePreset")}>
            <select
              id={`${id}-template`}
              value={presetId}
              onChange={(event) => {
                const chosen = presets.data?.find(
                  ({ id }) => id === event.target.value,
                );
                setPresetId(event.target.value);
                setPresetName(chosen?.name ?? "");
              }}
              disabled={pending}
            >
              <option value="">{t("unnamed")}</option>
              {presets.data?.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.currency})
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-template-name`} label={t("presetName")}>
            <input
              id={`${id}-template-name`}
              value={presetName}
              maxLength={120}
              onChange={(event) => setPresetName(event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!matchingPreset || pending}
            onClick={() => {
              if (!matchingPreset) return;
              setComponents(
                toFormRows(matchingPreset.configuration.components),
              );
              setUnitMinutes(String(matchingPreset.configuration.unit_minutes));
              setCopiedPreset(matchingPreset.name);
            }}
          >
            {t("applyPreset")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canWritePreset}
            onClick={() => presetMutation.mutate({ action: "save" })}
          >
            {t("saveNewPreset")}
          </Button>
          {matchingPreset && (
            <Button
              type="button"
              variant="secondary"
              disabled={!canWritePreset}
              onClick={() =>
                presetMutation.mutate({
                  action: "save",
                  original: matchingPreset,
                })
              }
            >
              {t("savePresetRevision")}
            </Button>
          )}
          {selectedPreset && (
            <Button
              type="button"
              variant="ghost"
              disabled={!online || pending}
              onClick={() =>
                presetMutation.mutate({
                  action: "archive",
                  original: selectedPreset,
                })
              }
            >
              {t("archivePreset")}
            </Button>
          )}
        </div>
        {selectedPreset && !matchingPreset && (
          <Notice>{t("changedCurrency")}</Notice>
        )}
        {copiedPreset && (
          <Notice>{t("appliedPreset", { name: copiedPreset })}</Notice>
        )}
        {configured.components.some((line) => line.session_rates) && (
          <p className="muted">{t("presetOverrideHint")}</p>
        )}
        {presetMutation.isError && (
          <Notice kind="error">{t("presetFailed")}</Notice>
        )}
        {presetMutation.isSuccess && (
          <Notice kind="success">
            {t(
              presetMutation.data.action === "archive"
                ? "archivedPreset"
                : "presetConfirmed",
            )}
          </Notice>
        )}
      </details>
      <Field id={`${id}-minutes`} label={t("unit")}>
        <input
          id={`${id}-minutes`}
          type="number"
          min="1"
          max="1440"
          step="1"
          required
          value={unitMinutes}
          onChange={(event) => setUnitMinutes(event.target.value)}
          disabled={pending}
        />
      </Field>
      {offer.sessions.length > 0 && (
        <details className="training-commercial-group">
          <summary>{t("breaks")}</summary>
          <div className="form-row">
            {offer.sessions.map((slot) => (
              <Field
                key={slot.id}
                id={`${id}-${slot.id}`}
                label={t("breakMinutes", {
                  time: dateTime(slot.starts_at, i18n.language, zone),
                })}
              >
                <input
                  id={`${id}-${slot.id}`}
                  type="number"
                  min="0"
                  step="1"
                  disabled={pending}
                  value={breaks[slot.id] ?? 0}
                  onChange={(event) =>
                    setBreaks({
                      ...breaks,
                      [slot.id]: Number(event.target.value),
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </details>
      )}
      {components.map(({ key, value }, index) => (
        <ComponentFields
          key={key}
          value={value}
          number={index + 1}
          physicalSessions={physicalSessions}
          zone={zone}
          disabled={pending}
          onChange={(next) =>
            setComponents(
              components.map((row) =>
                row.key === key ? { key, value: next } : row,
              ),
            )
          }
          onRemove={() =>
            setComponents(components.filter((row) => row.key !== key))
          }
        />
      ))}
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || components.length >= 24}
          onClick={() =>
            setComponents([...components, ...toFormRows([newComponent])])
          }
        >
          {t("add")}
        </Button>
        <Button type="submit" variant="secondary" disabled={!online || pending}>
          {t("preview")}
        </Button>
        <Button
          type="button"
          disabled={!online || pending || !reviewed}
          onClick={() => verify.mutate({ action: "save", payload: plan })}
        >
          {t("save")}
        </Button>
      </div>
      {verify.isError && <Notice kind="error">{t("failed")}</Notice>}
      {reviewed && verify.data?.confirmation.preview && (
        <Breakdown projection={verify.data.confirmation.preview} />
      )}
      {reviewed && !verify.data?.hasComponents && (
        <Notice>{t("notConfigured")}</Notice>
      )}
    </form>
  );
}

export function TrainingCompensationPanel({
  actor,
  jobId,
  zone,
}: {
  actor: string;
  jobId: string;
  zone: string;
}) {
  const { t } = useTranslation("trainingCommercial");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const offer = useQuery({
    queryKey: trainingOfferCompensationKey(actor, jobId),
    queryFn: () => trainingOfferCompensation(jobId, "read"),
    enabled: open,
    retry: false,
  });
  if (offer.data === null) return null;
  return (
    <details
      className="training-commercial-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("title")}</summary>
      {open && (
        <>
          <p className="muted">{t("description")}</p>
          {offer.isPending && <Loading />}
          {offer.isError && (
            <Notice kind="error">
              {t("failed")}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => void offer.refetch()}
              >
                {t("reload")}
              </Button>
            </Notice>
          )}
          {saved && <Notice kind="success">{t("saved")}</Notice>}
          {offer.data && (
            <>
              {offer.data.accepted.map(({ claim_id, snapshot }) => (
                <Breakdown key={claim_id} projection={snapshot} accepted />
              ))}
              {!editing && offer.data.preview && (
                <Breakdown projection={offer.data.preview} />
              )}
              {!editing &&
                offer.data.plan &&
                !offer.data.preview &&
                offer.data.editable && (
                  <Notice kind="error">{t("stale")}</Notice>
                )}
              {!editing && !offer.data.plan && (
                <p className="muted">{t("notConfigured")}</p>
              )}
              {offer.data.editable && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(!editing);
                      setSaved(false);
                    }}
                  >
                    {t(editing ? "close" : "edit")}
                  </Button>
                  {editing && (
                    <CompensationForm
                      key={offer.data.terms_version}
                      actor={actor}
                      offer={offer.data}
                      zone={zone}
                      onDone={() => {
                        setEditing(false);
                        setSaved(true);
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </details>
  );
}

export function TrainingAssignmentCompensation({
  actor,
  claimId,
}: {
  actor: string;
  claimId: string;
}) {
  const { t, i18n } = useTranslation("trainingCommercial");
  const receipt = useQuery({
    queryKey: ["training-assignment-compensation", actor, claimId],
    queryFn: () => trainingAssignmentCompensation(claimId),
    retry: false,
  });
  if (!receipt.data) return null;
  const { currency, base_amount, total_amount, components } = receipt.data;
  return (
    <details className="panel training-commercial-group">
      <summary>{t("accepted")}</summary>
      <dl className="training-assignment-lines">
        <div>
          <dt>{t("base")}</dt>
          <dd>{money(base_amount, currency, i18n.language)}</dd>
        </div>
        {components.map((line, index) => (
          <div key={index}>
            <dt>{line.label || t(`kind.${line.kind}`)}</dt>
            <dd>{money(line.amount, currency, i18n.language)}</dd>
          </div>
        ))}
        <div>
          <dt>{t("total")}</dt>
          <dd>
            <strong>{money(total_amount, currency, i18n.language)}</strong>
          </dd>
        </div>
      </dl>
    </details>
  );
}
