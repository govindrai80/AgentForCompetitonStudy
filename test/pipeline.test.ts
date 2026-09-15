import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { loadAgentConfig } from "../src/config.js";
import { loadCorpus } from "../src/corpus/load.js";
import { isBlocked, runPipeline } from "../src/pipeline.js";
import { renderBrief } from "../src/render/brief.js";
import { renderEmailBody } from "../src/render/email.js";
import type { EmailDraft, MatchPlan, ProspectResearch, Verification } from "../src/types.js";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const RESEARCH: ProspectResearch = {
  company: {
    displayName: "Acme Logistics",
    legalName: "Acme Logistics Inc.",
    website: "https://acme.example",
    hqCountry: "United States",
    hqCity: "Denver",
    foundedYear: 2011,
    employeeRange: "500-1000",
    ownership: "PE-backed",
    fundingStage: null,
  },
  industry: { primary: "Logistics", subSectors: ["freight"], businessModel: "B2B SaaS" },
  market: { countriesServed: ["United States"], primaryRegion: "North America", languages: ["English"] },
  productsAndServices: ["freight visibility platform"],
  techSignals: ["Kafka", "PostgreSQL"],
  recentDevelopments: [
    { headline: "Acquired Bolt Freight", date: "2026-03", whyItMatters: "Doubles data volume", sourceIds: ["s1"] },
  ],
  likelyPains: [{ pain: "reporting contention", evidence: "data engineer job advert", sourceIds: ["s2"] }],
  buyingContext: { likelyBuyerTitles: ["VP Engineering"], probableTriggers: ["acquisition"], procurementNotes: null },
  competitors: [],
  regionalNotes: ["US buyers expect a short first email."],
  regulatoryNotes: [],
  confidence: "high",
  gaps: ["Could not establish current database size."],
  sources: [
    { id: "s1", url: "https://news.example/a", title: "Acme acquires Bolt", publisher: "Trade Press", publishedDate: "2026-03-01" },
    { id: "s2", url: "https://acme.example/careers", title: "Careers", publisher: null, publishedDate: null },
  ],
};

const PLAN: MatchPlan = {
  pitchAngle: "Reporting load is about to collide with operations.",
  selected: [
    {
      caseStudyId: "nordic-fintech-reporting",
      relevanceScore: 88,
      rationale: "Same failure mode: analytics contending with the transactional primary.",
      anglesToUse: ["phased, revertible migration"],
      resultsToCite: ["-87% month-end p99 authorisation latency"],
    },
  ],
  recommendedServices: [{ serviceId: "data-platform", why: "Directly addresses the contention", specsToSurface: ["ingestion"] }],
  rejected: [{ caseStudyId: "meridian-checkout-latency", why: "Different failure mode." }],
  risks: ["They may already be mid-migration."],
  disqualifierHits: [],
};

const DRAFT: EmailDraft = {
  subject: "Reporting load after the Bolt acquisition",
  preheader: "One phased approach that stays revertible",
  body: [
    "Hi Dana,",
    "",
    "The Bolt Freight acquisition roughly doubles the data behind your reporting, which usually shows up first as analytics queries contending with the transactional database.",
    "",
    "We moved a Nordic payments company off that pattern using CDC via Debezium, in four independently revertible phases. Month-end p99 on their authorisation path fell 87%.",
    "",
    "Worth fifteen minutes?",
    "",
    "Best,",
    "Priya",
  ].join("\n"),
  claims: [
    { text: "The Bolt Freight acquisition roughly doubles the data behind your reporting", evidenceRef: "src:s1" },
    { text: "We moved a Nordic payments company off that pattern using CDC via Debezium", evidenceRef: "cs:nordic-fintech-reporting" },
  ],
  cta: "Fifteen minutes",
  toneNotes: "US register: short, direct, one ask.",
  followUpSuggestion: "Follow up in eight working days with the phase breakdown.",
  alternativeSubjects: ["Analytics contention after Bolt"],
};

const VERIFICATION: Verification = {
  verdict: "pass",
  summary: "Every claim traces to the evidence pack.",
  findings: [],
};

/**
 * Minimal stand-in for the SDK client. The pipeline calls `extract` four times
 * in a fixed order, so the stub is keyed by stage rather than by a bare counter
 * — an override then replaces exactly one stage and leaves the rest intact.
 */
interface StageOverrides {
  research?: unknown;
  plan?: unknown;
  draft?: unknown;
  verification?: unknown;
}

