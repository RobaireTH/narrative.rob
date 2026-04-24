import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';

import { buildTestApp } from './helpers';
import type { NarrativeJson } from '../../src/domain/narrative/schema';

const BAYSE_HOST = 'http://bayse.test';
const OWNER_TOKEN = 'owner-brs-1';
const AUTH = { authorization: `Bearer ${OWNER_TOKEN}` } as const;

function makeNarrative(narrator_id: string): NarrativeJson {
  const now = new Date().toISOString();
  return {
    narrative_id: 'narr-brs-1',
    narrator_id,
    title: 'Runs history narrative',
    status: 'ACTIVE',
    thesis_text: 'test',
    failure_conditions: ['falsified'],
    timestamps: { created_at: now, updated_at: now, expires_at: now },
    events: [
      {
        event_id: 'ev-brs-1',
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

describe('bayse wallet balance', () => {
  const { app, services } = buildTestApp();

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect(/^127\.0\.0\.1/);
  });
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('returns 404 when the caller has no Bayse connection', async () => {
    const response = await request(app)
      .get('/api/bayse/accounts/me/balance')
      .set(AUTH);
    expect(response.status).toBe(404);
  });

  it('proxies GET /v1/wallet/assets with session headers', async () => {
    nock(BAYSE_HOST)
      .post('/v1/user/login')
      .reply(200, {
        deviceId: 'dev-1',
        token: 'session-1',
        userId: 'bayse-user-1',
      });

    await services.bayse_bootstrap_service.connectAccount({
      email: 'user@example.com',
      owner_id: OWNER_TOKEN,
      password: 'pw',
    });

    nock(BAYSE_HOST)
      .get('/v1/wallet/assets')
      .matchHeader('x-auth-token', 'session-1')
      .matchHeader('x-device-id', 'dev-1')
      .reply(200, { assets: [{ currency: 'USD', balance: 500 }] });

    const response = await request(app)
      .get('/api/bayse/accounts/me/balance')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data.assets).toEqual({
      assets: [{ currency: 'USD', balance: 500 }],
    });
    expect(response.body.data.fetched_at).toBeTypeOf('string');
  });
});

describe('orchestrator runs history', () => {
  async function primed() {
    const harness = buildTestApp({ ALLOW_NARRATIVE_IMPORT: 'true' });
    const narrative = makeNarrative(OWNER_TOKEN);
    await harness.services.narrative_service.importNarrative({
      narrative,
      owner_id: OWNER_TOKEN,
    });
    await harness.services.workspace_bootstrap_service.bootstrapWorkspace({
      narrative_id: narrative.narrative_id,
      owner_id: OWNER_TOKEN,
      thread_id: 'thread-brs-1',
    });

    for (let i = 0; i < 3; i += 1) {
      await harness.services.orchestrator_service.runThread({
        owner_id: OWNER_TOKEN,
        thread_id: 'thread-brs-1',
        trigger: 'manual',
      });
    }

    return harness;
  }

  it('lists runs newest-first', async () => {
    const { app } = await primed();

    const response = await request(app)
      .get('/api/orchestrator/threads/thread-brs-1/runs')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(3);
    const started = response.body.data.map(
      (run: { started_at: string }) => run.started_at,
    );
    const sorted = [...started].sort((a, b) => b.localeCompare(a));
    expect(started).toEqual(sorted);
  });

  it('respects the limit query parameter', async () => {
    const { app } = await primed();

    const response = await request(app)
      .get('/api/orchestrator/threads/thread-brs-1/runs?limit=1')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('rejects runs listing for a thread the caller does not own', async () => {
    const { app } = await primed();

    const response = await request(app)
      .get('/api/orchestrator/threads/thread-brs-1/runs')
      .set({ authorization: 'Bearer stranger' });

    expect(response.status).toBe(404);
  });
});

describe('compiler SSE stream', () => {
  it('sends an initial thread_updated event on connect and pushes further updates', async () => {
    const { app, services } = buildTestApp();
    const thread = await services.compiler_service.createThread({
      narrator_id: OWNER_TOKEN,
      owner_id: OWNER_TOKEN,
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/compiler/threads/${thread.thread_id}/stream`,
        {
          headers: { authorization: `Bearer ${OWNER_TOKEN}` },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      const readEvent = async () => {
        let buffer = '';
        while (!buffer.includes('\n\n')) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        return buffer;
      };

      const first = await readEvent();
      expect(first).toContain('event: thread_updated');
      expect(first).toContain(`"thread_id":"${thread.thread_id}"`);

      const update_promise = readEvent();
      await services.compiler_service.postUserMessage({
        content: 'hello',
        owner_id: OWNER_TOKEN,
        thread_id: thread.thread_id,
      });
      const second = await update_promise;
      expect(second).toContain('event: thread_updated');

      await reader.cancel();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
