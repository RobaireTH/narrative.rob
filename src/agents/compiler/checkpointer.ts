import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

/**
 * Runtime configuration for the compiler agent's Redis-backed checkpointer.
 *
 * This lets compiler conversations survive across process restarts while still
 * expiring old threads automatically.
 */
export interface CreateCompilerRedisCheckpointerParams {
  redis_url: string;
  ttl_minutes?: number;
  refresh_on_read?: boolean;
}

/**
 * Create a Redis-backed LangGraph checkpointer for the compiler agent.
 *
 * The checkpointer stores conversational graph state so the compiler can pause
 * for approval and later resume from the exact same graph thread.
 */
export async function create_compiler_redis_checkpointer(
  params: CreateCompilerRedisCheckpointerParams,
) {
  // Use Redis's built-in TTL support so abandoned compiler sessions expire.
  return RedisSaver.fromUrl(params.redis_url, {
    defaultTTL: params.ttl_minutes ?? 60 * 48,
    refreshOnRead: params.refresh_on_read ?? true,
  });
}
