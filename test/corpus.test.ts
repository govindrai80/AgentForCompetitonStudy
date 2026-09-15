import { describe, expect, it } from "vitest";
import { parseCsv, resolveLocale, resolveIndustryStyle } from "../src/corpus/load.js";
import { fixtureCorpus } from "./helpers.js";

const corpus = fixtureCorpus();

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas and doubled quotes", () => {
    const rows = parseCsv('a,b,c\n1,"two, and a half","he said ""hi"""\n');
    expect(rows[0]).toEqual(["a", "b", "c"]);
    expect(rows[1]).toEqual(["1", "two, and a half", 'he said "hi"']);
  });

  it("tolerates CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")[1]).toEqual(["1", "2"]);
  });
});

describe("loadCorpus", () => {
  it("loads the shipped reference material", () => {
    expect(corpus.caseStudies.length).toBeGreaterThan(0);
    expect(corpus.company.services.length).toBeGreaterThan(0);
  });

  it("keeps the narrative body separate from the frontmatter", () => {
    const cs = corpus.caseStudies.find((c) => c.id === "skyline-launch")!;
    expect(cs.narrative).toContain("stalling in its third month");
    expect(cs.problem).not.toContain("stalling in its third month");
  });

  it("ignores underscore-prefixed and README files in the case-study directory", () => {
    expect(corpus.caseStudies.map((c) => c.id)).not.toContain("_template");
  });

  it("validates every service id referenced by a case study", () => {
    const ids = new Set(corpus.company.services.map((s) => s.id));
    for (const cs of corpus.caseStudies) {
      for (const used of cs.servicesUsed) expect(ids).toContain(used);
    }
  });
});

describe("resolveLocale", () => {
  it("matches on ISO code and on label", () => {
    expect(resolveLocale(corpus.locales, "DE").code).toBe("DE");
    expect(resolveLocale(corpus.locales, "Germany").code).toBe("DE");
    expect(resolveLocale(corpus.locales, "germany").code).toBe("DE");
  });

  it("prefers the metro profile over the country profile", () => {
    expect(resolveLocale(corpus.locales, "India", "Mumbai").code).toBe("IN-MMR");
    expect(resolveLocale(corpus.locales, "India", "Bengaluru").code).toBe("IN-BLR");
    expect(resolveLocale(corpus.locales, "India", null).code).toBe("IN");
  });

  it("falls back to the country when the city is unknown", () => {
    expect(resolveLocale(corpus.locales, "India", "Nashik").code).toBe("IN");
  });

  it("falls back to DEFAULT for an unknown or missing country", () => {
    expect(resolveLocale(corpus.locales, "Ruritania").code).toBe("DEFAULT");
    expect(resolveLocale(corpus.locales, null).code).toBe("DEFAULT");
  });
});

describe("resolveIndustryStyle", () => {
  it("matches a known segment", () => {
    expect(resolveIndustryStyle(corpus.industries, "Real Estate", [])?.key).toBe("real estate");
    expect(resolveIndustryStyle(corpus.industries, "Real Estate", ["luxury"])?.key).toBe("luxury");
  });

  it("falls back to the default style", () => {
    expect(resolveIndustryStyle(corpus.industries, "Shipbuilding", [])?.key).toBe("default");
  });
});
