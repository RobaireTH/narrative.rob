import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { InMemoryNarrativeStore } from '../../src/application/narratives/store';
import { InMemoryWorkspaceStore } from '../../src/application/workspaces/store';
import { InMemoryWorkspaceArtifactStore } from '../../src/application/workspaces/artifact-store';
import { InMemoryOrchestratorScheduleStore } from '../../src/application/orchestrator/schedule-store';
import { InMemoryOrchestratorRunStore } from '../../src/application/orchestrator/run-store';
import { OrchestratorService } from '../../src/application/orchestrator/service';
import { TradingPolicyService } from '../../src/application/trading-policy/service';
import { WorkspaceBootstrapService } from '../../src/application/workspaces/service';
import { InMemoryLockStore } from '../../src/infrastructure/redis/lock-store';
import type { NarrativeJson } from '../../src/domain/narrative/schema';

const silent_logger = pino({ level: 'silent' });

function makeNarrative(owner_id: string): NarrativeJson {
  const now = new Date().toISOString();
  return {
    narrative_id: 'narr-1',
    narrator_id: owner_id,
    title: 'Test',
    status: 'ACTIVE',
    thesis_text: 'Test thesis.',
    failure_conditions: ['Bad happens'],
    timestamps: { created_at: now, updated_at: now, expires_at: now },
    events: [
      {
        event_id: 'ev-1',
        label: 'Event 1',
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
}

function makeServices(owner_id: string) {
  const narrative_store = new InMemoryNarrativeStore();
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
  const orchestrator_service = new OrchestratorService({
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
  const bootstrap_service = new WorkspaceBootstrapService({
    artifact_object_prefix: 'workspaces',
    artifact_store,
    logger: silent_logger,
    narrative_store,
    orchestrator_service,
    workspace_store,
  });

  const narrative = makeNarrative(owner_id);
  const now = new Date().toISOString();
  void narrative_store.saveNarrative({
    created_at: now,
    narrative,
    owner_id,
    updated_at: now,
  });

  return { bootstrap_service, narrative };
}

describe('WorkspaceBootstrapService', () => {
  it('creates a workspace on first call', async () => {
    const owner_id = 'owner-1';
    const { bootstrap_service, narrative } = makeServices(owner_id);

    const result = await bootstrap_service.bootstrapWorkspace({
      narrative_id: narrative.narrative_id,
      owner_id,
      thread_id: 'thread-1',
    });

    expect(result.reused).toBe(false);
    expect(result.workspace.narrative_id).toBe(narrative.narrative_id);
  });

  it('is idempotent for the same thread + narrative + owner', async () => {
    const owner_id = 'owner-1';
    const { bootstrap_service, narrative } = makeServices(owner_id);

    const first = await bootstrap_service.bootstrapWorkspace({
      narrative_id: narrative.narrative_id,
      owner_id,
      thread_id: 'thread-1',
    });
    const second = await bootstrap_service.bootstrapWorkspace({
      narrative_id: narrative.narrative_id,
      owner_id,
      thread_id: 'thread-1',
    });

    expect(second.reused).toBe(true);
    expect(second.workspace.workspace_id).toBe(first.workspace.workspace_id);
  });
});
