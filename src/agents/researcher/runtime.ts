import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import {
  StateBackend,
  resolveBackend,
  type AnyBackendProtocol,
  type BackendFactory,
} from 'deepagents';
import { tool, type StructuredTool, type ToolRuntime } from 'langchain';

import { create_empty_logs, logs_json_schema } from '../../domain/logs/schema';
import type { NarrativeJson } from '../../domain/narrative/schema';
import {
  applyResearchEvidence,
  type ResearcherCommitResult,
} from './updater';
import { commit_research_update_schema } from './schema';

/**
 * Read and parse a JSON file from the current workspace, returning a default
 * value when the file is missing.
 */
async function readJsonOrDefault<T>(params: {
  backend: AnyBackendProtocol | BackendFactory;
  default_value: T;
  file_path: string;
  runtime: ToolRuntime;
}): Promise<T> {
  const resolved_backend = await resolveBackend(params.backend, params.runtime);
  const result = await resolved_backend.read(params.file_path);

  if (result.error) {
    if (params.file_path === 'logs.json') {
      return params.default_value;
    }

    throw new Error(result.error);
  }

  if (typeof result.content !== 'string') {
    return params.default_value;
  }

  return JSON.parse(result.content) as T;
}

/**
 * Create the Researcher's atomic commit tool.
 *
 * The model passes only structured evidence judgments; the backend:
 * - reads `narrative.json`
 * - applies deterministic update math
 * - writes the updated narrative
 * - appends an audit log entry to `logs.json`
 */
export function createCommitResearchUpdateTool(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): StructuredTool {
  return tool(
    async (input, runtime: ToolRuntime) => {
      // Validate the LLM payload before any file reads or math updates happen.
      const parsed = commit_research_update_schema.parse(input);
      const resolved_backend = await resolveBackend(backend, runtime);

      // Load the current narrative projection that the Researcher is allowed to mutate.
      const narrative = await readJsonOrDefault<NarrativeJson>({
        backend,
        default_value: null as never,
        file_path: 'narrative.json',
        runtime,
      });

      // Load or initialize the audit log projection for this workspace.
      const logs = logs_json_schema.parse(
        await readJsonOrDefault({
          backend,
          default_value: create_empty_logs(),
          file_path: 'logs.json',
          runtime,
        }),
      );

      // Hand the structured evidence into the deterministic updater.
      const result: ResearcherCommitResult = applyResearchEvidence({
        input: parsed,
        logs,
        narrative,
      });

      // Persist the updated narrative state.
      const narrative_write = await resolved_backend.write(
        'narrative.json',
        JSON.stringify(result.narrative, null, 2),
      );
      if (narrative_write.error) {
        return narrative_write.error;
      }

      // Persist the appended research audit trail.
      const logs_write = await resolved_backend.write(
        'logs.json',
        JSON.stringify(result.logs, null, 2),
      );
      if (logs_write.error) {
        return logs_write.error;
      }

      // Return a compact success signal plus metadata useful for debugging.
      const message = new ToolMessage({
        content:
          `SUCCESS: narrative.json has been updated and the research audit has been written. ${result.event_updates.length} event(s) were updated.`,
        metadata: {
          event_updates: result.event_updates,
          log_entry_id: result.log_entry.log_id,
          narrative_status: result.narrative.status,
        },
        name: 'commit_research_update',
        tool_call_id: runtime.toolCallId,
      });

      // Merge both file updates so the Deep Agents runtime sees the whole workspace patch.
      const files_update = {
        ...(narrative_write.filesUpdate ?? {}),
        ...(logs_write.filesUpdate ?? {}),
      };

      if (Object.keys(files_update).length > 0) {
        return new Command({
          update: {
            files: files_update,
            messages: [message],
          },
        });
      }

      return message;
    },
    {
      description:
        'Validate a complete batch of structured research evidence, read the current narrative.json and logs.json from the workspace, apply deterministic probability/conviction updates plus thesis failure/expiry logic, write the updated narrative.json, append the research audit log to logs.json, and return compact event-update metadata. No explicit narrative_id input is required because the current workspace narrative.json is the source of truth. This is the Researcher write boundary and should be called only when the evidence batch is complete.',
      name: 'commit_research_update',
      schema: commit_research_update_schema,
    },
  );
}
