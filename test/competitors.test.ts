import { describe, expect, it } from "vitest";
import { analyseCompetitors, competitorCaseStudyIds } from "../src/corpus/competitors.js";
import { matchCompany, mentionsName, normaliseName } from "../src/util/names.js";
import { shortlist } from "../src/corpus/match.js";
import { competitor, fixtureCorpus, research } from "./helpers.js";

const corpus = fixtureCorpus();

describe("matchCompany", () => {
  it("treats legal suffixes and punctuation as noise", () => {
    expect(matchCompany("Skyline Developers", "Skyline Developers Pvt. Ltd.")?.confidence).toBe("exact");
    expect(normaliseName("Harbour Estates Pvt Ltd")).toBe("harbour estates");
  });

  it("matches a name against the same name plus qualifiers", () => {
    expect(matchCompany("Godrej", "Godrej Properties")?.confidence).toBe("strong");
    expect(matchCompany("Prestige Group", "Prestige")?.confidence).toBe("strong");
  });

  it("downgrades a shared-word match to weak rather than claiming it", () => {
    // The real trap in Indian real estate: these are genuinely different firms.
    const m = matchCompany("Lodha Group", "The House of Abhinandan Lodha");
    expect(m?.confidence).toBe("weak");
    expect(m?.reason).toContain("lodha");
  });

  it("ignores words that are generic in the sector", () => {
    expect(matchCompany("Skyline Developers", "Harbour Developers")).toBeNull();
    expect(matchCompany("Alpha Properties", "Beta Properties")).toBeNull();
  });

  it("returns null for unrelated names", () => {
    expect(matchCompany("Skyline Developers", "Quiet Partner Homes")).toBeNull();
  });
});

describe("mentionsName", () => {
  it("catches the name with the legal suffix dropped", () => {
    expect(mentionsName("We worked with Harbour Estates last year.", "Harbour Estates Pvt Ltd")).toBe(true);
  });

  it("catches a distinctive leading token on its own", () => {
    expect(mentionsName("Skyline came to us in March.", "Skyline Developers")).toBe(true);
  });

  it("respects word boundaries", () => {
    expect(mentionsName("Skylines across the city.", "Skyline Developers")).toBe(false);
  });
});

describe("analyseCompetitors", () => {
  it("finds leverage when a prospect's rival is a nameable client", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Developers")] }));
    expect(intel.leverage).toHaveLength(1);
    expect(intel.leverage[0]?.referAs).toBe("Skyline Developers");
    expect(intel.leverage[0]?.origin).toMatchObject({ kind: "case-study", id: "skyline-launch" });
  });

  it("substitutes the anonymous label for a restricted rival", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Harbour Estates")] }));
    expect(intel.leverage[0]?.referAs).toBe("a Pune developer with a mid-income portfolio");
    expect(intel.leverage[0]?.referAs).not.toContain("Harbour");
  });

  it("keeps an internal_only rival out of the usable set but still reports it", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Meridian Towers")] }));
    expect(intel.leverage).toHaveLength(0);
    expect(intel.silent).toHaveLength(1);
    expect(intel.silent[0]?.note).toContain("internal_only");
  });

  it("finds a client-list relationship with no case study behind it", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Beacon Realty")] }));
    expect(intel.leverage[0]?.origin).toMatchObject({ kind: "client-list" });
    expect(intel.leverage[0]?.note).toContain("no case study");
  });

  it("will not name a client-list entry that is not cleared", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Quiet Partner Homes")] }));
    expect(intel.leverage).toHaveLength(0);
    expect(intel.silent).toHaveLength(1);
  });

  it("raises a major caution when the seller's disqualifiers flag competitor conflicts", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Developers", "direct")] }));
    expect(intel.cautions[0]?.severity).toBe("major");
    expect(intel.cautions[0]?.reason).toContain("exclusivity");
  });

  it("does not raise a caution for a merely adjacent competitor", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Developers", "adjacent")] }));
    expect(intel.cautions).toHaveLength(0);
    expect(intel.leverage).toHaveLength(1);
  });

  it("routes a weak name match to human review and never to the email", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Skyline Retail Ventures")] }));
    expect(intel.leverage).toHaveLength(0);
    expect(intel.silent).toHaveLength(0);
    expect(intel.possible).toHaveLength(1);
    expect(competitorCaseStudyIds(intel).size).toBe(0);
  });

  it("reports rivals we have no relationship with", () => {
    const intel = analyseCompetitors(corpus, research({ competitors: [competitor("Unrelated Builders")] }));
    expect(intel.unmatched).toEqual(["Unrelated Builders"]);
  });
});

describe("shortlist competitor bias", () => {
  it("scores a rival's case study strictly higher and records why", () => {
    const r = research({ competitors: [competitor("Skyline Developers")] });
    const intel = analyseCompetitors(corpus, r);

    const plain = shortlist(corpus.caseStudies, r, 10).find((s) => s.caseStudy.id === "skyline-launch")!;
    const biased = shortlist(corpus.caseStudies, r, 10, competitorCaseStudyIds(intel)).find(
      (s) => s.caseStudy.id === "skyline-launch",
    )!;

    expect(biased.score).toBeGreaterThan(plain.score);
    expect(biased.reasons).toContain("client is a direct competitor of the prospect");
    expect(plain.reasons).not.toContain("client is a direct competitor of the prospect");
  });

  it("is strong enough to overturn a better sector match", () => {
    // On sector alone skyline-launch wins: it matches both sub-sectors and its
    // client is nameable. Having worked for the prospect's actual rival should
    // still beat that.
    const r = research({ competitors: [competitor("Harbour Estates")] });
    const intel = analyseCompetitors(corpus, r);

    expect(shortlist(corpus.caseStudies, r, 10)[0]?.caseStudy.id).toBe("skyline-launch");
    expect(shortlist(corpus.caseStudies, r, 10, competitorCaseStudyIds(intel))[0]?.caseStudy.id).toBe(
      "harbour-estates",
    );
  });

  it("never promotes an internal_only engagement, competitor or not", () => {
    const r = research({ competitors: [competitor("Meridian Towers")] });
    const intel = analyseCompetitors(corpus, r);
    const ids = shortlist(corpus.caseStudies, r, 10, competitorCaseStudyIds(intel)).map((s) => s.caseStudy.id);
    expect(ids).not.toContain("meridian-towers");
  });
});
