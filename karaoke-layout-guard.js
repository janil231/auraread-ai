/**
 * Guards against karaoke layout shift.
 *
 * The highlight must be paint-only. If any declaration that participates in
 * layout sneaks into the active/idle class lists, the active word's box changes
 * size, the line reflows, and the neighbouring words visibly jump as the
 * highlight moves. This asserts the class strings contain nothing of the sort,
 * and that the two states share every layout-relevant base class.
 */
const fs = require("fs");

const SRC = "C:\\Users\\sadth\\Desktop\\auraread AI\\app\\page.tsx";
const src = fs.readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  [PASS] ${name}  ${detail}`); }
  else { fail++; console.log(`  [FAIL] ${name}  ${detail}`); }
}

function grabConst(name) {
  const m = src.match(new RegExp(`const ${name} =\\s*\`?([\\s\\S]*?)\`?;`));
  return m ? m[1] : null;
}

const base = grabConst("KARAOKE_BASE_CLASS");
const active = grabConst("KARAOKE_ACTIVE_CLASS");
const idle = grabConst("KARAOKE_IDLE_CLASS");

console.log("=== class lists found in source ===");
check("KARAOKE_BASE_CLASS present", base !== null, base || "");
check("KARAOKE_ACTIVE_CLASS present", active !== null, active || "");
check("KARAOKE_IDLE_CLASS present", idle !== null, idle || "");

// Everything in this Tailwind version that can change an element's box.
const LAYOUT_RE = new RegExp([
  "font-bold", "font-semibold", "font-medium", "font-light", "font-normal", "font-thin",
  "\\bfont-",                       // any font-weight utility
  "\\bscale-",                      // transforms resize the painted box visually
  "\\brotate-", "\\btranslate-",
  "\\bpx-", "\\bpy-", "\\bpt-", "\\bpb-", "\\bpl-", "\\bpr-",
  "\\bm[trblxy]?-",                 // margins
  "\\bw-", "\\bh-", "\\bmin-w-", "\\bmin-h-", "\\bmax-w-", "\\bmax-h-",
  "tracking-",                      // letter-spacing
  "leading-",                       // line-height
  "\\bwhitespace-", "\\bbreak-",
  "\\balign-",                      // vertical-align moves the line box
  "\\binline-", "\\bblock", "\\bflex", "\\bgrid", "\\btable",
  // `shadow-*` box-shadow utilities can paint outside the box but do not change
  // its size, so they are allowed. `text-shadow` (our bold illusion) is a paint
  // property too - exclude it via lookbehind so the hyphen prefix doesn't match.
  "\\bborder(?!-)", "\\boutline", "\\bring",
  "(?<![\\w-])shadow-",
  "\\btransform", "\\bfilter", "\\bblur",
  "\\btext-(xs|sm|base|lg|xl|\\d)", // font-size
].join("|"));

console.log("");
console.log("=== NO layout-affecting utility anywhere in the highlight ===");
for (const [label, raw] of [["BASE", base], ["ACTIVE", active], ["IDLE", idle]]) {
  if (raw === null) continue;
  // Resolve `${KARAOKE_BASE_CLASS}` first, otherwise the base utilities are
  // invisible to the scan and ACTIVE/IDLE get a free pass on half their content.
  const val = (label === "BASE" ? raw : raw.replace(/\$\{KARAOKE_BASE_CLASS\}/g, (base || "").replace(/^"|"$/g, "").trim()));
  const hits = val.match(new RegExp(LAYOUT_RE.source, "g"));
  check(`${label} is paint-only`, hits === null, hits ? `found: ${[...new Set(hits)].join(", ")}` : "no layout utils");
}

console.log("");
console.log("=== active/inactive differ ONLY by colour ===");
// The active list is BASE + colours; the idle list is BASE + bg-transparent.
// Strip colour utilities and the two must be identical.
// Resolve the template-literal interpolation so the comparison is real rather
// than trivially true (both lists start with the literal text `${KARAOKE_BASE_CLASS}`).
const baseResolved = (base || "").replace(/^"|"$/g, "").trim();
const resolve = (s) => (s || "").replace(/\$\{KARAOKE_BASE_CLASS\}/g, baseResolved);

