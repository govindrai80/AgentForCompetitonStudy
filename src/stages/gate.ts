import type { Corpus } from "../corpus/load.js";
import type { EvidencePack } from "./evidence.js";
import type { EmailDraft, GateFinding, LocaleProfile } from "../types.js";

const FILLER = [
  "i hope this email finds you well",
  "i hope this finds you well",
  "i wanted to reach out",
  "just reaching out",
  "touch base",
  "circle back",
  "game-changing",
  "game changing",
  "revolutionary",
  "cutting-edge",
  "synergy",
  "synergies",
  "best-in-class",
  "world-class",
  "quick question",
  "picking your brain",
];

/**
 * Checks that do not involve a model.
 *
 * The verifier stage is a second opinion; this is the floor. Anything here is
 * either arithmetic or string matching, so it cannot be argued with, and it
 * catches exactly the failures that are most expensive and least visible:
 * naming a client we contracted not to name, and quoting a number we never
 * verified.
 */
export function runGate(args: {
  draft: EmailDraft;
  evidence: EvidencePack;
  corpus: Corpus;
  locale: LocaleProfile;
}): GateFinding[] {
  const { draft, evidence, corpus, locale } = args;
  const findings: GateFinding[] = [];
  const body = draft.body;
  const lower = body.toLowerCase();
  const add = (severity: GateFinding["severity"], rule: string, detail: string) =>
    findings.push({ severity, rule, detail });

  /* --- Claim ledger integrity --- */
  const allowed = new Set(evidence.allowedRefs);
  for (const claim of draft.claims) {
    if (!allowed.has(claim.evidenceRef)) {
      add(
        "blocker",
        "unknown-evidence-ref",
        `Claim "${truncate(claim.text, 90)}" cites ${claim.evidenceRef}, which is not in the evidence pack.`,
      );
    }
    if (claim.text.trim() && !normalise(lower).includes(normalise(claim.text.toLowerCase()))) {
      add(
        "minor",
        "claim-not-in-body",
        `Ledger entry "${truncate(claim.text, 90)}" does not appear verbatim in the body — the ledger may be stale.`,
      );
    }
  }

  /* --- Confidentiality: the constraint we are contractually bound to --- */
  for (const cs of corpus.caseStudies) {
    const named = mentionsName(body, cs.client);
    if (cs.confidentiality === "internal_only" && named) {
      add("blocker", "confidentiality", `"${cs.client}" is marked internal_only but appears in the body.`);
    }
    if (cs.confidentiality === "anonymized" && named) {
      add(
        "blocker",
        "confidentiality",
        `"${cs.client}" is marked anonymized and must be referred to as "${cs.anonymousLabel}", but the real name appears in the body.`,
      );
    }
    // Unverified numbers must not surface, whatever the confidentiality level.
    for (const result of cs.results.filter((r) => !r.verified)) {
      for (const figure of figuresIn(result.delta)) {
        if (figuresIn(body).includes(figure)) {
          add(
            "major",
            "unverified-number",
            `The figure "${figure}" matches an unverified result on case study "${cs.id}" (${result.metric}). Verify it or cut it.`,
          );
        }
      }
    }
  }

  /* --- Claims we may never make --- */
  for (const forbidden of corpus.company.forbiddenClaims) {
    if (lower.includes(forbidden.toLowerCase())) {
      add("blocker", "forbidden-claim", `Body contains a forbidden claim: "${forbidden}".`);
    }
  }

  /* --- Locale limits --- */
  if (draft.subject.length > locale.subjectMaxChars) {
    add(
      "major",
      "subject-length",
      `Subject is ${draft.subject.length} chars; ${locale.label} limit is ${locale.subjectMaxChars}.`,
    );
  }
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words > locale.bodyMaxWords) {
    add("major", "body-length", `Body is ${words} words; ${locale.label} limit is ${locale.bodyMaxWords}.`);
  }

  /* --- Compliance --- */
  const needsAddress = locale.compliance.some((c) => /address/i.test(c));
  if (needsAddress && !corpus.company.postalAddress) {
    add(
      "major",
      "compliance",
      `${locale.label} requires a postal address in commercial email, but company.postalAddress is not set.`,
    );
  }
  const needsOptOut = locale.compliance.some((c) => /opt.?out|unsubscribe/i.test(c));
  if (needsOptOut && !corpus.company.unsubscribeLine) {
    add(
      "major",
      "compliance",
      `${locale.label} requires an opt-out mechanism, but company.unsubscribeLine is not set.`,
    );
  }

  /* --- Copy hygiene --- */
  for (const phrase of FILLER) {
    if (lower.includes(phrase)) add("minor", "filler", `Body contains "${phrase}".`);
  }
  const placeholder = body.match(/\[[A-Za-z ._-]{2,30}\]|\{\{[^}]{1,40}\}\}|<[A-Za-z ._-]{2,30}>/);
  if (placeholder) {
    add("blocker", "placeholder", `Unfilled placeholder left in the body: ${placeholder[0]}`);
  }
  if ((body.match(/!/g) ?? []).length > 0) {
    add("minor", "punctuation", "Body contains an exclamation mark.");
  }
  if (draft.claims.length === 0 && /\d/.test(body)) {
    add("major", "no-ledger", "The body contains figures but the writer produced an empty claim ledger.");
  }

  return findings;
}

export const worstSeverity = (findings: GateFinding[]): "blocker" | "major" | "minor" | "none" =>
  findings.some((f) => f.severity === "blocker")
    ? "blocker"
    : findings.some((f) => f.severity === "major")
      ? "major"
      : findings.length
        ? "minor"
        : "none";

const LEGAL_SUFFIXES =
  /[,\s]+\b(inc|incorporated|llc|l\.l\.c|ltd|limited|plc|corp|corporation|co|company|gmbh|ag|kg|ug|ab|asa|as|a\/s|aps|oy|oyj|nv|bv|sa|sas|sarl|srl|spa|pte|pty|pvt|private limited|kk|kabushiki kaisha|holdings|group)\b\.?/gi;

/**
 * Does the body name this client?
 *
 * Deliberately generous. A model that drops the legal suffix, or writes only
 * the distinctive part of the name, has still named the client — and on a
 * confidentiality check the asymmetry is stark: a false positive costs a human
 * ten seconds reading the brief, a false negative breaches a contract. Word
 * boundaries keep it from firing on "Meridianum" when the client is "Meridian".
 */
function mentionsName(body: string, name: string): boolean {
  const cleaned = name.replace(LEGAL_SUFFIXES, "").trim();
  if (cleaned.length < 3) return false;

  const candidates = new Set<string>([name.trim(), cleaned]);
  const words = cleaned.split(/\s+/);
  // A distinctive leading token on its own is enough — "Lindqvist" identifies
  // "Lindqvist Betalningar AB". Short or generic-length tokens are not.
  if (words.length > 1 && (words[0]?.length ?? 0) >= 5) candidates.add(words[0]!);

  return [...candidates].some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`, "i").test(body);
  });
}

/** Percentages, multiples, currency and bare numbers, normalised for comparison. */
function figuresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\d[\d,.]*)\s*(%|x\b|×)?/gi)) {
    const value = m[1]?.replace(/,/g, "").replace(/\.$/, "");
    if (!value || value.length < 2) continue;
    out.add(`${value}${(m[2] ?? "").toLowerCase().replace("×", "x")}`);
  }
  return [...out];
}

const normalise = (s: string) => s.replace(/[\s‘’“”]+/g, (m) => (/\s/.test(m) ? " " : "'")).trim();
const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);
