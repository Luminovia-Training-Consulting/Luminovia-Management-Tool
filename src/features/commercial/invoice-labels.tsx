/**
 * Bounded invoice-label editor. Labels organize records without altering accepted fees, invoice
 * items or payment amounts.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Tags } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Notice } from "../../components/common";
import { commercialKeys, parseInvoiceLabels } from "./api";
import type { InvoiceRecord } from "./types";
import "./platform-i18n";
/** Save bounded invoice labels through the RPC, then refresh invoice data. */
export function InvoiceLabels({
  actor,
  invoice,
  canEdit,
}: {
  actor: string;
  invoice: InvoiceRecord;
  canEdit: boolean;
}) {
  const { t } = useTranslation("platform");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      setInvalid(false);
      let labels: string[];
      try {
        labels = parseInvoiceLabels(value);
      } catch (error) {
        setInvalid(true);
        throw error;
      }
      const { error } = await db().rpc("set_invoice_labels", {
        p_invoice_id: invoice.id,
        p_labels: labels,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: commercialKeys.finance(actor),
      });
      setOpen(false);
    },
  });
  return (
    <>
      <div className="platform-invoice-labels">
        {(invoice.labels ?? []).map((label) => (
          <span className="badge" key={label}>
            {label}
          </span>
        ))}
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!online}
            onClick={() => {
              setValue((invoice.labels ?? []).join(", "));
              setInvalid(false);
              save.reset();
              setOpen(true);
            }}
          >
            <Tags size={15} />
            {t("editInvoiceLabels")}
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("editInvoiceLabels")}
        description={t("labelsHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field id="invoice-labels" label={t("invoiceLabels")} error={invalid}>
            <input
              id="invoice-labels"
              maxLength={1000}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={save.isPending}
            />
          </Field>
          <Button disabled={!online || save.isPending}>{common("save")}</Button>
          {save.isError && (
            <Notice kind="error">
              {invalid ? t("labelsInvalid") : common("error")}
            </Notice>
          )}
        </form>
      </Dialog>
    </>
  );
}
