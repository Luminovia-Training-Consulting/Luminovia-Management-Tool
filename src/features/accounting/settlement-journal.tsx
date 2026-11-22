import { useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeftRight, Download } from "lucide-react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useOnline } from "../../lib/online";
import {
  downloadSettlementJournal,
  filterSettlementJournal,
  readSettlementJournal,
  type SettlementJournalFile,
  type SettlementJournalFilter,
} from "./settlement-journal-api";
import {
  settlementJournalKind,
  settlementJournalPeriodSchema,
  type SettlementJournal,
  type SettlementJournalPeriod,
} from "./settlement-journal-schema";

import { accountingCurrency } from "./schema";

type Action = "preview" | SettlementJournalFile;
const pageSize = 20;

export function SettlementJournalButton() {
  const { t } = useTranslation("accounting");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        onClick={(event) => {
          setTrigger(event.currentTarget);
          setOpen(true);
        }}
      >
        <ArrowLeftRight size={18} aria-hidden="true" />
        {t("journal.title")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("journal.title")}
        description={t("journal.description")}
        returnFocusTo={trigger}
      >
        {open &&
          (online ? (
            <JournalForm />
          ) : (
            <Notice kind="error">{t("offline")}</Notice>
          ))}
      </Dialog>
    </>
  );
}

