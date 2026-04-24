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
import { PortfolioService } from '../../src/application/portfolio/service';
import {
  NotFoundError,
  ValidationAppError,
} from '../../src/application/common/errors';
import { logs_json_schema } from '../../src/domain/logs/schema';
import { portfolio_schema } from '../../src/domain/portfolio/schema';
import type { NarrativeJson } from '../../src/domain/narrative/schema';

const silent_logger = pino({ level: 'silent' });

function makeNarrative(owner_id: string): NarrativeJson {
  const now = new Date().toISOString();
  return {
    narrative_id: 'narr-p-1',
    narrator_id: owner_id,
    title: 'Portfolio test',
    status: 'ACTIVE',
    thesis_text: 'test',
    failure_conditions: ['falsified'],
    timestamps: { created_at: now, updated_at: now, expires_at: now },
    events: [
      {
        event_id: 'ev-p-1',
        label: 'E1',
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

async function primeWorkspace(owner_id: string, initial_liquidity = 100) {
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
  await narrative_store.saveNarrative({
    created_at: now,
    narrative,
    owner_id,
    updated_at: now,
  });

  const boot = await bootstrap_service.bootstrapWorkspace({
    initial_master_liquidity: initial_liquidity,
    narrative_id: narrative.narrative_id,
    owner_id,
    thread_id: 'thread-p-1',
  });

  const portfolio_service = new PortfolioService({
    artifact_store,
    logger: silent_logger,
    workspace_store,
  });

  return {
    artifact_store,
    portfolio_service,
    workspace: boot.workspace,
  };
}

describe('PortfolioService.deposit', () => {
  it('adds to unallocated_master_liquidity and appends a log entry', async () => {
    const { artifact_store, portfolio_service, workspace } =
      await primeWorkspace('owner-p-1', 100);

    const result = await portfolio_service.deposit({
      amount: 250,
      note: 'seed capital',
      owner_id: 'owner-p-1',
      workspace_id: workspace.workspace_id,
    });

    expect(result.portfolio.unallocated_master_liquidity).toBe(350);

    const portfolio_read = await artifact_store.readTextObject(
      workspace.current_portfolio_object_key,
    );
    const persisted_portfolio = portfolio_schema.parse(
      JSON.parse(portfolio_read.content),
    );
    expect(persisted_portfolio.unallocated_master_liquidity).toBe(350);

    const logs_read = await artifact_store.readTextObject(
      workspace.current_logs_object_key,
    );
    const logs = logs_json_schema.parse(JSON.parse(logs_read.content));
    const deposit_entry = logs.entries.find(
      (e) => e.event === 'PORTFOLIO_DEPOSIT',
    );
    expect(deposit_entry).toBeDefined();
    expect(deposit_entry?.log_id).toBe(result.log_id);
    expect(deposit_entry?.metadata?.amount).toBe(250);
    expect(deposit_entry?.metadata?.new_balance).toBe(350);
  });

  it('stacks deposits idempotently across calls', async () => {
    const { portfolio_service, workspace } = await primeWorkspace(
      'owner-p-2',
      0,
    );

    await portfolio_service.deposit({
      amount: 100,
      owner_id: 'owner-p-2',
      workspace_id: workspace.workspace_id,
    });
    const second = await portfolio_service.deposit({
      amount: 50,
      owner_id: 'owner-p-2',
      workspace_id: workspace.workspace_id,
    });

    expect(second.portfolio.unallocated_master_liquidity).toBe(150);
  });

  it('rejects zero and negative amounts', async () => {
    const { portfolio_service, workspace } = await primeWorkspace(
      'owner-p-3',
      0,
    );

    await expect(
      portfolio_service.deposit({
        amount: 0,
        owner_id: 'owner-p-3',
        workspace_id: workspace.workspace_id,
      }),
    ).rejects.toBeInstanceOf(ValidationAppError);

    await expect(
      portfolio_service.deposit({
        amount: -5,
        owner_id: 'owner-p-3',
        workspace_id: workspace.workspace_id,
      }),
    ).rejects.toBeInstanceOf(ValidationAppError);
  });

  it('rejects deposits above the ceiling', async () => {
    const { portfolio_service, workspace } = await primeWorkspace(
      'owner-p-4',
      0,
    );

    await expect(
      portfolio_service.deposit({
        amount: 1_000_000_001,
        owner_id: 'owner-p-4',
        workspace_id: workspace.workspace_id,
      }),
    ).rejects.toBeInstanceOf(ValidationAppError);
  });

  it('rejects when the caller does not own the workspace', async () => {
    const { portfolio_service, workspace } = await primeWorkspace(
      'owner-p-5',
      0,
    );

    await expect(
      portfolio_service.deposit({
        amount: 10,
        owner_id: 'someone-else',
        workspace_id: workspace.workspace_id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
