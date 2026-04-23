import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers';
import type { NarrativeJson } from '../../src/domain/narrative/schema';

const OWNER_TOKEN = 'owner-orch-1';
const OWNER_HEADER = { authorization: `Bearer ${OWNER_TOKEN}` } as const;

function buildNarrative(narrator_id: string): NarrativeJson {
  const now = new Date().toISOString();
  return {
    narrative_id: 'narr-int-1',
    narrator_id,
    title: 'Integration test narrative',
    status: 'ACTIVE',
    thesis_text: 'Testing end-to-end orchestrator wiring.',
    failure_conditions: ['Thesis invalidated by disconfirming evidence'],
    timestamps: { created_at: now, updated_at: now, expires_at: now },
    events: [
      {
        event_id: 'ev-int-1',
        label: 'Test event',
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

describe('orchestrator HTTP surface (memory storage, disabled runtime)', () => {
  async function primedApp() {
    const harness = buildTestApp({ ALLOW_NARRATIVE_IMPORT: 'true' });
    const narrative = buildNarrative(OWNER_TOKEN);
    await harness.services.narrative_service.importNarrative({
      narrative,
      owner_id: OWNER_TOKEN,
    });
    const bootstrap =
      await harness.services.workspace_bootstrap_service.bootstrapWorkspace({
        base_currency: 'USD',
        narrative_id: narrative.narrative_id,
        owner_id: OWNER_TOKEN,
        thread_id: 'thread-int-1',
      });
    return { ...harness, bootstrap };
  }

  it('rejects orchestrator routes without auth', async () => {
    const { app } = buildTestApp();
    const response = await request(app).get(
      '/api/orchestrator/threads/thread-int-1/status',
    );
    expect(response.status).toBe(401);
  });

  it('returns status, then pauses and resumes a thread', async () => {
    const { app } = await primedApp();

    const status = await request(app)
      .get('/api/orchestrator/threads/thread-int-1/status')
      .set(OWNER_HEADER);

    expect(status.status).toBe(200);
    expect(status.body.data.schedule.thread_id).toBe('thread-int-1');
    expect(status.body.data.runtime_mode).toBe('disabled');

    const pause = await request(app)
      .post('/api/orchestrator/threads/thread-int-1/pause')
      .set(OWNER_HEADER);
    expect(pause.status).toBe(200);
    expect(pause.body.data.status).toBe('paused');

    const resume = await request(app)
      .post('/api/orchestrator/threads/thread-int-1/resume')
      .set(OWNER_HEADER);
    expect(resume.status).toBe(200);
  });

  it('manual runThread records a skipped run while runtime is disabled', async () => {
    const { app } = await primedApp();

    const run = await request(app)
      .post('/api/orchestrator/threads/thread-int-1/run')
      .set(OWNER_HEADER);

    expect(run.status).toBe(200);
    expect(run.body.data.run.status).toBe('skipped');
    expect(run.body.data.run.trigger).toBe('manual');
  });

  it('internal sweep endpoint requires INTERNAL_TOKEN', async () => {
    const { app } = await primedApp();

    const denied = await request(app)
      .post('/api/orchestrator/internal/scheduler/sweep')
      .send({});
    expect(denied.status).toBe(401);

    const allowed = await request(app)
      .post('/api/orchestrator/internal/scheduler/sweep')
      .set('x-internal-token', 'test-internal-token')
      .send({});
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.runtime_mode).toBe('disabled');
  });
});