function JournalForm() {
  const { t } = useTranslation("accounting");
  const id = useId();
  const [period, setPeriod] = useState<SettlementJournalPeriod>(() => {
    const today = DateTime.utc();
    return {
      p_from: today.startOf("month").toISODate()!,
      p_to: today.toISODate()!,
    };
  });
  const [visible, setVisible] = useState(pageSize);
  const [filter, setFilter] = useState<SettlementJournalFilter>({
    kind: "",
    currency: "",
    posting: "",
  });
  const report = useMutation({
    mutationFn: readSettlementJournal,
    gcTime: 0,
  });
  const data = useMemo(
    () => report.data && filterSettlementJournal(report.data, filter),
    [report.data, filter],
  );
  const validPeriod = settlementJournalPeriodSchema.safeParse(period).success;
  const enabled = validPeriod && !report.isPending;
  const errorCode =
    report.error && "code" in report.error ? report.error.code : null;

  function update(field: keyof SettlementJournalPeriod, value: string) {
    report.reset();
    setPeriod((current) => ({ ...current, [field]: value }));
  }

  function updateFilter<K extends keyof SettlementJournalFilter>(
    field: K,
    value: SettlementJournalFilter[K],
  ) {
    setVisible(pageSize);
    setFilter((current) => ({ ...current, [field]: value }));
  }

  function load(action: Action) {
    if (!enabled) return;
    setVisible(pageSize);
    report.mutate(period, {
      onSuccess(data) {
        if (action !== "preview")
          downloadSettlementJournal(
            filterSettlementJournal(data, filter),
            action,
            filter,
          );
      },
    });
  }

  return (
    <section className="accounting-journal">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          load("preview");
        }}
      >
        <div className="accounting-journal-period">
          <Field id={`${id}-from`} label={t("journal.from")}>
            <input
              id={`${id}-from`}
              required
              type="date"
              max={period.p_to || undefined}
              value={period.p_from}
              disabled={report.isPending}
              onChange={(event) => update("p_from", event.target.value)}
            />
          </Field>
          <Field id={`${id}-to`} label={t("journal.to")}>
            <input
              id={`${id}-to`}
              required
              type="date"
              min={period.p_from || undefined}
              value={period.p_to}
              disabled={report.isPending}
              onChange={(event) => update("p_to", event.target.value)}
            />
          </Field>
        </div>
        <div className="accounting-journal-period">
          <Field id={`${id}-kind`} label={t("journal.kindFilter")}>
            <select
              id={`${id}-kind`}
              value={filter.kind}
              disabled={report.isPending}
              onChange={(event) =>
                updateFilter(
                  "kind",
                  event.target.value as SettlementJournalFilter["kind"],
                )
              }
            >
              <option value="">{t("journal.allKinds")}</option>
              {settlementJournalKind.options.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`journal.kind.${kind}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-currency`} label={t("journal.currencyFilter")}>
            <select
              id={`${id}-currency`}
              value={filter.currency}
              disabled={report.isPending}
              onChange={(event) =>
                updateFilter(
                  "currency",
                  event.target.value as SettlementJournalFilter["currency"],
                )
              }
            >
              <option value="">{t("journal.allCurrencies")}</option>
              {accountingCurrency.options.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-posting`} label={t("journal.postingFilter")}>
            <select
              id={`${id}-posting`}
              value={filter.posting}
              disabled={report.isPending}
              onChange={(event) =>
                updateFilter(
                  "posting",
                  event.target.value as SettlementJournalFilter["posting"],
                )
              }
            >
              <option value="">{t("journal.allPostings")}</option>
              <option value="recorded">{t("journal.onlyRecorded")}</option>
              <option value="reversed">{t("journal.onlyReversed")}</option>
            </select>
          </Field>
        </div>
        {!validPeriod && <p role="alert">{t("journal.invalidPeriod")}</p>}
        <div className="accounting-actions">
          <Button disabled={!enabled} type="submit">
            {t("journal.load")}
          </Button>
          <Button
            disabled={!enabled}
            type="button"
            variant="secondary"
            onClick={() => load("json")}
          >
            <Download size={16} aria-hidden="true" />
            {t("journal.json")}
          </Button>
          <Button
            disabled={!enabled}
            type="button"
            variant="secondary"
            onClick={() => load("csv")}
          >
            <Download size={16} aria-hidden="true" />
            {t("journal.csv")}
          </Button>
          <Button
            disabled={!enabled}
            type="button"
            variant="secondary"
            onClick={() => load("totals_csv")}
          >
            <Download size={16} aria-hidden="true" />
            {t("journal.totalsCsv")}
          </Button>
        </div>
      </form>
      {report.isPending && <p role="status">{t("journal.loading")}</p>}
      {report.isError && (
        <Notice kind="error">
          {t(
            errorCode === "42501"
              ? "journal.denied"
              : errorCode === "PT413"
                ? "journal.tooMany"
                : "journal.error",
          )}
        </Notice>
      )}
      {data && <JournalResult data={data} visible={visible} />}
      {data && visible < data.items.length && (
        <Button
          variant="secondary"
          onClick={() => setVisible((current) => current + pageSize)}
        >
          {t("journal.more")}
        </Button>
      )}
    </section>
  );
}

function JournalResult({
  data,
  visible,
}: {
  data: SettlementJournal;
  visible: number;
}) {
  const { t, i18n } = useTranslation("accounting");
  const format = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  return (
    <>
      <p role="status">{t("journal.count", { count: data.items.length })}</p>
      {data.totals.length > 0 && (
        <div className="accounting-grid">
          {data.totals.map((total) => (
            <section
              className="accounting-card"
              key={`${total.currency}:${total.kind}`}
            >
              <h3>
                {t(`journal.kind.${total.kind}`)} · {total.currency}
              </h3>
              <dl>
                <dt>{t("journal.recorded")}</dt>
                <dd>{total.recorded}</dd>
                <dt>{t("journal.reversed")}</dt>
                <dd>{total.reversed}</dd>
                <dt>{t("journal.net")}</dt>
                <dd>{total.net}</dd>
              </dl>
            </section>
          ))}
        </div>
      )}
      {data.items.length > 0 && (
        <ul className="accounting-journal-entries">
          {data.items.slice(0, visible).map((item) => (
            <li key={`${item.kind}:${item.id}:${Boolean(item.reverses_id)}`}>
              <strong>{item.reference}</strong>
              <span>
                {t(`journal.kind.${item.kind}`)} ·{" "}
                {format.format(new Date(item.effective_on))}
              </span>
              <span>
                {item.reverses_id
                  ? t("journal.reversalAmount", {
                      amount: item.amount,
                      currency: item.currency,
                    })
                  : `${item.amount} ${item.currency}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
