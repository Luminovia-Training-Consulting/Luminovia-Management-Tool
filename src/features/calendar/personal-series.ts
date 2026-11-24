import type { z } from "zod";
import { db } from "../../lib/supabase";
import { zonedInstant } from "../../lib/dates";
import { expandRecurrence, type RecurrenceRule } from "../../lib/recurrence";

import {
  cancelledPersonalSeriesCount,
  createPersonalSeriesInput,
  personalSeriesLimit,
  personalSeriesReceipt,
} from "./personal-series-schema";

export type PersonalSeriesPayload = z.output<typeof createPersonalSeriesInput>;

export function preparePersonalSeries(
  values: {
    title: string;
    description: string;
    meeting_url: string;
    time_zone: string;
    starts_at: string;
    ends_at: string;
  },
  rule: RecurrenceRule,
): PersonalSeriesPayload {
  const slots = expandRecurrence(
    { starts_at: values.starts_at, ends_at: values.ends_at },
    values.time_zone,
    rule,
    personalSeriesLimit,
  );
  let previousEnd = -Infinity;
  const instants = slots.map((slot) => {
    const start = zonedInstant(slot.starts_at, values.time_zone);
    const end = zonedInstant(slot.ends_at, values.time_zone);
    if (
      !start ||
      !end ||
      Date.parse(end) <= Date.parse(start) ||
      Date.parse(start) < previousEnd
    )
      throw new RangeError("Invalid or overlapping recurring appointment");
    previousEnd = Date.parse(end);
    return { starts_at: start, ends_at: end };
  });
  return createPersonalSeriesInput.parse({
    p_title: values.title,
    p_description: values.description,
    p_meeting_url: values.meeting_url,
    p_time_zone: values.time_zone,
    p_occurrences: instants,
  });
}

export async function savePersonalSeries(
  requestId: string,
  payload: PersonalSeriesPayload,
) {
  const { data, error } = await db().rpc("create_my_personal_event_series", {
    p_request_id: requestId,
    ...payload,
  });
  if (error) throw error;
  const receipt = personalSeriesReceipt.parse(data);
  if (receipt.created !== payload.p_occurrences.length)
    throw new Error("Unconfirmed personal calendar series");
  return receipt;
}

export async function cancelFuturePersonalEvents(seriesId: string) {
  const { data, error } = await db().rpc("cancel_my_future_personal_events", {
    p_series_id: seriesId,
  });
  if (error) throw error;
  return cancelledPersonalSeriesCount.parse(data);
}
