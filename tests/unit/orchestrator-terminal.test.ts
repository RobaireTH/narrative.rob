import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { OrchestratorService } from '../../src/application/orchestrator/service';
import { TradingPolicyService } from '../../src/application/trading-policy/service';
import { InMemoryWorkspaceStore } from '../../src/application/workspaces/store';
import { InMemoryWorkspaceArtifactStore } from '../../src/application/workspaces/artifact-store';
import { InMemoryOrchestratorScheduleStore } from '../../src/application/orchestrator/schedule-store';
import { InMemoryOrchestratorRunStore } from '../../src/application/orchestrator/run-store';
import { InMemoryLockStore } from '../../src/infrastructure/redis/lock-store';
import { ConflictError } from '../../src/application/common/errors';
import type { OrchestratorRuntime } from '../../src/application/orchestrator/runtime';

const silent_logger = pino({ level: 'silent' });

const baseline_narrative = {
  narrative_id: 'narr-term-1',
  narrator_id: 'owner-term-1',
  title: 'Terminal test',
  status: 'ACTIVE',
  thesis_text: 'test',
  failure_conditions: ['falsified'],
  timestamps: {
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    expires_at: '2026-05-01T00:00:00.000Z',
  },
  events: [
    {
      event_id: 'ev-term-1',
      label: 'E',
      narrative_weight: 1,
      depends_on: [],
      status: 'PENDING',
      probability: 0.5,
      conviction: 0.5,
      belief: 0.25,
      disbelief: 0.25,
      uncertainty: 0.5,
      base_rate: 0.5,
    },
  ],
};

async function buildHarness() {
  const workspace_store = new InMemoryWorkspaceStore();
  const artifact_store = new InMemoryWorkspaceArtifactStore();
  const schedule_store = new InMemoryOrchestratorScheduleStore();
  const run_store = new InMemoryOrchestratorRunStore();
  const lock_store = new InMemoryLockStore();
  const trading_policy_service = new TradingPolicyService({
    default_mode: 'paper',
    enable_live_trading: false,
    enable_paper_trading: true,
  });

  const now = new Date().toISOString();
  await workspace_store.saveWorkspace({
    base_currency: 'USD',
    created_at: now,
    current_execution_plan_object_key: 'ws/term/execution_plan.json',
    current_logs_object_key: 'ws/term/logs.json',
    current_narrative_object_key: 'ws/term/narrative.json',
    current_portfolio_object_key: 'ws/term/portfolio.json',
    narrative_id: 'narr-term-1',
    owner_id: 'owner-term-1',
    portfolio_id: 'p-1',
    thread_id: 'thread-term-1',
    updated_at: now,
    version: 1,
    workspace_id: 'ws-term-1',
  });
  await artifact_store.writeTextObject({
    content: JSON.stringify(baseline_narrative),
    content_type: 'application/json',
    object_key: 'ws/term/narrative.json',
  });
  await schedule_store.saveSchedule({
    consecutive_failures: 0,
    created_at: now,
    narrative_id: 'narr-term-1',
    next_run_at: now,
    status: 'active',
    thread_id: 'thread-term-1',
    updated_at: now,
    workspace_id: 'ws-term-1',
  });

  const make_runtime = (
    mutator: (existing: typeof baseline_narrative) => typeof baseline_narrative,
  ): OrchestratorRuntime => ({
    async execute() {
      const next = mutator(baseline_narrative);
      await artifact_store.writeTextObject({
        content: JSON.stringify(next),
        content_type: 'application/json',
        object_key: 'ws/term/narrative.json',
      });
      return { files_written: ['narrative.json'], summary: 'ok' };
    },
  });

  const make_service = (runtime: OrchestratorRuntime) =>
    new OrchestratorService({
      artifact_store,
      lock_store,
      lock_ttl_seconds: 60,
      logger: silent_logger,
      runtime,
      runtime_mode: 'deepagents',
      run_store,
      schedule_store,
      trading_policy_service,
      workspace_store,
    });

  return {
    artifact_store,
    make_runtime,
    make_service,
    schedule_store,
    workspace_store,
  };
}

describe('OrchestratorService terminal state auto-pause', () => {
  it('moves schedule to terminal when narrative.json is FAILED after a run', async () => {
    const harness = await buildHarness();
    const runtime = harness.make_runtime((n) => ({ ...n, status: 'FAILED' }));
    const service = harness.make_service(runtime);

    const result = await service.runThread({
      owner_id: 'owner-term-1',
      thread_id: 'thread-term-1',
      trigger: 'manual',
    });

    expect(result.run.status).toBe('succeeded');
    expect(result.schedule.status).toBe('terminal');
    expect(result.schedule.next_run_at).toBeUndefined();
  });

  it('keeps schedule active when narrative is still ACTIVE', async () => {
    const harness = await buildHarness();
    const runtime = harness.make_runtime((n) => n);
    const service = harness.make_service(runtime);

    const result = await service.runThread({
      owner_id: 'owner-term-1',
      thread_id: 'thread-term-1',
      trigger: 'manual',
    });

    expect(result.schedule.status).toBe('active');
    expect(result.schedule.next_run_at).toBeDefined();
  });

  it('rejects manual runs once the schedule is terminal', async () => {
    const harness = await buildHarness();
    const runtime = harness.make_runtime((n) => ({ ...n, status: 'EXPIRED' }));
    const service = harness.make_service(runtime);

    await service.runThread({
      owner_id: 'owner-term-1',
      thread_id: 'thread-term-1',
      trigger: 'manual',
    });

    await expect(
      service.runThread({
        owner_id: 'owner-term-1',
        thread_id: 'thread-term-1',
        trigger: 'manual',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects resume on a terminal thread', async () => {
    const harness = await buildHarness();
    const runtime = harness.make_runtime((n) => ({ ...n, status: 'COMPLETED' }));
    const service = harness.make_service(runtime);

    await service.runThread({
      owner_id: 'owner-term-1',
      thread_id: 'thread-term-1',
      trigger: 'manual',
    });

    await expect(
      service.resumeThread({
        owner_id: 'owner-term-1',
        thread_id: 'thread-term-1',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
