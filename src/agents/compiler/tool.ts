import { tool } from "@langchain/core/tools";

import { compile_narrative_input_schema } from "./schema";
import type {
  CompileNarrativeContext,
  CompilerNarrativeRepository,
} from "./repository";
import { materialize_narrative_json } from "./repository";

/**
 * Dependencies required by the compiler save tool.
 */
export interface CreateCompileNarrativeToolParams {
  context: CompileNarrativeContext;
  repository: CompilerNarrativeRepository;
}

/**
 * Create the final compiler save tool.
 *
 * The model is only allowed to call this tool after a fully specified narrative
 * has been reviewed and explicitly approved by the user.
 */
export function create_compile_narrative_tool(
  params: CreateCompileNarrativeToolParams,
) {
  return tool(
    async (input) => {
      // Materialize the persisted runtime shape from the validated tool input.
      const narrative = materialize_narrative_json(input, params.context);

      // Persist the compiled narrative through the configured repository.
      await params.repository.saveNarrative({
        source_conversation_id: params.context.source_conversation_id,
        narrative,
      });

      // Return a compact success payload to the model/runtime.
      return JSON.stringify({
        status: "SUCCESS",
        narrative_id: narrative.narrative_id,
        title: narrative.title,
      });
    },
    {
      name: "compile_narrative",
      description:
        "Call this tool only after the user explicitly approves the final narrative review.",
      schema: compile_narrative_input_schema,
    },
  );
}
