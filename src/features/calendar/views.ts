/** Calendar view identifiers shared by navigation and the actual FullCalendar instance. */
export const calendarViews = [
    "dayGridMonth",
    "timeGridWeek",
    "timeGridDay",
    "listMonth",
] as const;
export type CalendarView = (typeof calendarViews)[number];