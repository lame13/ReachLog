export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

export type AiCompletion = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null
  ) {
    super(message);
  }
}

export function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

export async function requestChatCompletion({
  config,
  messages,
  maxTokens = 1200,
  json = true,
  request = fetch
}: {
  config: AiProviderConfig;
  messages: AiChatMessage[];
  maxTokens?: number;
  json?: boolean;
  request?: typeof fetch;
}): Promise<AiCompletion> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens
  };

  if (json) {
    body.response_format = { type: "json_object" };
  }

  const first = await postCompletion({ config, body, request });

  if (first.ok) {
    return first.completion;
  }

  // Several compatible providers implement chat completions but reject
  // response_format. Retry once without it before treating the provider as
  // unavailable. Authentication and model errors are not retried.
  if (json && (first.status === 400 || first.status === 422)) {
    delete body.response_format;
    const second = await postCompletion({ config, body, request });
    if (second.ok) return second.completion;

    if (second.status === 400 && body.max_tokens !== undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      const third = await postCompletion({ config, body, request });
      if (third.ok) return third.completion;
      throw new AiProviderError(third.message, third.status);
    }

    throw new AiProviderError(second.message, second.status);
  }

  if (first.status === 400 && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    const fallback = await postCompletion({ config, body, request });
    if (fallback.ok) return fallback.completion;
    throw new AiProviderError(fallback.message, fallback.status);
  }

  throw new AiProviderError(first.message, first.status);
}

async function postCompletion({
  config,
  body,
  request
}: {
  config: AiProviderConfig;
  body: Record<string, unknown>;
  request: typeof fetch;
}): Promise<
  | { ok: true; completion: AiCompletion }
  | { ok: false; status: number | null; message: string }
> {
  let response: Response;

  try {
    response = await request(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store"
    });
  } catch {
    return {
      ok: false,
      status: null,
      message:
        "Could not reach the AI endpoint. Check the base URL, network access, and provider availability."
    };
  }

  const raw = await response.text();
  let payload: unknown = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = readProviderError(payload);
    const providerMessage = (config.apiKey
      ? error.replaceAll(config.apiKey, "[redacted]")
      : error).slice(0, 300);
    return {
      ok: false,
      status: response.status,
      message: providerMessage
        ? `AI provider returned ${response.status}: ${providerMessage}`
        : `AI provider returned ${response.status}.`
    };
  }

  const content = readContent(payload);

  if (!content) {
    return {
      ok: false,
      status: response.status,
      message: "The AI provider returned an empty message."
    };
  }

  const usage = readUsage(payload);

  return {
    ok: true,
    completion: {
      content,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens
    }
  };
}

export async function testAiProvider(
  config: AiProviderConfig,
  request: typeof fetch = fetch
) {
  const completion = await requestChatCompletion({
    config,
    messages: [
      {
        role: "system",
        content: "Reply with the single word OK. Do not add punctuation."
      },
      { role: "user", content: "Connection test." }
    ],
    maxTokens: 8,
    json: false,
    request
  });

  return completion.content.trim();
}

function readContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = Reflect.get(payload, "choices");
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = Reflect.get(choices[0], "message");
  const content = message && typeof message === "object" ? Reflect.get(message, "content") : null;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof Reflect.get(part, "text") === "string")
          return Reflect.get(part, "text") as string;
        return "";
      })
      .join("")
      .trim();
  }

  const legacyText = Reflect.get(choices[0], "text");
  return typeof legacyText === "string" ? legacyText.trim() : "";
}

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? Reflect.get(payload, "usage") : null;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

  return {
    promptTokens: number(usage && typeof usage === "object" ? Reflect.get(usage, "prompt_tokens") ?? Reflect.get(usage, "input_tokens") : 0),
    completionTokens: number(usage && typeof usage === "object" ? Reflect.get(usage, "completion_tokens") ?? Reflect.get(usage, "output_tokens") : 0)
  };
}

function readProviderError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const error = Reflect.get(payload, "error");
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof Reflect.get(error, "message") === "string")
    return Reflect.get(error, "message") as string;
  return "";
}
