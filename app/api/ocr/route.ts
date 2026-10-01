import { NextResponse } from "next/server";
import { MODEL_CANDIDATES as GEMINI_MODEL_CANDIDATES } from "@/lib/gemini";
import { SAMPLE_TEXT } from "@/lib/sample-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Shared so the model list cannot drift between routes. See lib/gemini.ts.
const MODEL_CANDIDATES = GEMINI_MODEL_CANDIDATES;

/** 429/5xx are worth a second try; a 404 will never succeed. */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS_PER_MODEL = 2;
/** Quota and 5xx windows are measured in seconds-to-minutes, so retry fast and
 *  fail fast — a long sleep here would just make the user stare at a spinner. */
const RETRY_DELAY_MS = 2500;
/**
 * A single Gemini call must never hang the request indefinitely. Measured
 * latency on a working call is 1.6-18.2s, so 30s leaves healthy headroom
 * while keeping the worst case (all candidates time out) bounded.
 */
const GEMINI_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One-line human summary of every model attempt, for the error banner. */
function summariseAttempts(attempts: Array<Record<string, unknown>>): string {
  if (attempts.length === 0) return "No model was attempted.";

  return attempts
    .map((entry) => {
      const model = String(entry.model);
      const attempt = entry.attempt ? ` #${entry.attempt}` : "";
      switch (entry.outcome) {
        case "ok":
          return `${model}${attempt}: ok (${entry.chars} chars, ${entry.elapsedMs}ms)`;
        case "http_error":
          return `${model}${attempt}: HTTP ${entry.status}`;
        case "api_error":
          return `${model}${attempt}: ${entry.status ?? "error"}`;
        case "network_error":
          return `${model}${attempt}: network error`;
        case "no_text":
          return `${model}${attempt}: no readable text in image`;
        default:
          return `${model}${attempt}: ${String(entry.outcome)}`;
      }
    })
    .join(" | ");
}

/** Verbatim OCR instructions, exactly as specified. */
const SYSTEM_PROMPT =
  "You are an accurate OCR text extraction utility. Extract and return ALL readable text from this image verbatim. Do not add intro text, explanations, or commentary. Return ONLY the extracted text content.";

/**
 * Appended to the prompt so a blank or unreadable photo is unambiguous. Without
 * this, Gemini answers "I cannot see any text in this image", and the app would
 * display that sentence as if it were the extracted text.
 */
const NO_TEXT_SENTINEL = "NO_TEXT_FOUND";
const OCR_PROMPT = `${SYSTEM_PROMPT} If the image contains no readable text at all, reply with exactly ${NO_TEXT_SENTINEL} and nothing else.`;

const FALLBACK_TEXT = SAMPLE_TEXT;

const MAX_BASE64_CHARS = 12_000_000;

type GeminiPart = { text?: string };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown[] };
  error?: { message?: string; status?: string };
};

/* ----------------------------- diagnostics ------------------------------ */

const LOG_PREFIX = "[auraread]";

