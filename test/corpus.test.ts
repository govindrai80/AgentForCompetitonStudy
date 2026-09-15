import { describe, expect, it } from "vitest";
import { parseCsv, loadCorpus, resolveLocale, resolveIndustryStyle } from "../src/corpus/load.js";
import { loadAgentConfig } from "../src/config.js";

const corpus = loadCorpus(loadAgentConfig());

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
    const cs = corpus.caseStudies.find((c) => c.id === "meridian-checkout-latency")!;
    expect(cs.narrative).toContain("Black Friday");
    expect(cs.problem).not.toContain("Black Friday deadline and a plan");
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

  it("falls back to DEFAULT for an unknown or missing country", () => {
    expect(resolveLocale(corpus.locales, "Ruritania").code).toBe("DEFAULT");
    expect(resolveLocale(corpus.locales, null).code).toBe("DEFAULT");
  });
});

describe("resolveIndustryStyle", () => {
  it("matches a known industry", () => {
    expect(resolveIndustryStyle(corpus.industries, "Fintech", ["payments"])?.key).toBe("fintech");
    expect(resolveIndustryStyle(corpus.industries, "E-commerce", [])?.key).toBe("ecommerce");
  });

  it("falls back to the default style", () => {
    expect(resolveIndustryStyle(corpus.industries, "Shipbuilding", [])?.key).toBe("default");
  });
});
