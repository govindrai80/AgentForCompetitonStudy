import type { Corpus } from "../corpus/load.js";
import { quotableFacts } from "../corpus/match.js";
import type { CompetitorIntel } from "../corpus/competitors.js";
import type { MatchPlan, ProspectResearch } from "../types.js";

/**
 * The evidence pack is the closed world the drafter and the verifier are
 * allowed to draw on. Building it once, in code, and handing the same object
 * to both stages is what makes grounding checkable: the verifier never sees the
 * research prose, so it cannot be talked into accepting a claim that isn't here.
 */
export interface EvidencePack {
  /** ref -> the fact it licenses. Keys are what `evidenceRef` must match. */
  facts: Map<string, string>;
  rendered: string;
  allowedRefs: string[];
}

export function buildEvidencePack(
  corpus: Corpus,
  research: ProspectResearch,
  plan: MatchPlan,
  competitorIntel?: CompetitorIntel,
): EvidencePack {
  const facts = new Map<string, string>();
  const sections: string[] = [];

  /* ---- Prospect facts, each bound to the source that established it ---- */
  const sourceById = new Map(research.sources.map((s) => [s.id, s]));
  const prospectLines: string[] = [];

  const co = research.company;
  const identity = [
    co.legalName ? `legal name ${co.legalName}` : null,
    co.hqCity || co.hqCountry ? `based in ${[co.hqCity, co.hqCountry].filter(Boolean).join(", ")}` : null,
    co.employeeRange ? `${co.employeeRange} employees` : null,
    co.foundedYear ? `founded ${co.foundedYear}` : null,
    co.ownership,
    co.fundingStage,
  ]
    .filter(Boolean)
    .join("; ");
  if (identity) {
    facts.set("profile:prospect", `${co.displayName}: ${identity}`);
    prospectLines.push(`- [profile:prospect] ${co.displayName} — ${identity}`);
  }

  for (const dev of research.recentDevelopments) {
    for (const sid of dev.sourceIds) {
      const src = sourceById.get(sid);
      if (!src) continue;
      const ref = `src:${sid}`;
      const text = `${dev.headline}${dev.date ? ` (${dev.date})` : ""} — ${dev.whyItMatters}`;
      facts.set(ref, text);
      prospectLines.push(`- [${ref}] ${text}\n    source: ${src.title} — ${src.url}`);
    }
  }
  for (const pain of research.likelyPains) {
    for (const sid of pain.sourceIds) {
      const src = sourceById.get(sid);
      if (!src) continue;
      const ref = `src:${sid}`;
      const text = `${pain.pain} — evidence: ${pain.evidence}`;
      facts.set(ref, [facts.get(ref), text].filter(Boolean).join(" || "));
      prospectLines.push(`- [${ref}] ${text}\n    source: ${src.title} — ${src.url}`);
    }
  }
  if (research.techSignals.length) {
    facts.set("profile:prospect.tech", research.techSignals.join("; "));
    prospectLines.push(`- [profile:prospect.tech] observed technology: ${research.techSignals.join("; ")}`);
  }

  sections.push(`## Prospect facts you may assert\n${prospectLines.join("\n") || "(none — do not assert any specifics about the prospect)"}`);

  /* ---- Our results, filtered by what the plan chose and what is quotable ---- */
  const csById = new Map(corpus.caseStudies.map((c) => [c.id, c]));
  const csLines: string[] = [];

  for (const sel of plan.selected) {
    const cs = csById.get(sel.caseStudyId);
    if (!cs || cs.confidentiality === "internal_only") continue;
    const qf = quotableFacts(cs);
    const ref = `cs:${cs.id}`;
    const body = [
      `${qf.clientReference} (${cs.industry}, ${cs.country})`,
      `problem: ${cs.problem}`,
      `what we did: ${cs.solution}`,
      qf.quotableResults.length ? `quotable results: ${qf.quotableResults.join(" | ")}` : "quotable results: NONE",
    ].join(" · ");
    facts.set(ref, body);

    csLines.push(
      [
        `- [${ref}] ${qf.clientReference} — ${cs.industry}, ${cs.country}${cs.year ? `, ${cs.year}` : ""}`,
        `    name them exactly as: "${qf.clientReference}"`,
        `    problem: ${cs.problem}`,
        `    what we did: ${cs.solution}`,
        qf.quotableResults.length
          ? `    QUOTABLE numbers: ${qf.quotableResults.map((r) => `"${r}"`).join(" | ")}`
          : `    QUOTABLE numbers: none — describe the outcome qualitatively or omit it`,
        qf.withheldResults.length ? `    DO NOT QUOTE (unverified): ${qf.withheldResults.join(" | ")}` : "",
        qf.quoteAllowed && cs.quote ? `    usable testimonial: "${cs.quote.text}" — ${cs.quote.attribution}` : "",
        `    angles the selector flagged: ${sel.anglesToUse.join("; ") || "n/a"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  sections.push(`## Our past results you may cite\n${csLines.join("\n") || "(none selected — write the email without a client reference)"}`);

  /* ---- Our own positioning and specs ---- */
  const svcById = new Map(corpus.company.services.map((s) => [s.id, s]));
  const svcLines: string[] = [];
  for (const rec of plan.recommendedServices) {
    const svc = svcById.get(rec.serviceId);
    if (!svc) continue;
    const ref = `profile:service.${svc.id}`;
    const specs = rec.specsToSurface
      .map((k) => (svc.specs[k] !== undefined ? `${k}: ${svc.specs[k]}` : null))
      .filter(Boolean) as string[];
    const body = `${svc.name} — ${svc.positioning}${specs.length ? ` · specs: ${specs.join("; ")}` : ""}`;
    facts.set(ref, body);
    svcLines.push(
      [
        `- [${ref}] ${svc.name}`,
        `    positioning: ${svc.positioning}`,
        `    why it fits here: ${rec.why}`,
        specs.length ? `    specifications you may state verbatim:\n${specs.map((s) => `      · ${s}`).join("\n")}` : "",
        svc.proofPoints.length ? `    proof points: ${svc.proofPoints.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const c = corpus.company;
  facts.set("profile:company", `${c.name} — ${c.oneLiner} · ${c.positioning}`);
  svcLines.unshift(`- [profile:company] ${c.name}: ${c.oneLiner}. ${c.positioning}`);
  if (c.differentiators.length) {
    facts.set("profile:differentiators", c.differentiators.join("; "));
    svcLines.push(`- [profile:differentiators] ${c.differentiators.join("; ")}`);
  }
  sections.push(`## Our positioning and specifications\n${svcLines.join("\n")}`);

  /* ---- Competitive leverage, where we are cleared to use it ---- */
  // Only the `leverage` bucket reaches this point. Silent matches (real but
  // undisclosable) and weak matches (possibly a different company) are kept out
  // of the writer's world entirely — they go to the brief, for a human.
  const usable = competitorIntel?.leverage ?? [];
  if (usable.length) {
    const lines = usable.map((l) => {
      const ref = `comp:${slugRef(l.competitor)}`;
      const body =
        `${l.referAs} competes with ${research.company.displayName} (${l.relationship}) and is our client` +
        (l.origin.kind === "case-study" ? `, written up as case study ${l.origin.id}` : ", with no case study behind it");
      facts.set(ref, body);
      return [
        `- [${ref}] ${l.referAs} — a ${l.relationship} competitor of the prospect, and our client`,
        `    refer to them exactly as: "${l.referAs}"`,
        l.origin.kind === "case-study"
          ? `    the engagement is written up as case study ${l.origin.id} — its results above are the ones you may cite`
          : `    relationship only: you may say we work with them, and you have NO numbers for them`,
        `    ${l.note}`,
      ].join("\n");
    });
    sections.push(
      `## Competitors of the prospect that are our clients\n` +
        `This is the strongest material available to you, and the easiest to misuse. Reference the relationship as a reason you understand their market — never as a boast, a threat, or an implied disclosure of what a rival is doing.\n` +
        lines.join("\n"),
    );
  }

  return { facts, rendered: sections.join("\n\n"), allowedRefs: [...facts.keys()] };
}

const slugRef = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
