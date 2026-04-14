import { z } from "zod";

import { narrative_dependency_types } from "../../domain/narrative/schema";

/**
 * Dependency schema for narrative events.
 *
 * Modifier dependencies require a positive weight, while unlock dependencies
 * must omit it.
 */
const compile_narrative_dependency_schema = z
  .object({
    parent_event: z.string().min(1),
    type: z.enum(narrative_dependency_types),
    weight: z.number().positive().optional(),
  })
  .superRefine((dependency, ctx) => {
    const is_modifier =
      dependency.type === "MODIFIER_POSITIVE" ||
      dependency.type === "MODIFIER_NEGATIVE";

    if (is_modifier && dependency.weight === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Modifier dependencies must include a positive weight.",
        path: ["weight"],
      });
    }

    if (!is_modifier && dependency.weight !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unlock dependencies must not include a weight.",
        path: ["weight"],
      });
    }
  });

/**
 * Event schema accepted by the compiler save tool.
 */
const compile_narrative_event_schema = z.object({
  event_id: z.string().min(1),
  label: z.string().min(1),
  narrative_weight: z.number().int().min(1).max(10),
  probability: z.number().min(0).max(1),
  conviction: z.number().min(0).max(1),
  depends_on: z.array(compile_narrative_dependency_schema),
});

/**
 * Detect whether the compiled event dependency graph contains a cycle.
 */
function has_dependency_cycle(
  event_lookup: Map<string, CompileNarrativeEvent>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (event_id: string): boolean => {
    if (visiting.has(event_id)) {
      return true;
    }

    if (visited.has(event_id)) {
      return false;
    }

    visiting.add(event_id);

    const event = event_lookup.get(event_id);
    if (!event) {
      visiting.delete(event_id);
      visited.add(event_id);
      return false;
    }

    for (const dependency of event.depends_on) {
      if (visit(dependency.parent_event)) {
        return true;
      }
    }

    visiting.delete(event_id);
    visited.add(event_id);
    return false;
  };

  for (const event_id of event_lookup.keys()) {
    if (visit(event_id)) {
      return true;
    }
  }

  return false;
}

/**
 * Full payload schema for the compiler save tool.
 *
 * This enforces event uniqueness, parent existence, self-dependency rejection,
 * and acyclic graph structure before anything is persisted.
 */
export const compile_narrative_input_schema = z
  .object({
    title: z.string().min(3),
    thesis_text: z.string().min(20),
    failure_conditions: z.array(z.string().min(1)).default([]),
    expires_at: z.string().datetime().optional(),
    events: z.array(compile_narrative_event_schema).min(1),
  })
  .superRefine((input, ctx) => {
    const event_lookup = new Map<string, CompileNarrativeEvent>();

    for (const [index, event] of input.events.entries()) {
      if (event_lookup.has(event.event_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate event_id "${event.event_id}" found.`,
          path: ["events", index, "event_id"],
        });
      }

      event_lookup.set(event.event_id, event);
    }

    for (const [event_index, event] of input.events.entries()) {
      for (const [dependency_index, dependency] of event.depends_on.entries()) {
        if (!event_lookup.has(dependency.parent_event)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown parent_event "${dependency.parent_event}".`,
            path: [
              "events",
              event_index,
              "depends_on",
              dependency_index,
              "parent_event",
            ],
          });
        }

        if (dependency.parent_event === event.event_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "An event cannot depend on itself.",
            path: [
              "events",
              event_index,
              "depends_on",
              dependency_index,
              "parent_event",
            ],
          });
        }
      }
    }

    if (has_dependency_cycle(event_lookup)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The narrative graph must be acyclic.",
        path: ["events"],
      });
    }
  });

/**
 * Inferred TypeScript type for a valid compiler save payload.
 */
export type CompileNarrativeInput = z.infer<
  typeof compile_narrative_input_schema
>;

/**
 * Inferred TypeScript type for one compiled narrative event.
 */
export type CompileNarrativeEvent = z.infer<typeof compile_narrative_event_schema>;
