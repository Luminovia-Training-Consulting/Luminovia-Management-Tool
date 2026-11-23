import { z } from "zod";

export const reference = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/);
export const releaseCommit = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .refine((value) => /[1-9a-f]/.test(value));
export const licenceLimits = z.strictObject({
  seat_count: z.int().positive(),
  storage_bytes: z.int().positive(),
  api_requests_per_minute: z.int().positive().max(0xffff_ffff),
});
