import { useId, useState } from "react";
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
  readSettlementJournal,
} from "./settlement-journal-api";
import {
  settlementJournalPeriodSchema,
  type SettlementJournal,
  type SettlementJournalPeriod,
} from "./settlement-journal-schema";

type Action = "preview" | "json" | "csv";
const pageSize = 20;

export function SettlementJournalButton() {
  const { t } = useTranslation("accounting");
  const [open, setOpen] = useState(false);
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
        {open && <JournalForm />}
      </Dialog>
    </>
  );
}

function JournalForm() {
  const { t } = useTranslation("accounting");
  const online = useOnline();
  const id = useId();
  const [period, setPeriod] = useState<SettlementJournalPeriod>(() => {
    const today = DateTime.utc();
    return {
      p_from: today.startOf("month").toISODate()!,
      p_to: today.toISODate()!,
    };
  });
  const [visible, setVisible] = useState(pageSize);
  const report = useMutation({ mutationFn: readSettlementJournal });
  const validPeriod = settlementJournalPeriodSchema.safeParse(period).success;
  const enabled = validPeriod && online && !report.isPending;
  const errorCode =
    report.error && "code" in report.error ? report.error.code : null;

  function update(field: keyof SettlementJournalPeriod, value: string) {
    report.reset();
    setPeriod((current) => ({ ...current, [field]: value }));
  }

  function load(action: Action) {
    if (!enabled) return;
    setVisible(pageSize);
    report.mutate(period, {
      onSuccess(data) {
        if (action !== "preview") downloadSettlementJournal(data, action);
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
        </div>
      </form>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
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
      {report.data && <JournalResult data={report.data} visible={visible} />}
      {report.data && visible < report.data.items.length && (
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
