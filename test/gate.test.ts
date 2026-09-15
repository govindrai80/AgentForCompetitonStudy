import { describe, expect, it } from "vitest";
import { runGate, worstSeverity } from "../src/stages/gate.js";
import { loadAgentConfig } from "../src/config.js";
import { loadCorpus } from "../src/corpus/load.js";
import type { EvidencePack } from "../src/stages/evidence.js";
import type { EmailDraft, LocaleProfile } from "../src/types.js";

const corpus = loadCorpus(loadAgentConfig());
const locale = corpus.locales.find((l) => l.code === "US") as LocaleProfile;

const pack = (refs: string[]): EvidencePack => ({
  facts: new Map(refs.map((r) => [r, "fact"])),
  rendered: "",
  allowedRefs: refs,
});

const draft = (over: Partial<EmailDraft>): EmailDraft => ({
  subject: "A short subject",
  preheader: "",
  body: "Hi Dana,\n\nA plain body with no claims.\n\nBest,\nPriya",
  claims: [],
  cta: "reply",
  toneNotes: "",
  followUpSuggestion: "",
  alternativeSubjects: [],
  ...over,
});

describe("deterministic gate", () => {
  it("passes a clean draft", () => {
    const findings = runGate({ draft: draft({}), evidence: pack([]), corpus, locale });
    expect(findings).toEqual([]);
    expect(worstSeverity(findings)).toBe("none");
  });

  it("blocks a claim citing an evidence ref that does not exist", () => {
    const findings = runGate({
      draft: draft({
        body: "Hi Dana,\n\nYou run a marketplace.\n\nBest,\nPriya",
        claims: [{ text: "You run a marketplace.", evidenceRef: "src:nope" }],
      }),
      evidence: pack(["src:s1"]),
      corpus,
      locale,
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "unknown-evidence-ref" }),
    );
  });

  it("blocks an internal_only client name appearing in the body", () => {
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nWe did this for Helix Diagnostics.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: "blocker", rule: "confidentiality" }),
    );
  });

  it("blocks an anonymized client's real name", () => {
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nWe helped Lindqvist Betalningar.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings.filter((f) => f.rule === "confidentiality")).toHaveLength(1);
  });

  it("does not fire on a substring of a client name", () => {
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nMeridianum Labs is unrelated.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings.filter((f) => f.rule === "confidentiality")).toHaveLength(0);
  });

  it("flags a number that traces back to an unverified result", () => {
    // Meridian's infra saving is recorded as unverified; a bare "20%" is fine,
    // but a figure matching an unverified delta is not. Use Helix's 340 pages.
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nOne team went from 340 pages a month to far fewer.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings.some((f) => f.rule === "unverified-number")).toBe(false); // 340 is a verified 'before'
  });

  it("blocks a forbidden claim", () => {
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nWe guarantee a 40% improvement.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: "forbidden-claim", severity: "blocker" }));
  });

  it("blocks an unfilled placeholder", () => {
    const findings = runGate({
      draft: draft({ body: "Hi [First Name],\n\nHello.\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: "placeholder", severity: "blocker" }));
  });

  it("enforces the locale subject and body limits", () => {
    const findings = runGate({
      draft: draft({
        subject: "x".repeat(locale.subjectMaxChars + 5),
        body: Array(locale.bodyMaxWords + 20).fill("word").join(" "),
      }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["subject-length", "body-length"]));
  });

  it("flags filler phrases and exclamation marks", () => {
    const findings = runGate({
      draft: draft({ body: "Hi Dana,\n\nI hope this email finds you well!\n\nBest,\nPriya" }),
      evidence: pack([]),
      corpus,
      locale,
    });
    expect(findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["filler", "punctuation"]));
  });

  it("flags a compliance gap when the locale needs an opt-out the profile lacks", () => {
    const stripped = { ...corpus, company: { ...corpus.company, unsubscribeLine: undefined, postalAddress: undefined } };
    const findings = runGate({ draft: draft({}), evidence: pack([]), corpus: stripped, locale });
    expect(findings.filter((f) => f.rule === "compliance")).toHaveLength(2);
  });
});
