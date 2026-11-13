import { v4 as uuidv4 } from "uuid";
import type {
  TranscriptTurn,
  ExcalidrawElement,
  CompactGraph,
  ProposalRecord,
  PlannedMutation,
} from "./types.js";
import { LLMRouter } from "./llmRouter.js";
import {
  DecisionDetectionSchema,
  IntentParserResponseSchema,
  extractAndValidateJson,
} from "./responseParser.js";
import { planOperations } from "./operationPlanner.js";
import { validateProposal } from "./proposalValidator.js";
import { generateGhostOverlay, type GhostOverlayResult } from "./ghostOverlay.js";
import Database from "better-sqlite3";

export interface PipelineEvaluationInput {
  boardId: string;
  sessionId?: string;
  transcriptDelta: TranscriptTurn[];
  recentTurns?: TranscriptTurn[];
  rawElements: ExcalidrawElement[];
}

export interface PipelineEvaluationOutput {
  status: "no_decision" | "proposed" | "rejected_validation" | "error";
  proposalId?: string;
  reason?: string;
  confidence?: number;
  providerUsed?: string;
  mutations?: PlannedMutation[];
  ghostResult?: GhostOverlayResult;
  errors?: string[];
}

export class AgentPipeline {
  constructor(
    private router: LLMRouter,
    private db?: Database.Database
  ) {}

