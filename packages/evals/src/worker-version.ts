import { createHash } from "node:crypto";

/** Bumped when eval worker persistence behavior changes; triggers worker restart in dev. */
export const EVAL_WORKER_VERSION = createHash("sha1")
  .update("eval-usage-collector-v1")
  .digest("hex")
  .slice(0, 8);

export function evalWorkerVersionLabel() {
  return `eval-worker@${EVAL_WORKER_VERSION}`;
}
