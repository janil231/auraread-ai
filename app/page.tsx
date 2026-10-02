"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  BookOpen,
  Brain,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Copy,
  Globe,
  Image as ImageIcon,
  Languages,
  Loader2,
  Menu,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Ruler,
  ScanLine,
  Settings,
  Sparkles,
  TriangleAlert,
  Type,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { SAMPLE_TEXT } from "@/lib/sample-text";

const SAMPLE_IMAGE_SRC = "/sample-page.png";

/* ------------------------- reading comfort tools ------------------------- */

type TintId = "default" | "cream" | "blue" | "yellow";

const READING_TINTS: Record<
  TintId,
  { label: string; swatch: string; surface: string; ink: string; muted: string; border: string }
> = {
  default: {
    label: "Default",
    swatch: "bg-gradient-to-br from-slate-100 to-slate-200",
    surface: "bg-gradient-to-br from-slate-100 to-slate-200",
    ink: "text-slate-800",
    muted: "text-slate-500",
    border: "border-slate-300",
  },
  cream: {
    label: "Warm Cream",
    swatch: "bg-[#FDF6E3]",
    surface: "bg-[#FDF6E3]",
    ink: "text-[#433422]",
    muted: "text-[#7a6a52]",
    border: "border-[#e8dcc0]",
  },
  blue: {
    label: "Pastel Blue",
    swatch: "bg-[#E0F2FE]",
    surface: "bg-[#E0F2FE]",
    ink: "text-[#1E293B]",
    muted: "text-[#5b6b80]",
    border: "border-[#b9dcf5]",
  },
  yellow: {
    label: "Soft Yellow",
    swatch: "bg-[#FEF9C3]",
    surface: "bg-[#FEF9C3]",
    ink: "text-[#422006]",
    muted: "text-[#7a6534]",
    border: "border-[#ecdfa2]",
  },
};

const TINT_ORDER: TintId[] = ["default", "cream", "blue", "yellow"];

/**
 * ASD Zen Sensory Focus surface. One flat, low-saturation earth tone that
 * replaces the page tint while the Autism profile is on - warm sand rather
 * than pure grey, no gradient, no decorative border, no colour competing with
 * the words.
 *
 * Only the background and text colour differ from a normal page. Font weight,
 * size, tracking and line height are untouched, so switching the profile in
 * mid-sentence cannot reflow the karaoke line.
 */
const ZEN_SURFACE_CLASS = "bg-[#E7E1D6]";
const ZEN_INK_CLASS = "text-[#3F382E]";
const ZEN_BORDER_CLASS = "border-[#D2C9B8]";

type WorkspaceTab = "reader" | "mindmap";

/**
 * The reading profiles are one single-choice set: a page can be set up for
 * Dyslexia, for Autism, or for neither, but never for both at once.
 */
type ReadingProfile = "dyslexia" | "autism" | "none";

/** Radio-group order, which is also the arrow-key order inside the modal. */
const PROFILE_ORDER: ReadingProfile[] = ["dyslexia", "autism", "none"];

const PROFILE_KEYS = new Set([
  "ArrowDown",
  "ArrowRight",
  "ArrowUp",
  "ArrowLeft",
  "Home",
  "End",
]);

/** Which language the reader surface is showing. */
type ReadingLang = "en" | "fil";

/**
 * Digraphs are matched before single letters so "sh" wins over the "h" that
 * follows it. "ng" and "ts" are included because Tagalog leans on them heavily
 * ("ang", "mataas") and the phonics toggle has to work on that text too.
 */
const PHONICS_DIGRAPHS = ["ng", "ts", "sh", "ch", "th"];
const PHONICS_PATTERN = new RegExp(
  `(${PHONICS_DIGRAPHS.join("|")})|([aeiouAEIOU])`,
  "g",
);

/** Dim colour for the ruler, so it reads correctly on every tint. */
const RULER_DIM_CLASS = "bg-slate-900/55";

/**
 * Splits text into phonics spans without touching the stored string, so speech
 * synthesis, copy-to-clipboard and the Tagalog view all keep working on the
 * original text.
 */
