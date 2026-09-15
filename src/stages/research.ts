import type { AgentConfig } from "../config.js";
import type { Claude, SystemBlock } from "../anthropic.js";
import type { Corpus } from "../corpus/load.js";
import { ProspectResearchSchema, type ProspectResearch } from "../types.js";
import { log } from "../util/logger.js";

export interface ResearchInput {
  prospect: string;
  /** Optional hints from the operator — website, country, a contact name. */
  hints: { website?: string; country?: string; contactName?: string; contactTitle?: string; notes?: string };
}

const ANALYST_BRIEF = `You are a B2B research analyst preparing a sales team for first contact with a company they have never spoken to.

Your output is read by a colleague who will write one cold email. They need to sound like they did their homework, not like they read a press release. So:

- Use the web search and web fetch tools. Do not answer from memory. Company facts change; your training data is stale by definition.
- Prefer primary sources: the company's own site, careers page, product docs, changelog, status page, pricing page, regulatory filings, and the local business press. Job adverts and engineering blogs are unusually high-signal about what a software company is actually struggling with.
- Search in the company's own language and market where that will find more than English will.
- Attribute every factual claim to a specific URL you actually retrieved. If two sources conflict, say so and say which you trust.
- Distinguish hard fact from inference, and label inference as inference.
- State what you could not find. A blank is useful; a confident guess is a liability, because the person reading this will put it in an email to a stranger.
- Note regional and market context that changes how outreach should land: business culture, buying process, procurement norms, data-residency and privacy regimes, language, and anything about the local market a foreigner would get wrong.

Structure your findings under these headings, in prose:

1. Company — legal name, site, HQ, age, size, ownership/funding
2. Industry and business model
3. Markets, countries served, languages
4. Products and services
5. Technology signals — stack, tooling, integrations, engineering practices
6. Recent developments — last 18 months, each with why it matters commercially
7. Likely operational pains — grounded in observed evidence, not archetype
8. Buying context — who buys this kind of thing there, what triggers a purchase, how procurement works
9. Competitors
10. Regional and regulatory context for outreach
11. Confidence and gaps — what you could not establish

Finish with a numbered SOURCES list: id, URL, title, publisher, publication date. Reference source ids inline as [s1], [s2] where the claim is made.`;

export async function researchProspect(
  claude: Claude,
  cfg: AgentConfig,
  corpus: Corpus,
  input: ResearchInput,
): Promise<{ research: ProspectResearch; notes: string }> {
  const tools: unknown[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: cfg.research.maxSearches,
      ...domainFilter(cfg),
    },
  ];
  if (cfg.research.maxFetches > 0) {
    tools.push({
      type: "web_fetch_20260209",
      name: "web_fetch",
      max_uses: cfg.research.maxFetches,
      ...domainFilter(cfg),
    });
  }

  // Stable across every prospect in a batch → cacheable prefix.
  // The prospect name lives in the user message, after the breakpoint.
  const system: SystemBlock[] = [
    { text: ANALYST_BRIEF },
    { text: sellerContext(corpus), cache: true },
  ];

  const hints = Object.entries(input.hints)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const notes = await claude.generate({
    label: "research",
    system,
    tools,
    maxTokens: 32000,
    userPrompt:
      `Research this prospect: **${input.prospect}**\n\n` +
      (hints ? `Operator-supplied starting points (verify them, don't assume they're right):\n${hints}\n\n` : "") +
      `Today's date is ${new Date().toISOString().slice(0, 10)}. Begin searching now.`,
  });

  log.debug(`research notes: ${notes.length} chars`);

  // Second pass: prose → schema. Separating this from the tool-using call keeps
  // the research turn free to be long and discursive, and makes the structured
  // extraction a short, cheap, deterministic-shaped call.
  const research = await claude.extract({
    label: "research/structure",
    schema: ProspectResearchSchema,
    schemaName: "prospect_research",
    system: [
      {
        text:
          `You convert a research analyst's notes into a structured record.\n\n` +
          `Rules:\n` +
          `- Copy only what the notes support. Never add facts, never smooth over a gap.\n` +
          `- Where the notes say something is unknown, use null or an empty array — do not infer.\n` +
          `- Every entry under recentDevelopments and likelyPains must carry at least one sourceId that exists in the sources array.\n` +
          `- Carry the analyst's source list across verbatim, keeping the same ids.\n` +
          `- Set confidence honestly: "low" if the notes are thin or mostly inference.`,
      },
    ],
    userPrompt: `Analyst notes for ${input.prospect}:\n\n<notes>\n${notes}\n</notes>`,
  });

  return { research, notes };
}

function domainFilter(cfg: AgentConfig): Record<string, string[]> {
  // The API accepts one list or the other, never both.
  if (cfg.research.allowedDomains.length) return { allowed_domains: cfg.research.allowedDomains };
  if (cfg.research.blockedDomains.length) return { blocked_domains: cfg.research.blockedDomains };
  return {};
}

/** A compact description of who we are, so the analyst knows what's relevant. */
function sellerContext(corpus: Corpus): string {
  const c = corpus.company;
  return [
    `You are researching on behalf of ${c.name} (${c.website}).`,
    ``,
    `${c.oneLiner}`,
    ``,
    `Positioning: ${c.positioning}`,
    ``,
    `What they sell:`,
    ...c.services.map((s) => `- ${s.name}: ${s.description} (ideal for: ${s.idealFor.join(", ") || "n/a"})`),
    ``,
    `Weight your research toward evidence that would tell this seller whether the prospect is a fit, and toward the operational problems this seller is equipped to solve. Do not pitch — just find out what is true.`,
  ].join("\n");
}
