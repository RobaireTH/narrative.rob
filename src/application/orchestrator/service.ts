import { randomUUID } from 'crypto';
import type { Logger } from 'pino';

import { create_empty_logs, type LogsJson } from '../../domain/logs/schema';
import {
  narrative_json_schema,
  type NarrativeStatus,
} from '../../domain/narrative/schema';

const TERMINAL_NARRATIVE_STATUSES: ReadonlySet<NarrativeStatus> = new Set([
  'ARCHIVED',
  'COMPLETED',
  'EXPIRED',
  'FAILED',
]);
import type { WorkspaceArtifactStore } from '../workspaces/artifact-store';
import type { WorkspaceStore } from '../workspaces/store';
import type {
  OrchestratorRunRecord,
  OrchestratorRunStore,
} from './run-store';
import type {
  OrchestratorScheduleRecord,
  OrchestratorScheduleStore,
} from './schedule-store';
import { ConflictError, NotFoundError } from '../common/errors';
import type { TradingPolicyService } from '../trading-policy/service';
import type { LockStore } from '../../infrastructure/redis/lock-store';
import type { OrchestratorTaskClient } from '../../infrastructure/tasks/cloud-tasks';
import type { OrchestratorRuntime } from './runtime';

export type OrchestratorRuntimeMode = 'disabled' | 'deepagents';

export interface OrchestratorServiceParams {
  artifact_store: WorkspaceArtifactStore;
  lock_store: LockStore;
  lock_ttl_seconds: number;
  logger: Logger;
  runtime?: OrchestratorRuntime;
  runtime_mode: OrchestratorRuntimeMode;
  run_store: OrchestratorRunStore;
  schedule_store: OrchestratorScheduleStore;
  task_client?: OrchestratorTaskClient;
  trading_policy_service: TradingPolicyService;
  workspace_store: WorkspaceStore;
}

