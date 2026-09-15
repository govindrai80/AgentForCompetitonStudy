import type { Claude } from "../anthropic.js";
import type { Corpus } from "../corpus/load.js";
import type { EvidencePack } from "./evidence.js";
import {
  VerificationSchema,
  type EmailDraft,
  type IndustryStyle,
  type LocaleProfile,
  type Verification,
} from "../types.js";

const AUDITOR_BRIEF = `You audit an outbound sales email before it reaches a stranger's inbox.

You are given the email and the evidence pack the writer was restricted to — nothing else. You do not have the research notes, and you must not reason from background knowledge about the companies involved. If a statement in the email is not supported by something in the pack, it is unsupported, full stop. That is the finding.

Check, in order:

1. Unsupported claims — any assertion about the prospect, the market, or a result that the pack does not establish. Quote the exact text.
2. Overstatement — a claim the pack supports weakly stated strongly. "Reduced costs" evidenced by one engagement is not "consistently reduces costs". A number restated as a rounder, larger, or differently-framed number is overstatement.
3. Confidentiality — a client named where the pack's "name them exactly as" string is an anonymous label, or a number the pack marked DO NOT QUOTE.
4. Competitor framing — where the email references a competitor of the recipient, check three things: that the pack licenses naming them at all; that nothing is implied about that competitor's confidential arrangements or results beyond what the pack states; and that the relationship is used as evidence of market understanding rather than as pressure or as an implied offer to transfer a rival's work. Any of those three is a blocker.
5. Forbidden claims — anything on the seller's forbidden list, in substance rather than wording.
6. Tone and locale — measured against the locale and industry guidance, not your own taste. Flag only what would actually cost a reply in that market.
7. Compliance — the locale's legal footer requirements.

Severity:
- blocker: would mislead the recipient, breach a confidentiality constraint, or break the law. The email cannot be sent.
- major: materially weakens or overstates the case; should be fixed before sending.
- minor: worth a look; not a reason to hold the email.

Verdict: "block" if any blocker. "revise" if any major. "pass" otherwise — and pass is a real option. Do not invent findings to look thorough; a clean email with two minor notes should pass.`;

export async function verifyDraft(
  claude: Claude,
  corpus: Corpus,
  args: {
    draft: EmailDraft;
    evidence: EvidencePack;
    locale: LocaleProfile;
    industryStyle: IndustryStyle | null;
  },
): Promise<Verification> {
  const { draft, evidence, locale, industryStyle } = args;

  return claude.extract({
    label: "verify",
    schema: VerificationSchema,
    schemaName: "verification_report",
    maxTokens: 16000,
    system: [{ text: AUDITOR_BRIEF }],
    userPrompt: [
      `## The email`,
      `Subject: ${draft.subject}`,
      ``,
      draft.body,
      ``,
      `## The writer's own claim ledger`,
      draft.claims.map((c) => `- "${c.text}"  →  ${c.evidenceRef}`).join("\n") || "(the writer listed no claims — that is itself a finding if the body asserts anything)",
      ``,
      `## Evidence pack — the complete set of facts the writer was allowed to use`,
      evidence.rendered,
      ``,
      `## Locale requirements — ${locale.label} (${locale.code})`,
      `- Formality ${locale.formality}, directness ${locale.directness}`,
      `- Subject limit ${locale.subjectMaxChars} chars; body limit ${locale.bodyMaxWords} words`,
      ...locale.notes.map((n) => `- ${n}`),
      locale.avoid.length ? `- Avoid: ${locale.avoid.join("; ")}` : "",
      locale.compliance.length ? `- Legal footer: ${locale.compliance.join("; ")}` : "",
      industryStyle
        ? `\n## Industry requirements — ${industryStyle.label}\n${industryStyle.notes.map((n) => `- ${n}`).join("\n")}${industryStyle.avoid.length ? `\n- Avoid: ${industryStyle.avoid.join(", ")}` : ""}`
        : "",
      ``,
      `## Claims ${corpus.company.name} may never make`,
      corpus.company.forbiddenClaims.length
        ? corpus.company.forbiddenClaims.map((f) => `- ${f}`).join("\n")
        : "- (none recorded)",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}
