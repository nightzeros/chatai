export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
    try {
      const { startIngestWorker } = await import("./lib/ingest-worker");
      startIngestWorker();
    } catch (error) {
      console.error("[ingest] failed to start worker:", error);
    }
    try {
      const { startEvalWorker } = await import("./lib/eval-worker");
      startEvalWorker();
    } catch (error) {
      console.error("[eval] failed to start worker:", error);
    }
    try {
      const { startPrivacyWorker } = await import("./lib/privacy/retention-worker");
      startPrivacyWorker();
    } catch (error) {
      console.error("[privacy] failed to start worker:", error);
    }
    try {
      const { startUsageReconcileWorker } = await import("./lib/hosting/stale-reservations");
      startUsageReconcileWorker();
    } catch (error) {
      console.error("[usage] failed to start stale reconciler:", error);
    }
  }
}