function renderPhonics(text: string, keyPrefix = "p", karaoke = false): React.ReactNode[] {
  const pattern = new RegExp(PHONICS_PATTERN.source, "g");
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const isDigraph = Boolean(match[1]);
    nodes.push(
      <span
        key={`${keyPrefix}-${key++}`}
        // `font-semibold` is kept in the karaoke variant on purpose. Dropping
        // the phonics markup on the active word would also drop its font
        // weight, which changes the word's width and reflows the line - the
        // exact jitter we are trying to eliminate. Only the colour is dropped,
        // so the highlight's own text colour shows through.
        className={
          karaoke
            ? "font-semibold"
            : isDigraph
              ? "text-emerald-600 font-semibold"
              : "text-red-600 font-semibold"
        }
      >
        {match[0]}
      </span>,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 34;
const FONT_SIZE_STEP = 2;

/* ------------------- literal language / idiom explainer ------------------- */

/**
 * Plain restatements of common English figures of speech, for the Literal
 * Language profile.
 *
 * This is a fixed lookup table on purpose. Nothing here is generated, and no
 * model is asked to interpret a page: each entry only restates what the printed
 * words mean, in the same neutral way a dictionary defines an idiom. BIGKAS
 * stays a formatting utility - it does not assess the reader, explain the
 * material, or offer guidance about it.
 */
const IDIOM_GLOSSARY: { term: string; plain: string }[] = [
  { term: "break the ice", plain: "start a conversation that would otherwise be awkward" },
  { term: "once in a blue moon", plain: "very rarely, almost never" },
  { term: "under the weather", plain: "feeling slightly unwell" },
  { term: "cost an arm and a leg", plain: "be very expensive" },
  { term: "piece of cake", plain: "be very easy to do" },
  { term: "hit the books", plain: "study hard" },
  { term: "on the same page", plain: "agree with each other" },
  { term: "in the same boat", plain: "be in the same difficult situation" },
  { term: "better late than never", plain: "arriving late is still better than not arriving" },
  { term: "see eye to eye", plain: "agree with each other completely" },
  { term: "let the cat out of the bag", plain: "reveal a secret by accident" },
  { term: "spill the beans", plain: "give away a secret" },
  { term: "burn the midnight oil", plain: "work late into the night" },
  { term: "pull yourself together", plain: "calm down and behave calmly" },
  { term: "get the hang of it", plain: "learn how to do it after practising a little" },
  { term: "read between the lines", plain: "notice the meaning that is implied but not written" },
  { term: "call it a day", plain: "stop work for now" },
  { term: "back to the drawing board", plain: "start the attempt again from the beginning" },
  { term: "jump on the bandwagon", plain: "join something because others have joined it" },
  { term: "go the extra mile", plain: "do more work than was asked" },
];

/**
 * Builds one case-insensitive alternation over every glossary term, longest
 * first so "in the same boat" is never shadowed by a shorter overlapping entry.
 */
const IDIOM_MATCH_PATTERN = new RegExp(
  `\\b(${[...IDIOM_GLOSSARY]
    .map((entry) => entry.term)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b`,
  "gi",
);

/**
 * Which figures of speech actually appear on this page. Matching is plain text
 * search - no model call, no inference about the reader.
 */
function matchIdioms(text: string): { term: string; plain: string; count: number }[] {
  const found: { term: string; plain: string; count: number }[] = [];

  for (const entry of IDIOM_GLOSSARY) {
    const pattern = new RegExp(
      `\\b${entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    const count = text.match(pattern)?.length ?? 0;
    if (count > 0) found.push({ ...entry, count });
  }

  return found;
}

/**
 * Reader rendering for Literal Language mode: figures of speech get a flat
 * highlight and a dotted underline, everything else is passed through with
 * phonics applied exactly as the plain reader does it.
 *
 * The marking is background colour and `text-decoration` only. Neither changes
 * a glyph's advance width, so this mode cannot reflow the line - the same rule
 * the karaoke highlight follows.
 */
function renderLiteralText(
  text: string,
  phonicsOn: boolean,
  keyPrefix = "l",
): React.ReactNode[] {
  const pattern = new RegExp(IDIOM_MATCH_PATTERN.source, "gi");
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      nodes.push(
        phonicsOn ? renderPhonics(segment, `${keyPrefix}-${key++}`) : segment,
      );
    }

    nodes.push(
      <span
        key={`${keyPrefix}-${key++}`}
        className="rounded-[2px] bg-sky-100/80 underline decoration-dotted decoration-2 underline-offset-4 decoration-sky-700"
      >
        {match[0]}
      </span>,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    nodes.push(phonicsOn ? renderPhonics(segment, `${keyPrefix}-${key++}`) : segment);
  }

  return nodes;
}

/* ------------------------------- karaoke ------------------------------- */

/**
 * One piece of the reading text: either a word (highlightable) or the
 * whitespace between words, which must be emitted verbatim so the rendered
 * output still equals `displayText` exactly. That matters because speech
 * reports offsets into the raw string, and the Reading Ruler measures the
 * same string.
 */
type TextToken = { text: string; start: number; isWord: boolean };

const TOKEN_PATTERN = /(\s+)|(\S+)/g;

function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const pattern = new RegExp(TOKEN_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      // Zero-length match: skip it rather than spin forever.
      pattern.lastIndex += 1;
      continue;
    }
    tokens.push({ text: match[0], start: match.index, isWord: Boolean(match[2]) });
  }

  return tokens;
}

/**
 * Maps a speech boundary offset onto a token index.
 *
 * `charIndex` is an offset into the utterance text, so it should land inside a
 * word. Engines are not consistent, though: some report the offset of the space
 * before the word, some collapse runs of whitespace, and a few report an index
 * past the end of the string. So we snap to the nearest word at or before the
 * reported offset rather than trusting it to be exact.
 */
function findTokenIndexAt(tokens: TextToken[], charIndex: number): number {
  let found = -1;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.isWord) continue;
    if (charIndex < token.start) break;
    if (charIndex < token.start + token.text.length) return i;
    found = i;
  }

  return found;
}

/**
 * Karaoke highlight: paints only.
 *
 * Every declaration here is `background-color` or `text-color`. Nothing that
 * participates in layout may appear - no `font-weight`, no `scale`, no padding,
 * no margin, no `display`, no `letter-spacing`. Any of those changes the active
 * word's box, which reflows the line and makes the surrounding words jump as
 * the highlight moves. `rounded` is safe (paint-only, and the radius is fixed
 * rather than dynamic) and `transition-colors` is safe because it animates only
 * the two properties that are allowed to change.
 *
 * The `text-shadow` fakes extra weight without touching `font-weight`, so the
 * lit word reads as emphasised while its advance width stays identical.
 */
const KARAOKE_BASE_CLASS =
  "rounded-[2px] transition-colors duration-100 motion-reduce:transition-none";

const KARAOKE_ACTIVE_CLASS =
  `${KARAOKE_BASE_CLASS} bg-amber-300 text-slate-950 [text-shadow:0_0_0.5px_currentColor]`;

const KARAOKE_IDLE_CLASS = `${KARAOKE_BASE_CLASS} bg-transparent`;

/**
 * Renders the reading text as karaoke tokens, colouring phonics inside each word
 * exactly as the plain reader does.
 *
 * Structural stability is the whole point: every word is wrapped in the same
 * element with the same inline formatting regardless of whether it is the active
 * one, so lighting a word can only change paint. Word nodes keep identical
 * markup across states - same span, same inner spans, same font-weight - and the
 * only difference is the class list.
 */
function renderKaraokeText(
  text: string,
  tokens: TextToken[],
  activeTokenIndex: number,
  phonicsOn: boolean,
  keyPrefix: string,
  activeRef: React.RefObject<HTMLElement | null>,
): React.ReactNode[] {
  void text;
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    const isActive = index === activeTokenIndex;

    if (!token.isWord) {
      return <span key={key}>{token.text}</span>;
    }

    // Phonics runs for the active word too, in its colourless variant, so the
    // font-weight is identical to every other word. Colour alone changes.
    const body = phonicsOn ? (
      renderPhonics(token.text, key, isActive)
    ) : (
      token.text
    );

    if (!isActive) {
      // Shares the active word's base classes so only colour differs. Paint-only,
      // so still zero reflow.
      return (
        <span key={key} className={KARAOKE_IDLE_CLASS}>
          {body}
        </span>
      );
    }

    return (
      <span
        key={key}
        ref={activeRef}
        className={KARAOKE_ACTIVE_CLASS}
        data-karaoke-active="true"
      >
        {body}
      </span>
    );
  });
}

const ACCEPTED_IMAGE_TYPES = "image/png, image/jpeg, image/jpg, image/webp";

/**
 * `/api/ocr` accepts a base64 data URL or a bare base64 string - it cannot
 * resolve a `blob:` URL or a server path, because those only mean something
 * inside this browser tab. So every source is normalised to base64 here first.
 *
 * Reading the blob back out preserves its real MIME type (webp stays webp,
 * jpeg stays jpeg), and the server then forwards that straight into Gemini's
 * `inlineData.mimeType`.
 */
async function toBase64DataUrl(source: Blob | string): Promise<string> {
  if (typeof source === "string" && source.startsWith("data:")) return source;

  const blob =
    source instanceof Blob
      ? source
      : await fetch(source).then((res) => {
          if (!res.ok) {
            throw new Error(`Could not load the image (HTTP ${res.status}).`);
          }
          return res.blob();
        });

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });

  if (!dataUrl.startsWith("data:image/")) {
    throw new Error(
      `That file is not a supported image (got "${blob.type || "unknown type"}").`,
    );
  }

  return dataUrl;
}

type Stage = "A" | "B";
type CamState = "idle" | "starting" | "ready" | "denied" | "unavailable";

/**
 * Which working screen the student is on: the camera, or the reader.
 *
 * This does NOT include the visual schedule. The schedule is not a place the
 * student navigates to - it is what the Autism profile replaces the landing
 * screen with - so it is derived from the chosen profile rather than stored
 * here. Keeping it out of this union stops the two from disagreeing.
 */
type AppState = "camera" | "workspace";

/* ------------------------- visual schedule (TEACCH) ------------------------- */

/**
 * A schedule item's position in the day, as a TEACCH work system presents it:
 * finished, happening right now, or still to come.
 */
type ScheduleStatus = "done" | "active" | "pending";

/**
 * Mock timetable. `status` is written out rather than derived from the clock,
 * so the demo always has one clearly marked "now" item to start from. A real
 * deployment would derive this from the student's actual timetable instead.
 */
const VISUAL_SCHEDULE: {
  time: string;
  label: string;
  status: ScheduleStatus;
}[] = [
  { time: "8:00 AM", label: "Reading", status: "done" },
  { time: "9:00 AM", label: "Math", status: "done" },
  { time: "10:00 AM", label: "Science", status: "active" },
  { time: "11:00 AM", label: "Art", status: "pending" },
  { time: "12:00 PM", label: "Lunch", status: "pending" },
  { time: "1:00 PM", label: "Recess", status: "pending" },
  { time: "2:00 PM", label: "Writing", status: "pending" },
];

const SCHOOL_END_TIME = "3:00 PM";

type OcrResult = {
  ok: boolean;
  text: string;
  error?: string;
  reason?: string;
  details?: string;
  fallback?: boolean;
  model?: string;
  chars?: number;
};

type Notice = {
  tone: "error" | "warn" | "info";
  text: string;
  detail?: string;
};

function CornerBracket({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute h-7 w-7 rounded-[6px] border-2 border-sky-400/80 shadow-[0_0_12px_rgba(56,189,248,0.35)] ${className}`}
    />
  );
}

type ToolButtonProps = {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
  full?: boolean;
  title?: string;
};

function ToolButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  tone = "default",
  full = false,
  title,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={active}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
        "disabled:cursor-not-allowed disabled:opacity-45",
        full ? "w-full" : "",
        active
          ? "border-sky-400 bg-sky-400/15 text-sky-200"
          : tone === "danger"
            ? "border-slate-700 bg-slate-800/60 text-slate-200 hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200"
            : "border-slate-700 bg-slate-800/60 text-slate-200 hover:border-slate-500 hover:bg-slate-700/60",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Per-feature accent colours, so every profile toggle reads as its own control. */
type ToggleAccent = "sky" | "amber" | "red" | "violet" | "emerald";

const TOGGLE_ACCENT_CLASS: Record<
  ToggleAccent,
  { on: string; icon: string; track: string }
> = {
  sky: { on: "border-sky-400 bg-sky-400/15", icon: "text-sky-300", track: "bg-sky-500" },
  amber: { on: "border-amber-400/60 bg-amber-400/10", icon: "text-amber-300", track: "bg-amber-500" },
  red: { on: "border-red-400/50 bg-red-400/10", icon: "text-red-300", track: "bg-red-500" },
  violet: {
    on: "border-violet-400/60 bg-violet-400/10",
    icon: "text-violet-300",
    track: "bg-violet-500",
  },
  emerald: {
    on: "border-emerald-400/60 bg-emerald-400/10",
    icon: "text-emerald-300",
    track: "bg-emerald-500",
  },
};

type ToggleRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onChange: () => void;
  disabled?: boolean;
  accent?: ToggleAccent;
};

/**
 * One feature switch, used by both the Accessibility Profiles drawer and the
 * settings drawer so the same feature always looks and behaves the same wherever
 * it is reached from.
 *
 * The switch pill is decorative (`aria-hidden`); the button itself carries
 * `aria-pressed`, so the control's state is announced once, not twice.
 */
function ToggleRow({
  icon,
  title,
  description,
  active,
  onChange,
  disabled = false,
  accent = "sky",
}: ToggleRowProps) {
  const palette = TOGGLE_ACCENT_CLASS[accent];

  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={active}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left",
        "transition-all duration-300 motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
        "disabled:cursor-not-allowed disabled:opacity-45",
        active ? palette.on : "border-slate-700/70 bg-slate-800/50 hover:border-slate-600",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={["shrink-0", active ? palette.icon : "text-slate-400"].join(" ")}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-100">{title}</span>
          <span className="block text-[11px] leading-snug text-slate-400">{description}</span>
        </span>
      </span>
      <span
        aria-hidden="true"
        className={[
          "relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 motion-reduce:transition-none",
          active ? palette.track : "bg-slate-600",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-300 motion-reduce:transition-none",
            active ? "left-[22px]" : "left-0.5",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

type ProfileTone = "sky" | "emerald";

const PROFILE_TONE_CLASS: Record<
  ProfileTone,
  { card: string; chip: string; mark: string; icon: string }
> = {
  sky: {
    card: "border-sky-400 bg-sky-500/10",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    mark: "border-sky-400 bg-sky-400 text-slate-950",
    icon: "bg-sky-500/15 text-sky-300",
  },
  emerald: {
    card: "border-emerald-400 bg-emerald-500/10",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    mark: "border-emerald-400 bg-emerald-400 text-slate-950",
    icon: "bg-emerald-500/15 text-emerald-300",
  },
};

type ProfileCardProps = {
  id: string;
  index: number;
  icon: React.ReactNode;
  title: string;
  summary: string;
  /** Passive labels, not controls: selecting the card applies all of them. */
  features: string[];
  selected: boolean;
  onSelect: () => void;
  tone: ProfileTone;
};

/**
 * One option of the reading-profile radio group.
 *
 * The card is a `role="radio"` button, so it carries `aria-checked` and is part
 * of a single-choice set rather than an independent on/off switch. Selection is
 * shown twice over - a ring around the card and a filled tick - because colour
 * alone is not a reliable signal.
 */
function ProfileCard({
  id,
  index,
  icon,
  title,
  summary,
  features,
  selected,
  onSelect,
  tone,
}: ProfileCardProps) {
  const palette = PROFILE_TONE_CLASS[tone];

  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      data-profile-index={index}
      onClick={onSelect}
      className={[
        "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left",
        "transition-all duration-300 motion-reduce:transition-none active:scale-[0.99]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
        selected
          ? `${palette.card} ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-900`
          : "border-slate-700 bg-slate-800/40 hover:border-slate-600",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          palette.icon,
        ].join(" ")}
      >
        {icon}
      </span>

      {/* spans, not divs: the whole card is one button, so its contents must be
          phrasing content. */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          <span
            aria-hidden="true"
            className={[
              "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
              "transition-all duration-300 motion-reduce:transition-none",
              selected ? palette.mark : "border-slate-600 bg-transparent",
            ].join(" ")}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
          {summary}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {features.map((feature) => (
            <span
              key={feature}
              className={[
                "rounded-full border px-2 py-0.5 text-[10px]",
                selected ? palette.chip : "border-slate-700 text-slate-500",
              ].join(" ")}
            >
              {feature}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

type HeaderButtonProps = {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  expanded?: boolean;
  controls: string;
};

/**
 * Left / right button of the sticky reading header. The visible text label is
 * hidden under 640px to keep the row on one line down to 360px, so an
 * `sr-only` copy carries the accessible name instead of losing it.
 */
function HeaderButton({ onClick, icon, label, expanded, controls }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/70 px-2.5 py-2",
        "text-xs font-medium text-slate-200 transition-all duration-300 motion-reduce:transition-none",
        "hover:border-slate-500 hover:bg-slate-700/60 active:scale-95",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
      ].join(" ")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

type VisualScheduleProps = {
  onStartTask: () => void;
};

/**
 * The Autism profile's screen, laid out the way a TEACCH visual schedule
 * presents a day: a fixed, visible list of what comes next, with one item
 * clearly marked as happening now.
 *
 * This is shown *because* the Autism profile is selected, not because the
 * student navigated here - see `showSchedule` in `Home`. Starting a task
 * returns to the camera and deliberately leaves the profile alone, so Zen
 * Sensory Focus and Literal Language are still in force once the page is read.
 *
 * Two accessibility decisions are deliberate here:
 *
 * 1. Status is never carried by colour alone. Every row states its status in
 *    words ("Finished", "Now", "Later"), so the list still reads correctly in
 *    greyscale, in high-contrast mode, and to a screen reader. The emoji are
 *    `aria-hidden` for the same reason - assistive tech would otherwise read
 *    out "white heavy check mark" before the actual label.
 * 2. The pulse on the current row is decoration, so it is disabled under
 *    `prefers-reduced-motion`. Nothing about the row's meaning depends on it.
 */
function VisualSchedule({ onStartTask }: VisualScheduleProps) {
  /**
   * Rendered after mount rather than during render: the server and the browser
   * can be in different timezones, and a date computed on both sides would
   * disagree and trip a hydration error.
   */
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    );
  }, []);

  const activeItem = VISUAL_SCHEDULE.find((item) => item.status === "active");
  const remaining = VISUAL_SCHEDULE.filter((item) => item.status === "pending")
    .length;

  return (
    <div className="mx-auto mt-8 w-full max-w-md px-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
          <span aria-hidden="true">📅</span> TODAY
          <span className="mt-1 block text-base font-semibold text-slate-300 sm:text-lg">
            {today ?? "…"}
          </span>
        </h2>

        <ul className="mt-5 space-y-2.5">
          {VISUAL_SCHEDULE.map((item) => {
            const isActive = item.status === "active";
            const isDone = item.status === "done";

            return (
              <li key={`${item.time}-${item.label}`}>
                <div
                  aria-current={isActive ? "true" : undefined}
                  className={[
                    "rounded-xl border p-3.5 transition-all duration-300 motion-reduce:transition-none",
                    isActive
                      ? [
                          "border-blue-500 bg-blue-900/30",
                          "shadow-[0_0_0_3px_rgba(59,130,246,0.18)]",
                          "animate-pulse motion-reduce:animate-none",
                        ].join(" ")
                      : isDone
                        ? "border-slate-800 bg-slate-800/40 opacity-50"
                        : "border-slate-800 bg-slate-900",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    {/* Status marker. The visible emoji is decorative; the word
                        beside it is what actually carries the status. */}
                    <span aria-hidden="true" className="text-xl leading-none">
                      {isDone ? "✅" : isActive ? "🔵" : "⬜"}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-100">
                        {item.time} — {item.label}
                      </span>
                      <span className="block text-[11px] font-medium text-slate-400">
                        {isDone ? "Finished" : isActive ? "Now" : "Later"}
                        {isDone && " (DONE!)"}
                      </span>
                    </span>

                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_10px_2px_rgba(96,165,250,0.75)]"
                      />
                    )}
                  </div>

                  {isActive && (
                    <button
                      id="schedule-start-task"
                      type="button"
                      onClick={onStartTask}
                      className={[
                        "mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl",
                        "bg-blue-500 px-4 py-3 text-sm font-bold text-slate-950",
                        "transition-all duration-300 motion-reduce:transition-none",
                        "hover:bg-blue-400 active:scale-[0.98]",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300",
                      ].join(" ")}
                    >
                      <span aria-hidden="true">📸</span>
                      Open Scanner to Start
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Predictability is the point of this screen: how much is left, and
            when the day is over. */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <p className="text-sm font-semibold text-slate-300">
            <span aria-hidden="true">⏳</span> {remaining} activities left
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-300">
            <span aria-hidden="true">🏁</span> School ends at {SCHOOL_END_TIME}
          </p>
        </div>
      </div>
    </div>
  );
}

type NoticeBannerProps = {
  notice: Notice;
  onDismiss: () => void;
};

/**
 * Shared status message. Rendered above the camera panel on stage A and at the
 * top of the reader's own scroll area on stage B, so a scanner error is still
 * the first thing you read whichever stage you are in.
 */
function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        "mb-5 flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm",
        notice.tone === "error"
          ? "border-rose-500/60 bg-rose-500/15 text-rose-50 shadow-lg shadow-rose-950/40"
          : notice.tone === "warn"
            ? "border-amber-500/50 bg-amber-500/12 text-amber-100"
            : "border-slate-600 bg-slate-800/70 text-slate-200",
      ].join(" ")}
    >
      <TriangleAlert
        className={[
          "mt-0.5 h-4 w-4 shrink-0",
          notice.tone === "error" ? "text-rose-300" : "text-amber-300",
        ].join(" ")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {notice.tone === "error" && (
          <p className="mb-0.5 text-xs font-bold uppercase tracking-wider text-rose-300">
            Scanner error
          </p>
        )}
        <p className="font-medium leading-snug">{notice.text}</p>
        {notice.detail && (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-current/20 bg-black/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed opacity-90">
            {notice.detail}
          </pre>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 text-current/70 transition hover:bg-white/10"
        aria-label="Dismiss message"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function Home() {
  const [appState, setAppState] = useState<AppState>("camera");
  /**
   * Set once the student starts a task from the Autism visual schedule. It is
   * cleared again whenever the profile is re-chosen, so picking Autism a second
   * time brings the schedule back rather than leaving it permanently skipped.
   */
  const [scheduleDismissed, setScheduleDismissed] = useState(false);
  const [stage, setStage] = useState<Stage>("A");
  const [camState, setCamState] = useState<CamState>("idle");
  const [camMessage, setCamMessage] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [scanSeconds, setScanSeconds] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [originalText, setExtractedText] = useState("");
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const [dyslexiaFocus, setDyslexiaFocus] = useState(true);
  const [fontSize, setFontSize] = useState(19);
  const [isSpeaking, setIsSpeaking] = useState(false);
  /**
   * Karaoke cursor. `charIndex` is the offset of the word being spoken in the
   * utterance text; `null` means "not reading", which is what clears the
   * highlight instantly on stop.
   */
  const [karaokeCharIndex, setKaraokeCharIndex] = useState<number | null>(null);
  const [karaokeWordLength, setKaraokeWordLength] = useState(0);
  const [copied, setCopied] = useState(false);

  const [tint, setTint] = useState<TintId>("default");
  const [phonicsOn, setPhonicsOn] = useState(false);
  const [rulerOn, setRulerOn] = useState(false);
  const [rulerTop, setRulerTop] = useState<number | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("reader");

  /**
   * Accessibility-profile features. Both are display-level: they restyle the
   * reader surface or mark up the words already on the page. Neither replaces
   * or resets any other state, so switching one mid-sentence only repaints.
   */
  const [asdZenFocus, setAsdZenFocus] = useState(false);
  const [literalLanguage, setLiteralLanguage] = useState(false);

  /**
   * Sticky-header overlays. Both belong to the reading stage; opening one
   * closes the other so they never stack on a short screen.
   */
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Full-screen view of the page photo. The thumbnail strip is gone in favour
   * of a single compact button, so the lightbox is the only way to see the
   * original at full size.
   */
  const [photoOpen, setPhotoOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [tagalog, setTagalog] = useState("");
  const [readingLang, setReadingLang] = useState<ReadingLang>("en");
  const [isMapping, setIsMapping] = useState(false);
  const [mindmap, setMindmap] = useState<{
    lang: "en" | "tl";
    mainTopic: string;
    keyConcepts: string[];
  } | null>(null);

  // One line of text at the current font size, used to size the ruler bar.
  const rulerLineHeight = Math.round(fontSize * (dyslexiaFocus ? 2.15 : 1.85));

  /**
   * The single text the reading tools act on. English and Tagalog share one
   * reader surface, so phonics and the ruler must follow whichever is showing
   * rather than being wired to one string.
   */
  /**
   * Fall back to English while the translation is in flight, so the reader
   * never blanks out on a slow or failed request.
   */
  const displayText = readingLang === "fil" && tagalog ? tagalog : originalText;
  const isReadingSurface = tab === "reader";
  /**
   * Reflects what the user asked for, not whether the text has landed. Keying
   * this off `Boolean(tagalog)` was what made the switch bounce back off after
   * a successful fetch.
   */
  const showingTagalog = readingLang === "fil";

  /**
   * The two profile cards are the only thing the Profiles modal offers, and the
   * only thing it reports: each card shows whether its profile is applied, so
   * there is no separate summary state to keep in sync.
   */

  /**
   * Figures of speech found on the page, only computed while Literal Language
   * is on. Pure text matching against a fixed glossary - no model call.
   */
  const matchedIdioms = useMemo(
    () => (literalLanguage ? matchIdioms(displayText) : []),
    [displayText, literalLanguage],
  );

  /**
   * Reader surface styling. Zen Sensory Focus overrides the page tint with one
   * flat neutral surface; everything else follows the chosen swatch.
   */
  const surfaceClass = asdZenFocus
    ? ZEN_SURFACE_CLASS
    : READING_TINTS[tint].surface;
  const surfaceInkClass = asdZenFocus ? ZEN_INK_CLASS : READING_TINTS[tint].ink;
  const surfaceBorderClass = asdZenFocus
    ? ZEN_BORDER_CLASS
    : dyslexiaFocus
      ? "border-sky-300"
      : READING_TINTS[tint].border;

  /**
   * What the mind map should summarise, and in what language. In Tagalog mode
   * this is the translated text, so the model's own Tagalog wording carries
   * through instead of it re-translating from English.
   */
  const mindmapLang: "en" | "tl" = showingTagalog && tagalog ? "tl" : "en";
  const mindmapSourceText =
    mindmapLang === "tl" && tagalog ? tagalog : originalText;

  /* --------------------------- karaoke plumbing -------------------------- */

  /**
   * Tokenised view of whatever the reader is showing. Recomputed only when the
   * text changes, so it is safe to read during render.
   */
  const karaokeTokens = useMemo(() => tokenizeText(displayText), [displayText]);

  const karaokeActive = isSpeaking && karaokeCharIndex !== null;

  /**
   * Which token is lit. Only meaningful while speaking; speech offsets are into
   * the utterance text, which is exactly `displayText`.
   */
  const karaokeTokenIndex =
    karaokeCharIndex === null ? -1 : findTokenIndexAt(karaokeTokens, karaokeCharIndex);

  const activeTokenElRef = useRef<HTMLElement | null>(null);

  /**
   * Keep the spoken word in view without fighting the user: only auto-scroll
   * when the active word has drifted outside a comfortable middle band, so
   * ordinary reading feels still instead of creeping the page under the cursor.
   *
   * The reader has no inner scroll container - the page scrolls - so this
   * measures against the viewport.
   */
  useEffect(() => {
    if (!karaokeActive) return;
    const el = activeTokenElRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;

    const box = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Comfortable band: the middle 60% of the viewport. Outside it, recentre.
    const bandTop = viewportHeight * 0.2;
    const bandBottom = viewportHeight * 0.8;
    const comfortablyInside = box.top >= bandTop && box.bottom <= bandBottom;

    if (comfortablyInside) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    el.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [karaokeActive, karaokeTokenIndex, displayText]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The profiles sheet, focused on open so Escape and Tab start inside it. */
  const profilesPanelRef = useRef<HTMLDivElement | null>(null);
  /** The photo lightbox, focused on open for the same reason. */
  const photoPanelRef = useRef<HTMLDivElement | null>(null);
  /** Whatever had focus before the sheet opened, to hand it back on close. */
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    // Clearing the cursor here is what makes "Stop reading" wipe the karaoke
    // highlight in the same tick, rather than waiting for an `end` event that
    // `cancel()` never fires.
    setKaraokeCharIndex(null);
    setKaraokeWordLength(0);
  }, []);

  const pushNotice = useCallback(
    (tone: "error" | "warn" | "info", text: string, detail?: string) => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      setNotice({ tone, text, detail });
      // Scanner errors linger because they are the thing you must act on;
      // softer messages clear themselves.
      noticeTimerRef.current = setTimeout(
        () => setNotice(null),
        tone === "error" ? 25000 : 8000,
      );
    },
    [],
  );

  /**
   * Closes whichever sticky-header overlay is open.
   *
   * `setRulerTop(null)` here is load-bearing: an open drawer shrinks the
   * reading area, so a ruler position captured while it was open points at the
   * wrong line once it closes. Dropping it costs nothing - the band reappears
   * as soon as the pointer re-enters the text.
   */
  const closeOverlays = useCallback(() => {
    setProfilesOpen(false);
    setSettingsOpen(false);
    setPhotoOpen(false);
    setRulerTop(null);
  }, []);

  /** One overlay at a time: opening either closes the other. */
  const toggleProfiles = useCallback(() => {
    setSettingsOpen(false);
    setPhotoOpen(false);
    setProfilesOpen((v) => {
      if (v) setRulerTop(null);
      return !v;
    });
  }, []);

  const toggleSettings = useCallback(() => {
    setProfilesOpen(false);
    setPhotoOpen(false);
    setSettingsOpen((v) => {
      if (v) setRulerTop(null);
      return !v;
    });
  }, []);

  /**
   * Reading profiles are single-choice, not a set of independent switches: the
   * Dyslexia and Autism profiles fight each other (one wants wide loose Lexend
   * lines, the other a flat calm surface), so only one may be applied at a time.
   *
   * `none` is the escape hatch that clears the profile entirely. Every branch
   * sets both flags, so the two can never drift out of sync, and each branch
   * also takes its bundled extras (the ruler, Literal Language) with it.
   *
   * Only display state changes here. Scanned text, the translation and the mind
   * map are never discarded, and read-aloud keeps running.
   */
  const selectProfile = useCallback((profile: ReadingProfile) => {
    // Choosing a profile re-arms the schedule: Autism puts it back, the other
    // two take it away for good.
    setScheduleDismissed(false);

    if (profile === "dyslexia") {
      setDyslexiaFocus(true);
      setAsdZenFocus(false);
      setRulerOn(true);
      setLiteralLanguage(false);
      return;
    }

    if (profile === "autism") {
      setDyslexiaFocus(false);
      setAsdZenFocus(true);
      // The line-tracking band belongs to the Dyslexia profile, and Zen keeps
      // the page plain, so both give it up here.
      setRulerOn(false);
      setRulerTop(null);
      setLiteralLanguage(true);
      return;
    }

    setDyslexiaFocus(false);
    setAsdZenFocus(false);
    setRulerOn(false);
    setRulerTop(null);
    setLiteralLanguage(false);
  }, []);

  /**
   * The active profile, derived rather than stored. It is read straight off the
   * two flags `selectProfile` writes, so the radio group in the modal, the
   * reader's Zen surface, and the visual schedule can never disagree about
   * which profile is on.
   */
  const activeProfile: ReadingProfile = asdZenFocus
    ? "autism"
    : dyslexiaFocus
      ? "dyslexia"
      : "none";

  /**
   * The visual schedule, shown *because* the Autism profile is selected.
   *
   * This is not part of `AppState` on purpose. The schedule is a consequence of
   * the profile, not a destination the student navigates to, so it is derived.
   * The one piece of state it does need is `scheduleDismissed`: selecting the
   * profile is not the same as staying on it. Without that flag the schedule
   * would re-assert itself forever and the Start button could never hand over
   * to the camera.
   */
  const showSchedule = activeProfile === "autism" && !scheduleDismissed;

  /**
   * Arrow keys move through a radio group, so the cards behave the way a
   * screen-reader user expects from a single-choice set.
   */
  const handleProfileGroupKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!PROFILE_KEYS.has(event.key)) return;

      const from = Number(
        (event.target as HTMLElement).dataset.profileIndex ?? "0",
      );
      const last = PROFILE_ORDER.length - 1;

      event.preventDefault();

      let next = from;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        next = from >= last ? 0 : from + 1;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        next = from <= 0 ? last : from - 1;
      } else if (event.key === "Home") {
        next = 0;
      } else {
        next = last;
      }

      const profile = PROFILE_ORDER[next];
      selectProfile(profile);
      document.getElementById(`profile-option-${profile}`)?.focus();
    },
    [selectProfile],
  );

  /* ------------------------------ boot camera ----------------------------- */
  const startCamera = useCallback(async () => {
    if (typeof window === "undefined") return;
    stopSpeaking();
    setCamMessage(null);

    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setCamState("unavailable");
      setCamMessage(
        "This browser cannot open a camera. Use “Upload image” or load the sample page instead.",
      );
      return;
    }

    setCamState("starting");
    stopStream();

    try {
      const stream = await media.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamState("ready");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCamState("denied");
        setCamMessage(
          "Camera permission was blocked. Allow camera access in your browser, or use “Upload image” / the sample page.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCamState("unavailable");
        setCamMessage(
          "No camera was found on this device. Use “Upload image” or load the sample page instead.",
        );
      } else {
        setCamState("unavailable");
        setCamMessage(
          "The camera could not start. Use “Upload image” or load the sample page instead.",
        );
      }
    }
  }, [stopSpeaking, stopStream]);

  /**
   * The camera only opens on the camera screen. Behind the visual schedule
   * there is no preview and no permission prompt to justify, so a student on
   * the Autism schedule is never asked for camera access until they actually
   * start a task.
   */
  useEffect(() => {
    if (showSchedule || appState !== "camera" || stage !== "A") return;
    void startCamera();
    return () => {
      stopStream();
    };
  }, [appState, showSchedule, stage, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      stopStream();
      stopSpeaking();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [stopSpeaking, stopStream]);

  /**
   * Escape closes an open overlay. Both are dismissible by keyboard, so the
   * sticky header is not a trap on a device with no back gesture.
   */
  useEffect(() => {
    if (!profilesOpen && !settingsOpen && !photoOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeOverlays();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOverlays, photoOpen, profilesOpen, settingsOpen]);

  /**
   * Move focus into a modal when it opens and hand it back to the button that
   * opened it when it closes, so keyboard and screen-reader users are never
   * left behind an overlay they cannot see the end of.
   */
  useEffect(() => {
    const target = profilesOpen ? profilesPanelRef : photoOpen ? photoPanelRef : null;
    const wasOpen = profilesOpen || photoOpen;

    if (target) {
      lastFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      target.current?.focus();
      return;
    }

    if (!wasOpen) {
      // First render: nothing was open, so there is nothing to give focus back.
      return;
    }

    const restoreTo = lastFocusedRef.current;
    lastFocusedRef.current = null;
    if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
  }, [photoOpen, profilesOpen]);

  /* -------------------------------- OCR ----------------------------------- */
  // A real OCR call takes 1-18s on the free tier, so show a live elapsed
  // counter instead of claiming it "usually takes a couple of seconds".
  useEffect(() => {
    if (!isProcessing) {
      setScanSeconds(0);
      return;
    }

    const id = setInterval(() => setScanSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isProcessing]);

  const runOcr = useCallback(
    async (image: string, label: string) => {
      setIsProcessing(true);
      stopSpeaking();
      setSourceLabel(label);
      setPreviewSrc(image);
      setStage("B");
      setAppState("workspace");

      try {
        // The preview above can stay a blob:/path URL, but the API needs bytes.
        const payload = await toBase64DataUrl(image);

        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: payload }),
        });

        const data = (await res.json().catch(() => null)) as OcrResult | null;

        if (!data) {
          throw new Error(
            `Scanner returned an unreadable response (HTTP ${res.status} ${res.statusText}).`,
          );
        }

        // A non-2xx status is a hard failure, even if sample text came with it.
        if (!res.ok && data.fallback !== true) {
          throw new Error(
            `Scanner returned HTTP ${res.status}${data.reason ? ` (${data.reason})` : ""}: ${
              data.error ?? res.statusText
            }`,
          );
        }

        if (typeof data.text === "string" && data.text.trim().length > 0) {
          setExtractedText(data.text.trim());
          setUsedFallback(Boolean(data.fallback));

          if (data.fallback) {
            const reason = data.reason ?? "unknown";
            console.error(
              `[bigkas] scanner fell back to sample text (reason=${reason})`,
              data.details ?? data.error,
            );
            pushNotice(
              reason === "no_text_detected" ? "warn" : "error",
              data.error ?? "The scanner could not read this image.",
              data.details,
            );
          }
        } else {
          setExtractedText(SAMPLE_TEXT);
          setUsedFallback(true);
          console.warn(
            "[bigkas] scanner response had no text field; using built-in sample.",
            data,
          );
          pushNotice(
            "error",
            "The scanner returned no text, so sample text is shown instead.",
            `reason=${data.reason ?? "unknown"}`,
          );
        }
      } catch (err) {
        setExtractedText(SAMPLE_TEXT);
        setUsedFallback(true);
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[bigkas] request to /api/ocr failed; using built-in sample.",
          err,
        );
        pushNotice(
          "error",
          "Could not reach the scanner, so sample text is shown instead.",
          message,
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [pushNotice, stopSpeaking],
  );

  const handleSnap = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      pushNotice("error", "The camera is not running yet. Try again in a moment.");
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      pushNotice("error", "The camera has not produced a frame yet. Hold on one second.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      pushNotice("error", "This browser blocked image capture.");
      return;
    }

    ctx.drawImage(video, 0, 0, vw, vh);
    let dataUrl = "";
    try {
      dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      pushNotice("error", "The photo could not be captured. Try uploading a file.");
      return;
    }

    stopStream();
    setCamState("idle");
    await runOcr(dataUrl, "Camera photo");
  }, [pushNotice, runOcr, stopStream]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      // `file.type` is empty for some Windows files, so a false here is not
      // conclusive - toBase64DataUrl re-checks the decoded type properly.
      if (file.type && !file.type.startsWith("image/")) {
        pushNotice("error", "That file is not an image. Please choose a photo or scan.");
        return;
      }

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      stopStream();
      setCamState("idle");
      await runOcr(url, file.name);
    },
    [pushNotice, runOcr, stopStream],
  );

  const handleLoadSample = useCallback(async () => {
    closeOverlays();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    stopStream();
    setCamState("idle");
    await runOcr(SAMPLE_IMAGE_SRC, "Sample textbook page");
  }, [closeOverlays, runOcr, stopStream]);

  const handleRetake = useCallback(() => {
    stopSpeaking();
    closeOverlays();
    setExtractedText("");
    setPreviewSrc(null);
    setSourceLabel(null);
    setUsedFallback(false);
    setCopied(false);
    setNotice(null);
    // Clear derived AI output too, so a new scan never shows the last page's
    // translation or mind map.
    setTagalog("");
    setMindmap(null);
    setTab("reader");
    setRulerOn(false);
    setRulerTop(null);
    setStage("A");
    // Retaking goes straight back to the scanner rather than to the schedule:
    // the student already knows which task they are working on. If the Autism
    // profile is still on, the schedule reappears in front of the camera, since
    // that profile owns the landing screen.
    setAppState("camera");
  }, [closeOverlays, stopSpeaking]);

  /* --------------------- translation & mind map ------------------------ */

  /**
   * Returns true when a usable translation came back. On failure the caller
   * reverts readingLang so the switch cannot be left ON pointing at nothing.
   */
  const fetchTranslation = useCallback(async () => {
    if (!originalText.trim()) return false;

    if (tagalog) return true;

    setIsTranslating(true);
    stopSpeaking();

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: originalText }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok || typeof data.translation !== "string") {
        throw new Error(
          `Translator returned HTTP ${res.status}${data?.reason ? ` (${data.reason})` : ""}: ${data?.details ?? data?.error ?? "unknown error"}`,
        );
      }

      setTagalog(data.translation);
      pushNotice("info", "Translated to Tagalog.");
      return true;
    } catch (err) {
      console.error("[bigkas] translation failed.", err);
      pushNotice(
        "error",
        "The Tagalog translation could not be created.",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      setIsTranslating(false);
    }
  }, [originalText, pushNotice, stopSpeaking, tagalog]);

  /**
   * The single control for language. First press fetches the translation, then
   * it becomes a pure in-place swap. Never leaves the reader tab, so the tab
   * bar stays at two tabs and the reader surface is never unmounted - which is
   * what keeps phonics, ruler, tint, font size and speech applied across the
   * switch instead of resetting.
   */
  const handleLangToggle = useCallback(() => {
    setTab("reader");
    setRulerTop(null);
    stopSpeaking();

    // Turning OFF is unconditional and immediate: the switch only ever turns
    // off when the user explicitly asks for English.
    if (readingLang === "fil") {
      setReadingLang("en");
      return;
    }

    // Turning ON is optimistic. Flip first so the switch reads ON during the
    // fetch, and only revert if the translation genuinely failed.
    setReadingLang("fil");
    void fetchTranslation().then((ok) => {
      if (!ok) setReadingLang("en");
    });
  }, [fetchTranslation, readingLang, stopSpeaking]);

  const handleBuildMindmap = useCallback(async () => {
    if (!originalText.trim()) return;

    setTab("mindmap");
    // Cache is per-language: an English map must not be shown while Tagalog is
    // active, or vice versa.
    if (mindmap && mindmap.lang === mindmapLang) return;

    setIsMapping(true);
    stopSpeaking();

    try {
      const res = await fetch("/api/mindmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // In Tagalog mode, summarise the Tagalog text so the model's own
          // wording is what gets mapped.
          text: mindmapSourceText,
          language: mindmapLang,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok || !data?.mindmap) {
        throw new Error(
          `Mind map returned HTTP ${res.status}${data?.reason ? ` (${data.reason})` : ""}: ${data?.details ?? data?.error ?? "unknown error"}`,
        );
      }

      setMindmap({
        lang: mindmapLang,
        mainTopic: String(data.mindmap.mainTopic),
        keyConcepts: (data.mindmap.keyConcepts ?? []).map((c: unknown) => String(c)),
      });
    } catch (err) {
      console.error("[bigkas] mind map failed.", err);
      pushNotice(
        "error",
        "The study summary could not be built.",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsMapping(false);
    }
  }, [mindmap, mindmapLang, mindmapSourceText, pushNotice, stopSpeaking]);

  const readerSurfaceRef = useRef<HTMLDivElement | null>(null);

  /**
   * Measures the padded container the overlay is positioned against, not the
   * inner text box. Measuring the inner box was off by the container padding,
   * which put the band above the real line.
   */
  const handleRulerMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (!rulerOn) return;
      const surface = readerSurfaceRef.current;
      if (!surface) return;

      const box = surface.getBoundingClientRect();
      const y = "touches" in event ? event.touches[0]?.clientY : event.clientY;
      if (typeof y !== "number") return;

      const next = y - box.top - rulerLineHeight / 2;
      setRulerTop(Math.max(0, Math.min(next, box.height - rulerLineHeight)));
    },
    [rulerOn, rulerLineHeight],
  );

  /* ------------------------------ text tools ------------------------------ */
  /**
   * Speaks `text`, wiring up the karaoke cursor.
   *
   * Word boundaries are what drive the highlight. Not every engine emits them
   * (some fire only `sentence`), so the highlight simply does not appear there
   * rather than the read-aloud itself failing.
   */
  const speakText = useCallback(
    (text: string, lang: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        pushNotice("error", "This browser does not support read-aloud.");
        return;
      }

      if (isSpeaking) {
        stopSpeaking();
        return;
      }

      if (!text.trim()) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95;
      utterance.pitch = 1;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
      if (preferred) utterance.voice = preferred;

      utterance.onboundary = (event) => {
        if (event.name !== "word") return;
        // `charLength` is missing on some engines; 0 is the honest value then,
        // and the renderer falls back to the token's own length.
        setKaraokeCharIndex(event.charIndex);
        setKaraokeWordLength(event.charLength || 0);
      };

      const clearKaraoke = () => {
        setIsSpeaking(false);
        setKaraokeCharIndex(null);
        setKaraokeWordLength(0);
      };

      utterance.onend = clearKaraoke;
      utterance.onerror = clearKaraoke;

      setIsSpeaking(true);
      setKaraokeCharIndex(null);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [isSpeaking, pushNotice, stopSpeaking],
  );

  /**
   * Read-aloud always speaks exactly what the reader is showing, so the
   * karaoke offsets line up with the rendered tokens in both languages.
   */
  const handleToggleSpeech = useCallback(() => {
    speakText(displayText, showingTagalog ? "fil-PH" : "en-US");
  }, [displayText, showingTagalog, speakText]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(originalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      pushNotice("error", "Clipboard access was blocked by the browser.");
    }
  }, [originalText, pushNotice]);

  const wordCount = useMemo(() => {
    const trimmed = originalText.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [originalText]);

  const readingTextStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
  };

  /** A real scanner failure looks different from "this page had no text". */
  const usedFallbackHardFailure =
    usedFallback && notice?.tone === "error";

  /**
   * The reading stage owns the whole viewport, but only while the reader is
   * actually on screen. The camera and the visual schedule keep an ordinary
   * scrolling document, so globals.css must not lock the scroll while either is
   * showing - a locked viewport would cut the schedule off on a short screen.
   */
  const isReadingStage =
    !showSchedule && appState === "workspace" && stage === "B";

  return (
    <div
      // Read by globals.css to lock the document scroll and hide the compliance
      // banner, so it tracks what is on screen rather than just `stage`.
      data-stage={isReadingStage ? "B" : "A"}
      className={[
        "flex flex-col",
        // The reading stage owns the whole viewport: a fixed-height column with
        // its own scroll area means the text is never pushed below the fold by
        // a page-level scroll, and the controls are always within thumb reach.
        // globals.css locks the document scroll while this is active, because
        // the compliance banner in layout.tsx sits above this element.
        isReadingStage ? "h-[100dvh] overflow-hidden" : "min-h-screen",
      ].join(" ")}
    >
      {/* The brand bar carries the same hamburger as the reading header, so the
          reading profile is one tap away before a page has even been scanned. */}
      {!isReadingStage && (
        <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
          {/* pl-14 on mobile reserves the gutter the fixed profile hamburger
              occupies (left-3 + h-9 = 48px), so the wordmark never sits under
              it once this bar sticks to the top. */}
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 py-4 pl-14 pr-4 sm:px-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-violet-500 text-slate-950 shadow-lg shadow-sky-500/20">
              <ScanLine className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="mr-auto">
              <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
                BIGKAS
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                Point your camera at a page &rarr; get clean, readable text.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-[11px] font-medium text-slate-300">
              <Sparkles className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              Assistive document formatting tool
            </span>
          </div>
        </header>
      )}

      <main
        className={[
          isReadingStage
            ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            : "mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8",
        ].join(" ")}
      >
        {!showSchedule && notice && (
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        )}

        {/* ---------------- Autism profile: TEACCH visual schedule -----------------
            Checked first, ahead of both working screens. The Autism profile is
            what puts a student on the schedule, and picking any other profile
            drops them straight back into the camera or the reader. */}
        {showSchedule ? (
          <VisualSchedule
            onStartTask={() => {
              // Move to the camera, but leave the profile alone: Zen Sensory
              // Focus and Literal Language must still be in force when the
              // page is read.
              setScheduleDismissed(true);
              setAppState("camera");
            }}
          />
        ) : appState === "camera" ? (
          <div className="animate-fade-in-up grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* ------------------------- camera panel ------------------------- */}
            <section
              aria-label="Camera"
              className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-2xl shadow-slate-950/50"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-200">
                  Camera view
                </h2>
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    camState === "ready"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : camState === "starting"
                        ? "bg-sky-500/15 text-sky-300"
                        : "bg-slate-700/50 text-slate-400",
                  ].join(" ")}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    {camState === "ready" && (
                      <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" />
                    )}
                    <span
                      className={[
                        "relative inline-flex h-1.5 w-1.5 rounded-full",
                        camState === "ready"
                          ? "bg-emerald-400"
                          : camState === "starting"
                            ? "bg-sky-400"
                            : "bg-slate-500",
                      ].join(" ")}
                    />
                  </span>
                  {camState === "ready"
                    ? "Live"
                    : camState === "starting"
                      ? "Starting…"
                      : "Offline"}
                </span>
              </div>

              <div className="relative aspect-[4/3] w-full bg-slate-950 sm:aspect-[16/10]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="h-full w-full object-cover"
                  aria-label="Live camera preview"
                />

                {/* viewfinder overlay */}
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden="true"
                >
                  <CornerBracket className="left-4 top-4 border-l-0 border-t-0" />
                  <CornerBracket className="right-4 top-4 border-r-0 border-t-0" />
                  <CornerBracket className="bottom-4 left-4 border-b-0 border-l-0" />
                  <CornerBracket className="bottom-4 right-4 border-b-0 border-r-0" />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/85 to-transparent" />
                  <p className="absolute inset-x-0 bottom-4 px-6 text-center text-xs font-medium text-slate-200">
                    Fit the whole page inside the frame, then tap the shutter
                  </p>
                </div>

                {camState !== "ready" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/85 px-6 text-center">
                    {camState === "starting" ? (
                      <>
                        <Loader2 className="h-7 w-7 animate-spin text-sky-400" aria-hidden="true" />
                        <p className="text-sm text-slate-300">Waking up the camera…</p>
                      </>
                    ) : (
                      <>
                        <CameraOff className="h-7 w-7 text-slate-500" aria-hidden="true" />
                        <p className="text-sm font-medium text-slate-200">
                          Camera unavailable
                        </p>
                        {camMessage && (
                          <p className="max-w-sm text-xs leading-relaxed text-slate-400">
                            {camMessage}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => void startCamera()}
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-400/60 hover:text-sky-200"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          Try camera again
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4 px-4 py-5">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleSnap()}
                    disabled={camState !== "ready"}
                    className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10 p-[6px] transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-white/20"
                    aria-label="Snap photo"
                  >
                    <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-sky-400/60 enabled:group-hover:border-sky-300" />
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 shadow-lg shadow-sky-500/30">
                      <Camera className="h-8 w-8 text-slate-950" aria-hidden="true" />
                    </span>
                  </button>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void handleSnap()}
                    disabled={camState !== "ready"}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 to-violet-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    Snap Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700/60"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload Image File
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLoadSample()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-200 transition hover:border-amber-300/70 hover:bg-amber-400/20"
                  >
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    Load Sample Page
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  capture="environment"
                  onChange={(e) => void handleFileChange(e)}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />

                <p className="text-center text-[11px] leading-relaxed text-slate-500">
                  Demo failsafe: “Load Sample Page” always works, even with no
                  camera and no API key.
                </p>
              </div>
            </section>

            {/* --------------------------- side panel ------------------------- */}
            <section className="flex flex-col gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="text-sm font-semibold text-slate-200">How it works</h2>
                <ol className="mt-4 space-y-4">
                  {[
                    {
                      step: "1",
                      title: "Frame the page",
                      body: "Fill the viewfinder with the printed text. More light and a flat page give the best result.",
                    },
                    {
                      step: "2",
                      title: "Snap or upload",
                      body: "Tap the shutter — or upload a photo you already took. The image is read once and never stored.",
                    },
                    {
                      step: "3",
                      title: "Read your way",
                      body: "Adjust the text, turn on dyslexia focus mode, or have it read aloud to you.",
                    },
                  ].map((item) => (
                    <li key={item.step} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-400/10 text-xs font-semibold text-sky-300">
                        {item.step}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                          {item.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Type className="h-4 w-4 text-violet-400" aria-hidden="true" />
                  Built for easier reading
                </h2>
                <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-400">
                  <li>
                    <span className="text-slate-200">Lexend typeface</span> — a
                    typeface designed with readers of written language
                    difficulties in mind.
                  </li>
                  <li>
                    <span className="text-slate-200">Focus mode</span> widens
                    letter spacing and line height so each letter stands on its
                    own.
                  </li>
                  <li>
                    <span className="text-slate-200">Read aloud</span> uses your
                    device&apos;s built-in voice, so nothing is sent anywhere.
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 text-[11px] leading-relaxed text-slate-500">
                <p className="font-semibold text-slate-400">
                  BIGKAS is an assistive document formatting tool.
                </p>
                <p className="mt-1">
                  It only reproduces the words already printed on the page you
                  photograph. It is not a medical device, it does not assess or
                  diagnose dyslexia or any health condition, and it is not a
                  substitute for professional advice. If something on a page
                  concerns you, speak to a qualified professional.
                </p>
              </div>
            </section>
          </div>
        ) : (
          <div className="animate-fade-in-up flex min-h-0 flex-1 flex-col">
            {/* ------------------ sticky reading header ------------------
                Mobile-first: every control the workspace needs lives within
                thumb reach at the top of the screen, so nothing has to be
                scrolled to. The controls drawer is positioned absolutely under
                this bar, so opening it overlays the text instead of resizing
                the reader - no reflow, no jump, and read-aloud keeps running. */}
            <header className="sticky top-0 z-40 w-full bg-slate-950/95 backdrop-blur-md border-b border-slate-800 px-3 py-2 flex items-center justify-between">
              {/* LEFT: wordmark. The profile hamburger is a fixed element outside
                  this bar, so it stays put across every stage; pl-12 clears it
                  without disturbing the header's own layout. */}
              <span className="flex min-w-0 items-center gap-1.5 pl-12 text-xs font-semibold text-slate-200">
                <ScanLine className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />
                <span className="hidden sm:inline">BIGKAS</span>
              </span>
              {/* CENTER: primary action, always visible */}
              <button
                type="button"
                onClick={handleToggleSpeech}
                disabled={isProcessing || displayText.trim().length === 0}
                aria-pressed={isSpeaking}
                className={[
                  "inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
                  "transition-all duration-300 motion-reduce:transition-none active:scale-[0.98]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  isSpeaking
                    ? "border border-amber-300 bg-amber-300 text-slate-950"
                    : "bg-gradient-to-br from-sky-500 to-violet-500 text-slate-950 shadow-lg shadow-sky-500/20",
                ].join(" ")}
              >
                {isSpeaking ? (
                  <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">
                  {isSpeaking ? "Stop reading" : "Read Aloud"}
                </span>
              </button>

              {/* RIGHT: general reading controls */}
              <HeaderButton
                onClick={toggleSettings}
                controls="reading-controls"
                expanded={settingsOpen}
                label="Controls"
                icon={
                  <span className="flex items-center">
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    <ChevronDown
                      className={[
                        "h-3.5 w-3.5 transition-transform duration-300",
                        "motion-reduce:transition-none",
                        settingsOpen ? "rotate-180" : "",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                  </span>
                }
              />

              {/* ------------- collapsible reading controls -------------
                  Positioned absolutely under the bar so it overlays the reader
                  instead of pushing it: the text underneath never reflows, and
                  read-aloud is not interrupted. Height is animated with the
                  grid-rows 0fr -> 1fr trick, which transitions to the content's
                  real height instead of guessing a max-height, and the panel
                  stays mounted so a font-size drag never loses its own focus. */}
              <div
                id="reading-controls"
                aria-hidden={!settingsOpen}
                inert={!settingsOpen}
                className={[
                  "absolute inset-x-0 top-full z-50 grid",
                  "transition-all duration-300 motion-reduce:transition-none",
                  settingsOpen
                    ? "grid-rows-[1fr] opacity-100"
                    : "pointer-events-none grid-rows-[0fr] opacity-0",
                ].join(" ")}
              >
                <div className="overflow-hidden">
                  <div
                    className={[
                      "scrollbar-soft max-h-[72dvh] space-y-3.5 overflow-y-auto overscroll-contain",
                      "border-b border-slate-800 bg-slate-950 px-3 py-3 shadow-2xl shadow-slate-950/60",
                    ].join(" ")}
                  >
                    {/* page tint swatches */}
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                        Page tint
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {TINT_ORDER.map((id) => {
                          const swatch = READING_TINTS[id];
                          const active = tint === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setTint(id)}
                              disabled={isProcessing}
                              aria-pressed={active}
                              title={swatch.label}
                              className={[
                                "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] font-medium",
                                "transition-all duration-300 motion-reduce:transition-none",
                                "disabled:cursor-not-allowed disabled:opacity-45",
                                active
                                  ? "border-sky-400 bg-sky-500/15 text-sky-100"
                                  : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "h-4 w-4 shrink-0 rounded-full border border-black/20",
                                  swatch.swatch,
                                ].join(" ")}
                                aria-hidden="true"
                              />
                              <span className="truncate">{swatch.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {asdZenFocus && (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          Zen Sensory Focus is holding the page tint until you pick
                          another profile in Profiles.
                        </p>
                      )}
                    </div>

                    {/* font size stepper */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label
                          htmlFor="font-size"
                          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400"
                        >
                          <Type className="h-3.5 w-3.5" aria-hidden="true" />
                          Font size
                        </label>
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                          {fontSize}px
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setFontSize((s) => Math.max(MIN_FONT_SIZE, s - FONT_SIZE_STEP))
                          }
                          disabled={isProcessing || fontSize <= MIN_FONT_SIZE}
                          aria-label="Decrease font size"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/60 text-slate-200 transition-all duration-300 hover:border-slate-500 hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Minus className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <input
                          id="font-size"
                          type="range"
                          min={MIN_FONT_SIZE}
                          max={MAX_FONT_SIZE}
                          step={FONT_SIZE_STEP}
                          value={fontSize}
                          onChange={(e) => setFontSize(Number(e.target.value))}
                          disabled={isProcessing}
                          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-400 disabled:opacity-45"
                          aria-valuetext={`${fontSize} pixels`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFontSize((s) =>
                              Math.min(MAX_FONT_SIZE, s + FONT_SIZE_STEP),
                            )
                          }
                          disabled={isProcessing || fontSize >= MAX_FONT_SIZE}
                          aria-label="Increase font size"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/60 text-slate-200 transition-all duration-300 hover:border-slate-500 hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* reading aids: ruler and colour-coded phonics */}
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
                        Reading aids
                      </div>
                      <div className="space-y-2">
                        <ToggleRow
                          icon={<Ruler className="h-4 w-4" aria-hidden="true" />}
                          title="Reading Ruler"
                          description="Dims every other line to stop line-skipping"
                          active={rulerOn}
                          accent="amber"
                          disabled={isProcessing || tab !== "reader"}
                          onChange={() =>
                            setRulerOn((v) => {
                              if (v) setRulerTop(null);
                              return !v;
                            })
                          }
                        />
                        <ToggleRow
                          icon={<Type className="h-4 w-4" aria-hidden="true" />}
                          title="Color-Coded Phonics"
                          description="Vowels and digraphs marked as sound anchors"
                          active={phonicsOn}
                          accent="red"
                          disabled={isProcessing}
                          onChange={() => setPhonicsOn((v) => !v)}
                        />
                      </div>
                    </div>

                    {/* language */}
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                        Language
                      </div>
                      <ToggleRow
                        icon={
                          isTranslating ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Languages className="h-4 w-4" aria-hidden="true" />
                          )
                        }
                        title={
                          showingTagalog ? "Show original English" : "Translate to Tagalog"
                        }
                        description={
                          showingTagalog
                            ? "Showing the Filipino version of this page"
                            : "Natural everyday Filipino for the same words"
                        }
                        active={showingTagalog}
                        accent="sky"
                        // Deliberately not disabled while translating: the switch
                        // has to stay live so it can be flipped back mid-fetch.
                        disabled={isProcessing || !originalText}
                        onChange={handleLangToggle}
                      />
                    </div>

                    {/* page actions */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <ToolButton
                        full
                        icon={
                          copied ? (
                            <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                          ) : (
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          )
                        }
                        label={copied ? "Copied" : "Copy text"}
                        onClick={() => void handleCopy()}
                        disabled={isProcessing || originalText.length === 0}
                      />
                      <ToolButton
                        full
                        icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                        label="Load Sample Page"
                        onClick={() => void handleLoadSample()}
                        disabled={isProcessing}
                      />
                      <ToolButton
                        full
                        tone="danger"
                        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                        label="Retake photo"
                        onClick={handleRetake}
                        disabled={isProcessing}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </header>


            {/* ------------------------- original photo lightbox -------------------------
                  Replaces the old pinned thumbnail: the photo is one tap away
                  and costs the reader no permanent height. */}
              {photoOpen && previewSrc && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in-up"
                  onClick={(event) => {
                    if (event.target === event.currentTarget) setPhotoOpen(false);
                  }}
                >
                  <div
                    ref={photoPanelRef}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal="true"
                    aria-label="The original page you scanned"
                    className="flex max-h-full w-full max-w-3xl flex-col gap-2 outline-none"
                  >
                    <div className="flex items-center gap-2">
                      <p className="mr-auto truncate text-xs font-medium text-slate-200">
                        {sourceLabel ?? "The page you scanned"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPhotoOpen(false)}
                        aria-label="Close original photo"
                        className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewSrc}
                      alt="The page that was scanned"
                      className="min-h-0 w-full rounded-xl border border-slate-700 bg-slate-950 object-contain"
                    />
                  </div>
                </div>
              )}

              {/* --------------------- reading workspace --------------------- */}
            <section
              aria-label="Reading workspace"
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* One compact strip: what is loaded, the photo on demand, and the
                  two workspace views. Every adjustment lives in the Controls
                  drawer, so nothing else competes for the reader's height. */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-800 bg-slate-950/60 px-3 py-1.5">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <BookOpen className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                  Reading workspace
                </h2>

                {/* The photo is no longer pinned above the text. One button opens
                    it full-screen instead, so the reader keeps the whole screen. */}
                {previewSrc && (
                  <button
                    type="button"
                    onClick={() => setPhotoOpen(true)}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/70",
                      "px-2 py-1 text-[11px] font-medium text-slate-300",
                      "transition-all duration-300 motion-reduce:transition-none hover:border-slate-500 hover:text-slate-100",
                    ].join(" ")}
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    View Original Photo
                  </button>
                )}

                {/* Metadata is reference-only, so it is the first thing to go
                    when the row runs out of room on a phone. */}
                {sourceLabel && (
                  <span className="hidden rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-300 sm:inline-block">
                    {sourceLabel}
                  </span>
                )}
                {originalText && (
                  <span className="hidden rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-400 sm:inline-block">
                    {wordCount.toLocaleString()} words
                  </span>
                )}

                <div
                  role="tablist"
                  aria-label="Workspace views"
                  className="ml-auto flex flex-wrap gap-1 rounded-xl border border-slate-700 bg-slate-800/50 p-1"
                >
                  {(
                    [
                      { id: "reader", label: "Text Reader" },
                      { id: "mindmap", label: "Visual Mind Map" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      disabled={isProcessing}
                      onClick={() => {
                        setTab(item.id);
                        // The band is measured against the previous view's
                        // layout, so drop it until the pointer re-enters.
                        setRulerTop(null);
                        if (item.id === "mindmap" && mindmap) return;
                        if (item.id === "mindmap") void handleBuildMindmap();
                      }}
                      className={[
                        "rounded-lg px-2.5 py-1 text-[11px] font-medium",
                        "transition-all duration-300 motion-reduce:transition-none disabled:opacity-45",
                        tab === item.id
                          ? "bg-sky-500 text-white shadow"
                          : "text-slate-300 hover:bg-slate-700/70",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {usedFallback && (
                <p
                  className={[
                    "shrink-0 border-b px-3 py-2 text-xs sm:px-5",
                    usedFallbackHardFailure
                      ? "border-rose-500/40 bg-rose-500/12 text-rose-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                  ].join(" ")}
                >
                  {usedFallbackHardFailure
                    ? "The scanner could not read this image, so the built-in sample text below is a placeholder — not your document."
                    : "No text was found in that image, so the built-in sample text below is shown as a placeholder."}
                </p>
              )}

              {/* Reader scroll area. This is the only scrolling region on the
                  reading stage: the page itself cannot scroll, so the sticky
                  header stays pinned and the document keeps the full height
                  below it. */}
              <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
                {notice && (
                  <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
                )}
                <div
                  ref={readerSurfaceRef}
                  className={[
                    "relative rounded-2xl border p-4 sm:p-8",
                    // Zen mode drops the inner shadow too - no decorative depth.
                    asdZenFocus ? "" : "shadow-inner",
                    surfaceClass,
                    surfaceBorderClass,
                  ].join(" ")}
                >
                  {isProcessing ? (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-sky-600" aria-hidden="true" />
                      <p className="text-sm font-medium text-slate-700">
                        Reading the page…
                      </p>
                      <p className="max-w-xs text-xs text-slate-500">
                        {scanSeconds < 6
                          ? "Sending one image to the OCR model."
                          : scanSeconds < 20
                            ? "Still reading. The free tier can be slow on a busy page."
                            : "Still working — occasional requests take up to half a minute."}
                      </p>
                      <p className="text-xs font-medium tabular-nums text-slate-400">
                        {scanSeconds}s
                      </p>
                    </div>
                  ) : tab === "mindmap" ? (
                    /* ----------------------- visual mind map ---------------------- */
                    <div
                      role="tabpanel"
                      aria-label={
                        mindmapLang === "tl"
                          ? "Visual mind map in Tagalog"
                          : "Visual mind map"
                      }
                      lang={mindmapLang === "tl" ? "fil" : "en"}
                    >
                      {isMapping ? (
                        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                          <Loader2
                            className="h-7 w-7 animate-spin text-sky-600"
                            aria-hidden="true"
                          />
                          <p className="text-sm font-medium text-slate-700">
                            Building your study map…
                          </p>
                        </div>
                      ) : mindmap && mindmap.lang === mindmapLang ? (
                        <div className="flex flex-col items-center gap-5 py-2">
                          {/* central topic node */}
                          <div className="rounded-2xl border border-sky-300 bg-white/70 px-6 py-3 text-center shadow-inner">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              Main topic
                            </p>
                            <p className="text-lg font-bold text-slate-900">
                              {mindmap.mainTopic}
                            </p>
                          </div>

                          {/* connector */}
                          <div
                            className="h-7 w-px bg-slate-400"
                            aria-hidden="true"
                          />

                          {/* concept grid */}
                          <div className="grid w-full gap-2.5 sm:grid-cols-2">
                            {mindmap.keyConcepts.map((concept, i) => (
                              <div
                                key={concept}
                                className="flex items-start gap-2.5 rounded-xl border border-slate-300 bg-white/60 px-3.5 py-2.5 shadow-sm"
                              >
                                <span
                                  className={[
                                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                                    i % 3 === 0
                                      ? "bg-sky-500 text-white"
                                      : i % 3 === 1
                                        ? "bg-emerald-500 text-white"
                                        : "bg-amber-500 text-white",
                                  ].join(" ")}
                                  aria-hidden="true"
                                >
                                  {i + 1}
                                </span>
                                <span className="text-sm leading-snug text-slate-800">
                                  {concept}
                                </span>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleBuildMindmap()}
                            className="mt-1 rounded-lg border border-slate-300 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white"
                          >
                            Refresh map
                          </button>
                        </div>
                      ) : (
                        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                          <Brain className="h-7 w-7 text-slate-400" aria-hidden="true" />
                          <p className="text-sm font-medium text-slate-700">
                            {mindmap
                              ? `No ${mindmapLang === "tl" ? "Tagalog" : "English"} map yet`
                              : "No mind map yet"}
                          </p>
                          <p className="max-w-xs text-xs text-slate-500">
                            {mindmap
                              ? "Switch language to see this page in the other one."
                              : "Build a study map from the text on this page."}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleBuildMindmap()}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500"
                          >
                            Build study map
                          </button>
                        </div>
                      )}
                    </div>
) : (
                    /* ------------------------- text reader -------------------------
                      One surface for both languages. The language toggle only
                      changes which string is rendered here, so phonics, ruler,
                      tint, font size and dyslexia focus all stay applied
                      without remounting anything. */
                    <div
                      className={[
                        "relative max-none whitespace-pre-wrap break-words outline-none transition-colors duration-200 motion-reduce:transition-none",
                        surfaceInkClass,
                        dyslexiaFocus
                          ? "font-lexend tracking-wide leading-loose"
                          : "font-lexend tracking-normal leading-relaxed",
                      ].join(" ")}
                      style={readingTextStyle}
                      tabIndex={0}
                      role="region"
                      lang={showingTagalog ? "fil" : "en"}
                      aria-label={
                        showingTagalog
                          ? "Tagalog translation of your page"
                          : "Extracted text from your photo"
                      }
                      onMouseMove={handleRulerMove}
                      onTouchMove={handleRulerMove}
                      onMouseLeave={() => setRulerTop(null)}
                    >
                      {isTranslating ? (
                        <span className="inline-flex items-center gap-2 text-slate-600">
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                          Translating to Tagalog…
                        </span>
                      ) : karaokeActive ? (
                        /* Karaoke wins over every markup mode while speaking:
                           the token stream must stay exactly as it was, or the
                           highlight starts moving words around. */
                        renderKaraokeText(
                          displayText,
                          karaokeTokens,
                          karaokeTokenIndex,
                          phonicsOn,
                          "k",
                          activeTokenElRef,
                        )
                      ) : literalLanguage ? (
                        renderLiteralText(displayText, phonicsOn)
                      ) : phonicsOn ? (
                        renderPhonics(displayText)
                      ) : (
                        displayText
                      )}
                    </div>
                  )}

                  {/*
                    Reading ruler. Mounted on the shared reading container, so it
                    tracks the cursor in the English reader and in Tagalog Notes
                    alike. Dimming sits above the text (pointer-events-none) so
                    the text underneath stays selectable.

                    Hidden while an overlay is open: a drawer shrinks the reading
                    area, and the captured position would then point at the wrong
                    line. `closeOverlays` clears the position, so the band
                    returns on the next pointer move.
                  */}
                  {rulerOn &&
                    rulerTop !== null &&
                    isReadingSurface &&
                    !profilesOpen &&
                    !settingsOpen && (
                    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                      <div
                        className={[
                          "absolute inset-x-0 top-0 transition-[height] duration-75",
                          RULER_DIM_CLASS,
                        ].join(" ")}
                        style={{ height: Math.max(0, rulerTop) }}
                      />
                      <div
                        className={[
                          "absolute inset-x-0 bottom-0 transition-[height] duration-75",
                          RULER_DIM_CLASS,
                        ].join(" ")}
                        style={{ height: Math.max(0, 9999 - rulerTop - rulerLineHeight) }}
                      />
                      <div
                        className="absolute inset-x-0 border-y-2 border-amber-400 bg-amber-200/25 transition-[top] duration-75"
                        style={{ top: rulerTop, height: rulerLineHeight }}
                      />
                    </div>
                  )}
                </div>

                {phonicsOn && isReadingSurface && (
                  <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="font-semibold text-red-600">vowels</span>
                    <span className="font-semibold text-emerald-600">
                      digraphs ({PHONICS_DIGRAPHS.join(", ")})
                    </span>
                    <span>visual sound anchors for decoding</span>
                  </p>
                )}

                {/* Literal Language: the plain restatements of any figure of
                    speech found on the page. Fixed glossary, no model call, no
                    interpretation of the material itself. */}
                {literalLanguage && (
                  <section
                    aria-label="Plain restatements of figures of speech"
                    className="mt-3 rounded-xl border border-slate-300 bg-white/60 p-3.5"
                  >
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <Type className="h-3.5 w-3.5" aria-hidden="true" />
                      Figures of speech on this page
                    </h3>
                    {matchedIdioms.length === 0 ? (
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        None of the common figures of speech were found in this
                        text. Everything above is written straight.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {matchedIdioms.map((entry) => (
                          <li
                            key={entry.term}
                            className="text-xs leading-relaxed text-slate-700"
                          >
                            <span className="font-semibold text-slate-900">
                              “{entry.term}”
                            </span>
                            {entry.count > 1 && (
                              <span className="text-slate-500">
                                {" "}
                                ({entry.count}×)
                              </span>
                            )}
                            <span className="text-slate-500"> → </span>
                            <span>{entry.plain}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
                      Each entry restates what the printed figure of speech means.
                      Nothing here interprets the page or the material itself.
                    </p>
                  </section>
                )}

                <p className="mt-3 text-[11px] text-slate-500">
                  Tip: focus the text box and use your browser&apos;s own zoom
                  (Ctrl + / Ctrl -) for fine adjustments.
                </p>

                <p className="mt-3 border-t border-slate-200/70 pt-3 text-[11px] leading-relaxed text-slate-500">
                  BIGKAS is an assistive document formatting tool. Text is
                  reproduced verbatim from your photo — no diagnosis,
                  interpretation or health guidance is provided.
                </p>
              </div>
            </section>
          </div>
        )}

      </main>

      {/* --------------- accessibility profiles modal ---------------
          Rendered after </main> so the same modal serves the camera stage and
          the reading stage. The two profiles are one single-choice set, so the
          cards are radios: picking one applies it and takes the other back off. */}
      {profilesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in-up"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeOverlays();
          }}
        >
          <div
            id="accessibility-profiles"
            ref={profilesPanelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profiles-heading"
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl outline-none"
          >
            <div className="mb-3 flex items-center gap-3">
              <h2
                id="profiles-heading"
                className="mr-auto text-sm font-semibold text-slate-100"
              >
                Choose a reading profile
              </h2>
              <button
                type="button"
                onClick={closeOverlays}
                aria-label="Close accessibility profiles"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <p className="mb-2.5 text-[11px] leading-snug text-slate-400">
              Pick the one that matches how you read. Only one profile is applied
              at a time, and you can clear it whenever you like.
            </p>

            <div
              role="radiogroup"
              aria-labelledby="profiles-heading"
              className="grid gap-2.5"
              onKeyDown={handleProfileGroupKeyDown}
            >
              <ProfileCard
                id="profile-option-dyslexia"
                index={0}
                icon={<Type className="h-5 w-5" aria-hidden="true" />}
                title="Dyslexia"
                summary="Roomier type and a line-tracking guide so the eye stays on the line it is reading."
                features={["Lexend typeface", "Wide spacing", "Reading ruler"]}
                selected={activeProfile === "dyslexia"}
                onSelect={() => {
                  selectProfile("dyslexia");
                  // Close on click so the student sees the result of their
                  // choice. Keyboard arrow navigation deliberately does NOT
                  // close it - browsing the options must not dismiss the
                  // dialog mid-navigation.
                  closeOverlays();
                }}
                tone="sky"
              />
              <ProfileCard
                id="profile-option-autism"
                index={1}
                icon={<Brain className="h-5 w-5" aria-hidden="true" />}
                title="Autism"
                summary="A calm, low-stimulation page with figures of speech restated in plain words."
                features={["Zen sensory focus", "Earth tones", "Literal language"]}
                selected={activeProfile === "autism"}
                onSelect={() => {
                  selectProfile("autism");
                  // Without this the schedule would render behind this modal's
                  // backdrop, so choosing Autism would look like nothing
                  // happened.
                  closeOverlays();
                }}
                tone="emerald"
              />

              {/* The clear option: same radio group, so it is reached with the
                  arrow keys like any other choice. */}
              <button
                id="profile-option-none"
                type="button"
                role="radio"
                aria-checked={activeProfile === "none"}
                tabIndex={activeProfile === "none" ? 0 : -1}
                data-profile-index={2}
                onClick={() => {
                  selectProfile("none");
                  closeOverlays();
                }}
                className={[
                  "flex w-full items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left",
                  "transition-all duration-300 motion-reduce:transition-none active:scale-[0.99]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
                  activeProfile === "none"
                    ? "border-slate-400 bg-slate-700/60 ring-2 ring-slate-300/70 ring-offset-2 ring-offset-slate-900"
                    : "border-slate-700 bg-slate-800/40 hover:border-slate-600",
                ].join(" ")}
              >
                <span className="text-xs font-medium text-slate-300">
                  Default — no profile
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    "transition-all duration-300 motion-reduce:transition-none",
                    activeProfile === "none"
                      ? "border-slate-300 bg-slate-300 text-slate-900"
                      : "border-slate-600 bg-transparent",
                  ].join(" ")}
                >
                  {activeProfile === "none" && (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  )}
                </span>
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              Profiles only change how the page is displayed. BIGKAS is an
              assistive document formatting tool and does not assess, diagnose
              or advise.
            </p>
          </div>
        </div>
      )}

      {!isReadingStage && (
        <footer className="border-t border-slate-800/80 px-4 py-5 text-center text-[11px] leading-relaxed text-slate-500">
          BIGKAS — assistive document formatting tool. Not a medical device.
          Images are processed in memory for this demo and are not stored.
        </footer>
      )}

      {/* --------------- permanent profiles hamburger ---------------
          Fixed outside the stage markup so it is on screen in the camera
          stage and the reading stage alike, and never scrolls or remounts.
          z-[60] keeps it above the sticky header (z-40) and both overlay
          layers (z-50), so it also closes the modal it opened. */}
      <button
        type="button"
        onClick={toggleProfiles}
        aria-expanded={profilesOpen}
        aria-controls="accessibility-profiles"
        aria-label="Reading profiles"
        className={[
          "fixed left-3 top-3 z-[60] inline-flex h-9 w-9 items-center justify-center rounded-xl",
          "border bg-slate-900/90 shadow-lg shadow-slate-950/50 backdrop-blur",
          "transition-all duration-300 motion-reduce:transition-none active:scale-95",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
          profilesOpen
            ? "border-sky-400 text-sky-300"
            : "border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white",
        ].join(" ")}
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