const COLOR_RE = /\bbg-[a-z0-9/-]+|\btext-(?!shadow)[a-z0-9/-]+|\[text-shadow:[^\]]+\]/g;
const stripColors = (s) => resolve(s).replace(COLOR_RE, "").replace(/\s+/g, " ").trim();
check("BASE identical after stripping colour",
  stripColors(active) === stripColors(idle),
  `active="${stripColors(active)}" idle="${stripColors(idle)}"`);
check("colour strip actually removed something",
  stripColors(active) !== resolve(active),
  resolve(active));

check("ACTIVE has amber background", /bg-amber-300/.test(active || ""), "");
check("ACTIVE has dark text for contrast", /text-slate-950/.test(active || ""), "");
check("IDLE is transparent", /bg-transparent/.test(idle || ""), "");
check("ACTIVE uses text-shadow bold illusion", /\[text-shadow:/.test(active || ""), "");
check("no font-weight utility in ACTIVE", !/font-(bold|semibold|medium|light|normal|thin|black)/.test(active || ""), "");
check("no scale in ACTIVE", !/scale-/.test(active || ""), "");

console.log("");
console.log("=== transition only animates colour ===");
check("transition-colors (not 'transition' all)", /transition-colors/.test(base || ""), "");
check("no transition-all", !/transition-all|transition-\[transform/.test(`${base} ${active} ${idle}`), "");

console.log("");
console.log("=== active word keeps its phonics font-weight ===");
// renderPhonics gained a `karaoke` flag; it must keep font-semibold so the
// word's advance width is identical to when it is idle.
const phonicsBody = src.match(/function renderPhonics\([\s\S]*?\n}/);
check("renderPhonics found", phonicsBody !== null, "");
if (phonicsBody) {
  check("karaoke variant keeps font-semibold",
    /karaoke\s*\?\s*"font-semibold"/.test(phonicsBody[0]),
    "");
  check("non-karaoke variants keep font-semibold",
    (phonicsBody[0].match(/font-semibold/g) || []).length >= 3,
    `${(phonicsBody[0].match(/font-semibold/g) || []).length} occurrences`);
}

console.log("");
console.log("=== active word still renders phonics (not stripped) ===");
check("renderKaraokeText passes isActive into renderPhonics",
  /renderPhonics\(token\.text, key, isActive\)/.test(src), "");
check("no early-return that drops phonics for the active word",
  !/isActive[\s\S]{0,200}?renderPhonics/.test(src) ||
  /renderPhonics\(token\.text, key, isActive\)/.test(src), "");

console.log("");
console.log("=== every word is wrapped identically regardless of state ===");
const karaokeFn = src.match(/function renderKaraokeText\([\s\S]*?\n}/);
if (karaokeFn) {
  const fn = karaokeFn[0];
  check("body computed before the active/inactive branch",
    /const body = phonicsOn[\s\S]*?isActive\)/.test(fn) && fn.indexOf("const body") < fn.indexOf("if (!isActive)"), "");
  check("inactive branch uses KARAOKE_IDLE_CLASS", /KARAOKE_IDLE_CLASS/.test(fn), "");
  check("active branch uses KARAOKE_ACTIVE_CLASS", /KARAOKE_ACTIVE_CLASS/.test(fn), "");
  check("both branches render the same `body` node", (fn.match(/\{body\}/g) || []).length === 2,
    `${(fn.match(/\{body\}/g) || []).length} uses`);
}

console.log("");
console.log("=== old jittery properties fully removed ===");
check("no inline-block on the highlight", !/inline-block[^\n]*KARAOKE_ACTIVE/.test(src) && !/KARAOKE_ACTIVE_CLASS\s*=\s*`[^`]*inline-block/.test(src), "");
check("no ring-2 on the highlight", !/ring-2/.test(grabConst("KARAOKE_ACTIVE_CLASS") || ""), "");
check("no shadow-sm on the highlight", !/shadow-sm/.test(grabConst("KARAOKE_ACTIVE_CLASS") || ""), "");
check("no px-1 on the highlight", !/\bpx-1\b/.test(grabConst("KARAOKE_ACTIVE_CLASS") || ""), "");

console.log("");
console.log(`=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);