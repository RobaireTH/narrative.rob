import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { DeepAgentsOrchestratorRuntime } from '../../src/application/orchestrator/runtime';
import { InMemoryBayseConnectionStore } from '../../src/application/bayse/credentials-service';
import { InMemoryWorkspaceStore } from '../../src/application/workspaces/store';
import { InMemoryWorkspaceArtifactStore } from '../../src/application/workspaces/artifact-store';
import { UpstreamUnavailableError } from '../../src/application/common/errors';

const silent_logger = pino({ level: 'silent' });

function buildRuntime(overrides: Partial<{ fallback: boolean }> = {}) {
  const workspace_store = new InMemoryWorkspaceStore();
  const artifact_store = new InMemoryWorkspaceArtifactStore();
  const bayse_connection_store = new InMemoryBayseConnectionStore();

  const now = new Date().toISOString();
  void workspace_store.saveWorkspace({
    base_currency: 'USD',
    created_at: now,
    current_execution_plan_object_key: 'ws/1/current/execution_plan.json',
    current_logs_object_key: 'ws/1/current/logs.json',
    current_narrative_object_key: 'ws/1/current/narrative.json',
    current_portfolio_object_key: 'ws/1/current/portfolio.json',
    narrative_id: 'n-1',
    owner_id: 'owner-runtime',
    portfolio_id: 'p-1',
    thread_id: 't-1',
    updated_at: now,
    version: 1,
    workspace_id: 'ws-1',
  });
  void artifact_store.writeTextObject({
    content: '{}',
    content_type: 'application/json',
    object_key: 'ws/1/current/narrative.json',
  });
  void artifact_store.writeTextObject({
    content: '{}',
    content_type: 'application/json',
    object_key: 'ws/1/current/portfolio.json',
  });
  void artifact_store.writeTextObject({
    content: '{}',
    content_type: 'application/json',
    object_key: 'ws/1/current/execution_plan.json',
  });
  void artifact_store.writeTextObject({
    content: '{"entries":[]}',
    content_type: 'application/json',
    object_key: 'ws/1/current/logs.json',
  });

  return new DeepAgentsOrchestratorRuntime({
    anthropic_api_key: 'test-key',
    artifact_store,
    bayse_base_url: 'http://bayse.test',
    bayse_connection_store,
    bayse_fallback_public_key: overrides.fallback ? 'pk_fb' : undefined,
    bayse_fallback_secret_key: overrides.fallback ? 'sk_fb' : undefined,
    bayse_timeout_ms: 5000,
    executor_model_id: 'claude-haiku-4-5-20251001',
    logger: silent_logger,
    pm_model_id: 'claude-haiku-4-5-20251001',
    researcher_model_id: 'claude-sonnet-4-6',
    supervisor_model_id: 'claude-sonnet-4-6',
    workspace_store,
  });
}

describe('DeepAgentsOrchestratorRuntime per-user Bayse auth gate', () => {
  it('throws UpstreamUnavailableError when owner has no Bayse connection and no fallback', async () => {
    const runtime = buildRuntime({ fallback: false });

    await expect(
      runtime.execute({
        narrative_id: 'n-1',
        thread_id: 't-1',
        trigger: 'manual',
        workspace_id: 'ws-1',
      }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});