/** Single-line, timestamped server log so every branch leaves a trail. */
function log(
  requestId: string,
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
) {
  const stamp = new Date().toISOString().slice(11, 23);
  const suffix = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  const text = `${LOG_PREFIX} ${stamp} [${requestId}] ${message}${suffix}`;

  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

/** Never print the whole key back to the terminal. */
function maskKey(key: string | undefined) {
  if (!key) return "(not set)";
  if (key.length <= 12) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 6)}...${key.slice(-4)} (len ${key.length})`;
}

let requestCounter = 0;
function nextRequestId() {
  requestCounter += 1;
  return `r${Date.now().toString(36)}${requestCounter}`;
}

/**
 * GET /api/ocr â€” a zero-cost health check.
 * Tells you whether the key was picked up and which models will be tried,
 * without revealing the key or spending a Gemini call.
 */
export async function GET() {
  const requestId = nextRequestId();
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = Boolean(apiKey);

  log(
    requestId,
    "info",
    "health check",
    {
      key: maskKey(apiKey),
      configured,
      models: MODEL_CANDIDATES,
      geminiModelEnv: process.env.GEMINI_MODEL ?? "(unset)",
    },
  );

  return NextResponse.json({
    configured,
    key: maskKey(apiKey),
    models: MODEL_CANDIDATES,
    geminiModelEnv: process.env.GEMINI_MODEL ?? null,
    hint: configured
      ? "Key is present. POST an image to /api/ocr to test extraction."
      : "GEMINI_API_KEY is missing. Add it to .env.local and restart the server.",
  });
}

/** Accepts `data:image/png;base64,....` or a bare base64 string + mimeType. */
function parseImagePayload(
  image: unknown,
  mimeTypeHint: unknown,
): { mimeType: string; base64: string; source: string } | null {
  if (typeof image !== "string" || image.length === 0) return null;

  const dataUrlMatch = image.match(/^data:([^;,]+);base64,(.*)$/s);
  const mimeType = (
    dataUrlMatch ? dataUrlMatch[1] : typeof mimeTypeHint === "string" ? mimeTypeHint : ""
  ).trim();

  const base64 = (dataUrlMatch ? dataUrlMatch[2] : image).replace(/\s/g, "").trim();

  if (!base64) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;

  return {
    mimeType: mimeType || "image/jpeg",
    base64,
    source: dataUrlMatch ? "data-url" : "bare-base64",
  };
}

/**
 * Failures are returned with a real HTTP status so they are impossible to miss
 * in devtools, and always carry the upstream detail so the client can show it.
 * The sample text is still attached so a live demo degrades instead of dying.
 */
function fail(
  requestId: string,
  status: number,
  reason: string,
  error: string,
  data?: Record<string, unknown>,
) {
  log(requestId, "warn", "fallback", { reason, status, ...(data ?? {}) });

  return NextResponse.json(
    { ok: false, error, reason, ...(data ?? {}), text: FALLBACK_TEXT, fallback: true },
    { status },
  );
}

export async function POST(request: Request) {
  const requestId = nextRequestId();

  try {
    log(requestId, "info", "request received", {
      method: request.method,
      contentLength: request.headers.get("content-length") ?? "unknown",
    });

    let body: unknown;
    try {
      body = await request.json();
    } catch (err) {
      return fail(
        requestId,
        400,
        "invalid_json",
        "Invalid request body. Expected JSON.",
        { detail: err instanceof Error ? err.message : String(err) },
      );
    }

    const { image, mimeType } = (body ?? {}) as {
      image?: unknown;
      mimeType?: unknown;
    };

    log(requestId, "info", "payload", {
      hasImage: Boolean(image),
      imageType: typeof image,
      imageChars: typeof image === "string" ? image.length : null,
      mimeTypeHint: typeof mimeType === "string" ? mimeType : null,
    });

    const parsed = parseImagePayload(image, mimeType);

    if (!parsed) {
      return fail(
        requestId,
        400,
        "unreadable_image",
        "No readable image was received. Please try snapping a photo or uploading a file.",
        { reason: typeof image === "string" ? "not valid base64" : "image field missing or wrong type" },
      );
    }

    log(requestId, "info", "image parsed", {
      source: parsed.source,
      mimeType: parsed.mimeType,
      base64Chars: parsed.base64.length,
      approxBytes: Math.round((parsed.base64.length * 3) / 4),
    });

    if (parsed.base64.length > MAX_BASE64_CHARS) {
      return fail(
        requestId,
        413,
        "image_too_large",
        "That image is too large to process. Please try a smaller photo.",
        { base64Chars: parsed.base64.length, limit: MAX_BASE64_CHARS },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return fail(
        requestId,
        200,
        "missing_api_key",
        "AI scanning is not configured on this deployment, so sample text is shown instead.",
        { key: maskKey(apiKey) },
      );
    }

    log(requestId, "info", "calling gemini", {
      key: maskKey(apiKey),
      models: MODEL_CANDIDATES,
    });

    let text = "";
    let usedModel = "";
    let sentinelHit = false;
    const attempts: Array<Record<string, unknown>> = [];
    let emptyReason = "";

    for (const model of MODEL_CANDIDATES) {
      /**
       * 2.5-series models think by default, which burns tokens and latency we
       * do not need for verbatim OCR. Disabling it also lowers the chance of
       * tripping free-tier quotas. Older/newer models reject the field, so we
       * only send it where it is supported.
       */
      const supportsThinkingConfig = /^gemini-2\.5/.test(model);

      const requestBody = {
        systemInstruction: { parts: [{ text: OCR_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              // `parsed.base64` is already stripped of any "data:...;base64,"
              // prefix — Gemini rejects the prefix if it is left in place.
              { text: "Extract all readable text verbatim. Return ONLY the text." },
              {
                inlineData: {
                  mimeType: parsed.mimeType,
                  data: parsed.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 8192,
          ...(supportsThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      };

      const startedAt = Date.now();

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
        let geminiRes: Response;

        try {
          geminiRes = await fetch(
            `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
              // The free tier occasionally accepts a request and then stalls.
              // Without this the browser spinner waits forever.
              signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
            },
          );
        } catch (err) {
          const isTimeout =
            err instanceof Error &&
            (err.name === "TimeoutError" ||
              err.name === "AbortError" ||
              /timed? ?out/i.test(err.message));
          const detail = isTimeout
            ? `timed out after ${GEMINI_TIMEOUT_MS}ms`
            : err instanceof Error
              ? err.message
              : String(err);
          attempts.push({ model, attempt, outcome: "network_error", detail });
          log(requestId, "error", "gemini network error", {
            model,
            attempt,
            timedOut: isTimeout,
            detail,
          });
          // Do not retry a timed-out model, but do fall through to the next
          // candidate - a lighter model often succeeds when a heavy one stalls.
          break;
        }

        const elapsedMs = Date.now() - startedAt;

        if (!geminiRes.ok) {
          const status = geminiRes.status;
          const detail = await geminiRes.text().catch(() => "");
          attempts.push({
            model,
            attempt,
            outcome: "http_error",
            status,
            detail: detail.slice(0, 400),
          });
          log(requestId, "error", "gemini http error", {
            model,
            attempt,
            status,
            elapsedMs,
            detail: detail.slice(0, 400),
          });

          if (TRANSIENT_STATUSES.has(status) && attempt < MAX_ATTEMPTS_PER_MODEL) {
            log(requestId, "warn", "transient error, retrying same model", {
              model,
              attempt,
              status,
              waitMs: RETRY_DELAY_MS,
            });
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }

        const data = (await geminiRes.json().catch((e) => {
          log(requestId, "error", "gemini response not json", {
            model,
            detail: e instanceof Error ? e.message : String(e),
          });
          return null;
        })) as GeminiResponse | null;

        if (!data) {
          attempts.push({ model, attempt, outcome: "bad_json" });
          break;
        }

        const parts = data.candidates?.[0]?.content?.parts ?? [];
        text = parts
          .map((part) => part.text ?? "")
          .join("")
          .trim();

        if (text && text.toUpperCase().replace(/[^A-Z_]/g, "") === NO_TEXT_SENTINEL) {
          log(requestId, "info", "image reported no readable text", { model, attempt });
          text = "";
          sentinelHit = true;
          emptyReason = "sentinel_no_text";
          attempts.push({ model, attempt, outcome: "no_text", reason: "sentinel" });
          break;
        }

        if (data.error) {
          attempts.push({
            model,
            attempt,
            outcome: "api_error",
            status: data.error.status,
            detail: data.error.message,
          });
          log(requestId, "error", "gemini api error", {
            model,
            attempt,
            status: data.error.status,
            detail: data.error.message,
          });
          break;
        }

        if (!text) {
          emptyReason =
            data.promptFeedback?.blockReason ??
            data.candidates?.[0]?.finishReason ??
            "empty response";
          attempts.push({
            model,
            attempt,
            outcome: "no_text",
            finishReason: data.candidates?.[0]?.finishReason ?? null,
            blockReason: data.promptFeedback?.blockReason ?? null,
            parts: parts.length,
          });
          log(requestId, "warn", "gemini returned no text", {
            model,
            attempt,
            reason: emptyReason,
            partCount: parts.length,
            elapsedMs,
          });
          break;
        }

        usedModel = model;
        attempts.push({ model, attempt, outcome: "ok", elapsedMs, chars: text.length });
        log(requestId, "info", "gemini ok", {
          model,
          attempt,
          elapsedMs,
          chars: text.length,
          finishReason: data.candidates?.[0]?.finishReason ?? null,
        });
        break;
      }

      if (usedModel || sentinelHit) break;
    }

    if (!text) {
      /**
       * Distinguish a genuinely blank/unreadable photo from a real outage.
       * A sentinel hit is authoritative: the model did look at the image and
       * reported it has no text, so an unrelated 429 from an earlier model must
       * not turn that into a misleading "service unavailable" message.
       */
      const noTextDetected =
        sentinelHit ||
        (attempts.length > 0 && attempts.every((entry) => entry.outcome === "no_text"));

      return fail(
        requestId,
        noTextDetected ? 200 : 502,
        noTextDetected ? "no_text_detected" : "gemini_unavailable",
        noTextDetected
          ? "No text could be detected in that image. Try more light, or hold the page flat and fill the frame."
          : "The scanning service is temporarily unavailable. Sample text is shown instead.",
        {
          attempts,
          emptyReason: emptyReason || null,
          details: summariseAttempts(attempts),
        },
      );
    }

    log(requestId, "info", "success", { model: usedModel, chars: text.length });

    return NextResponse.json({
      ok: true,
      text,
      fallback: false,
      model: usedModel,
      chars: text.length,
    });
  } catch (error) {
    console.error("GEMINI OCR ERROR:", error);
    log(requestId, "error", "unexpected failure", {
      detail: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Something went wrong while reading that image. Sample text is shown instead.",
        reason: "unexpected_exception",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        text: FALLBACK_TEXT,
        fallback: true,
      },
      { status: 500 },
    );
  }
}
