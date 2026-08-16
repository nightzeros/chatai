export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
    const { startIngestWorker } = await import("./lib/ingest-worker");
    startIngestWorker();
  }
}