function stubClient(overrides: StageOverrides = {}) {
  const stages = ["research", "plan", "draft", "verification"] as const;
  const defaults: Record<(typeof stages)[number], unknown> = {
    research: RESEARCH,
    plan: PLAN,
    draft: DRAFT,
    verification: VERIFICATION,
  };
  const seen: { streams: unknown[]; parses: unknown[] } = { streams: [], parses: [] };
  let i = 0;

  const client = {
    beta: {
      messages: {
        stream(params: unknown) {
          seen.streams.push(params);
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              stop_details: null,
              usage,
              content: [
                { type: "text", text: "Analyst notes about Acme Logistics.\n\nSOURCES\n1. https://news.example/a" },
              ],
            }),
          };
        },
      },
    },
    messages: {
      parse(params: unknown) {
        seen.parses.push(params);
        const stage = stages[i++];
        if (!stage) throw new Error("stub: more parse calls than pipeline stages");
        return Promise.resolve({
          stop_reason: "end_turn",
          stop_details: null,
          usage,
          parsed_output: overrides[stage] ?? defaults[stage],
        });
      },
    },
  };
  return { client: client as unknown as Anthropic, seen };
}

describe("pipeline", () => {
  const cfg = loadAgentConfig();
  const corpus = loadCorpus(cfg);

  it("runs end to end and produces a sendable draft", async () => {
    const { client, seen } = stubClient();
    const result = await runPipeline(
      cfg,
      { prospect: "Acme Logistics", contactName: "Dana Whitfield", contactTitle: "VP Engineering" },
      { corpus, sdkClient: client },
    );

    expect(seen.streams).toHaveLength(1); // research
    expect(seen.parses).toHaveLength(4); // structure, select, draft, verify
    expect(result.artifacts.gateFindings).toEqual([]);
    expect(result.artifacts.verification.verdict).toBe("pass");
    expect(isBlocked(result.artifacts)).toBe(false);
    expect(result.artifacts.usage.calls).toBe(5);
    expect(result.artifacts.usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("picks the locale from the researched HQ country", async () => {
    const { client } = stubClient();
    const { artifacts } = await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });
    expect(artifacts.locale.code).toBe("US");
    expect(artifacts.industryStyle?.key).toBe("logistics");
  });

  it("honours an explicit locale override", async () => {
    const { client } = stubClient();
    const { artifacts } = await runPipeline(
      cfg,
      { prospect: "Acme Logistics", localeCode: "DE" },
      { corpus, sdkClient: client },
    );
    expect(artifacts.locale.code).toBe("DE");
  });

  it("gives the research stage web tools and caches the seller prefix", async () => {
    const { client, seen } = stubClient();
    await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });

    const params = seen.streams[0] as {
      tools: { type: string }[];
      system: { text: string; cache_control?: unknown }[];
      thinking: { type: string };
      output_config: { effort: string };
    };
    expect(params.tools.map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(params.thinking.type).toBe("adaptive");
    expect(params.output_config.effort).toBe(cfg.effort);
    // The stable seller context is the cache breakpoint; the prospect name is
    // in the user message, after it.
    expect(params.system.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(params.system.map((b) => b.text).join(" ")).not.toContain("Acme Logistics");
  });

  it("appends the signature and the US compliance footer outside the model's control", async () => {
    const { client } = stubClient();
    const { artifacts } = await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });
    const email = renderEmailBody(artifacts.draft, corpus.company, artifacts.locale);

    expect(email).toContain("Priya Raman");
    expect(email).toContain("Principal, Platform Engineering, Northwind Systems");
    expect(email).toContain(corpus.company.postalAddress!);
    expect(email).toContain(corpus.company.unsubscribeLine!);
  });

  it("renders a brief carrying the audit trail", async () => {
    const { client } = stubClient();
    const result = await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });
    const brief = renderBrief(result.artifacts, corpus.company, result.shortlisted, result.researchNotes);

    expect(brief).toContain("# Outreach brief — Acme Logistics");
    expect(brief).toContain("PASS");
    expect(brief).toContain("cs:nordic-fintech-reporting");
    expect(brief).toContain("https://news.example/a");
    expect(brief).toContain("Could not establish current database size.");
    expect(brief).not.toContain("Lindqvist"); // anonymised client stays anonymous
  });

  it("blocks when the draft cites evidence that is not in the pack", async () => {
    const { client } = stubClient({
      draft: { ...DRAFT, claims: [{ text: "Worth fifteen minutes?", evidenceRef: "src:fabricated" }] },
    });

    const { artifacts } = await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });

    expect(artifacts.gateFindings).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "unknown-evidence-ref" }),
    );
    expect(isBlocked(artifacts)).toBe(true);
    // The verifier still ran normally; the block came from the deterministic gate.
    expect(artifacts.verification.verdict).toBe("pass");
  });

  it("blocks when the verifier returns a block verdict even with a clean gate", async () => {
    const { client } = stubClient({
      verification: {
        verdict: "block",
        summary: "A number was restated more strongly than the evidence supports.",
        findings: [
          {
            severity: "blocker",
            kind: "overstated_claim",
            quote: "fell 87%",
            issue: "Framed as typical rather than as one engagement.",
            suggestedFix: "Attribute the figure to the single engagement.",
          },
        ],
      },
    });

    const { artifacts } = await runPipeline(cfg, { prospect: "Acme Logistics" }, { corpus, sdkClient: client });

    expect(artifacts.gateFindings).toEqual([]);
    expect(isBlocked(artifacts)).toBe(true);
  });

});
