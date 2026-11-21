import { z } from "zod";

export const courseDestinationsSchema = z.object({
  organisation: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  lecturers: z.array(z.object({ id: z.uuid(), name: z.string() })),
  jobs: z.array(z.object({ id: z.uuid(), title: z.string() })),
  rooms: z.array(z.object({ id: z.uuid(), name: z.string().nullable() })),
});
