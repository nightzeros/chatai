/**
 * Tracks client-delegation lifecycle for race-safe appends.
 * Shared by mock and (later) live adapters / ChatAI orchestration.
 */

export type DelegationStatus = "active" | "superseded" | "completed";

export type DelegationRecord = {
  id: string;
  status: DelegationStatus;
  createdAtMs: number;
  supersededAtMs?: number;
  completedAtMs?: number;
};

export type DelegationAcceptResult =
  | { ok: true }
  | {
      ok: false;
      reason: "superseded" | "unknown_delegation" | "completed" | "session_closed";
    };

export class DelegationTracker {
  private readonly byId = new Map<string, DelegationRecord>();
  private sessionOpen = true;

  isSessionOpen(): boolean {
    return this.sessionOpen;
  }

  closeSession(): void {
    this.sessionOpen = false;
    for (const record of this.byId.values()) {
      if (record.status === "active") {
        record.status = "superseded";
        record.supersededAtMs = record.supersededAtMs ?? Date.now();
      }
    }
  }

  create(id: string, createdAtMs = Date.now()): DelegationRecord {
    if (!this.sessionOpen) {
      throw new Error("Cannot create delegation on a closed session.");
    }
    const record: DelegationRecord = { id, status: "active", createdAtMs };
    this.byId.set(id, record);
    return record;
  }

  get(id: string): DelegationRecord | undefined {
    return this.byId.get(id);
  }

  listActive(): DelegationRecord[] {
    return [...this.byId.values()].filter((d) => d.status === "active");
  }

  /** Mark one delegation superseded (e.g. barge-in or newer turn). */
  supersede(id: string, atMs = Date.now()): boolean {
    const record = this.byId.get(id);
    if (!record || record.status !== "active") return false;
    record.status = "superseded";
    record.supersededAtMs = atMs;
    return true;
  }

  /** Supersede every active delegation (typical barge-in). */
  supersedeAllActive(atMs = Date.now()): string[] {
    const ids: string[] = [];
    for (const record of this.byId.values()) {
      if (record.status === "active") {
        record.status = "superseded";
        record.supersededAtMs = atMs;
        ids.push(record.id);
      }
    }
    return ids;
  }

  complete(id: string, atMs = Date.now()): boolean {
    const record = this.byId.get(id);
    if (!record || record.status !== "active") return false;
    record.status = "completed";
    record.completedAtMs = atMs;
    return true;
  }

  /** Gate for commentary/thinking appends — rejects superseded / late results. */
  acceptAppend(delegationId: string): DelegationAcceptResult {
    if (!this.sessionOpen) return { ok: false, reason: "session_closed" };
    const record = this.byId.get(delegationId);
    if (!record) return { ok: false, reason: "unknown_delegation" };
    if (record.status === "superseded") return { ok: false, reason: "superseded" };
    if (record.status === "completed") return { ok: false, reason: "completed" };
    return { ok: true };
  }
}
