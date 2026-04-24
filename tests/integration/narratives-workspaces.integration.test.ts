import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers';
import type { NarrativeJson } from '../../src/domain/narrative/schema';

const OWNER_TOKEN = 'owner-nw-1';
const OTHER_TOKEN = 'owner-nw-2';
const AUTH = { authorization: `Bearer ${OWNER_TOKEN}` } as const;

function makeNarrative(narrator_id: string, id = 'narr-nw-1'): NarrativeJson {
  const now = new Date().toISOString();
  return {
    narrative_id: id,
    narrator_id,
    title: `Narrative ${id}`,
    status: 'ACTIVE',
    thesis_text: 'test thesis',
    failure_conditions: ['falsified'],
    timestamps: { created_at: now, updated_at: now, expires_at: now },
    events: [
      {
        event_id: `${id}-ev-1`,
        label: 'Event',
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

async function seededApp() {
  const harness = buildTestApp({ ALLOW_NARRATIVE_IMPORT: 'true' });

  await harness.services.narrative_service.importNarrative({
    narrative: makeNarrative(OWNER_TOKEN, 'narr-a'),
    owner_id: OWNER_TOKEN,
  });
  await harness.services.narrative_service.importNarrative({
    narrative: makeNarrative(OWNER_TOKEN, 'narr-b'),
    owner_id: OWNER_TOKEN,
  });
  await harness.services.narrative_service.importNarrative({
    narrative: makeNarrative(OTHER_TOKEN, 'narr-other'),
    owner_id: OTHER_TOKEN,
  });

  const boot_a =
    await harness.services.workspace_bootstrap_service.bootstrapWorkspace({
      initial_master_liquidity: 100,
      narrative_id: 'narr-a',
      owner_id: OWNER_TOKEN,
      thread_id: 'thread-a',
    });

  return { ...harness, workspace_a: boot_a.workspace };
}

describe('list + deposit HTTP surface', () => {
  it('GET /api/narratives returns only the caller\'s narratives', async () => {
    const { app } = await seededApp();

    const response = await request(app).get('/api/narratives').set(AUTH);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    const ids = response.body.data.map((n: { narrative: { narrative_id: string } }) =>
      n.narrative.narrative_id,
    );
    expect(ids).toEqual(expect.arrayContaining(['narr-a', 'narr-b']));
    expect(ids).not.toContain('narr-other');
  });

  it('GET /api/narratives without auth returns 401', async () => {
    const { app } = buildTestApp();
    const response = await request(app).get('/api/narratives');
    expect(response.status).toBe(401);
  });

  it('GET /api/workspaces returns the caller\'s workspaces', async () => {
    const { app } = await seededApp();

    const response = await request(app).get('/api/workspaces').set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].narrative_id).toBe('narr-a');
  });

  it('POST /api/workspaces/:id/deposit bumps master liquidity', async () => {
    const { app, services, workspace_a } = await seededApp();

    const response = await request(app)
      .post(`/api/workspaces/${workspace_a.workspace_id}/deposit`)
      .set(AUTH)
      .send({ amount: 500, note: 'seed' });

    expect(response.status).toBe(200);
    expect(response.body.data.portfolio.unallocated_master_liquidity).toBe(600);

    const file =
      await services.workspace_bootstrap_service.getWorkspaceFile({
        file_name: 'portfolio',
        owner_id: OWNER_TOKEN,
        workspace_id: workspace_a.workspace_id,
      });
    const parsed = JSON.parse(file.content);
    expect(parsed.unallocated_master_liquidity).toBe(600);
  });

  it('rejects negative/zero deposits with 400', async () => {
    const { app, workspace_a } = await seededApp();

    const zero = await request(app)
      .post(`/api/workspaces/${workspace_a.workspace_id}/deposit`)
      .set(AUTH)
      .send({ amount: 0 });
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .post(`/api/workspaces/${workspace_a.workspace_id}/deposit`)
      .set(AUTH)
      .send({ amount: -10 });
    expect(negative.status).toBe(400);
  });

  it('refuses a deposit on a workspace the caller does not own', async () => {
    const { app, workspace_a } = await seededApp();

    const response = await request(app)
      .post(`/api/workspaces/${workspace_a.workspace_id}/deposit`)
      .set({ authorization: `Bearer ${OTHER_TOKEN}` })
      .send({ amount: 10 });

    expect(response.status).toBe(404);
  });
});

describe('compiler and orchestrator list endpoints', () => {
  it('GET /api/compiler/threads returns only caller\'s threads', async () => {
    const { app, services } = buildTestApp();

    const mine = await services.compiler_service.createThread({
      narrator_id: OWNER_TOKEN,
      owner_id: OWNER_TOKEN,
    });
    await services.compiler_service.createThread({
      narrator_id: OTHER_TOKEN,
      owner_id: OTHER_TOKEN,
    });

    const response = await request(app)
      .get('/api/compiler/threads')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].thread_id).toBe(mine.thread_id);
  });

  it('GET /api/orchestrator/threads joins workspace + schedule for caller', async () => {
    const { app, workspace_a } = await seededApp();

    const response = await request(app)
      .get('/api/orchestrator/threads')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].workspace.workspace_id).toBe(
      workspace_a.workspace_id,
    );
    expect(response.body.data[0].schedule.thread_id).toBe('thread-a');
  });
});
