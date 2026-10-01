import { NextResponse } from "next/server";

import { extractJson, GeminiError, generateText, MODEL_CANDIDATES } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CHARS = 20_000;
/** Guard against a runaway response producing an unreadable wall of pills. */
const MAX_CONCEPTS = 10;
const MAX_CONCEPT_CHARS = 90;

const SYSTEM_PROMPT = `You turn a short passage into a study mind map.

Reply with JSON only, no prose and no markdown fences, in exactly this shape:
{
  "mainTopic": "Sharks",
  "keyConcepts": ["500+ species", "Great White / Hammerhead", "Found in all oceans"]
}

Rules:
- mainTopic: the single clearest name for the subject, 2-4 words.
- keyConcepts: 4 to 8 short factual points from the passage.
- Each keyConcept must be a standalone phrase, not a sentence. No trailing full stops.
- Keep the passage's own facts. Do not invent anything.
- Keep scientific terms in the language the passage uses.`;

/**
 * Tagalog variant. The JSON shape is identical so the client needs no special
 * case - only the wording of the nodes changes.
 */
const TL_SYSTEM_PROMPT = `You turn a short Filipino (Tagalog) passage into a study mind map.

Reply with JSON only, no prose and no markdown fences, in exactly this shape:
{
  "mainTopic": "Mga Pating",
  "keyConcepts": ["Higit sa 500 iba't ibang uri ng pating", "Nakatira sa lahat ng karagatan"]
}

Rules:
- mainTopic: the clearest name for the subject, 2-4 words, in natural Tagalog.
- keyConcepts: 4 to 8 short factual points from the passage, in natural Tagalog.
- Write the way Filipinos actually speak. Do not produce stiff, textbook Tagalog.
- Each keyConcept must be a standalone phrase, not a sentence. No trailing full stops.
- Keep the passage's own facts. Do not invent anything.
- Keep proper nouns, numbers and measurements exactly as the passage has them.
- Do not switch back to English, even for scientific terms.`;

type MindMap = {
  mainTopic: string;
  keyConcepts: string[];
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "mindmap",
    models: MODEL_CANDIDATES,
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}

export async function POST(request: Request) {
  let body: { text?: unknown; language?: unknown };

  try {
    body = (await request.json()) as { text?: unknown; language?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "That request could not be read as JSON.", reason: "invalid_json" },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json(
      { ok: false, error: "There is no text to build a mind map from yet.", reason: "no_text" },
      { status: 400 },
    );
  }

  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `That text is too long (max ${MAX_CHARS.toLocaleString()} characters).`,
        reason: "too_long",
      },
      { status: 413 },
    );
  }

  // Default to English so an older or hand-made client still behaves.
  const language: "en" | "tl" = body.language === "tl" ? "tl" : "en";

  try {
    const raw = await generateText(
      `Build a mind map from this passage:\n\n${text}`,
      {
        systemInstruction: language === "tl" ? TL_SYSTEM_PROMPT : SYSTEM_PROMPT,
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    );

    // Validate rather than trust: a malformed shape would otherwise crash the
    // render with "cannot read property of undefined" instead of a real message.
    const parsed = extractJson(raw.text) as Partial<MindMap>;
    const mainTopic =
      typeof parsed.mainTopic === "string" ? parsed.mainTopic.trim() : "";
    const keyConcepts = Array.isArray(parsed.keyConcepts)
      ? parsed.keyConcepts
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) =>
            c
              .replace(/\s+/g, " ")
              .replace(/[.\s]+$/, "")
              .slice(0, MAX_CONCEPT_CHARS)
              .trim(),
          )
          .filter(Boolean)
          .slice(0, MAX_CONCEPTS)
      : [];

    if (!mainTopic || keyConcepts.length === 0) {
      throw new GeminiError(
        `Model returned no usable structure (mainTopic=${Boolean(mainTopic)}, concepts=${keyConcepts.length})`,
        [{ model: raw.model, outcome: "invalid_shape" }],
      );
    }

    return NextResponse.json({
      ok: true,
      mindmap: { mainTopic, keyConcepts } satisfies MindMap,
      model: raw.model,
      language,
    });
  } catch (error) {
    const isParse =
      error instanceof SyntaxError ||
      (error instanceof GeminiError && /invalid_shape/.test(error.message));
    const attempts = error instanceof GeminiError ? error.attempts : [];
    const detail =
      error instanceof GeminiError ? error.message : String(error);

    console.error("[auraread] mindmap failed:", detail);

    return NextResponse.json(
      {
        ok: false,
        error: isParse
          ? "The study summary came back in an unexpected shape. Try again."
          : "The summary service is unavailable right now. Please try again.",
        reason: isParse ? "mindmap_bad_shape" : "mindmap_unavailable",
        details: detail,
        attempts,
      },
      { status: 502 },
    );
  }
}