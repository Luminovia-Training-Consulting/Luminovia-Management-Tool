/** DTOs for protected offer pricing and the lecturer's own accepted amounts. */
import { z } from "zod";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";

import {
  trainingCommercialPresetSchema,
  trainingOfferCompensationSchema,
  trainingAssignmentCompensationSchema,
  type TrainingPlan,
  type CommercialPreset,
} from "./training-commercial-types";
export {
  componentKinds,
  componentBases,
  commissionTreatments,
  type TrainingComponent,
  type TrainingPlan,
  type CompensationProjection,
  type CommercialPreset,
} from "./training-commercial-types";

export function trainingOfferCompensationKey(actor: string, jobId: string) {
  return ["training-offer-compensation", actor, jobId] as const;
}
export function trainingCommercialPresetsKey(
  actor: string,
  organisationId: string,
) {
  return ["training-commercial-presets", actor, organisationId] as const;
}
export async function trainingOfferCompensation(
  jobId: string,
  action: "read" | "preview" | "save",
  expectedVersion: number | null = null,
  payload: TrainingPlan | null = null,
) {
  const { data, error } = await db().rpc("training_offer_compensation", {
    p_job_id: jobId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (error) throw error;
  return trainingOfferCompensationSchema.nullable().parse(data);
}

export async function trainingCommercialPresets(organisationId: string) {
  const { data, error } = await db().rpc("training_commercial_presets", {
    p_organisation_id: organisationId,
    p_action: "list",
  });
  if (error) throw error;
  return z.array(trainingCommercialPresetSchema).parse(data);
}
export async function changeTrainingCommercialPreset(
  organisationId: string,
  action: "save" | "archive",
  original: CommercialPreset | undefined,
  draft: Pick<
    CommercialPreset,
    "name" | "currency" | "configuration" | "base_rate" | "rate_unit"
  > | null,
) {
  const { data, error } = await db().rpc("training_commercial_presets", {
    p_organisation_id: organisationId,
    p_action: action,
    p_preset_id: original?.id ?? null,
    p_expected_revision: original?.revision ?? 0,
    p_payload: draft,
  });
  if (error) throw error;
  return trainingCommercialPresetSchema.parse(data);
}
export async function trainingAssignmentCompensation(claimId: string) {
  const { data, error } = await db().rpc(
    "training_assignment_compensation",
    {
      p_claim_id: claimId,
    },
    { get: true },
  );
  if (error) throw error;
  return trainingAssignmentCompensationSchema.nullable().parse(data);
}

/** Price the initial form value with integer cents from the reviewed schedule. */
export function presetBaseTotal(
  preset: CommercialPreset,
  sessions: readonly { starts_at: string; ends_at: string }[],
  zone: string,
) {
  if (!preset.base_rate || !preset.rate_unit) return null;
  const [whole, fractional = ""] = preset.base_rate.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
  if (preset.rate_unit === "fixed_total") return Number(cents) / 100;
  if (preset.rate_unit === "per_day") {
    const localDays = new Set<string>();
    for (const { starts_at, ends_at } of sessions) {
      const first = DateTime.fromISO(starts_at, { zone }).startOf("day");
      const last = DateTime.fromISO(ends_at, { zone })
        .minus({ milliseconds: 1 })
        .startOf("day");
      if (
        !first.isValid ||
        !last.isValid ||
        last.diff(first, "days").days > 366
      )
        return null;
      for (let day = first; day <= last; day = day.plus({ days: 1 })) {
        localDays.add(day.toISODate()!);
      }
    }
    return Number(cents * BigInt(localDays.size)) / 100;
  }
  const milliseconds = sessions.reduce(
    (total, session) =>
      total + Date.parse(session.ends_at) - Date.parse(session.starts_at),
    0,
  );
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
  const millisecondsPerUnit = BigInt(
    (preset.rate_unit === "per_hour" ? 60 : preset.configuration.unit_minutes) *
      60_000,
  );
  return (
    Number(
      (cents * BigInt(milliseconds) + millisecondsPerUnit / 2n) /
        millisecondsPerUnit,
    ) / 100
  );
}
