/** Manual combined-source gate: install the actual committed PR17 migration
 * overlay in an isolated worktree first. Missing prerequisites are fatal;
 * the normal operational SQL suite does not depend on another open PR. */
import { runOperationalForwardChecks } from "./operational-forward-db-tests.mjs";

await runOperationalForwardChecks({ requirePr17: true });
