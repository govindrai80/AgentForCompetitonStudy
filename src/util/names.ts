/**
 * Company-name matching.
 *
 * Used for two jobs that pull in opposite directions: finding leverage ("we
 * worked with a rival of this prospect") and catching conflicts ("a rival of
 * this prospect is already our client"). Both are reported to a human, so the
 * function returns a graded verdict with its reasoning rather than a bare
 * boolean — a weak match is worth surfacing and not worth acting on
 * automatically.
 */

const LEGAL_SUFFIX_WORDS = [
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation",
  "co", "company", "gmbh", "ag", "kg", "ug", "ab", "asa", "as", "aps", "oy",
  "oyj", "nv", "bv", "sa", "sas", "sarl", "srl", "spa", "pte", "pty", "pvt",
  "kk", "llp", "lp",
];

export const LEGAL_SUFFIX_RE = new RegExp(
  `[,\\s]+\\b(${LEGAL_SUFFIX_WORDS.join("|")}|a\\/s|l\\.l\\.c|private limited|kabushiki kaisha)\\b\\.?`,
  "gi",
);

/**
 * Words that appear in so many company names in a given market that sharing one
 * says nothing. Heavy on real-estate vocabulary because that is where a shared
 * token is most likely to be a coincidence.
 */
const GENERIC_TOKENS = new Set([
  "group", "groups", "holdings", "holding", "properties", "property", "realty",
  "realtors", "estate", "estates", "developers", "developer", "development",
  "developments", "builders", "builder", "infra", "infratech", "infrastructure",
  "projects", "project", "ventures", "venture", "homes", "housing", "land",
  "lands", "house", "constructions", "construction", "enterprises", "india",
  "global", "international", "national", "technologies", "technology", "systems",
  "solutions", "services", "digital", "media", "labs", "partners", "capital",
  "the", "and", "of", "for",
]);

export const stripLegalSuffixes = (name: string): string =>
  name.replace(LEGAL_SUFFIX_RE, "").trim();

export const normaliseName = (name: string): string =>
  stripLegalSuffixes(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const significantTokens = (name: string): string[] =>
  normaliseName(name)
    .split(" ")
    .filter((t) => t.length >= 5 && !GENERIC_TOKENS.has(t));

export type MatchConfidence = "exact" | "strong" | "weak";

export interface NameMatch {
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Compare two company names.
 *
 *   exact  — the same name once legal suffixes and punctuation are removed
 *   strong — one name is the other plus qualifiers ("Godrej" / "Godrej Properties")
 *   weak   — they share one distinctive word and nothing more
 *
 * The weak tier exists because of cases like "Lodha Group" against "House of
 * Abhinandan Lodha": related, frequently confused, and genuinely separate
 * companies. Treating that as a match would put a false claim in an email;
 * ignoring it would hide a conflict worth a human's attention. So it is
 * reported, and it is not acted on.
 */
export function matchCompany(a: string, b: string): NameMatch | null {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return null;

  if (na === nb) return { confidence: "exact", reason: `"${a}" and "${b}" are the same name` };

  const ta = na.split(" ");
  const tb = nb.split(" ");
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = shorter === ta ? tb : ta;

  // "godrej" ⊂ "godrej properties" — every word of the shorter name appears in
  // the longer one, in order, and at least one of them is distinctive.
  if (isSubsequence(shorter, longer) && shorter.some((t) => t.length >= 5 && !GENERIC_TOKENS.has(t))) {
    return { confidence: "strong", reason: `"${a}" and "${b}" share the same distinctive name` };
  }

  const shared = significantTokens(a).filter((t) => significantTokens(b).includes(t));
  if (shared.length > 0) {
    return {
      confidence: "weak",
      reason: `"${a}" and "${b}" share the word "${shared[0]}" but are otherwise different names`,
    };
  }

  return null;
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const word of haystack) {
    if (word === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

/**
 * Word-boundary search for a company name inside free text, generous by design:
 * a model that drops the legal suffix or writes only the distinctive part has
 * still named the client. Used by the confidentiality gate, where a false
 * positive costs a human ten seconds and a false negative breaches a contract.
 */
export function mentionsName(body: string, name: string): boolean {
  const cleaned = stripLegalSuffixes(name);
  if (cleaned.length < 3) return false;

  const candidates = new Set<string>([name.trim(), cleaned]);
  const words = cleaned.split(/\s+/);
  if (words.length > 1 && (words[0]?.length ?? 0) >= 5) candidates.add(words[0]!);

  return [...candidates].some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`, "i").test(body);
  });
}
