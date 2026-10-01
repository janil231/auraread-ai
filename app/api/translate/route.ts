import { NextResponse } from "next/server";

import { GeminiError, generateText, MODEL_CANDIDATES } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Well past a full textbook page; guards against someone posting a whole book. */
const MAX_CHARS = 20_000;

const SYSTEM_PROMPT = `You translate short English reading passages into natural, everyday Tagalog (Filipino).

Rules:
- Use the Tagalog people actually speak. Do not produce stiff, textbook Tagalog.
- Keep proper nouns, numbers, measurements and units as they are.
- Preserve the meaning exactly. Do not summarise, add, or omit information.
- Keep the paragraph breaks from the original.
- If a term has no good Tagalog equivalent, keep the English term.
- Reply with the translation only. No notes, no explanations, no quotes around it.`;

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "translate",
    models: MODEL_CANDIDATES,
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}

export async function POST(request: Request) {
  let body: { text?: unknown };

  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "That request could not be read as JSON.", reason: "invalid_json" },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json(
      { ok: false, error: "There is no text to translate yet.", reason: "no_text" },
      { status: 400 },
    );
  }

  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `That text is too long to translate (max ${MAX_CHARS.toLocaleString()} characters).`,
        reason: "too_long",
      },
      { status: 413 },
    );
  }

  try {
    const { text: translation, model } = await generateText(text, {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.3,
      maxOutputTokens: 8192,
    });

    return NextResponse.json({ ok: true, translation, model });
  } catch (error) {
    const attempts = error instanceof GeminiError ? error.attempts : [];
    const detail =
      error instanceof GeminiError ? error.message : String(error);

    console.error("[auraread] translate failed:", detail);

    return NextResponse.json(
      {
        ok: false,
        error: "The translation service is unavailable right now. Please try again.",
        reason: "translate_unavailable",
        details: detail,
        attempts,
      },
      { status: 502 },
    );
  }
}