  private extractCompactGraph(elements: ExcalidrawElement[]): CompactGraph {
    const nodes: CompactGraph["nodes"] = [];
    const edges: CompactGraph["edges"] = [];

    for (const el of elements) {
      if (el.isDeleted) continue;
      if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
        nodes.push({
          id: el.id,
          label: el.customData?.label || el.text || "Component",
          nodeType: el.customData?.nodeType || "service",
        });
      } else if (el.type === "arrow") {
        const source = el.startBinding?.elementId || el.customData?.sourceId || "";
        const target = el.endBinding?.elementId || el.customData?.targetId || "";
        if (source && target) {
          edges.push({
            id: el.id,
            source,
            target,
            label: el.customData?.label || el.text || undefined,
          });
        }
      }
    }
    return { nodes, edges };
  }

  async evaluate(input: PipelineEvaluationInput): Promise<PipelineEvaluationOutput> {
    const { boardId, transcriptDelta, recentTurns = [], rawElements } = input;
    if (transcriptDelta.length === 0) {
      return { status: "no_decision", reason: "Empty transcript delta" };
    }

    const compactGraph = this.extractCompactGraph(rawElements);

    // ==========================================
    // STAGE 1: DECISION DETECTION
    // ==========================================
    const stage1System = `You are a senior software architecture observer listening to a live engineering design review.
Your sole task is to determine whether the latest conversation segment contains a concrete, actionable architectural decision that should change the system diagram.

Rules:
1. Return is_decision: true ONLY when participants agree on or explicitly decide to add, remove, connect, disconnect, rename, split, or insert a system component or data flow (e.g., "Let's put Redis in front of Postgres", "We should drop Kafka and use SQS", "Add an API Gateway").
2. Return is_decision: false for small talk, open-ended questions without resolution ("Should we use Redis or Memcached?"), explanations of existing boxes, or off-topic remarks.
3. Respond strictly with valid JSON matching this schema:
{"is_decision": boolean, "confidence": number, "reason": string}`;

    const nodesSummary = compactGraph.nodes
      .map((n) => `- [${n.id}] ${n.label} (${n.nodeType})`)
      .join("\n");
    const edgesSummary = compactGraph.edges
      .map((e) => `- ${e.source} -> ${e.target} ${e.label ? `[${e.label}]` : ""}`)
      .join("\n");

    const previousContext = recentTurns
      .map((t) => `${t.speakerName}: "${t.text}"`)
      .join("\n");
    const deltaContext = transcriptDelta
      .map((t) => `${t.speakerName}: "${t.text}"`)
      .join("\n");

    const stage1User = `CURRENT DIAGRAM COMPONENTS:
Nodes:
${nodesSummary || "None"}
Edges:
${edgesSummary || "None"}

RECENT CONTEXT (ALREADY PROCESSED):
${previousContext || "None"}

NEW TRANSCRIPT DELTA TO EVALUATE:
${deltaContext}`;

    let stage1Response;
    try {
      stage1Response = await this.router.complete({
        messages: [
          { role: "system", content: stage1System },
          { role: "user", content: stage1User },
        ],
      });
    } catch (err: any) {
      return { status: "error", reason: `Stage 1 LLM failure: ${err.message}` };
    }

    let decision;
    try {
      decision = extractAndValidateJson(stage1Response.content, DecisionDetectionSchema);
    } catch (err: any) {
      return { status: "error", reason: `Malformed Stage 1 JSON: ${err.message}` };
    }

    if (!decision.is_decision || decision.confidence < 0.75) {
      return {
        status: "no_decision",
        reason: decision.reason,
        confidence: decision.confidence,
      };
    }

    // ==========================================
    // STAGE 2: INTENT PARSING
    // ==========================================
    const stage2System = `You are an architectural diagram compiler. Convert the confirmed engineering decision into an ordered list of atomic graph edit operations against the provided diagram JSON.

Allowed operations (use ONLY these 8 types):
1. {"op": "add_node", "label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external", "positionHint": "right_of"|"left_of"|"below"|"above"|"center", "anchorNodeId"?: string}
2. {"op": "remove_node", "id": string}
3. {"op": "add_edge", "sourceId": string, "targetId": string, "label"?: string}
4. {"op": "remove_edge", "id": string}
5. {"op": "relabel_element", "id": string, "newLabel": string}
6. {"op": "reposition_element", "id": string, "x": number, "y": number}
7. {"op": "insert_between", "sourceId": string, "targetId": string, "newNode": {"label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external"}}
8. {"op": "fork_path", "sourceId": string, "branchNode": {"label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external"}, "targetId"?: string}

Constraints:
- Reference existing node and edge IDs accurately from CURRENT DIAGRAM GRAPH.
- Prefer "insert_between" when placing middleware/caches/queues along an existing connection.
- Output strictly valid JSON: {"operations": EditIntent[]}`;

    const stage2User = `CONFIRMED DECISION:
"${decision.reason}"

SUPPORTING TRANSCRIPT:
${deltaContext}

CURRENT DIAGRAM GRAPH (JSON):
${JSON.stringify(compactGraph, null, 2)}`;

    let stage2Response;
    try {
      stage2Response = await this.router.complete({
        messages: [
          { role: "system", content: stage2System },
          { role: "user", content: stage2User },
        ],
      });
    } catch (err: any) {
      return { status: "error", reason: `Stage 2 LLM failure: ${err.message}` };
    }

    let parsedOps;
    try {
      parsedOps = extractAndValidateJson(stage2Response.content, IntentParserResponseSchema);
    } catch {
      // Retry once on malformed JSON
      try {
        const retryResponse = await this.router.complete({
          messages: [
            { role: "system", content: stage2System },
            { role: "user", content: stage2User },
            { role: "assistant", content: stage2Response.content },
            {
              role: "user",
              content:
                "Your previous response failed JSON schema validation. Return ONLY valid JSON matching: {\"operations\": EditIntent[]}",
            },
          ],
        });
        parsedOps = extractAndValidateJson(retryResponse.content, IntentParserResponseSchema);
      } catch (err: any) {
        return { status: "error", reason: `Malformed Stage 2 JSON after retry: ${err.message}` };
      }
    }

    // ==========================================
    // STAGE 3: DETERMINISTIC OPERATION PLANNER
    // ==========================================
    const plannedMutations = planOperations(parsedOps.operations, rawElements);

    // ==========================================
    // STAGE 4: DETERMINISTIC VALIDATOR
    // ==========================================
    const validation = validateProposal(rawElements, plannedMutations);

    const proposalId = uuidv4();
    const now = Date.now();
    const providerUsed = stage2Response.provider || "groq";
    const tokensUsed = (stage1Response.tokens || 0) + (stage2Response.tokens || 0);

    if (this.db) {
      try {
        const exists = this.db.prepare(`SELECT id FROM boards WHERE id = ?`).get(boardId);
        if (!exists) {
          const now = Date.now();
          this.db.prepare(`
            INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at)
            VALUES ('system_owner', 'system@boardmind.local', 'System', 'n/a', ?)
          `).run(now);
          this.db.prepare(`
            INSERT OR IGNORE INTO boards (id, name, owner_id, created_at, updated_at)
            VALUES (?, 'Architecture Board', 'system_owner', ?, ?)
          `).run(boardId, now, now);
        }
      } catch {
        // Ignore
      }
    }

    if (!validation.valid) {
      if (this.db) {
        try {
          const insertStmt = this.db.prepare(`
            INSERT INTO ai_proposals (id, board_id, status, input_transcript, output_ops, provider_used, tokens_used, created_at)
            VALUES (?, ?, 'rejected_validation', ?, ?, ?, ?, ?)
          `);
          insertStmt.run(
            proposalId,
            boardId,
            deltaContext,
            JSON.stringify({ errors: validation.errors, mutations: plannedMutations }),
            providerUsed,
            tokensUsed,
            now
          );
        } catch (dbErr: any) {
          console.warn(`[AgentPipeline] DB write proposal error: ${dbErr.message}`);
        }
      }

      return {
        status: "rejected_validation",
        proposalId,
        reason: validation.errors[0] || "Validation failed",
        errors: validation.errors,
      };
    }

    // ==========================================
    // STAGE 5: GHOST OVERLAY GENERATION
    // ==========================================
    const ghostResult = generateGhostOverlay(plannedMutations, proposalId);

    if (this.db) {
      try {
        const insertStmt = this.db.prepare(`
          INSERT INTO ai_proposals (id, board_id, status, input_transcript, output_ops, provider_used, tokens_used, created_at)
          VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
        `);
        insertStmt.run(
          proposalId,
          boardId,
          deltaContext,
          JSON.stringify({ operations: parsedOps.operations, mutations: plannedMutations }),
          providerUsed,
          tokensUsed,
          now
        );
      } catch (dbErr: any) {
        console.warn(`[AgentPipeline] DB write proposal error: ${dbErr.message}`);
      }
    }

    return {
      status: "proposed",
      proposalId,
      reason: decision.reason,
      confidence: decision.confidence,
      providerUsed,
      mutations: plannedMutations,
      ghostResult,
    };
  }
}
