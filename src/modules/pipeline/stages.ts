import { isDoNotResendHardBlock, isSendBlockedStatus } from "@/modules/outreach/status";

export type PipelineStageKey =
  | "new"
  | "contacted"
  | "replied"
  | "in_conversation"
  | "qualified"
  | "won"
  | "lost";

export type PipelineStageKind = "open" | "won" | "lost";

export type PipelineStage = {
  key: PipelineStageKey;
  label: string;
  shortLabel: string;
  kind: PipelineStageKind;
  description: string;
};

/**
 * The pipeline vocabulary. Outreach used a free-text status for 0.1.0-0.3.0,
 * which cannot be counted, filtered or ordered reliably. Stages are the stable
 * set everything CRM-shaped is built on; the free-text status stays as the
 * outreach detail it always was.
 */
export const pipelineStages: readonly PipelineStage[] = [
  {
    key: "new",
    label: "New",
    shortLabel: "New",
    kind: "open",
    description: "Found and recorded, not contacted yet."
  },
  {
    key: "contacted",
    label: "Contacted",
    shortLabel: "Contacted",
    kind: "open",
    description: "A first message went out and you are waiting for a reply."
  },
  {
    key: "replied",
    label: "Replied",
    shortLabel: "Replied",
    kind: "open",
    description: "They answered. Keep the conversation moving."
  },
  {
    key: "in_conversation",
    label: "In conversation",
    shortLabel: "Conversation",
    kind: "open",
    description: "Back and forth about scope, timing or price."
  },
  {
    key: "qualified",
    label: "Qualified",
    shortLabel: "Qualified",
    kind: "open",
    description: "A real fit, moving toward a deal."
  },
  {
    key: "won",
    label: "Won",
    shortLabel: "Won",
    kind: "won",
    description: "Became a client."
  },
  {
    key: "lost",
    label: "Lost",
    shortLabel: "Lost",
    kind: "lost",
    description: "Closed without a deal."
  }
];

export const defaultPipelineStage: PipelineStageKey = "new";

export const pipelineStageKeys = pipelineStages.map((stage) => stage.key);

const stageByKey = new Map(pipelineStages.map((stage) => [stage.key, stage]));

export function isPipelineStage(value: string | null | undefined): value is PipelineStageKey {
  return Boolean(value && stageByKey.has(value as PipelineStageKey));
}

export function getPipelineStage(value: string | null | undefined): PipelineStage {
  return stageByKey.get(value as PipelineStageKey) ?? stageByKey.get(defaultPipelineStage)!;
}

export function pipelineStageLabel(value: string | null | undefined) {
  return getPipelineStage(value).label;
}

export function pipelineStageIndex(value: string | null | undefined) {
  return pipelineStages.findIndex((stage) => stage.key === getPipelineStage(value).key);
}

export function isOpenPipelineStage(value: string | null | undefined) {
  return getPipelineStage(value).kind === "open";
}

export function isWonPipelineStage(value: string | null | undefined) {
  return getPipelineStage(value).kind === "won";
}

export function isLostPipelineStage(value: string | null | undefined) {
  return getPipelineStage(value).kind === "lost";
}

/**
 * Maps the free-text outreach status of an existing database onto the pipeline
 * so 0.4.0 upgrades do not land with an empty board. Order matters: closing
 * words are checked before the softer "sent" words they contain.
 */
export function stageFromLegacyStatus(status: string | null | undefined): PipelineStageKey {
  const normalized = (status ?? "").trim().toLowerCase();

  if (!normalized) {
    return defaultPipelineStage;
  }

  const includes = (...needles: string[]) =>
    needles.some((needle) => normalized.includes(needle));

  if (includes("dead", "bounced", "skipped", "blocked", "do not send", "lost", "declined", "no thanks")) {
    return "lost";
  }

  if (includes("won", "client", "customer", "signed", "contract", "paid", "closed")) {
    return "won";
  }

  if (includes("qualified", "proposal", "quote", "meeting", "invoice", "deal")) {
    return "qualified";
  }

  if (includes("in conversation", "in_conversation", "conversation", "negotiat", "discussion")) {
    return "in_conversation";
  }

  if (includes("replied", "reply", "responded", "active", "hiring_thread")) {
    return "replied";
  }

  if (
    includes(
      "contacted",
      "sent",
      "waiting",
      "follow-up due",
      "followup due",
      "follow up",
      "form submitted",
      "outreach",
      "emailed"
    )
  ) {
    return "contacted";
  }

  return defaultPipelineStage;
}

/**
 * The outreach status written back when a stage is moved by hand, so tables,
 * exports and the send guards keep reading a status that matches the board.
 */
export function legacyStatusForStage(stage: string | null | undefined) {
  switch (getPipelineStage(stage).key) {
    case "new":
      return "new";
    case "contacted":
      return "waiting";
    case "replied":
      return "replied";
    case "in_conversation":
      return "replied";
    case "qualified":
      return "replied";
    case "won":
      return "replied";
    case "lost":
      return "dead";
  }
}

/**
 * The status a stage move should write. A target that was blocked by hand keeps
 * its blocking status unless the move closes it as lost, so changing columns on
 * the board never quietly re-enables sending to someone who asked you not to.
 */
export function statusForStageMove(
  currentStatus: string,
  stage: string | null | undefined,
  doNotResend: boolean | number = false
) {
  const blocked = isSendBlockedStatus(currentStatus) ||
    isDoNotResendHardBlock({ status: currentStatus, doNotResend });

  if (blocked && getPipelineStage(stage).key !== "lost") {
    return currentStatus;
  }

  return legacyStatusForStage(stage);
}
