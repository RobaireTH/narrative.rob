export const orchestrator_schedule_statuses = [
  'active',
  'errored',
  'paused',
  'terminal',
] as const;

export type OrchestratorScheduleStatus =
  (typeof orchestrator_schedule_statuses)[number];

export interface OrchestratorScheduleRecord {
  consecutive_failures: number;
  created_at: string;
  last_error?: string;
  last_run_at?: string;
  last_success_at?: string;
  narrative_id: string;
  next_run_at?: string;
  status: OrchestratorScheduleStatus;
  thread_id: string;
  updated_at: string;
  workspace_id: string;
}

export interface OrchestratorScheduleStore {
  findDueSchedules(now_iso: string): Promise<OrchestratorScheduleRecord[]>;
  getSchedule(thread_id: string): Promise<OrchestratorScheduleRecord | null>;
  saveSchedule(
    record: OrchestratorScheduleRecord,
  ): Promise<OrchestratorScheduleRecord>;
}

export class InMemoryOrchestratorScheduleStore
  implements OrchestratorScheduleStore
{
  private readonly schedules = new Map<string, OrchestratorScheduleRecord>();

  async findDueSchedules(now_iso: string): Promise<OrchestratorScheduleRecord[]> {
    return Array.from(this.schedules.values())
      .filter((schedule) =>
        schedule.status === 'active' &&
        schedule.next_run_at !== undefined &&
        schedule.next_run_at <= now_iso,
      )
      .map((schedule) => structuredClone(schedule));
  }

  async getSchedule(
    thread_id: string,
  ): Promise<OrchestratorScheduleRecord | null> {
    const record = this.schedules.get(thread_id);
    return record ? structuredClone(record) : null;
  }

  async saveSchedule(
    record: OrchestratorScheduleRecord,
  ): Promise<OrchestratorScheduleRecord> {
    this.schedules.set(record.thread_id, structuredClone(record));
    return structuredClone(record);
  }
}
