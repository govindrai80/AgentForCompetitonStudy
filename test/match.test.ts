import { describe, expect, it } from "vitest";
import { quotableFacts, shortlist } from "../src/corpus/match.js";
import { fixtureCorpus, research } from "./helpers.js";

const corpus = fixtureCorpus();

describe("shortlist", () => {
  it("never surfaces internal_only material", () => {
    expect(shortlist(corpus.caseStudies, research(), 50).map((s) => s.caseStudy.id)).not.toContain("meridian-towers");
  });

  it("ranks the closest sector and sub-sector match first", () => {
    const ranked = shortlist(corpus.caseStudies, research(), 50);
    expect(ranked[0]?.caseStudy.id).toBe("skyline-launch");
    expect(ranked[0]?.reasons.join(" ")).toMatch(/industry match/);
  });

  it("credits sub-sector overlap to the engagement that shares it", () => {
    const affordable = research({
      industry: { primary: "Real Estate", subSectors: ["affordable"], businessModel: "Residential developer" },
    });
    const score = (r: ReturnType<typeof research>, id: string) =>
      shortlist(corpus.caseStudies, r, 50).find((s) => s.caseStudy.id === id)!;

    const noSubSectors = research({
      industry: { primary: "Real Estate", subSectors: [], businessModel: "Residential developer" },
    });
    const harbourBefore = score(noSubSectors, "harbour-estates");
    const harbourAfter = score(affordable, "harbour-estates");
    const skylineAfter = score(affordable, "skyline-launch");

    expect(harbourAfter.score).toBeGreaterThan(harbourBefore.score);
    expect(harbourAfter.reasons.join(" ")).toMatch(/shared sub-sector/);
    expect(skylineAfter.reasons.join(" ")).not.toMatch(/shared sub-sector/);
  });

  it("respects the limit and is deterministic", () => {
    expect(shortlist(corpus.caseStudies, research(), 1)).toHaveLength(1);
    const key = () => shortlist(corpus.caseStudies, research(), 50).map((s) => `${s.caseStudy.id}:${s.score}`);
    expect(key()).toEqual(key());
  });
});

describe("quotableFacts", () => {
  it("names a public client and quotes only verified results", () => {
    const f = quotableFacts(corpus.caseStudies.find((c) => c.id === "skyline-launch")!);
    expect(f.clientReference).toBe("Skyline Developers");
    expect(f.quotableResults.join(" ")).toContain("-38% cost per booking");
    expect(f.quotableResults.join(" ")).not.toContain("roughly a fifth lower");
    expect(f.withheldResults.join(" ")).toContain("roughly a fifth lower");
    expect(f.quoteAllowed).toBe(true);
  });

  it("substitutes the anonymous label and forbids the testimonial", () => {
    const f = quotableFacts(corpus.caseStudies.find((c) => c.id === "harbour-estates")!);
    expect(f.clientReference).toBe("a Pune developer with a mid-income portfolio");
    expect(f.clientReference).not.toContain("Harbour");
    expect(f.quoteAllowed).toBe(false);
  });
});
