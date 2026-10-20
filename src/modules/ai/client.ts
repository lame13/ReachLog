import { createHash } from "node:crypto";
import type { z } from "zod";
import { getSqlite } from "@/modules/core/db/client";
import { env } from "@/modules/core/env";
import { createId } from "@/modules/core/ids";
import {
  AiProviderError,
  requestChatCompletion,
  type AiChatMessage,
  type AiProviderConfig
} from "./provider";

export const AI_PROMPT_VERSION = "1.0.0";

export type AiRunKind = "reply_triage" | "followup_draft" | "unlinked_lead";

export type AiRunRow = {
  id: string;
  kind: AiRunKind;
  entityType: string;
  entityId: string;
  targetId: string | null;
  inputHash: string;
  promptVersion: string;
  model: string;
  status: string;
  reviewStatus: string;
  outputJson: string | null;
  error: string | null;
  promptTokens: number;
  completionTokens: number;
  attempts: number;
  appliedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const AI_RUN_COLUMNS = `
  id, kind, entity_type AS entityType, entity_id AS entityId,
  target_id AS targetId, input_hash AS inputHash, prompt_version AS promptVersion,
  model, status, review_status AS reviewStatus, output_json AS outputJson, error,
  prompt_tokens AS promptTokens, completion_tokens AS completionTokens, attempts,
  applied_at AS appliedAt, reviewed_at AS reviewedAt,
  created_at AS createdAt, updated_at AS updatedAt
`;

export function aiConfig(): AiProviderConfig | null {
  if (!env.AI_ENABLED) return null;
  const baseUrl = env.AI_BASE_URL?.trim();
  const model = env.AI_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    apiKey: env.AI_API_KEY?.trim() || undefined
  };
}

export function aiReady() {
  return aiConfig() !== null;
}

export function inputHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function runAiJson<S extends z.ZodTypeAny>({
  kind,
  entityType,
  entityId,
  targetId = null,
  input,
  schema,
  system,
  user,
  maxTokens = 1200,
  request = fetch
}: {
  kind: AiRunKind;
  entityType: string;
  entityId: string;
  targetId?: string | null;
  input: unknown;
  schema: S;
  system: string;
  user: string;
  maxTokens?: number;
  request?: typeof fetch;
}): Promise<{ run: AiRunRow; output: z.infer<S> }> {
  const config = aiConfig();

  if (!config) {
    throw new Error("AI automation is not configured.");
  }

  const hash = inputHash({
    promptVersion: AI_PROMPT_VERSION,
    model: config.model,
    input
  });
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const existing = sqlite
    .prepare(
      "SELECT id, output_json AS outputJson, status FROM ai_runs WHERE kind = ? AND entity_id = ? AND input_hash = ?"
    )
    .get(kind, entityId, hash) as
    | {
        id: string;
        outputJson: string | null;
        status: string;
      }
    | undefined;

  if (existing?.status === "success" && existing.outputJson) {
    try {
      const output = schema.parse(JSON.parse(existing.outputJson));
      return {
        run: getAiRun(existing.id)!,
        output
      };
    } catch {
      // A stored response that no longer matches the schema is regenerated.
    }
  }

  const runId = existing?.id ?? createId("ai");
  sqlite
    .prepare(
      `
      INSERT INTO ai_runs (
        id, kind, entity_type, entity_id, target_id, input_hash,
        prompt_version, model, status, review_status, output_json, error,
        prompt_tokens, completion_tokens, attempts, applied_at, reviewed_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 'none', NULL, NULL, 0, 0, 1, NULL, NULL, ?, ?)
      ON CONFLICT(kind, entity_id, input_hash) DO UPDATE SET
        status = 'running',
        target_id = COALESCE(excluded.target_id, ai_runs.target_id),
        attempts = ai_runs.attempts + 1,
        error = NULL,
        updated_at = excluded.updated_at
    `
    )
    .run(
      runId,
      kind,
      entityType,
      entityId,
      targetId,
      hash,
      AI_PROMPT_VERSION,
      config.model,
      now,
      now
    );

  const messages: AiChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const first = await requestChatCompletion({
      config,
      messages,
      maxTokens,
      request
    });
    promptTokens += first.promptTokens;
    completionTokens += first.completionTokens;
    const firstOutput = parseAndValidate(first.content, schema);

    if (firstOutput.success) {
      return finishSuccess(runId, firstOutput.data, promptTokens, completionTokens);
    }

    const repair = await requestChatCompletion({
      config,
      messages: [
        ...messages,
        { role: "assistant", content: first.content.slice(0, 6000) },
        {
          role: "user",
          content: `That response did not match the required JSON schema. Return only one corrected JSON object. Validation error: ${firstOutput.error}`
        }
      ],
      maxTokens,
      request
    });
    promptTokens += repair.promptTokens;
    completionTokens += repair.completionTokens;
    const repaired = parseAndValidate(repair.content, schema);

    if (!repaired.success) {
      throw new AiProviderError(
        "The AI response did not match the required JSON schema."
      );
    }

    return finishSuccess(runId, repaired.data, promptTokens, completionTokens);
  } catch (error) {
    sqlite
      .prepare(
        `
        UPDATE ai_runs
        SET status = 'failed',
            error = ?,
            prompt_tokens = prompt_tokens + ?,
            completion_tokens = completion_tokens + ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        error instanceof Error ? error.message.slice(0, 800) : "Unknown AI error",
        promptTokens,
        completionTokens,
        new Date().toISOString(),
        runId
      );
    throw error;
  }
}

export function getAiRun(runId: string) {
  return getSqlite()
    .prepare(`SELECT ${AI_RUN_COLUMNS} FROM ai_runs WHERE id = ?`)
    .get(runId) as AiRunRow | undefined;
}

function finishSuccess<T>(
  runId: string,
  output: T,
  promptTokens: number,
  completionTokens: number
) {
  const now = new Date().toISOString();
  getSqlite()
    .prepare(
      `
      UPDATE ai_runs
      SET status = 'success',
          output_json = ?,
          error = NULL,
          prompt_tokens = prompt_tokens + ?,
          completion_tokens = completion_tokens + ?,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(JSON.stringify(output), promptTokens, completionTokens, now, runId);

  return {
    run: getAiRun(runId)!,
    output
  };
}

function parseAndValidate<S extends z.ZodTypeAny>(content: string, schema: S) {
  const json = extractJsonObject(content);
  if (!json) {
    return { success: false as const, error: "No JSON object was returned." };
  }

  try {
    const parsed = JSON.parse(json);
    const validated = schema.safeParse(parsed);
    if (validated.success) {
      return { success: true as const, data: validated.data };
    }
    return {
      success: false as const,
      error: validated.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")
    };
  } catch {
    return { success: false as const, error: "The response was not valid JSON." };
  }
}

function extractJsonObject(content: string) {
  const withoutFence = content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start < 0 || end <= start) return "";
  return withoutFence.slice(start, end + 1);
}
