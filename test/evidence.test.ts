import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../src/stages/evidence.js";
import { loadAgentConfig } from "../src/config.js";
import { loadCorpus } from "../src/corpus/load.js";
import type { MatchPlan, ProspectResearch } from "../src/types.js";

const corpus = loadCorpus(loadAgentConfig());

const research: ProspectResearch = {
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
  likelyPains: [{ pain: "reporting contention", evidence: "job advert for a data engineer", sourceIds: ["s2"] }],
  buyingContext: { likelyBuyerTitles: ["VP Engineering"], probableTriggers: ["acquisition"], procurementNotes: null },
  competitors: [],
  regionalNotes: [],
  regulatoryNotes: [],
  confidence: "high",
  gaps: [],
  sources: [
    { id: "s1", url: "https://news.example/a", title: "Acme acquires Bolt", publisher: "Trade Press", publishedDate: "2026-03-01" },
    { id: "s2", url: "https://acme.example/careers", title: "Careers", publisher: null, publishedDate: null },
  ],
};

const plan: MatchPlan = {
  pitchAngle: "Reporting is about to contend with operations.",
  selected: [
    { caseStudyId: "nordic-fintech-reporting", relevanceScore: 88, rationale: "same failure mode", anglesToUse: ["CDC"], resultsToCite: [] },
    // internal_only — must be dropped by the pack even though the plan named it.
    { caseStudyId: "helix-oncall-reset", relevanceScore: 40, rationale: "n/a", anglesToUse: [], resultsToCite: [] },
  ],
  recommendedServices: [{ serviceId: "data-platform", why: "fits", specsToSurface: ["data residency", "ingestion"] }],
  rejected: [],
  risks: [],
  disqualifierHits: [],
};

const pack = buildEvidencePack(corpus, research, plan);

describe("evidence pack", () => {
  it("excludes internal_only case studies even when the plan selects one", () => {
    expect(pack.rendered).not.toContain("Helix Diagnostics");
    expect(pack.allowedRefs).not.toContain("cs:helix-oncall-reset");
  });

  it("substitutes the anonymous label for a restricted client", () => {
    expect(pack.rendered).toContain("a Nordic payments company");
    expect(pack.rendered).not.toContain("Lindqvist");
  });

  it("marks unverified numbers as unquotable", () => {
    expect(pack.rendered).toContain("DO NOT QUOTE");
    expect(pack.rendered).toContain("roughly halved");
  });

  it("binds every prospect fact to a source the research actually returned", () => {
    for (const ref of pack.allowedRefs.filter((r) => r.startsWith("src:"))) {
      expect(research.sources.map((s) => `src:${s.id}`)).toContain(ref);
    }
    expect(pack.rendered).toContain("https://news.example/a");
  });

  it("surfaces only the spec keys the plan asked for", () => {
    expect(pack.rendered).toContain("data residency: EU, US or India");
    expect(pack.rendered).toContain("ingestion: CDC via Debezium");
    expect(pack.rendered).not.toContain("typical duration: 12–20 weeks");
  });

  it("always licenses the seller's own positioning", () => {
    expect(pack.allowedRefs).toContain("profile:company");
  });
});
