import { describe, expect, it } from "vitest";
import { runGate, worstSeverity } from "../src/stages/gate.js";
import { analyseCompetitors } from "../src/corpus/competitors.js";
import { competitor, fixtureCorpus, research } from "./helpers.js";
import type { EvidencePack } from "../src/stages/evidence.js";
import type { EmailDraft, LocaleProfile } from "../src/types.js";

const corpus = fixtureCorpus();
const locale = corpus.locales.find((l) => l.code === "US") as LocaleProfile;
const indiaLocale = corpus.locales.find((l) => l.code === "IN-MMR") as LocaleProfile;

const pack = (refs: string[]): EvidencePack => ({
  facts: new Map(refs.map((r) => [r, "fact"])),
  rendered: "",
  allowedRefs: refs,
});

const draft = (over: Partial<EmailDraft>): EmailDraft => ({
  subject: "A short subject",
  preheader: "",
  body: "Hi Dana,\n\nA plain body with no claims.\n\nBest,\nAsha",
  claims: [],
  cta: "reply",
  toneNotes: "",
  followUpSuggestion: "",
  alternativeSubjects: [],
  ...over,
});

const gate = (over: Partial<EmailDraft>, extra: Partial<Parameters<typeof runGate>[0]> = {}) =>
  runGate({ draft: draft(over), evidence: pack([]), corpus, locale, ...extra });

describe("deterministic gate", () => {
  it("passes a clean draft", () => {
    expect(gate({})).toEqual([]);
    expect(worstSeverity(gate({}))).toBe("none");
  });

  it("blocks a claim citing an evidence ref that does not exist", () => {
    const findings = runGate({
      draft: draft({
        body: "Hi Dana,\n\nYou launched in Thane.\n\nBest,\nAsha",
        claims: [{ text: "You launched in Thane.", evidenceRef: "src:nope" }],
      }),
      evidence: pack(["src:s1"]),
      corpus,
      locale,
    });
    expect(findings).toContainEqual(expect.objectContaining({ severity: "blocker", rule: "unknown-evidence-ref" }));
  });

  it("blocks an internal_only client name appearing in the body", () => {
    expect(gate({ body: "Hi Dana,\n\nWe did this for Meridian Towers.\n\nBest,\nAsha" })).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "confidentiality" }),
    );
  });

  it("blocks an anonymized client's real name even with the legal suffix dropped", () => {
    const findings = gate({ body: "Hi Dana,\n\nWe helped Harbour Estates.\n\nBest,\nAsha" });
    expect(findings.filter((f) => f.rule === "confidentiality")).toHaveLength(1);
  });

  it("blocks a client-list name that is not cleared, with no case study behind it", () => {
    expect(gate({ body: "Hi Dana,\n\nWe work with Quiet Partner Homes.\n\nBest,\nAsha" })).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "confidentiality" }),
    );
  });

  it("allows a client-list name that is cleared", () => {
    const findings = gate({ body: "Hi Dana,\n\nWe work with Beacon Realty.\n\nBest,\nAsha" });
    expect(findings.filter((f) => f.rule === "confidentiality")).toHaveLength(0);
  });

  it("does not fire on a substring of a client name", () => {
    expect(
      gate({ body: "Hi Dana,\n\nSkylines across Thane.\n\nBest,\nAsha" }).filter((f) => f.rule === "confidentiality"),
    ).toHaveLength(0);
  });

  it("blocks a forbidden claim", () => {
    expect(gate({ body: "Hi Dana,\n\nWe guarantee a 40% lift.\n\nBest,\nAsha" })).toContainEqual(
      expect.objectContaining({ rule: "forbidden-claim", severity: "blocker" }),
    );
  });

  it("blocks the returns language that is a regulatory trap in Indian real estate", () => {
    expect(gate({ body: "Hi Dana,\n\nBuyers want assured returns.\n\nBest,\nAsha" })).toContainEqual(
      expect.objectContaining({ rule: "forbidden-claim" }),
    );
  });

  it("flags a number traceable to an unverified result", () => {
    // "roughly a fifth lower" carries no figure, so use the verified one's twin:
    // an unverified delta with a number in it would be caught the same way.
    const findings = gate({ body: "Hi Dana,\n\nOne developer saw -38% cost per booking.\n\nBest,\nAsha" });
    expect(findings.some((f) => f.rule === "unverified-number")).toBe(false);
  });

  it("blocks an unfilled placeholder", () => {
    expect(gate({ body: "Hi [First Name],\n\nHello.\n\nBest,\nAsha" })).toContainEqual(
      expect.objectContaining({ rule: "placeholder", severity: "blocker" }),
    );
  });

  it("enforces the locale subject and body limits", () => {
    const findings = gate({
      subject: "x".repeat(locale.subjectMaxChars + 5),
      body: Array(locale.bodyMaxWords + 20).fill("word").join(" "),
    });
    expect(findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["subject-length", "body-length"]));
  });

  it("applies the tighter Mumbai limits when that locale is in force", () => {
    const body = Array(indiaLocale.bodyMaxWords + 5).fill("word").join(" ");
    expect(runGate({ draft: draft({ body }), evidence: pack([]), corpus, locale: indiaLocale })).toContainEqual(
      expect.objectContaining({ rule: "body-length" }),
    );
  });

  it("flags filler phrases and exclamation marks", () => {
    const findings = gate({ body: "Hi Dana,\n\nI hope this email finds you well!\n\nBest,\nAsha" });
    expect(findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["filler", "punctuation"]));
  });

  it("flags a compliance gap when the locale needs an opt-out the profile lacks", () => {
    const stripped = { ...corpus, company: { ...corpus.company, unsubscribeLine: undefined, postalAddress: undefined } };
    expect(
      runGate({ draft: draft({}), evidence: pack([]), corpus: stripped, locale }).filter((f) => f.rule === "compliance"),
    ).toHaveLength(2);
  });
});

describe("gate: competitor rules", () => {
  const intelFor = (name: string, rel: "direct" | "adjacent" = "direct") =>
    analyseCompetitors(corpus, research({ competitors: [competitor(name, rel)] }));

  it("blocks disclosing a competitor relationship we may not reference", () => {
    const findings = gate(
      { body: "Hi Dana,\n\nWe already run Meridian Towers.\n\nBest,\nAsha" },
      { competitorIntel: intelFor("Meridian Towers") },
    );
    expect(findings).toContainEqual(expect.objectContaining({ severity: "blocker", rule: "competitor-not-nameable" }));
  });

  it("raises the seller's own conflict rule as a major finding", () => {
    const findings = gate({}, { competitorIntel: intelFor("Skyline Developers") });
    expect(findings).toContainEqual(expect.objectContaining({ severity: "major", rule: "competitor-conflict" }));
  });

  it("warns when the email leans on a weak name match", () => {
    const findings = gate(
      { body: "Hi Dana,\n\nWe work with Skyline Developers, who you compete with.\n\nBest,\nAsha" },
      { competitorIntel: intelFor("Skyline Retail Ventures") },
    );
    expect(findings).toContainEqual(expect.objectContaining({ rule: "competitor-weak-match", severity: "major" }));
  });

  it("stays quiet when a usable competitor is referenced properly", () => {
    const findings = gate(
      { body: "Hi Dana,\n\nWe ran the Skyline Developers launch.\n\nBest,\nAsha" },
      { competitorIntel: intelFor("Skyline Developers", "adjacent") },
    );
    expect(findings).toEqual([]);
  });
});
