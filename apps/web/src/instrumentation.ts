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
  }
}
