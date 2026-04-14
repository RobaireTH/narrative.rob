import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { compiler_agent_system_prompt } from "./prompt";
import type {
  CompileNarrativeContext,
  CompilerNarrativeRepository,
} from "./repository";
import { compiler_agent_state, type CompilerAgentState } from "./state";
import { create_compile_narrative_tool } from "./tool";

/**
 * Human payload used when resuming the compiler graph after an interrupt.
 */
export interface CompilerHumanInput {
  content: string;
}

/**
 * Dependencies required to build the compiler LangGraph.
 */
export interface CreateCompilerAgentGraphParams {
  model: BaseChatModel;
  context: CompileNarrativeContext;
  repository: CompilerNarrativeRepository;
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Normalize LangChain message content into a plain string.
 *
 * This lets approval checks work whether the message arrives as a simple string
 * or as structured content blocks.
 */
function extract_message_text(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  // Concatenate all text-like parts into one approval-checkable string.
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join(" ")
    .trim();
}

/**
 * Detect whether the latest user message is explicit approval to save.
 */
function is_explicit_approval(content: string): boolean {
  const normalized = content.trim().toLowerCase();

  // Keep this intentionally narrow so edits or brainstorming do not trigger saves.
  return [
    /^yes\b/,
    /^approved\b/,
    /^i approve\b/,
    /^yes,? save (it|this)\b/,
    /^looks good,? proceed\b/,
    /^looks good\b/,
    /^proceed\b/,
    /^save it\b/,
  ].some((pattern) => pattern.test(normalized));
}

/**
 * Detect whether an AI response is a formal narrative review.
 *
 * The review heading and section cues are enforced in the prompt so the graph
 * can tell the difference between ordinary follow-up chat and the final
 * inspection-ready synthesis step.
 */
function is_formal_review_text(content: string): boolean {
  const normalized = content.toLowerCase();

  return (
    normalized.includes("narrative review") &&
    normalized.includes("thesis") &&
    normalized.includes("sequence") &&
    normalized.includes("causal") &&
    normalized.includes("invalid") &&
    (normalized.includes("implied") || normalized.includes("defaulted"))
  );
}

/**
 * Detect whether the model attempted to call a tool in its latest response.
 */
function has_pending_tool_call(message: BaseMessage | undefined): boolean {
  if (!message || message.type !== "ai") {
    return false;
  }

  // AI tool calls are represented only on AI messages.
  const ai_message = message as AIMessage;
  return (
    Array.isArray(ai_message.tool_calls) && ai_message.tool_calls.length > 0
  );
}

/**
 * Build the human-input node for the compiler graph.
 *
 * This node either consumes the latest human message or interrupts the graph
 * until a new human message arrives.
 */
function create_human_node() {
  return (state: CompilerAgentState) => {
    const last_message = state.messages.at(-1);

    if (last_message?.type === "human") {
      // Recompute approval state every time the user responds.
      const content = extract_message_text(last_message.content);
      const explicit_approval = is_explicit_approval(content);

      return {
        // A human approval only counts if it comes after a formal review.
        is_approved: state.awaiting_confirmation && explicit_approval,
        // Any non-approval response after a review means the draft needs a refreshed review.
        awaiting_confirmation: explicit_approval
          ? state.awaiting_confirmation
          : false,
      };
    }

    // Pause the graph until the next human message is supplied by the caller.
    const resumed_input = interrupt<
      {
        kind: "awaiting_human_input";
        message: string;
      },
      CompilerHumanInput
    >({
      kind: "awaiting_human_input",
      message: "Provide the next user message for the compiler agent.",
    });

    return {
      messages: [new HumanMessage(resumed_input.content)],
      is_approved:
        state.awaiting_confirmation &&
        is_explicit_approval(resumed_input.content),
      awaiting_confirmation: is_explicit_approval(resumed_input.content)
        ? state.awaiting_confirmation
        : false,
    };
  };
}

/**
 * Build the model node that performs thesis compilation and optional tool use.
 */
function create_agent_node(
  model: BaseChatModel,
  compile_narrative_tool: ReturnType<typeof create_compile_narrative_tool>,
) {
  if (!model.bindTools) {
    throw new Error(
      "The provided chat model does not support tool binding. Use a tool-calling capable model.",
    );
  }

  const model_with_tools = model.bindTools([compile_narrative_tool]);

  return async (state: CompilerAgentState) => {
    // Re-run the full conversation with the compiler system prompt each turn.
    const response = await model_with_tools.invoke([
      new SystemMessage(compiler_agent_system_prompt),
      ...state.messages,
    ]);
    const response_text = extract_message_text(response.content);
    const is_formal_review = !has_pending_tool_call(response)
      ? is_formal_review_text(response_text)
      : false;

    if (has_pending_tool_call(response) && !state.is_approved) {
      // Never let the model save before a formal review has been inspected and approved.
      return {
        messages: [
          new AIMessage({
            content:
              state.awaiting_confirmation
                ? "The narrative looks structurally ready, but I still need your explicit confirmation after the Narrative Review before I can create the draft. Please inspect the review and confirm only if everything looks right."
                : "I think the narrative may be close to ready, but I cannot create the draft until I have first presented a formal Narrative Review for inspection and then received your explicit confirmation.",
          }),
        ],
        awaiting_confirmation: state.awaiting_confirmation,
        is_approved: false,
      };
    }

    return {
      messages: [response],
      // Once a formal review has been presented, the next step must be user inspection.
      awaiting_confirmation: is_formal_review,
      // The approval flag only applies to the current save turn and is otherwise cleared.
      is_approved: false,
    };
  };
}

/**
 * Route tool-calling outputs to the tool node and everything else back to the
 * human node for further conversation.
 */
function route_after_agent(state: CompilerAgentState) {
  const last_message = state.messages.at(-1);

  if (has_pending_tool_call(last_message)) {
    return "compile_tool_node";
  }

  return "human_node";
}

/**
 * Create the full compiler LangGraph.
 *
 * The graph alternates between human input and model reasoning, only invoking
 * `compile_narrative` once the model has already presented a formal review and
 * the user has explicitly confirmed that review.
 */
export function create_compiler_agent_graph(
  params: CreateCompilerAgentGraphParams,
) {
  const compile_narrative_tool = create_compile_narrative_tool({
    context: params.context,
    repository: params.repository,
  });

  const compile_tool_node = new ToolNode([compile_narrative_tool], {
    name: "compile_tool_node",
  });

  return new StateGraph(compiler_agent_state)
    .addNode("human_node", create_human_node())
    .addNode(
      "agent_node",
      create_agent_node(params.model, compile_narrative_tool),
    )
    .addNode("compile_tool_node", compile_tool_node)
    .addEdge(START, "human_node")
    .addEdge("human_node", "agent_node")
    .addConditionalEdges("agent_node", route_after_agent, {
      compile_tool_node: "compile_tool_node",
      human_node: "human_node",
    })
    .addEdge("compile_tool_node", END)
    .compile({
      checkpointer: params.checkpointer,
      name: "compiler_agent_graph",
    });
}

/**
 * Build the resume command used by callers to continue an interrupted compiler
 * graph with the next user message.
 */
export function create_compiler_resume_command(content: string) {
  return new Command({
    resume: {
      content,
    },
  });
}
