import type { CaseStudy, ProspectResearch } from "../types.js";

export interface ScoredCaseStudy {
  caseStudy: CaseStudy;
  score: number;
  reasons: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2));

function overlap(a: Iterable<string>, b: Iterable<string>): number {
  const setB = new Set([...b].map((x) => norm(x)).filter(Boolean));
  let hits = 0;
  for (const item of a) if (setB.has(norm(item))) hits++;
  return hits;
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits;
}

/**
 * Cheap, explainable, deterministic shortlist.
 *
 * Its job is not to pick the winner — the model does that with the full
 * narrative in front of it. Its job is to keep token spend flat as the case
 * study library grows from 8 to 800, and to make the ranking auditable: every
 * score comes with the reasons that produced it.
 */
export function shortlist(
  caseStudies: CaseStudy[],
  research: ProspectResearch,
  limit: number,
  /** Case studies whose client is a confirmed competitor of the prospect. */
  competitorCaseStudyIds: ReadonlySet<string> = new Set(),
): ScoredCaseStudy[] {
  const thisYear = new Date().getUTCFullYear();

  const scored = caseStudies
    // Internal-only material never reaches a stage that can quote it.
    .filter((cs) => cs.confidentiality !== "internal_only")
    .map((cs) => {
      const reasons: string[] = [];
      let score = 0;

      // Having worked for a company the prospect competes with outranks every
      // other signal here: it is the difference between "we understand your
      // sector" and "we have already solved this for the firm across the road".
      if (competitorCaseStudyIds.has(cs.id)) {
        score += 70;
        reasons.push("client is a direct competitor of the prospect");
      }

      const industryHit = tokenOverlap(cs.industry, research.industry.primary);
      if (industryHit > 0) {
        score += 30 * Math.min(industryHit, 2);
        reasons.push(`industry match: ${cs.industry} ≈ ${research.industry.primary}`);
      }

      const subHits = overlap(cs.subSectors, research.industry.subSectors);
      if (subHits > 0) {
        score += 12 * subHits;
        reasons.push(`${subHits} shared sub-sector(s)`);
      }

      if (research.company.hqCountry && norm(cs.country) === norm(research.company.hqCountry)) {
        score += 25;
        reasons.push(`same country (${cs.country})`);
      } else if (norm(cs.region) === norm(research.market.primaryRegion)) {
        score += 14;
        reasons.push(`same region (${cs.region})`);
      }

      if (cs.businessModel && tokenOverlap(cs.businessModel, research.industry.businessModel) > 0) {
        score += 15;
        reasons.push(`similar business model (${cs.businessModel})`);
      }

      const stackHits = overlap(cs.stack, research.techSignals);
      if (stackHits > 0) {
        score += 8 * stackHits;
        reasons.push(`${stackHits} shared tech signal(s)`);
      }

      const painText = research.likelyPains.map((p) => p.pain).join(" ");
      const painHits = tokenOverlap(cs.problem, painText);
      if (painHits > 0) {
        score += Math.min(painHits * 4, 20);
        reasons.push(`problem statement echoes ${painHits} pain term(s)`);
      }

      const verified = cs.results.filter((r) => r.verified).length;
      score += verified * 6;
      if (verified > 0) reasons.push(`${verified} verified result(s)`);
      else if (cs.results.length > 0) reasons.push("results present but unverified — numbers withheld");

      if (cs.year) {
        const age = thisYear - cs.year;
        const recency = Math.max(0, 12 - age * 3);
        score += recency;
        if (age <= 2) reasons.push(`recent (${cs.year})`);
      }

      if (cs.confidentiality === "public") {
        score += 8;
        reasons.push("client is nameable");
      }

      return { caseStudy: cs, score, reasons };
    });

  return scored.sort((a, b) => b.score - a.score || a.caseStudy.id.localeCompare(b.caseStudy.id)).slice(0, limit);
}

/**
 * What the drafter is allowed to say about a case study, given its
 * confidentiality setting and whether its numbers were ever verified. This is a
 * code-enforced rule, not a prompt instruction — prompts get ignored.
 */
export function quotableFacts(cs: CaseStudy): {
  clientReference: string;
  quotableResults: string[];
  withheldResults: string[];
  quoteAllowed: boolean;
} {
  const clientReference =
    cs.confidentiality === "public" ? cs.client : (cs.anonymousLabel ?? `a ${cs.industry} company in ${cs.country}`);

  const quotable = cs.results.filter((r) => r.verified);
  const withheld = cs.results.filter((r) => !r.verified);

  return {
    clientReference,
    quotableResults: quotable.map((r) =>
      [r.metric, r.delta, r.timeframe ? `in ${r.timeframe}` : ""].filter(Boolean).join(" — "),
    ),
    withheldResults: withheld.map((r) => `${r.metric} — ${r.delta}`),
    quoteAllowed: cs.confidentiality === "public" && !!cs.quote,
  };
}
