import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { isBlocked, runPipeline } from "../src/pipeline.js";
import { renderBrief } from "../src/render/brief.js";
import { renderEmailBody } from "../src/render/email.js";
import { competitor, fixtureConfig, fixtureCorpus, research } from "./helpers.js";
import type { EmailDraft, MatchPlan, Verification } from "../src/types.js";

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const RESEARCH = research({
  competitors: [competitor("Skyline Developers", "direct"), competitor("Unrelated Builders", "adjacent")],
  gaps: ["Could not establish current unsold inventory."],
});

const PLAN: MatchPlan = {
  pitchAngle: "Absorption, not lead volume, is the problem after a 600-unit launch.",
  selected: [
    {
      caseStudyId: "skyline-launch",
      relevanceScore: 92,
      rationale: "Same failure mode, and the client is a direct competitor of the prospect.",
      anglesToUse: ["cost per booking rose while cost per lead fell"],
      resultsToCite: ["-38% cost per booking"],
    },
  ],
  recommendedServices: [{ serviceId: "performance", why: "Directly addresses absorption", specsToSurface: ["attribution"] }],
  rejected: [{ caseStudyId: "harbour-estates", why: "Different segment." }],
  risks: ["Naming a direct rival can read as indiscretion."],
  disqualifierHits: [],
};

const DRAFT: EmailDraft = {
  subject: "After the Thane launch",
  preheader: "On absorption rather than lead volume",
  body: [
    "Dear Dana Whitfield,",
    "",
    "You launched a 600-unit tower in Thane in June, which usually turns the question from lead volume into absorption within two quarters.",
    "",
    "We ran the Skyline Developers launch through the same shift and brought cost per booking down 38% over six months, by re-cutting media against bookings rather than enquiries.",
    "",
    "Worth fifteen minutes?",
    "",
    "Best regards,",
    "Asha",
  ].join("\n"),
  claims: [
    { text: "You launched a 600-unit tower in Thane in June", evidenceRef: "src:s1" },
    { text: "We ran the Skyline Developers launch", evidenceRef: "comp:skyline-developers" },
    { text: "brought cost per booking down 38% over six months", evidenceRef: "cs:skyline-launch" },
  ],
  cta: "Fifteen minutes",
  toneNotes: "Mumbai register: direct, absorption-led, no flattery.",
  followUpSuggestion: "Follow up in eight working days with the media re-cut.",
  alternativeSubjects: ["Absorption after a 600-unit launch"],
};

const VERIFICATION: Verification = { verdict: "pass", summary: "Every claim traces to the evidence pack.", findings: [] };

interface StageOverrides {
  research?: unknown;
  plan?: unknown;
  draft?: unknown;
  verification?: unknown;
}

/** Keyed by stage, so an override replaces exactly one and leaves the rest intact. */
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
              content: [{ type: "text", text: "Analyst notes.\n\nSOURCES\n1. https://trade.example/a" }],
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
  const cfg = fixtureConfig();
  const corpus = fixtureCorpus();
  const run = (overrides: StageOverrides = {}, opts = {}) => {
    const { client, seen } = stubClient(overrides);
    return runPipeline(
      cfg,
      { prospect: "Northpoint Developers", contactName: "Dana Whitfield", contactTitle: "Head of Sales", ...opts },
      { corpus, sdkClient: client },
    ).then((result) => ({ result, seen }));
  };

  it("runs end to end and produces a sendable draft", async () => {
    const { result, seen } = await run();

    expect(seen.streams).toHaveLength(1);
    expect(seen.parses).toHaveLength(4);
    expect(result.artifacts.usage.calls).toBe(5);
    expect(result.artifacts.usage.estimatedCostUsd).toBeGreaterThan(0);
    // The only finding is the seller's own competitor-conflict rule firing.
    expect(result.artifacts.gateFindings.map((f) => f.rule)).toEqual(["competitor-conflict"]);
    expect(isBlocked(result.artifacts)).toBe(false);
  });

  it("resolves the metro locale from the researched city, not just the country", async () => {
    const { result } = await run();
    expect(result.artifacts.locale.code).toBe("IN-MMR");
    expect(result.artifacts.industryStyle?.key).toBe("real estate");
  });

  it("honours an explicit locale override", async () => {
    const { result } = await run({}, { localeCode: "AE" });
    expect(result.artifacts.locale.code).toBe("AE");
  });

  it("cross-references competitors before anything decides what to pitch", async () => {
    const { result } = await run();
    const ci = result.artifacts.competitorIntel;

    expect(ci.leverage.map((l) => l.referAs)).toEqual(["Skyline Developers"]);
    expect(ci.unmatched).toEqual(["Unrelated Builders"]);
    expect(ci.cautions[0]?.severity).toBe("major");
  });

  it("puts the competitor relationship in front of the writer", async () => {
    const { seen } = await run();
    const draftPrompt = JSON.stringify(seen.parses[2]);
    expect(draftPrompt).toContain("comp:skyline-developers");
    expect(draftPrompt).toContain("Competitors of the prospect that are our clients");
  });

  it("gives the research stage web tools and caches the seller prefix", async () => {
    const { seen } = await run();
    const params = seen.streams[0] as {
      tools: { type: string }[];
      system: { text: string; cache_control?: unknown }[];
      thinking: { type: string };
      output_config: { effort: string };
    };
    expect(params.tools.map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(params.thinking.type).toBe("adaptive");
    expect(params.output_config.effort).toBe(cfg.effort);
    expect(params.system.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // The prospect name lives after the cache breakpoint, in the user message.
    expect(params.system.map((b) => b.text).join(" ")).not.toContain("Northpoint");
  });

  it("appends the signature outside the model's control", async () => {
    const { result } = await run();
    const email = renderEmailBody(result.artifacts.draft, corpus.company, result.artifacts.locale);
    expect(email).toContain("Asha Menon");
    expect(email).toContain("Principal, Fixture Marketing Works");
  });

  it("renders a brief carrying the audit trail and the competitor picture", async () => {
    const { result } = await run();
    const brief = renderBrief(result.artifacts, corpus.company, result.shortlisted, result.researchNotes);

    expect(brief).toContain("# Outreach brief — Northpoint Developers");
    expect(brief).toContain("## Competitor overlap");
    expect(brief).toContain("Skyline Developers");
    expect(brief).toContain("No recorded relationship with: Unrelated Builders");
    expect(brief).toContain("Could not establish current unsold inventory.");
    expect(brief).not.toContain("Harbour Estates"); // anonymised client stays anonymous
  });

  it("blocks when the draft cites evidence that is not in the pack", async () => {
    const { result } = await run({
      draft: { ...DRAFT, claims: [{ text: "Worth fifteen minutes?", evidenceRef: "src:fabricated" }] },
    });
    expect(result.artifacts.gateFindings).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "unknown-evidence-ref" }),
    );
    expect(isBlocked(result.artifacts)).toBe(true);
    expect(result.artifacts.verification.verdict).toBe("pass");
  });

  it("blocks when the verifier returns a block verdict even with a clean gate", async () => {
    const { result } = await run({
      verification: {
        verdict: "block",
        summary: "A rival's confidential arrangement was implied.",
        findings: [
          {
            severity: "blocker",
            kind: "overstated_claim",
            quote: "We ran the Skyline Developers launch",
            issue: "Implies transferable knowledge of a rival's plan.",
            suggestedFix: "Frame as market familiarity.",
          },
        ],
      },
    });
    expect(result.artifacts.gateFindings.map((f) => f.rule)).toEqual(["competitor-conflict"]);
    expect(isBlocked(result.artifacts)).toBe(true);
  });
});
