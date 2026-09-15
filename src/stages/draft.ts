import type { AgentConfig } from "../config.js";
import type { Claude } from "../anthropic.js";
import type { Corpus } from "../corpus/load.js";
import type { EvidencePack } from "./evidence.js";
import {
  EmailDraftSchema,
  type EmailDraft,
  type IndustryStyle,
  type LocaleProfile,
  type MatchPlan,
  type ProspectResearch,
} from "../types.js";

export interface DraftInput {
  prospect: string;
  contactName?: string;
  contactTitle?: string;
  locale: LocaleProfile;
  industryStyle: IndustryStyle | null;
  research: ProspectResearch;
  plan: MatchPlan;
  evidence: EvidencePack;
  extraInstructions?: string;
}

const WRITER_BRIEF = `You write first-contact sales emails that a busy, sceptical senior person will actually finish reading.

Everything you assert must come from the evidence pack you are given. The pack is a closed world: if a fact is not in it, you do not know it, and you write around the gap rather than filling it. This is not a style preference. An invented client result is a legal problem for the sender and the end of the relationship with the prospect.

How to write:
- Open with something specific and true about *their* business, drawn from the evidence pack. Not "I came across your website." Not flattery. A real observation.
- Make one argument. An email that makes three makes none.
- Use a past result the way a peer would — as evidence for a claim, not as a trophy. One is enough.
- Numbers only where the pack marks them QUOTABLE, quoted exactly as written there. Never round, scale, or restate a number in stronger terms.
- Name clients only using the exact "name them exactly as" string.
- Surface specifications only when a buyer in this industry would want them, and state them verbatim.
- No filler: "I hope this email finds you well", "I wanted to reach out", "revolutionary", "game-changing", "synergy", "leverage" as a verb, "circle back". No exclamation marks.
- If the evidence pack shows you have worked with a competitor of theirs, that is usually the strongest sentence in the email — but the framing decides whether it lands as credibility or as a threat. Write it as the reason you understand their market. Never imply you will bring a rival's playbook, never hint at anything confidential about the rival, and never use it as pressure ("your competitors are already doing this"). If you cannot write it without one of those, leave it out.
- One clear, low-friction ask. A first email asks for a reply or fifteen minutes, not a signed contract.
- Write the body as plain text with real line breaks. No markdown, no bullet characters unless the locale guidance calls for them, no placeholders like [Company] — every field is known to you.

Then account for every factual claim: list each one with the evidenceRef that licenses it. Use exactly the refs given in the pack. A claim you cannot ref is a claim you should not have written — remove it and rewrite instead of guessing a ref.

Pure courtesy and self-introduction ("I lead engineering at X", "happy to send a short note") need no ref beyond profile:company. Everything about the prospect, and every number, needs one.`;

export async function draftEmail(
  claude: Claude,
  _cfg: AgentConfig,
  corpus: Corpus,
  input: DraftInput,
): Promise<EmailDraft> {
  const { locale, industryStyle } = input;
  const sender = corpus.company.sender;

  const styleGuidance = [
    `## Locale calibration — ${locale.label} (${locale.code})`,
    `- Formality: ${locale.formality}. Directness: ${locale.directness}.`,
    `- Open with: ${locale.greeting}`,
    `- Sign off with: ${locale.signOff}`,
    `- Subject line: at most ${locale.subjectMaxChars} characters.`,
    `- Body: at most ${locale.bodyMaxWords} words, greeting and sign-off included.`,
    ...locale.notes.map((n) => `- ${n}`),
    locale.avoid.length ? `- Avoid: ${locale.avoid.join("; ")}` : "",
    locale.compliance.length ? `- Legal footer requirements: ${locale.compliance.join("; ")}` : "",
    ``,
    industryStyle
      ? [
          `## Industry calibration — ${industryStyle.label}`,
          ...industryStyle.notes.map((n) => `- ${n}`),
          industryStyle.vocabulary.length ? `- Language this audience uses: ${industryStyle.vocabulary.join(", ")}` : "",
          industryStyle.avoid.length ? `- Language that loses them: ${industryStyle.avoid.join(", ")}` : "",
          industryStyle.specsThatMatter.length
            ? `- Specifications this audience checks first: ${industryStyle.specsThatMatter.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const greeting = input.contactName
    ? locale.greeting.replace("{firstName}", firstName(input.contactName)).replace("{fullName}", input.contactName)
    : locale.greeting.replace(/\{firstName\}|\{fullName\}/g, "there");

  return claude.extract({
    label: "draft",
    schema: EmailDraftSchema,
    schemaName: "email_draft",
    maxTokens: 16000,
    system: [{ text: WRITER_BRIEF }],
    userPrompt: [
      `# Write one cold email`,
      ``,
      `**To:** ${input.contactName ?? "an unnamed recipient"}${input.contactTitle ? `, ${input.contactTitle}` : ""} at ${input.prospect}`,
      `**From:** ${sender.name}, ${sender.title} at ${corpus.company.name}`,
      `**Greeting to use:** ${greeting}`,
      sender.calendarLink ? `**Booking link available:** ${sender.calendarLink}` : "",
      ``,
      `**The argument this email makes:** ${input.plan.pitchAngle}`,
      `**Call to action:** a reply, or ${sender.calendarLink ? "fifteen minutes via the booking link" : "fifteen minutes"}.`,
      ``,
      styleGuidance,
      ``,
      `## Evidence pack — the only facts you may use`,
      input.evidence.rendered,
      ``,
      `## Valid evidenceRef values`,
      input.evidence.allowedRefs.map((r) => `- ${r}`).join("\n"),
      ``,
      input.plan.risks.length
        ? `## Risks the selector flagged — write so these don't happen\n${input.plan.risks.map((r) => `- ${r}`).join("\n")}`
        : "",
      input.research.gaps.length
        ? `## Known blanks — do not paper over these\n${input.research.gaps.map((g) => `- ${g}`).join("\n")}`
        : "",
      input.extraInstructions ? `## Additional instructions from the sender\n${input.extraInstructions}` : "",
      ``,
      `Write the body only — no signature block; the signature is appended afterwards. End the body at the sign-off line.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
