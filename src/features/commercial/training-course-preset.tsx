/** Explicit customer-preset inheritance in the existing course-offer editor. */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  trainingCommercialPresets,
  trainingCommercialPresetsKey,
  type CommercialPreset,
} from "./training-commercial-api";
import "./training-commercial-i18n";
import "./training-commercial.css";

export function TrainingCoursePreset({
  actor,
  organisationId,
  applied,
  onApply,
  disabled,
}: {
  actor: string;
  organisationId: string;
  applied: Pick<CommercialPreset, "name"> | null;
  onApply: (preset: CommercialPreset | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("trainingCommercial");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const presets = useQuery({
    queryKey: trainingCommercialPresetsKey(actor, organisationId),
    queryFn: () => trainingCommercialPresets(organisationId),
    enabled: open,
    retry: false,
  });
  const current = presets.data?.find((preset) => preset.id === selected);
  return (
    <details
      className="training-commercial-group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("presets")}</summary>
      {open && presets.isPending && <Loading />}
      {presets.isError && <Notice kind="error">{t("presetFailed")}</Notice>}
      <Field
        id={`${id}-training-preset`}
        label={t("choosePreset")}
        hint={t("presetBaseRate")}
      >
        <select
          id={`${id}-training-preset`}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={disabled}
        >
          <option value="">{t("unnamed")}</option>
          {presets.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.currency})
            </option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!current || disabled}
          onClick={() => {
            if (current) onApply(current);
          }}
        >
          {t("applyCoursePreset")}
        </Button>
        {applied && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onApply(null)}
          >
            {t("clearCoursePreset")}
          </Button>
        )}
      </div>
      {applied && (
        <Notice>{t("inheritedCoursePreset", { name: applied.name })}</Notice>
      )}
    </details>
  );
}
