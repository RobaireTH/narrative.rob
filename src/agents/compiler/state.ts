import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

/**
 * Compiler graph state.
 *
 * - `messages` stores the conversation transcript
 * - `is_approved` tracks whether the latest user input authorizes saving
 * - `awaiting_confirmation` tracks whether the agent has already presented a
 *   formal narrative review and is now waiting for the user's inspection
 *   and confirmation
 */
export const compiler_agent_state = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // Use the built-in message reducer so LangGraph merges transcripts correctly.
    reducer: messagesStateReducer,
    default: () => [],
  }),
  is_approved: Annotation<boolean>({
    // Approval is always replaced by the latest computed value.
    reducer: (_current, update) => update,
    default: () => false,
  }),
  awaiting_confirmation: Annotation<boolean>({
    // The latest compiler step decides whether the graph is waiting on review confirmation.
    reducer: (_current, update) => update,
    default: () => false,
  }),
});

/**
 * Concrete compiler graph state type.
 */
export type CompilerAgentState = typeof compiler_agent_state.State;
/**
 * Partial state update type for compiler graph steps.
 */
export type CompilerAgentUpdate = typeof compiler_agent_state.Update;
