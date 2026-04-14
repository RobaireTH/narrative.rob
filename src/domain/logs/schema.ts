import { z } from 'zod';

export const audit_log_levels = [
  'INFO',
  'WARN',
  'ERROR',
  'CRITICAL',
] as const;

export type AuditLogLevel = (typeof audit_log_levels)[number];

export const audit_log_actors = [
  'orchestrator',
  'contextual_researcher',
  'portfolio_manager',
  'executor',
  'system',
] as const;

export type AuditLogActor = (typeof audit_log_actors)[number];

export type ISO8601String = string;

export const audit_log_entry_schema = z.object({
  log_id: z.string().min(1),
  timestamp: z.string().min(1),
  level: z.enum(audit_log_levels),
  actor: z.enum(audit_log_actors),
  event: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditLogEntry = z.infer<typeof audit_log_entry_schema>;

export const logs_json_schema = z.object({
  entries: z.array(audit_log_entry_schema).default([]),
});

export type LogsJson = z.infer<typeof logs_json_schema>;

export function create_empty_logs(): LogsJson {
  return {
    entries: [],
  };
}
