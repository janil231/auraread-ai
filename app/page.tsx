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
  Copy,
  Languages,
  Loader2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Ruler,
  ScanLine,
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

type WorkspaceTab = "reader" | "mindmap";

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

export default function Home() {
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

  useEffect(() => {
    if (stage !== "A") return;
    void startCamera();
    return () => {
      stopStream();
    };
  }, [stage, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      stopStream();
      stopSpeaking();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [stopSpeaking, stopStream]);

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
              `[auraread] scanner fell back to sample text (reason=${reason})`,
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
            "[auraread] scanner response had no text field; using built-in sample.",
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
          "[auraread] request to /api/ocr failed; using built-in sample.",
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
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    stopStream();
    setCamState("idle");
    await runOcr(SAMPLE_IMAGE_SRC, "Sample textbook page");
  }, [runOcr, stopStream]);

  const handleRetake = useCallback(() => {
    stopSpeaking();
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
  }, [stopSpeaking]);

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
      console.error("[auraread] translation failed.", err);
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
      console.error("[auraread] mind map failed.", err);
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-violet-500 text-slate-950 shadow-lg shadow-sky-500/20">
            <ScanLine className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="mr-auto">
            <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              AuraRead AI
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {notice && (
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
              onClick={() => setNotice(null)}
              className="rounded-md p-1 text-current/70 transition hover:bg-white/10"
              aria-label="Dismiss message"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {stage === "A" ? (
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
                  AuraRead AI is an assistive document formatting tool.
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
          <div className="animate-fade-in-up grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* --------------------- reading workspace --------------------- */}
            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-2xl shadow-slate-950/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-5 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <BookOpen className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  Accessible reading workspace
                </h2>

                {/* Language toggle + tab switcher sit together at the top of the workspace. */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLangToggle}
                    // Deliberately NOT disabled while translating: the switch
                    // must stay clickable so it can be cancelled back to
                    // English mid-fetch.
                    disabled={isProcessing || !originalText}
                    aria-pressed={showingTagalog}
                    aria-busy={isTranslating}
                    className={[
                      "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                      showingTagalog
                        ? "border-sky-400/60 bg-sky-500/20 text-sky-100"
                        : "border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600",
                    ].join(" ")}
                  >
                    {isTranslating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Languages
                        className={[
                          "h-3.5 w-3.5",
                          showingTagalog ? "text-sky-300" : "text-slate-400",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                    )}
                    {showingTagalog ? "Show Original English" : "Translate to Tagalog"}
                  </button>

                  <div
                    role="tablist"
                    aria-label="Workspace views"
                    className="flex flex-wrap gap-1 rounded-xl border border-slate-700 bg-slate-800/50 p-1"
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
                          "rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
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
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {sourceLabel && (
                    <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-slate-300">
                      {sourceLabel}
                    </span>
                  )}
                  {originalText && (
                    <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-slate-400">
                      {wordCount.toLocaleString()} words
                    </span>
                  )}
                </div>
              </div>

              {usedFallback && (
                <p
                  className={[
                    "border-b px-5 py-2 text-xs",
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

              {previewSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={previewSrc}
                  alt="The page that was scanned"
                  className="max-h-64 w-full border-b border-slate-800 bg-slate-950 object-contain"
                />
              )}

              {/* background tint toolbar */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800/70 px-5 py-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Page tint
                </span>
                {TINT_ORDER.map((id) => {
                  const swatch = READING_TINTS[id];
                  const active = tint === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTint(id)}
                      aria-pressed={active}
                      title={swatch.label}
                      className={[
                        "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11px] font-medium transition",
                        active
                          ? "border-sky-400 bg-sky-500/15 text-sky-200"
                          : "border-slate-700 text-slate-400 hover:border-slate-500",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "h-4 w-4 rounded-full border border-black/20",
                          swatch.swatch,
                        ].join(" ")}
                        aria-hidden="true"
                      />
                      {swatch.label}
                    </button>
                  );
                })}
              </div>

              <div className="p-4 sm:p-6">
                <div
                  ref={readerSurfaceRef}
                  className={[
                    "relative rounded-2xl border p-5 shadow-inner sm:p-8",
                    READING_TINTS[tint].surface,
                    dyslexiaFocus ? "border-sky-300" : READING_TINTS[tint].border,
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
                        READING_TINTS[tint].ink,
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
                        renderKaraokeText(
                          displayText,
                          karaokeTokens,
                          karaokeTokenIndex,
                          phonicsOn,
                          "k",
                          activeTokenElRef,
                        )
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
                  */}
                  {rulerOn && rulerTop !== null && isReadingSurface && (
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

                <p className="mt-3 text-[11px] text-slate-500">
                  Tip: focus the text box and use your browser&apos;s own zoom
                  (Ctrl + / Ctrl -) for fine adjustments.
                </p>
              </div>
            </section>

            {/* ---------------------------- toolbar ------------------------- */}
            <aside className="flex flex-col gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="text-sm font-semibold text-slate-200">
                  Reading controls
                </h2>

                <div className="mt-4 space-y-5">
                  <div>
                    <button
                      type="button"
                      onClick={() => setDyslexiaFocus((v) => !v)}
                      disabled={isProcessing}
                      aria-pressed={dyslexiaFocus}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-45",
                        dyslexiaFocus
                          ? "border-sky-400 bg-sky-400/15"
                          : "border-slate-700 bg-slate-800/60 hover:border-slate-500",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        <Type
                          className={[
                            "h-5 w-5",
                            dyslexiaFocus ? "text-sky-300" : "text-slate-400",
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-100">
                            Dyslexia Focus
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Wider spacing &amp; line height
                          </span>
                        </span>
                      </span>
                      <span
                        className={[
                          "relative h-6 w-11 shrink-0 rounded-full transition",
                          dyslexiaFocus ? "bg-sky-500" : "bg-slate-600",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                            dyslexiaFocus ? "left-[22px]" : "left-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </button>
                  </div>

                  {/* ------------------- reading ruler toggle ------------------- */}
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setRulerOn((v) => {
                          if (v) setRulerTop(null);
                          return !v;
                        });
                      }}
                      disabled={isProcessing}
                      aria-pressed={rulerOn}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-45",
                        rulerOn
                          ? "border-amber-400/60 bg-amber-400/10"
                          : "border-slate-700/70 hover:border-slate-600",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        <Ruler
                          className={[
                            "h-4 w-4",
                            rulerOn ? "text-amber-300" : "text-slate-400",
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-100">
                            Reading Ruler
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Dim other lines to stop line-skipping
                          </span>
                        </span>
                      </span>
                      <span
                        className={[
                          "relative h-6 w-11 shrink-0 rounded-full transition",
                          rulerOn ? "bg-amber-500" : "bg-slate-600",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                            rulerOn ? "left-[22px]" : "left-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </button>
                  </div>

                  {/* ----------------- color-coded phonics toggle ---------------- */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setPhonicsOn((v) => !v)}
                      disabled={isProcessing}
                      aria-pressed={phonicsOn}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-45",
                        phonicsOn
                          ? "border-red-400/50 bg-red-400/10"
                          : "border-slate-700/70 hover:border-slate-600",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        <Type
                          className={[
                            "h-4 w-4",
                            phonicsOn ? "text-red-300" : "text-slate-400",
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-100">
                            Color-Coded Phonics
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            <span className="font-semibold text-red-400">vowels</span>
                            {" and "}
                            <span className="font-semibold text-emerald-400">
                              digraphs
                            </span>{" "}
                            highlighted
                          </span>
                        </span>
                      </span>
                      <span
                        className={[
                          "relative h-6 w-11 shrink-0 rounded-full transition",
                          phonicsOn ? "bg-red-500" : "bg-slate-600",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                            phonicsOn ? "left-[22px]" : "left-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </button>
                  </div>

                  {/* ------------------- English / Tagalog toggle ----------------- */}
                  <div>
                    <button
                      type="button"
                      onClick={handleLangToggle}
                      // Stay clickable while translating so the user can
                      // switch back to English without waiting for the fetch.
                      disabled={isProcessing || !originalText}
                      aria-pressed={showingTagalog}
                      aria-busy={isTranslating}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-45",
                        showingTagalog
                          ? "border-sky-400/60 bg-sky-500/12"
                          : "border-slate-700/70 hover:border-slate-600",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-3">
                        {isTranslating ? (
                          <Loader2
                            className="h-4 w-4 animate-spin text-sky-400"
                            aria-hidden="true"
                          />
                        ) : (
                          <Languages
                            className={[
                              "h-4 w-4",
                              showingTagalog ? "text-sky-300" : "text-sky-400",
                            ].join(" ")}
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          <span className="block text-sm font-medium text-slate-100">
                            {showingTagalog ? "Show Original English" : "Translate to Tagalog"}
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            Natural everyday Filipino
                          </span>
                        </span>
                      </span>
                      <span
                        className={[
                          "relative h-6 w-11 shrink-0 rounded-full transition",
                          showingTagalog ? "bg-sky-500" : "bg-slate-600",
                        ].join(" ")}
                        aria-hidden="true"
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                            showingTagalog ? "left-[22px]" : "left-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="font-size"
                        className="text-xs font-medium uppercase tracking-wider text-slate-400"
                      >
                        Font size
                      </label>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                        {fontSize}px
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setFontSize((s) => Math.max(MIN_FONT_SIZE, s - FONT_SIZE_STEP))
                        }
                        disabled={isProcessing || fontSize <= MIN_FONT_SIZE}
                        aria-label="Decrease font size"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/60 text-slate-200 transition hover:border-slate-500 hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-40"
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
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/60 text-slate-200 transition hover:border-slate-500 hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="mt-3 rounded-lg bg-slate-800/50 px-3 py-2 text-xs leading-relaxed text-slate-400">
                      Preview:{" "}
                      <span
                        className={[
                          "text-slate-200",
                          dyslexiaFocus ? "tracking-wide leading-loose" : "",
                        ].join(" ")}
                        style={{ fontSize: `${Math.min(fontSize, 20)}px` }}
                      >
                        Every letter on its own line
                      </span>
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <ToolButton
                      full
                      icon={
                        isSpeaking ? (
                          <VolumeX className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Volume2 className="h-4 w-4" aria-hidden="true" />
                        )
                      }
                      label={isSpeaking ? "Stop reading" : "Read aloud"}
                      onClick={handleToggleSpeech}
                      disabled={isProcessing || displayText.trim().length === 0}
                      active={isSpeaking}
                    />
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
                      tone="danger"
                      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                      label="Retake photo"
                      onClick={handleRetake}
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 text-[11px] leading-relaxed text-slate-500">
                <p className="font-semibold text-slate-400">
                  AuraRead AI is an assistive document formatting tool.
                </p>
                <p className="mt-1">
                  Text is reproduced verbatim from your photo. No diagnosis,
                  interpretation or health guidance is provided.
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800/80 px-4 py-5 text-center text-[11px] leading-relaxed text-slate-500">
        AuraRead AI — assistive document formatting tool. Not a medical device.
        Images are processed in memory for this demo and are not stored.
      </footer>
    </div>
  );
}
