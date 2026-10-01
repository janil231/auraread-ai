/**
 * Shared Gemini plumbing for the text-generation routes (translate, mind map).
 *
 * The model list lives here, in one place, on purpose: an earlier version kept
 * a separate hard-coded list per route, they drifted, and every route silently
 * fell back to sample text. If you add a model, add it here.
 *
 * Verified against a freshly created Google AI Studio key (Oct 2026):
 *   - gemini-1.5-flash / -latest  -> 404, the whole 1.5 family is retired
 *   - gemini-2.5-flash / -lite    -> 404 "no longer available to new users"
 *   - gemini-flash-latest, 3.6, 3.7 -> intermittent 503 "high demand"
 *   - gemini-3.5-flash-lite, 3.1-flash-lite, 3.5-flash -> confirmed working
 * Ordered fastest/most reliable first because the free tier 503s constantly.
 */
export const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
].filter((name): name is string => Boolean(name));

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** 429/5xx are worth a second try; a 404 will never succeed. */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 2500;
const GEMINI_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiError extends Error {
  readonly attempts: Array<Record<string, unknown>>;

  constructor(message: string, attempts: Array<Record<string, unknown>>) {
    super(message);
    this.name = "GeminiError";
    this.attempts = attempts;
  }
}

type GenerateOptions = {
  /** Instruction that frames the whole response; not echoed back to the user. */
  systemInstruction: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** e.g. "application/json" to ask Gemini for strict JSON. */
  responseMimeType?: string;
};

/**
 * Runs one prompt across the model chain and returns the first usable text.
 * Throws GeminiError when every candidate fails, so callers can surface a real
 * error instead of inventing a fallback.
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions,
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured on the server.", []);
  }

  const attempts: Array<Record<string, unknown>> = [];

  for (const model of MODEL_CANDIDATES) {
    const body = {
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        ...(options.responseMimeType
          ? { responseMimeType: options.responseMimeType }
          : {}),
      },
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;

      try {
        res = await fetch(
          `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
          },
        );
      } catch (err) {
        const timedOut = err instanceof Error && /timed? ?out|abort/i.test(`${err.name} ${err.message}`);
        attempts.push({ model, attempt, outcome: "network_error", detail: timedOut ? "timed out" : String(err) });
        break;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        attempts.push({ model, attempt, outcome: "http_error", status: res.status, detail: detail.slice(0, 300) });

        if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }

      const data = (await res.json().catch(() => null)) as
        | {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            error?: { message?: string };
          }
        | null;

      if (data?.error) {
        attempts.push({ model, attempt, outcome: "api_error", detail: data.error.message });
        break;
      }

      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        attempts.push({ model, attempt, outcome: "empty" });
        break;
      }

      attempts.push({ model, attempt, outcome: "ok", chars: text.length });
      return { text, model };
    }
  }

  throw new GeminiError(
    summariseAttempts(attempts),
    attempts,
  );
}

/** One-line summary for error banners and server logs. */
export function summariseAttempts(attempts: Array<Record<string, unknown>>): string {
  if (attempts.length === 0) return "No model was attempted.";

  return attempts
    .map((entry) => {
      const model = String(entry.model);
      const attempt = entry.attempt ? ` #${entry.attempt}` : "";
      switch (entry.outcome) {
        case "ok":
          return `${model}${attempt}: ok`;
        case "http_error":
          return `${model}${attempt}: HTTP ${entry.status}`;
        case "api_error":
          return `${model}${attempt}: ${entry.detail ?? "api error"}`;
        case "network_error":
          return `${model}${attempt}: ${entry.detail ?? "network error"}`;
        default:
          return `${model}${attempt}: ${String(entry.outcome)}`;
      }
    })
    .join(" | ");
}

/**
 * Pulls the first JSON object out of a model response. Gemini usually honours
 * responseMimeType, but it can still wrap output in ``` fences or add a
 * sentence of preamble, so this stays defensive.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  const candidate =
    start !== -1 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;

  return JSON.parse(candidate);
}