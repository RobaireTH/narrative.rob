import { describe, expect, it } from 'vitest';

import { resolveEnv } from '../../src/config/env';

describe('resolveEnv', () => {
  it('accepts a minimal development env', () => {
    const env = resolveEnv({
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);

    expect(env.AUTH_PROVIDER).toBe('disabled');
    expect(env.COMPILER_RUNTIME_MODE).toBe('disabled');
    expect(env.COMPILER_MODEL_ID).toBe('claude-opus-4-7');
  });

  it('rejects AUTH_PROVIDER=disabled in production', () => {
    expect(() =>
      resolveEnv({
        NODE_ENV: 'production',
        AUTH_PROVIDER: 'disabled',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('requires ANTHROPIC_API_KEY when compiler runtime is langgraph', () => {
    expect(() =>
      resolveEnv({
        NODE_ENV: 'development',
        COMPILER_RUNTIME_MODE: 'langgraph',
        REDIS_URL: 'redis://localhost:6379',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('requires REDIS_URL when orchestrator runtime is enabled', () => {
    expect(() =>
      resolveEnv({
        NODE_ENV: 'development',
        ORCHESTRATOR_RUNTIME_MODE: 'deepagents',
      } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_URL/);
  });
});