function plusHours(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export class OrchestratorService {
  private readonly artifact_store: WorkspaceArtifactStore;
  private readonly lock_store: LockStore;
  private readonly lock_ttl_seconds: number;
  private readonly logger: Logger;
  private readonly runtime?: OrchestratorRuntime;
  private readonly runtime_mode: OrchestratorRuntimeMode;
  private readonly run_store: OrchestratorRunStore;
  private readonly schedule_store: OrchestratorScheduleStore;
  private readonly task_client?: OrchestratorTaskClient;
  private readonly trading_policy_service: TradingPolicyService;
  private readonly workspace_store: WorkspaceStore;

  constructor(params: OrchestratorServiceParams) {
    this.artifact_store = params.artifact_store;
    this.lock_store = params.lock_store;
    this.lock_ttl_seconds = params.lock_ttl_seconds;
    this.logger = params.logger;
    this.runtime = params.runtime;
    this.runtime_mode = params.runtime_mode;
    this.run_store = params.run_store;
    this.schedule_store = params.schedule_store;
    this.task_client = params.task_client;
    this.trading_policy_service = params.trading_policy_service;
    this.workspace_store = params.workspace_store;
  }

  getLockStore(): LockStore {
    return this.lock_store;
  }

  getLockTtlSeconds(): number {
    return this.lock_ttl_seconds;
  }

  getRuntimeMode(): OrchestratorRuntimeMode {
    return this.runtime_mode;
  }

  getRunStore(): OrchestratorRunStore {
    return this.run_store;
  }

  getArtifactStore(): WorkspaceArtifactStore {
    return this.artifact_store;
  }

  async listRunsForThread(params: {
    before?: string;
    limit?: number;
    owner_id: string;
    thread_id: string;
  }) {
    await this.requireOwnedSchedule({
      owner_id: params.owner_id,
      thread_id: params.thread_id,
    });
    return this.run_store.listRunsByThread({
      before: params.before,
      limit: params.limit,
      thread_id: params.thread_id,
    });
  }

  async listThreadsForOwner(owner_id: string) {
    const workspaces = await this.workspace_store.listByOwner(owner_id);

    return Promise.all(
      workspaces.map(async (workspace) => {
        const [schedule, latest_run] = await Promise.all([
          this.schedule_store.getSchedule(workspace.thread_id),
          this.run_store.getLatestRunByThread(workspace.thread_id),
        ]);
        return {
          latest_run,
          schedule,
          workspace: {
            base_currency: workspace.base_currency,
            narrative_id: workspace.narrative_id,
            thread_id: workspace.thread_id,
            workspace_id: workspace.workspace_id,
          },
        };
      }),
    );
  }

  async getStatus(params: {
    owner_id: string;
    thread_id: string;
  }) {
    const schedule = await this.requireOwnedSchedule(params);
    const latest_run = await this.run_store.getLatestRunByThread(
      params.thread_id,
    );
    const workspace = await this.workspace_store.getWorkspaceByThread(
      params.thread_id,
    );

    return {
      latest_run,
      runtime_mode: this.runtime_mode,
      schedule,
      trading_policy: this.trading_policy_service.getPolicySummary(),
      workspace,
    };
  }

  async initializeScheduleForWorkspace(input: {
    narrative_id: string;
    thread_id: string;
    workspace_id: string;
  }) {
    const now = new Date();
    const record: OrchestratorScheduleRecord = {
      consecutive_failures: 0,
      created_at: now.toISOString(),
      narrative_id: input.narrative_id,
      next_run_at:
        this.runtime_mode === 'disabled' ? undefined : now.toISOString(),
      status: this.runtime_mode === 'disabled' ? 'paused' : 'active',
      thread_id: input.thread_id,
      updated_at: now.toISOString(),
      workspace_id: input.workspace_id,
    };

    return this.schedule_store.saveSchedule(record);
  }

  async pauseThread(params: {
    owner_id: string;
    thread_id: string;
  }) {
    const schedule = await this.requireOwnedSchedule(params);

    return this.schedule_store.saveSchedule({
      ...schedule,
      next_run_at: undefined,
      status: 'paused',
      updated_at: new Date().toISOString(),
    });
  }

  async resumeThread(params: {
    owner_id: string;
    thread_id: string;
  }) {
    const schedule = await this.requireOwnedSchedule(params);

    if (schedule.status === 'terminal') {
      throw new ConflictError(
        `Thread "${params.thread_id}" is in a terminal state and cannot be resumed.`,
        { schedule_status: schedule.status },
      );
    }

    const now = new Date().toISOString();

    return this.schedule_store.saveSchedule({
      ...schedule,
      next_run_at:
        this.runtime_mode === 'disabled' ? undefined : now,
      status: this.runtime_mode === 'disabled' ? 'paused' : 'active',
      updated_at: now,
    });
  }

  async runThread(params: {
    owner_id?: string;
    thread_id: string;
    trigger: 'manual' | 'scheduler' | 'task';
  }) {
    const schedule = params.owner_id
      ? await this.requireOwnedSchedule({
          owner_id: params.owner_id,
          thread_id: params.thread_id,
        })
      : await this.requireSchedule(params.thread_id);

    if (schedule.status === 'terminal') {
      throw new ConflictError(
        `Thread "${params.thread_id}" is in a terminal state and cannot be run.`,
        { schedule_status: schedule.status },
      );
    }

    const lock_key = `thread:${params.thread_id}:orchestrator-lock`;
    const lock = await this.lock_store.acquire({
      key: lock_key,
      ttl_seconds: this.lock_ttl_seconds,
    });

    if (!lock) {
      this.logger.warn(
        { thread_id: params.thread_id, trigger: params.trigger },
        'orchestrator run skipped: lock busy',
      );
      throw new ConflictError(
        `Orchestrator is already running for thread "${params.thread_id}".`,
        { lock_key },
      );
    }

    try {
      const trading_policy =
        this.trading_policy_service.getPolicySummary();
      const run: OrchestratorRunRecord = {
        run_id: randomUUID(),
        started_at: new Date().toISOString(),
        status: 'started',
        thread_id: params.thread_id,
        trigger: params.trigger,
        workspace_id: schedule.workspace_id,
      };
      await this.run_store.saveRun(run);

      if (this.runtime_mode === 'disabled') {
        await this.appendDisabledRuntimeLog(schedule.workspace_id);
        const ended_at = new Date().toISOString();

        const completed_run: OrchestratorRunRecord = {
          ...run,
          ended_at,
          status: 'skipped',
          summary:
            'Orchestrator run was skipped because the runtime adapter is not wired yet.',
        };
        await this.run_store.saveRun(completed_run);

        const updated_schedule = await this.schedule_store.saveSchedule({
          ...schedule,
          last_run_at: completed_run.ended_at,
          last_error: undefined,
          updated_at: ended_at,
        });

        return {
          run: completed_run,
          schedule: updated_schedule,
          trading_policy,
        };
      }

      if (!this.runtime) {
        throw new Error(
          'Orchestrator runtime is not configured despite runtime_mode not being disabled.',
        );
      }

      try {
        const runtime_result = await this.runtime.execute({
          narrative_id: schedule.narrative_id,
          thread_id: params.thread_id,
          trigger: params.trigger,
          workspace_id: schedule.workspace_id,
        });

        const ended_at = new Date().toISOString();
        const snapshot_keys = await this.snapshotWorkspaceFiles({
          run_id: run.run_id,
          workspace_id: schedule.workspace_id,
        });
        const completed_run: OrchestratorRunRecord = {
          ...run,
          ended_at,
          snapshot_execution_plan_object_key:
            snapshot_keys?.execution_plan,
          snapshot_logs_object_key: snapshot_keys?.logs,
          snapshot_narrative_object_key: snapshot_keys?.narrative,
          snapshot_portfolio_object_key: snapshot_keys?.portfolio,
          status: 'succeeded',
          summary: runtime_result.summary,
        };
        await this.run_store.saveRun(completed_run);

        const narrative_status = await this.readNarrativeStatus(
          schedule.workspace_id,
        );
        const is_terminal =
          narrative_status !== undefined &&
          TERMINAL_NARRATIVE_STATUSES.has(narrative_status);

        const updated_schedule = await this.schedule_store.saveSchedule({
          ...schedule,
          consecutive_failures: 0,
          last_error: undefined,
          last_run_at: completed_run.ended_at,
          last_success_at: completed_run.ended_at,
          next_run_at: is_terminal ? undefined : plusHours(new Date(), 4),
          status: is_terminal ? 'terminal' : 'active',
          updated_at: ended_at,
        });

        if (is_terminal) {
          this.logger.info(
            {
              narrative_status,
              thread_id: params.thread_id,
              workspace_id: schedule.workspace_id,
            },
            'orchestrator schedule moved to terminal state',
          );
        }

        return {
          run: completed_run,
          schedule: updated_schedule,
          trading_policy,
        };
      } catch (error) {
        const ended_at = new Date().toISOString();
        const error_message =
          error instanceof Error ? error.message : String(error);
        const failed_run: OrchestratorRunRecord = {
          ...run,
          ended_at,
          status: 'failed',
          summary: error_message.slice(0, 2000),
        };
        await this.run_store.saveRun(failed_run);

        const updated_schedule = await this.schedule_store.saveSchedule({
          ...schedule,
          consecutive_failures: (schedule.consecutive_failures ?? 0) + 1,
          last_error: error_message.slice(0, 1000),
          last_run_at: failed_run.ended_at,
          next_run_at: plusHours(new Date(), 4),
          status: 'active',
          updated_at: ended_at,
        });

        this.logger.error(
          { err: error, thread_id: params.thread_id },
          'orchestrator run failed',
        );

        return {
          run: failed_run,
          schedule: updated_schedule,
          trading_policy,
        };
      }
    } finally {
      await this.lock_store.release(lock).catch((error: unknown) => {
        this.logger.warn(
          { err: error, thread_id: params.thread_id },
          'failed to release orchestrator lock',
        );
      });
    }
  }

  async sweepDueSchedules() {
    const now = new Date().toISOString();
    const due_schedules = await this.schedule_store.findDueSchedules(now);

    const enqueued: Array<{
      task_name?: string;
      thread_id: string;
      workspace_id: string;
    }> = [];

    if (this.task_client) {
      for (const schedule of due_schedules) {
        try {
          const result = await this.task_client.enqueueOrchestratorRun({
            thread_id: schedule.thread_id,
          });
          enqueued.push({
            task_name: result.name,
            thread_id: schedule.thread_id,
            workspace_id: schedule.workspace_id,
          });
        } catch (error) {
          this.logger.error(
            {
              err: error,
              thread_id: schedule.thread_id,
            },
            'failed to enqueue orchestrator task',
          );
        }
      }
    }

    return {
      due_count: due_schedules.length,
      due_threads: due_schedules.map((schedule) => ({
        next_run_at: schedule.next_run_at,
        thread_id: schedule.thread_id,
        workspace_id: schedule.workspace_id,
      })),
      enqueued,
      runtime_mode: this.runtime_mode,
      swept_at: now,
    };
  }

  private async snapshotWorkspaceFiles(params: {
    run_id: string;
    workspace_id: string;
  }): Promise<
    | {
        execution_plan: string;
        logs: string;
        narrative: string;
        portfolio: string;
      }
    | undefined
  > {
    try {
      const workspace = await this.workspace_store.getWorkspace(
        params.workspace_id,
      );
      if (!workspace) return undefined;

      const targets = [
        {
          file_name: 'narrative.json',
          source_key: workspace.current_narrative_object_key,
        },
        {
          file_name: 'portfolio.json',
          source_key: workspace.current_portfolio_object_key,
        },
        {
          file_name: 'execution_plan.json',
          source_key: workspace.current_execution_plan_object_key,
        },
        {
          file_name: 'logs.json',
          source_key: workspace.current_logs_object_key,
        },
      ];

      const written: Record<string, string> = {};
      for (const target of targets) {
        const source = await this.artifact_store.readTextObject(
          target.source_key,
        );
        const dest_key = target.source_key.replace(
          /\/current\/[^/]+$/,
          `/runs/${params.run_id}/${target.file_name}`,
        );
        await this.artifact_store.writeTextObject({
          content: source.content,
          content_type: source.content_type,
          object_key: dest_key,
        });
        written[target.file_name] = dest_key;
      }

      return {
        execution_plan: written['execution_plan.json'],
        logs: written['logs.json'],
        narrative: written['narrative.json'],
        portfolio: written['portfolio.json'],
      };
    } catch (error) {
      this.logger.warn(
        { err: error, run_id: params.run_id, workspace_id: params.workspace_id },
        'failed to write run snapshot files',
      );
      return undefined;
    }
  }

  private async readNarrativeStatus(
    workspace_id: string,
  ): Promise<NarrativeStatus | undefined> {
    try {
      const workspace = await this.workspace_store.getWorkspace(workspace_id);
      if (!workspace) return undefined;

      const file = await this.artifact_store.readTextObject(
        workspace.current_narrative_object_key,
      );
      const narrative = narrative_json_schema.parse(JSON.parse(file.content));
      return narrative.status;
    } catch (error) {
      this.logger.warn(
        { err: error, workspace_id },
        'failed to read narrative status after orchestrator run',
      );
      return undefined;
    }
  }

  private async appendDisabledRuntimeLog(workspace_id: string) {
    const workspace = await this.workspace_store.getWorkspace(workspace_id);

    if (!workspace) {
      throw new NotFoundError(
        `Workspace "${workspace_id}" was not found.`,
      );
    }

    let logs: LogsJson;
    try {
      const current_logs = await this.artifact_store.readTextObject(
        workspace.current_logs_object_key,
      );
      logs = JSON.parse(current_logs.content) as LogsJson;
    } catch {
      logs = create_empty_logs();
    }

    logs.entries.push({
      actor: 'orchestrator',
      event: 'ORCHESTRATOR_RUNTIME_DISABLED',
      level: 'WARN',
      log_id: randomUUID(),
      message:
        'Run requested, but orchestrator runtime integration is not wired yet.',
      metadata: {
        runtime_mode: this.runtime_mode,
      },
      timestamp: new Date().toISOString(),
    });

    await this.artifact_store.writeTextObject({
      content: JSON.stringify(logs, null, 2),
      content_type: 'application/json',
      object_key: workspace.current_logs_object_key,
    });
  }

  private async requireSchedule(thread_id: string) {
    const schedule = await this.schedule_store.getSchedule(thread_id);

    if (!schedule) {
      throw new NotFoundError(
        `No orchestrator schedule exists for thread "${thread_id}".`,
      );
    }

    return schedule;
  }

  private async requireOwnedSchedule(params: {
    owner_id: string;
    thread_id: string;
  }) {
    const schedule = await this.requireSchedule(params.thread_id);
    const workspace = await this.workspace_store.getWorkspace(
      schedule.workspace_id,
    );

    if (!workspace || workspace.owner_id !== params.owner_id) {
      throw new NotFoundError(
        `No orchestrator schedule exists for thread "${params.thread_id}".`,
      );
    }

    return schedule;
  }
}
