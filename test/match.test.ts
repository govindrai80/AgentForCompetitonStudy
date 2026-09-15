import { describe, expect, it } from "vitest";
import { quotableFacts, shortlist } from "../src/corpus/match.js";
import { loadAgentConfig } from "../src/config.js";
import { loadCorpus } from "../src/corpus/load.js";
import type { ProspectResearch } from "../src/types.js";

const corpus = loadCorpus(loadAgentConfig());

const research = (over: Partial<ProspectResearch> = {}): ProspectResearch =>
  ({
    company: {
      displayName: "Acme",
      legalName: null,
      website: null,
      hqCountry: "United Kingdom",
      hqCity: null,
      foundedYear: null,
      employeeRange: null,
      ownership: null,
      fundingStage: null,
    },
    industry: { primary: "E-commerce", subSectors: ["marketplace"], businessModel: "B2C marketplace" },
    market: { countriesServed: ["United Kingdom"], primaryRegion: "Europe", languages: ["English"] },
    productsAndServices: [],
    techSignals: ["Kafka", "Kubernetes"],
    recentDevelopments: [],
    likelyPains: [{ pain: "checkout latency at peak", evidence: "engineering blog", sourceIds: ["s1"] }],
    buyingContext: { likelyBuyerTitles: [], probableTriggers: [], procurementNotes: null },
    competitors: [],
    regionalNotes: [],
    regulatoryNotes: [],
    confidence: "high",
    gaps: [],
    sources: [{ id: "s1", url: "https://x.example", title: "t", publisher: null, publishedDate: null }],
    ...over,
  }) as ProspectResearch;

describe("shortlist", () => {
  it("never surfaces internal_only material", () => {
    const ids = shortlist(corpus.caseStudies, research(), 50).map((s) => s.caseStudy.id);
    expect(ids).not.toContain("helix-oncall-reset");
  });

  it("ranks the same-industry, same-country engagement first", () => {
    const ranked = shortlist(corpus.caseStudies, research(), 50);
    expect(ranked[0]?.caseStudy.id).toBe("meridian-checkout-latency");
    expect(ranked[0]?.reasons.join(" ")).toMatch(/industry match/);
  });

  it("re-ranks when the prospect's industry and country change", () => {
    const ranked = shortlist(
      corpus.caseStudies,
      research({
        company: { ...research().company, hqCountry: "Sweden" },
        industry: { primary: "Fintech", subSectors: ["payments"], businessModel: "B2B SaaS" },
        market: { countriesServed: ["Sweden"], primaryRegion: "Europe", languages: ["Swedish"] },
      }),
      50,
    );
    expect(ranked[0]?.caseStudy.id).toBe("nordic-fintech-reporting");
  });

  it("respects the limit", () => {
    expect(shortlist(corpus.caseStudies, research(), 1)).toHaveLength(1);
  });

  it("is deterministic", () => {
    const a = shortlist(corpus.caseStudies, research(), 50).map((s) => `${s.caseStudy.id}:${s.score}`);
    const b = shortlist(corpus.caseStudies, research(), 50).map((s) => `${s.caseStudy.id}:${s.score}`);
    expect(a).toEqual(b);
  });
});

describe("quotableFacts", () => {
  it("names a public client and quotes only verified results", () => {
    const cs = corpus.caseStudies.find((c) => c.id === "meridian-checkout-latency")!;
    const f = quotableFacts(cs);
    expect(f.clientReference).toBe("Meridian Retail Group");
    expect(f.quotableResults.join(" ")).toContain("-85% p95 checkout latency");
    expect(f.quotableResults.join(" ")).not.toContain("roughly a fifth lower");
    expect(f.withheldResults.join(" ")).toContain("roughly a fifth lower");
    expect(f.quoteAllowed).toBe(true);
  });

  it("substitutes the anonymous label and forbids the testimonial", () => {
    const cs = corpus.caseStudies.find((c) => c.id === "nordic-fintech-reporting")!;
    const f = quotableFacts(cs);
    expect(f.clientReference).toBe("a Nordic payments company");
    expect(f.clientReference).not.toContain("Lindqvist");
    expect(f.quoteAllowed).toBe(false);
  });
});
