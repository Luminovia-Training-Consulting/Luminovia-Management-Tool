/** Reviewed native envelope for published, scanned H5P packages and learner progress. */
import { z } from "zod";

import { h5pCatalogue, h5pProgress } from "../learning/h5p-playback-schema.ts";

const run = { p_run_id: z.uuid(), p_version_id: z.uuid() };
const command = <A extends string>(action: A, payload: z.ZodType) =>
  z.strictObject({ ...run, p_action: z.literal(action), p_payload: payload });
export const readH5pPackages = z.toJSONSchema(h5pCatalogue);
export const h5pPlaybackCommand = z.toJSONSchema(
  z.discriminatedUnion("p_action", [
    command(
      "publish",
      z.strictObject({
        title: z.string().min(1).max(200),
        sha256: z.hash("sha256"),
      }),
    ),
    command("withdraw", z.strictObject({})),
    command("progress", h5pProgress),
  ]),
);
