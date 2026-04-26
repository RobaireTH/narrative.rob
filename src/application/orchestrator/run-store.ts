export const orchestrator_run_statuses = [
  'failed',
  'skipped',
  'started',
  'succeeded',
] as const;

export type OrchestratorRunStatus =
  (typeof orchestrator_run_statuses)[number];

export const orchestrator_run_triggers = [
  'manual',
  'scheduler',
  'task',
] as const;

export type OrchestratorRunTrigger =
  (typeof orchestrator_run_triggers)[number];

export interface OrchestratorRunRecord {
  ended_at?: string;
  error?: string;
  run_id: string;
  snapshot_execution_plan_object_key?: string;
  snapshot_logs_object_key?: string;
  snapshot_narrative_object_key?: string;
  snapshot_portfolio_object_key?: string;
  started_at: string;
  status: OrchestratorRunStatus;
  summary?: string;
  thread_id: string;
  trigger: OrchestratorRunTrigger;
  workspace_id: string;
}

export interface ListRunsByThreadInput {
  before?: string;
  limit?: number;
  thread_id: string;
}

export interface OrchestratorRunStore {
  getLatestRunByThread(
    thread_id: string,
  ): Promise<OrchestratorRunRecord | null>;
  getRunById(run_id: string): Promise<OrchestratorRunRecord | null>;
  listRunsByThread(
    input: ListRunsByThreadInput,
  ): Promise<OrchestratorRunRecord[]>;
  saveRun(record: OrchestratorRunRecord): Promise<OrchestratorRunRecord>;
}

export class InMemoryOrchestratorRunStore
  implements OrchestratorRunStore
{
  private readonly runs = new Map<string, OrchestratorRunRecord>();

  async getLatestRunByThread(
    thread_id: string,
  ): Promise<OrchestratorRunRecord | null> {
    const latest = Array.from(this.runs.values())
      .filter((run) => run.thread_id === thread_id)
      .sort((left, right) =>
        right.started_at.localeCompare(left.started_at),
      )[0];

    return latest ? structuredClone(latest) : null;
  }

  async getRunById(run_id: string): Promise<OrchestratorRunRecord | null> {
    const record = this.runs.get(run_id);
    return record ? structuredClone(record) : null;
  }

  async listRunsByThread(
    input: ListRunsByThreadInput,
  ): Promise<OrchestratorRunRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    return Array.from(this.runs.values())
      .filter((run) => run.thread_id === input.thread_id)
      .filter((run) =>
        input.before ? run.started_at < input.before : true,
      )
      .sort((left, right) => right.started_at.localeCompare(left.started_at))
      .slice(0, limit)
      .map((run) => structuredClone(run));
  }

  async saveRun(record: OrchestratorRunRecord): Promise<OrchestratorRunRecord> {
    this.runs.set(record.run_id, structuredClone(record));
    return structuredClone(record);
  }
}
