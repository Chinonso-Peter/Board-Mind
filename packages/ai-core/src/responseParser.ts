import { z } from "zod";

export const DecisionDetectionSchema = z.object({
  is_decision: z.boolean(),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().min(1).max(1000),
});

export const NodeTypeEnum = z.enum(["service", "database", "cache", "queue", "gateway", "external"]);
export const PositionHintEnum = z.enum(["right_of", "left_of", "below", "above", "center"]);

export const EditIntentSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    label: z.string().min(1).max(80),
    nodeType: NodeTypeEnum,
    positionHint: PositionHintEnum.default("right_of").optional(),
    anchorNodeId: z.string().nullable().optional(),
  }),
  z.object({
    op: z.literal("remove_node"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("add_edge"),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    label: z.string().max(60).nullable().optional(),
  }),
  z.object({
    op: z.literal("remove_edge"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("relabel_element"),
    id: z.string().min(1),
    newLabel: z.string().min(1).max(80),
  }),
  z.object({
    op: z.literal("reposition_element"),
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal("insert_between"),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    newNode: z.object({
      label: z.string().min(1).max(80),
      nodeType: NodeTypeEnum,
    }),
  }),
  z.object({
    op: z.literal("fork_path"),
    sourceId: z.string().min(1),
    branchNode: z.object({
      label: z.string().min(1).max(80),
      nodeType: NodeTypeEnum,
    }),
    targetId: z.string().nullable().optional(),
  }),
]);

export const IntentParserResponseSchema = z.object({
  operations: z.array(EditIntentSchema).min(1).max(50),
  explanation: z.string().optional(),
});

export function extractAndValidateJson<T>(rawText: string, schema: z.ZodType<T>): T {
  let candidate = rawText.trim();
  // Strip out reasoning/thinking tags (e.g. <think>...</think> from Qwen/DeepSeek)
  candidate = candidate.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Attempt 1: Direct JSON.parse
  try {
    return schema.parse(JSON.parse(candidate));
  } catch {
    // Fall through to fence stripping
  }

  // Attempt 2: Strip ```json ... ``` markdown fences
  const fencedMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    try {
      return schema.parse(JSON.parse(fencedMatch[1].trim()));
    } catch {
      // Fall through to outermost brace extraction
    }
  }

  // Attempt 3: Extract outermost {...} object
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      return schema.parse(JSON.parse(sliced));
    } catch (e: any) {
      throw new Error(`JSON schema validation failed: ${e.message}`);
    }
  }

  throw new Error("No valid JSON object found in LLM output.");
}
