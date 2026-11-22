import { z } from "zod";

export const calendarRecipientCode = z
  .string()
  .regex(/^LV(?:-[0-9A-F]{4}){5}$/);
export const calendarResponse = z.enum(["accepted", "tentative", "declined"]);
const calendarStatus = z.enum(["pending", ...calendarResponse.options]);
const eventVersion = z.int().min(1).max(2147483647);
export const calendarInvitationVersion = eventVersion;
export const calendarExpectedRevision = z.int().min(0).max(2147483647);

export const calendarInvitationCursor = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
export const ownCalendarInvitations = z.strictObject({
  items: z
    .array(
      z.strictObject({
        event_id: z.uuid(),
        event_version: eventVersion,
        title: z.string(),
        starts_at: z.iso.datetime({ offset: true }),
        ends_at: z.iso.datetime({ offset: true }),
        time_zone: z.string(),
        revision: eventVersion,
        response: calendarStatus,
      }),
    )
    .max(50),
  next_cursor: calendarInvitationCursor.nullable(),
});

export const calendarInvitationRoster = z
  .array(
    z.strictObject({
      user_code: calendarRecipientCode,
      name: z.string(),
      revision: eventVersion,
      response: calendarStatus,
      withdrawn: z.boolean(),
    }),
  )
  .max(100);
