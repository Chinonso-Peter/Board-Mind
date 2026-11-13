export type NodeType = "service" | "database" | "cache" | "queue" | "gateway" | "external";
export type PositionHint = "right_of" | "left_of" | "below" | "above" | "center";

export type EditIntent =
  | {
      op: "add_node";
      label: string;
      nodeType: NodeType;
      positionHint?: PositionHint;
      anchorNodeId?: string;
    }
  | {
      op: "remove_node";
      id: string;
    }
  | {
      op: "add_edge";
      sourceId: string;
      targetId: string;
      label?: string;
    }
  | {
      op: "remove_edge";
      id: string;
    }
  | {
      op: "relabel_element";
      id: string;
      newLabel: string;
    }
  | {
      op: "reposition_element";
      id: string;
      x: number;
      y: number;
    }
  | {
      op: "insert_between";
      sourceId: string;
      targetId: string;
      newNode: {
        label: string;
        nodeType: NodeType;
      };
    }
  | {
      op: "fork_path";
      sourceId: string;
      branchNode: {
        label: string;
        nodeType: NodeType;
      };
      targetId?: string;
    };

export interface ExcalidrawBoundElement {
  id: string;
  type: "text" | "arrow";
}

export interface ExcalidrawElement {
  id: string;
  type: "rectangle" | "diamond" | "ellipse" | "arrow" | "text" | "line" | "freedraw";
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "solid" | "hachure" | "cross-hatch" | "dots";
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: number;
  opacity?: number;
  groupIds?: string[];
  frameId?: string | null;
  roundness?: { type: number; value?: number } | null;
  seed?: number;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  boundElements?: ExcalidrawBoundElement[] | null;
  updated?: number;
  link?: string | null;
  locked?: boolean;
  customData?: Record<string, any>;

  // Arrow bindings & points
  points?: [number, number][];
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  endArrowhead?: "arrow" | "bar" | "dot" | "triangle" | null;
  startArrowhead?: "arrow" | "bar" | "dot" | "triangle" | null;

  // Text container binding & content
  containerId?: string | null;
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
}

export type PlannedMutation =
  | { op: "add"; elementId: string; element: ExcalidrawElement }
  | {
      op: "update";
      elementId: string;
      patch: Partial<ExcalidrawElement> & {
        appendBoundElement?: ExcalidrawBoundElement;
        deltaX?: number;
        deltaY?: number;
      };
    }
  | { op: "delete"; elementId: string };

export interface DiagramNode {
  id: string;
  textId?: string;
  label: string;
  nodeType: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  id: string;
  labelId?: string;
  sourceId?: string;
  targetId?: string;
  label?: string;
}

export interface DecisionDetectionResult {
  is_decision: boolean;
  confidence: number;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TranscriptTurn {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  timestamp: number;
  source: "voice" | "text";
  processedByAgent: boolean;
}

export interface ProposalRecord {
  id: string;
  status: "pending" | "approved" | "dismissed";
  decisionSummary: string;
  confidence: number;
  providerUsed: string;
  operationsJson: string;
  plannedMutationsJson: string;
  ghostElementsJson: string;
  createdAt: number;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

export interface CheckpointRecord {
  id: string;
  boardId: string;
  label: string;
  trigger: "manual" | "ai_approved" | "session_start";
  proposalId?: string | null;
  snapshotPath: string;
  elementCount: number;
  createdAt: number;
  createdBy: string;
}

export interface BoardRecord {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
}

export interface BoardMemberRecord {
  board_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  added_at: number;
}

export interface ProviderUsageRecord {
  provider_name: string;
  date: string;
  requests_used: number;
  tokens_used: number;
}

export interface CompactGraph {
  nodes: Array<{ id: string; label: string; nodeType: NodeType }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}
