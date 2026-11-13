import { describe, it, expect } from "vitest";
import {
  extractAndValidateJson,
  DecisionDetectionSchema,
  IntentParserResponseSchema,
} from "../../packages/ai-core/src/responseParser.js";

describe("Response Parser", () => {
  it("parses clean JSON directly", () => {
    const raw = JSON.stringify({
      is_decision: true,
      confidence: 0.95,
      reason: "Add Redis cache",
    });

    const parsed = extractAndValidateJson(raw, DecisionDetectionSchema);
    expect(parsed.is_decision).toBe(true);
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.reason).toBe("Add Redis cache");
  });

  it("extracts JSON wrapped in markdown fences", () => {
    const raw = `
Here is your requested output:
\`\`\`json
{
  "is_decision": false,
  "confidence": 0.2,
  "reason": "Team was debating options without resolution."
}
\`\`\`
Hope this helps!
`;
    const parsed = extractAndValidateJson(raw, DecisionDetectionSchema);
    expect(parsed.is_decision).toBe(false);
    expect(parsed.confidence).toBe(0.2);
  });

  it("extracts outermost braces when text precedes and follows", () => {
    const raw = `I evaluated the request. Result: {"operations":[{"op":"add_node","label":"Auth Service","nodeType":"service","positionHint":"right_of"}]} - finished analysis.`;

    const parsed = extractAndValidateJson(raw, IntentParserResponseSchema);
    expect(parsed.operations.length).toBe(1);
    expect(parsed.operations[0].op).toBe("add_node");
  });

  it("throws Error when no valid JSON is present", () => {
    expect(() => {
      extractAndValidateJson("I cannot fulfill this request.", DecisionDetectionSchema);
    }).toThrow("No valid JSON object found in LLM output.");
  });

  it("enforces valid operations schema", () => {
    const invalidOp = JSON.stringify({
      operations: [
        {
          op: "unknown_op",
          label: "Test",
        },
      ],
    });

    expect(() => {
      extractAndValidateJson(invalidOp, IntentParserResponseSchema);
    }).toThrow();
  });
});
