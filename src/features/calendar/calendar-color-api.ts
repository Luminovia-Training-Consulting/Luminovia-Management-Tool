import { db } from "../../lib/supabase";

export type CalendarColors = {
  personal_event_color: string;
  assignment_event_color: string;
  customer_event_color: string;
  version: number;
};

/** Match the SQL getter's untouched-account defaults until the private read finishes. */
export const defaultCalendarColors: CalendarColors = {
  personal_event_color: "#E1EDDA",
  assignment_event_color: "#DCE9F8",
  customer_event_color: "#FFF0C5",
  version: 0,
};

/** Query key and getter are explicitly actor-scoped; no administrator reads another user's choices. */
export const calendarColorsQuery = (actor: string) => ({
  queryKey: ["calendar-color-preferences", actor] as const,
  queryFn: async () => {
    const { data, error } = await db().rpc("get_my_calendar_color_preferences");
    if (error) throw error;
    return data as CalendarColors;
  },
});
