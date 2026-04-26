import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { OrchestratorService } from '../../src/application/orchestrator/service';
import { TradingPolicyService } from '../../src/application/trading-policy/service';
import { InMemoryWorkspaceStore } from '../../src/application/workspaces/store';
import { InMemoryWorkspaceArtifactStore } from '../../src/application/workspaces/artifact-store';
import { InMemoryOrchestratorScheduleStore } from '../../src/application/orchestrator/schedule-store';
import { InMemoryOrchestratorRunStore } from '../../src/application/orchestrator/run-store';
import { InMemoryLockStore } from '../../src/infrastructure/redis/lock-store';
import type { OrchestratorRuntime } from '../../src/application/orchestrator/runtime';

const silent_logger = pino({ level: 'silent' });

const baseline_narrative = {
  narrative_id: 'narr-snap-1',
  narrator_id: 'owner-snap-1',
  title: 'Snapshot test',
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
      event_id: 'ev-snap-1',
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
    current_execution_plan_object_key: 'workspaces/ws-snap/current/execution_plan.json',
    current_logs_object_key: 'workspaces/ws-snap/current/logs.json',
    current_narrative_object_key: 'workspaces/ws-snap/current/narrative.json',
    current_portfolio_object_key: 'workspaces/ws-snap/current/portfolio.json',
    narrative_id: 'narr-snap-1',
    owner_id: 'owner-snap-1',
    portfolio_id: 'p-1',
    thread_id: 'thread-snap-1',
    updated_at: now,
    version: 1,
    workspace_id: 'ws-snap-1',
  });

  await artifact_store.writeTextObject({
    content: JSON.stringify(baseline_narrative),
    content_type: 'application/json',
    object_key: 'workspaces/ws-snap/current/narrative.json',
  });
  await artifact_store.writeTextObject({
    content: JSON.stringify({ unallocated_master_liquidity: 100 }),
    content_type: 'application/json',
    object_key: 'workspaces/ws-snap/current/portfolio.json',
  });
  await artifact_store.writeTextObject({
    content: JSON.stringify({ summary: 'plan' }),
    content_type: 'application/json',
    object_key: 'workspaces/ws-snap/current/execution_plan.json',
  });
  await artifact_store.writeTextObject({
    content: JSON.stringify({ entries: [] }),
    content_type: 'application/json',
    object_key: 'workspaces/ws-snap/current/logs.json',
  });

  await schedule_store.saveSchedule({
    consecutive_failures: 0,
    created_at: now,
    narrative_id: 'narr-snap-1',
    next_run_at: now,
    status: 'active',
    thread_id: 'thread-snap-1',
    updated_at: now,
    workspace_id: 'ws-snap-1',
  });

  const runtime: OrchestratorRuntime = {
    async execute() {
      return { files_written: ['narrative.json'], summary: 'ok' };
    },
  };

  const service = new OrchestratorService({
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

  return { artifact_store, run_store, service };
}

describe('OrchestratorService run snapshots', () => {
  it('writes 4 snapshot files under runs/<run_id>/ after a successful run', async () => {
    const { artifact_store, run_store, service } = await buildHarness();

    const result = await service.runThread({
      owner_id: 'owner-snap-1',
      thread_id: 'thread-snap-1',
      trigger: 'manual',
    });

    expect(result.run.status).toBe('succeeded');
    const run_id = result.run.run_id;

    const expected_keys = {
      execution_plan: `workspaces/ws-snap/runs/${run_id}/execution_plan.json`,
      logs: `workspaces/ws-snap/runs/${run_id}/logs.json`,
      narrative: `workspaces/ws-snap/runs/${run_id}/narrative.json`,
      portfolio: `workspaces/ws-snap/runs/${run_id}/portfolio.json`,
    };

    expect(result.run.snapshot_narrative_object_key).toBe(expected_keys.narrative);
    expect(result.run.snapshot_portfolio_object_key).toBe(expected_keys.portfolio);
    expect(result.run.snapshot_execution_plan_object_key).toBe(
      expected_keys.execution_plan,
    );
    expect(result.run.snapshot_logs_object_key).toBe(expected_keys.logs);

    const persisted = await run_store.getRunById(run_id);
    expect(persisted?.snapshot_narrative_object_key).toBe(expected_keys.narrative);

    const snap_narrative = await artifact_store.readTextObject(
      expected_keys.narrative,
    );
    expect(JSON.parse(snap_narrative.content).narrative_id).toBe('narr-snap-1');

    const snap_portfolio = await artifact_store.readTextObject(
      expected_keys.portfolio,
    );
    expect(JSON.parse(snap_portfolio.content).unallocated_master_liquidity).toBe(
      100,
    );
  });
});
