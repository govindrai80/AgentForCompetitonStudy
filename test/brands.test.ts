import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "../src/config.js";
import { analyseCompetitors, findCrossBrandClients } from "../src/corpus/competitors.js";
import { shortlist } from "../src/corpus/match.js";
import { buildEvidencePack } from "../src/stages/evidence.js";
import { runGate } from "../src/stages/gate.js";
import { competitor, FIXTURE_CONFIG, fixtureCorpus, research } from "./helpers.js";
import type { EmailDraft, LocaleProfile, MatchPlan } from "../src/types.js";

const fixture = fixtureCorpus();
const sibling = fixtureCorpus("sibling");

describe("brand resolution", () => {
  it("defaults to the configured brand and switches on demand", () => {
    expect(loadAgentConfig(FIXTURE_CONFIG).activeBrand).toBe("fixture");
    expect(loadAgentConfig(FIXTURE_CONFIG, "sibling").activeBrand).toBe("sibling");
    expect(loadAgentConfig(FIXTURE_CONFIG, "sibling").paths.companyProfile).toContain("sibling.yaml");
  });

  it("rejects an unknown brand rather than silently using the default", () => {
    expect(() => loadAgentConfig(FIXTURE_CONFIG, "nope")).toThrow(/Unknown brand "nope"/);
  });

  it("loads the whole group's client list whichever brand is sending", () => {
    expect(fixture.clients.length).toBe(sibling.clients.length);
    expect(fixture.clients.map((c) => c.name)).toContain("Tidewater Group");
  });
});

describe("brand isolation in the pitch", () => {
  it("will not let a brand cite a sibling's engagement", () => {
    const ids = shortlist(fixture.caseStudies, research(), 50, new Set(), fixture.brand).map((s) => s.caseStudy.id);
    expect(ids).not.toContain("tidewater-content");
    expect(ids).toContain("skyline-launch");
  });

  it("lets the sibling cite its own, and not ours", () => {
    const ids = shortlist(sibling.caseStudies, research(), 50, new Set(), sibling.brand).map((s) => s.caseStudy.id);
    expect(ids).toEqual(["tidewater-content"]);
  });

  it("keeps a sibling's client out of the evidence pack", () => {
    const plan: MatchPlan = {
      pitchAngle: "x",
      selected: [{ caseStudyId: "tidewater-content", relevanceScore: 90, rationale: "x", anglesToUse: [], resultsToCite: [] }],
      recommendedServices: [],
      rejected: [],
      risks: [],
      disqualifierHits: [],
    };
    const intel = analyseCompetitors(fixture, research({ competitors: [competitor("Tidewater Group")] }));
    const pack = buildEvidencePack(fixture, research(), plan, intel);
    expect(pack.allowedRefs.some((r) => r.startsWith("comp:"))).toBe(false);
  });
});

describe("group-wide competitor visibility", () => {
  const withTidewater = research({ competitors: [competitor("Tidewater Group", "direct")] });

  it("sees a sibling brand's client but will not let this brand claim it", () => {
    const intel = analyseCompetitors(fixture, withTidewater);
    expect(intel.leverage).toHaveLength(0);
    expect(intel.silent).toHaveLength(1);
    expect(intel.silent[0]?.sibling).toBe(true);
    expect(intel.silent[0]?.heldBy).toBe("sibling");
    expect(intel.silent[0]?.note).toContain("sibling brand");
  });

  it("raises the conflict as the group's, not just this brand's", () => {
    const intel = analyseCompetitors(fixture, withTidewater);
    expect(intel.cautions[0]?.reason).toContain("Check across the group");
  });

  it("treats the same client as its own leverage when that brand is sending", () => {
    const intel = analyseCompetitors(sibling, withTidewater);
    expect(intel.leverage).toHaveLength(1);
    expect(intel.leverage[0]?.sibling).toBe(false);
    expect(intel.leverage[0]?.referAs).toBe("Tidewater Group");
  });

  it("blocks naming a sibling's client in this brand's email", () => {
    const locale = fixture.locales.find((l) => l.code === "IN-MMR") as LocaleProfile;
    const draft: EmailDraft = {
      subject: "A subject",
      preheader: "",
      body: "Dear Dana,\n\nWe work with Tidewater Group.\n\nBest regards,\nAsha",
      claims: [],
      cta: "reply",
      toneNotes: "",
      followUpSuggestion: "",
      alternativeSubjects: [],
    };
    const findings = runGate({
      draft,
      evidence: { facts: new Map(), rendered: "", allowedRefs: [] },
      corpus: fixture,
      locale,
      competitorIntel: analyseCompetitors(fixture, withTidewater),
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: "competitor-not-nameable", severity: "blocker" }));
  });
});

describe("cross-brand client overlap", () => {
  const overlaps = findCrossBrandClients(fixture.clients);

  it("reports a client both brands record, and no one-brand clients", () => {
    expect(overlaps.map((o) => o.name)).toContain("Skyline Developers");
    expect(overlaps.find((o) => o.name === "Skyline Developers")?.brands).toEqual(["fixture", "sibling"]);
    expect(overlaps.map((o) => o.name)).not.toContain("Quiet Partner Homes");
  });

  it("marks an uncertain pairing weak rather than asserting it", () => {
    const beacon = overlaps.find((o) => o.name === "Beacon Realty");
    expect(beacon?.confidence).toBe("weak");
    expect(beacon?.aliases).toContain("Beacon Retail Ventures");
  });

  it("is deterministic", () => {
    expect(findCrossBrandClients(fixture.clients)).toEqual(overlaps);
  });
});
