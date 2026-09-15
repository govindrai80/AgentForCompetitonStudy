import type { AgentConfig } from "../config.js";
import type { Claude } from "../anthropic.js";
import type { Corpus } from "../corpus/load.js";
import { quotableFacts, shortlist, type ScoredCaseStudy } from "../corpus/match.js";
import { MatchPlanSchema, type MatchPlan, type ProspectResearch } from "../types.js";
import { log } from "../util/logger.js";

export async function selectEvidence(
  claude: Claude,
  cfg: AgentConfig,
  corpus: Corpus,
  research: ProspectResearch,
): Promise<{ plan: MatchPlan; shortlisted: ScoredCaseStudy[] }> {
  const shortlisted = shortlist(corpus.caseStudies, research, cfg.matching.shortlistSize);
  if (shortlisted.length === 0) {
    throw new Error(
      "No usable case studies. Every case study is marked internal_only, or the library is empty.",
    );
  }
  log.debug(`shortlist: ${shortlisted.map((s) => `${s.caseStudy.id}(${s.score})`).join(", ")}`);

  const plan = await claude.extract({
    label: "select",
    schema: MatchPlanSchema,
    schemaName: "match_plan",
    maxTokens: 16000,
    system: [
      {
        text:
          `You decide which of a seller's past engagements are genuinely comparable to a prospect, and which of their services to lead with.\n\n` +
          `You are the quality gate between a library of case studies and a cold email. Most case studies in the shortlist will not be relevant. Say so.\n\n` +
          `Judgement rules:\n` +
          `- Comparability means the prospect would recognise themselves in it: same class of problem, similar scale, similar constraints. Same industry label is weak evidence on its own.\n` +
          `- Select at most ${cfg.matching.maxCited}. One sharply relevant case study beats three loose ones. Selecting only one is a good outcome.\n` +
          `- Only cite results marked QUOTABLE. Results marked WITHHELD are unverified — you may reference the direction of change in words, never the number.\n` +
          `- Refer to clients only by the "refer to as" name given. That string reflects a contractual constraint.\n` +
          `- resultsToCite must be exact substrings of the QUOTABLE lines.\n` +
          `- specsToSurface must be exact spec keys from the service definitions. Pick the two or three a buyer in this industry would actually ask about.\n` +
          `- Check the seller's disqualifiers against the research. If any fires, list it in disqualifierHits — that is a recommendation not to send.\n` +
          `- risks: what would make this outreach land badly. Be blunt. "Nothing" is almost never true.`,
      },
      { text: sellerSheet(corpus), cache: true },
    ],
    userPrompt: [
      `## Prospect research`,
      "```json",
      JSON.stringify(compactResearch(research), null, 2),
      "```",
      ``,
      `## Shortlisted case studies (pre-ranked by a deterministic filter; the score is a hint, not an instruction)`,
      ...shortlisted.map((s) => renderCaseStudy(s)),
    ].join("\n"),
  });

  if (plan.selected.length > cfg.matching.maxCited) {
    plan.selected = plan.selected
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, cfg.matching.maxCited);
  }
  return { plan, shortlisted };
}

function renderCaseStudy(s: ScoredCaseStudy): string {
  const cs = s.caseStudy;
  const facts = quotableFacts(cs);
  return [
    ``,
    `### ${cs.id}  (prefilter score ${s.score}: ${s.reasons.join("; ") || "no signal"})`,
    `- Refer to as: ${facts.clientReference}  [confidentiality: ${cs.confidentiality}]`,
    `- Industry: ${cs.industry}${cs.subSectors.length ? ` / ${cs.subSectors.join(", ")}` : ""}`,
    `- Where: ${cs.country} (${cs.region})${cs.year ? ` · ${cs.year}` : ""}${cs.companySize ? ` · ${cs.companySize}` : ""}`,
    cs.businessModel ? `- Business model: ${cs.businessModel}` : "",
    `- Services used: ${cs.servicesUsed.join(", ") || "n/a"}`,
    cs.stack.length ? `- Stack: ${cs.stack.join(", ")}` : "",
    `- Problem: ${cs.problem}`,
    `- Solution: ${cs.solution}`,
    facts.quotableResults.length ? `- QUOTABLE results: ${facts.quotableResults.map((r) => `"${r}"`).join(" | ")}` : `- QUOTABLE results: none`,
    facts.withheldResults.length ? `- WITHHELD (unverified, never quote the number): ${facts.withheldResults.join(" | ")}` : "",
    facts.quoteAllowed && cs.quote ? `- Usable testimonial: "${cs.quote.text}" — ${cs.quote.attribution}` : "",
    cs.narrative ? `- Narrative: ${truncate(cs.narrative, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function sellerSheet(corpus: Corpus): string {
  const c = corpus.company;
  return [
    `# Seller: ${c.name}`,
    c.oneLiner,
    ``,
    `## Services`,
    ...c.services.map((s) =>
      [
        `### ${s.id} — ${s.name}`,
        s.description,
        `Positioning: ${s.positioning}`,
        s.idealFor.length ? `Ideal for: ${s.idealFor.join(", ")}` : "",
        Object.keys(s.specs).length
          ? `Specifications:\n${Object.entries(s.specs).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`
          : "",
        s.proofPoints.length ? `Proof points: ${s.proofPoints.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    ``,
    `## Differentiators`,
    ...c.differentiators.map((d) => `- ${d}`),
    ``,
    `## Disqualifiers (reasons not to pitch at all)`,
    ...(c.disqualifiers.length ? c.disqualifiers.map((d) => `- ${d}`) : ["- (none recorded)"]),
    ``,
    `## Claims that may never be made`,
    ...(c.forbiddenClaims.length ? c.forbiddenClaims.map((d) => `- ${d}`) : ["- (none recorded)"]),
  ].join("\n");
}

/** Drop the long tail the selector doesn't need, to keep the call small. */
function compactResearch(r: ProspectResearch) {
  return {
    company: r.company,
    industry: r.industry,
    market: r.market,
    productsAndServices: r.productsAndServices,
    techSignals: r.techSignals,
    recentDevelopments: r.recentDevelopments.map((d) => ({ headline: d.headline, whyItMatters: d.whyItMatters })),
    likelyPains: r.likelyPains.map((p) => ({ pain: p.pain, evidence: p.evidence })),
    buyingContext: r.buyingContext,
    competitors: r.competitors,
    regulatoryNotes: r.regulatoryNotes,
    confidence: r.confidence,
    gaps: r.gaps,
  };
}

const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);
