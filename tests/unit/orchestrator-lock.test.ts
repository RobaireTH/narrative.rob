import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { InMemoryWorkspaceArtifactStore } from '../../src/application/workspaces/artifact-store';
import { InMemoryWorkspaceStore } from '../../src/application/workspaces/store';
import { InMemoryOrchestratorScheduleStore } from '../../src/application/orchestrator/schedule-store';
import { InMemoryOrchestratorRunStore } from '../../src/application/orchestrator/run-store';
import { OrchestratorService } from '../../src/application/orchestrator/service';
import { TradingPolicyService } from '../../src/application/trading-policy/service';
import { InMemoryLockStore } from '../../src/infrastructure/redis/lock-store';
import { ConflictError } from '../../src/application/common/errors';

const silent_logger = pino({ level: 'silent' });

async function makeService(options: { lock_store?: InMemoryLockStore } = {}) {
  const artifact_store = new InMemoryWorkspaceArtifactStore();
  const workspace_store = new InMemoryWorkspaceStore();
  const schedule_store = new InMemoryOrchestratorScheduleStore();
  const run_store = new InMemoryOrchestratorRunStore();
  const lock_store = options.lock_store ?? new InMemoryLockStore();
  const trading_policy_service = new TradingPolicyService({
    default_mode: 'paper',
    enable_live_trading: false,
    enable_paper_trading: true,
  });

  const service = new OrchestratorService({
    artifact_store,
    lock_store,
    lock_ttl_seconds: 60,
    logger: silent_logger,
    runtime_mode: 'disabled',
    run_store,
    schedule_store,
    trading_policy_service,
    workspace_store,
  });

  const now = new Date().toISOString();
  const workspace_id = 'ws-1';
  const thread_id = 'thread-1';

  await workspace_store.saveWorkspace({
    base_currency: 'USD',
    created_at: now,
    current_execution_plan_object_key: 'a',
    current_logs_object_key: 'b',
    current_narrative_object_key: 'c',
    current_portfolio_object_key: 'd',
    narrative_id: 'n-1',
    owner_id: 'owner-1',
    portfolio_id: 'p-1',
    thread_id,
    updated_at: now,
    version: 1,
    workspace_id,
  });

  await schedule_store.saveSchedule({
    consecutive_failures: 0,
    created_at: now,
    narrative_id: 'n-1',
    status: 'active',
    thread_id,
    updated_at: now,
    workspace_id,
  });

  return { lock_store, service, thread_id };
}

describe('OrchestratorService lock acquisition', () => {
  it('rejects a second concurrent run on the same thread', async () => {
    const lock_store = new InMemoryLockStore();
    const { service, thread_id } = await makeService({ lock_store });

    // Pre-acquire the lock to simulate a run already in progress.
    await lock_store.acquire({
      key: `thread:${thread_id}:orchestrator-lock`,
      ttl_seconds: 60,
    });

    await expect(
      service.runThread({
        owner_id: 'owner-1',
        thread_id,
        trigger: 'manual',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('releases the lock after a successful run', async () => {
    const lock_store = new InMemoryLockStore();
    const { service, thread_id } = await makeService({ lock_store });

    await service.runThread({
      owner_id: 'owner-1',
      thread_id,
      trigger: 'manual',
    });

    const next = await lock_store.acquire({
      key: `thread:${thread_id}:orchestrator-lock`,
      ttl_seconds: 60,
    });
    expect(next).not.toBeNull();
  });
});
