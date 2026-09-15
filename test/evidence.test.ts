import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../src/stages/evidence.js";
import { analyseCompetitors } from "../src/corpus/competitors.js";
import { competitor, fixtureCorpus, research } from "./helpers.js";
import type { MatchPlan } from "../src/types.js";

const corpus = fixtureCorpus();

const plan: MatchPlan = {
  pitchAngle: "Absorption is about to become the problem, not lead volume.",
  selected: [
    { caseStudyId: "harbour-estates", relevanceScore: 88, rationale: "same funnel gap", anglesToUse: ["instrumentation"], resultsToCite: [] },
    // internal_only — the pack must drop it even though the plan named it.
    { caseStudyId: "meridian-towers", relevanceScore: 40, rationale: "n/a", anglesToUse: [], resultsToCite: [] },
  ],
  recommendedServices: [{ serviceId: "performance", why: "fits", specsToSurface: ["attribution", "markets"] }],
  rejected: [],
  risks: [],
  disqualifierHits: [],
};

const r = research();
const pack = buildEvidencePack(corpus, r, plan);

describe("evidence pack", () => {
  it("excludes internal_only case studies even when the plan selects one", () => {
    expect(pack.rendered).not.toContain("Meridian Towers");
    expect(pack.allowedRefs).not.toContain("cs:meridian-towers");
  });

  it("substitutes the anonymous label for a restricted client", () => {
    expect(pack.rendered).toContain("a Pune developer with a mid-income portfolio");
    expect(pack.rendered).not.toContain("Harbour Estates");
  });

  it("binds every prospect fact to a source the research actually returned", () => {
    for (const ref of pack.allowedRefs.filter((x) => x.startsWith("src:"))) {
      expect(r.sources.map((s) => `src:${s.id}`)).toContain(ref);
    }
    expect(pack.rendered).toContain("https://trade.example/a");
  });

  it("surfaces only the spec keys the plan asked for", () => {
    expect(pack.rendered).toContain("attribution: Lead to site visit to booking");
    expect(pack.rendered).toContain("markets: Mumbai, Pune, Bengaluru");
    expect(pack.rendered).not.toContain("reporting cadence: Weekly review");
  });

  it("always licenses the seller's own positioning", () => {
    expect(pack.allowedRefs).toContain("profile:company");
  });

  it("marks unverified numbers as unquotable", () => {
    const withSkyline = buildEvidencePack(corpus, r, {
      ...plan,
      selected: [{ caseStudyId: "skyline-launch", relevanceScore: 90, rationale: "x", anglesToUse: [], resultsToCite: [] }],
    });
    expect(withSkyline.rendered).toContain("DO NOT QUOTE");
    expect(withSkyline.rendered).toContain("roughly a fifth lower");
    expect(withSkyline.rendered).toContain("-38% cost per booking");
  });
});

describe("evidence pack: competitor leverage", () => {
  it("licenses a usable competitor relationship with an explicit ref", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Developers")] }));
    const withComp = buildEvidencePack(corpus, r, plan, intel);

    expect(withComp.allowedRefs).toContain("comp:skyline-developers");
    expect(withComp.rendered).toContain("Competitors of the prospect that are our clients");
    expect(withComp.rendered).toContain('refer to them exactly as: "Skyline Developers"');
  });

  it("keeps a non-referenceable competitor relationship out of the writer's world entirely", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Meridian Towers")] }));
    const withComp = buildEvidencePack(corpus, r, plan, intel);

    expect(intel.silent).toHaveLength(1);
    expect(withComp.rendered).not.toContain("Meridian");
    expect(withComp.allowedRefs.some((x) => x.startsWith("comp:"))).toBe(false);
  });

  it("keeps a weak name match out of the writer's world", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Retail Ventures")] }));
    const withComp = buildEvidencePack(corpus, r, plan, intel);
    expect(intel.possible).toHaveLength(1);
    expect(withComp.allowedRefs.some((x) => x.startsWith("comp:"))).toBe(false);
  });
});
