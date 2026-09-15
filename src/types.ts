import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Reference material — what *we* know about ourselves.
 * These are loaded from config/ and data/ and validated on every run, so a
 * malformed case study fails loudly at load time rather than quietly producing
 * a weaker email.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Free-text positioning: how we talk about this when we lead with it. */
  positioning: z.string(),
  /** Sectors / company profiles this is a natural fit for. */
  idealFor: z.array(z.string()).default([]),
  /**
   * The SaaS analogue of a material specification: the concrete, checkable
   * facts a technical buyer will ask for. Kept as free-form key/value so it
   * survives contact with any product.
   * e.g. { "uptime SLA": "99.95%", "deployment": "VPC or SaaS",
   *        "compliance": "SOC 2 Type II, ISO 27001", "data residency": "EU/US/IN" }
   */
  specs: z.record(z.string(), z.string()).default({}),
  proofPoints: z.array(z.string()).default([]),
  /** Typical commercial shape — never quoted verbatim in a cold email. */
  commercialNotes: z.string().optional(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const SenderSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  calendarLink: z.string().optional(),
  linkedin: z.string().optional(),
});

export const CompanyProfileSchema = z.object({
  name: z.string(),
  website: z.string(),
  oneLiner: z.string(),
  positioning: z.string(),
  foundedYear: z.number().int().optional(),
  headquarters: z.string().optional(),
  teamSize: z.string().optional(),
  services: z.array(ServiceSchema).min(1),
  differentiators: z.array(z.string()).default([]),
  /** Signals that mean we should NOT pitch. Surfaced as a hard warning. */
  disqualifiers: z.array(z.string()).default([]),
  /** Claims we are contractually or legally not allowed to make. Enforced. */
  forbiddenClaims: z.array(z.string()).default([]),
  sender: SenderSchema,
  /** Postal address — required by CAN-SPAM for US recipients. */
  postalAddress: z.string().optional(),
  unsubscribeLine: z.string().optional(),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const ResultSchema = z.object({
  metric: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
  /** The headline movement, e.g. "-38% p95 latency". */
  delta: z.string(),
  timeframe: z.string().optional(),
  /**
   * false = we believe it but cannot evidence it. Unverified results are never
   * allowed into an email body as a hard number.
   */
  verified: z.boolean().default(false),
});

export const ConfidentialitySchema = z.enum([
  /** Client named, numbers quotable. */
  "public",
  /** Numbers quotable, client must be described generically. */
  "anonymized",
  /** Reference only — must never appear in outbound copy. */
  "internal_only",
]);
export type Confidentiality = z.infer<typeof ConfidentialitySchema>;

export const CaseStudySchema = z.object({
  id: z.string(),
  client: z.string(),
  confidentiality: ConfidentialitySchema,
  /** How to refer to the client when confidentiality is "anonymized". */
  anonymousLabel: z.string().optional(),
  industry: z.string(),
  subSectors: z.array(z.string()).default([]),
  country: z.string(),
  region: z.string(),
  companySize: z.string().optional(),
  businessModel: z.string().optional(),
  problem: z.string(),
  solution: z.string(),
  servicesUsed: z.array(z.string()).default([]),
  stack: z.array(z.string()).default([]),
  results: z.array(ResultSchema).default([]),
  quote: z
    .object({ text: z.string(), attribution: z.string() })
    .optional(),
  engagementLength: z.string().optional(),
  year: z.number().int().optional(),
  tags: z.array(z.string()).default([]),
  /** Long-form narrative from the markdown body. Not sent to the draft stage. */
  narrative: z.string().default(""),
});
export type CaseStudy = z.infer<typeof CaseStudySchema>;

export const ClientRecordSchema = z.object({
  name: z.string(),
  industry: z.string(),
  country: z.string(),
  region: z.string().optional(),
  services: z.array(z.string()).default([]),
  nameable: z.boolean().default(false),
  since: z.string().optional(),
});
export type ClientRecord = z.infer<typeof ClientRecordSchema>;

export const LocaleProfileSchema = z.object({
  /** ISO-3166 alpha-2, or "DEFAULT". */
  code: z.string(),
  label: z.string(),
  formality: z.enum(["low", "medium", "high"]),
  directness: z.enum(["low", "medium", "high"]),
  greeting: z.string(),
  signOff: z.string(),
  subjectMaxChars: z.number().int().default(60),
  bodyMaxWords: z.number().int().default(160),
  /** Written guidance handed to the drafting model verbatim. */
  notes: z.array(z.string()).default([]),
  /** Things that read as rude, pushy or illegal in this market. */
  avoid: z.array(z.string()).default([]),
  /** Regulatory obligations that must be reflected in the footer. */
  compliance: z.array(z.string()).default([]),
  dateFormat: z.string().default("D MMMM YYYY"),
  currency: z.string().optional(),
});
export type LocaleProfile = z.infer<typeof LocaleProfileSchema>;

export const IndustryStyleSchema = z.object({
  key: z.string(),
  label: z.string(),
  notes: z.array(z.string()).default([]),
  vocabulary: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  /** Which spec keys this audience actually cares about. */
  specsThatMatter: z.array(z.string()).default([]),
});
export type IndustryStyle = z.infer<typeof IndustryStyleSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Stage outputs — what the model returns. Every schema that carries a factual
 * claim also carries the id of the evidence behind it. That is the whole point:
 * it lets the verifier and the renderer check the claim against a real source
 * instead of trusting the prose.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SourceSchema = z.object({
  id: z.string().describe("Short stable id, e.g. s1, s2."),
  url: z.string(),
  title: z.string(),
  publisher: z.string().nullable(),
  publishedDate: z.string().nullable(),
});

const Cited = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    sourceIds: z
      .array(z.string())
      .describe("Ids from the sources array that support this. Never empty."),
  });

export const ProspectResearchSchema = z.object({
  company: z.object({
    displayName: z.string(),
    legalName: z.string().nullable(),
    website: z.string().nullable(),
    hqCountry: z.string().nullable(),
    hqCity: z.string().nullable(),
    foundedYear: z.number().int().nullable(),
    employeeRange: z.string().nullable(),
    ownership: z.string().nullable().describe("Private, public (ticker), PE-backed, etc."),
    fundingStage: z.string().nullable(),
  }),
  industry: z.object({
    primary: z.string(),
    subSectors: z.array(z.string()),
    businessModel: z.string(),
  }),
  market: z.object({
    countriesServed: z.array(z.string()),
    primaryRegion: z.string(),
    languages: z.array(z.string()),
  }),
  productsAndServices: z.array(z.string()),
  techSignals: z.array(z.string()).describe("Observed stack, tooling, integrations, job-ad signals."),
  recentDevelopments: z.array(
    Cited({
      headline: z.string(),
      date: z.string().nullable(),
      whyItMatters: z.string(),
    }),
  ),
  likelyPains: z.array(
    Cited({
      pain: z.string(),
      evidence: z.string(),
    }),
  ),
  buyingContext: z.object({
    likelyBuyerTitles: z.array(z.string()),
    probableTriggers: z.array(z.string()),
    procurementNotes: z.string().nullable(),
  }),
  competitors: z.array(z.string()),
  regionalNotes: z.array(z.string()).describe("Market, cultural and regulatory context for outreach."),
  regulatoryNotes: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  gaps: z.array(z.string()).describe("What could not be established. Honest blanks, not guesses."),
  sources: z.array(SourceSchema),
});
export type ProspectResearch = z.infer<typeof ProspectResearchSchema>;

export const MatchPlanSchema = z.object({
  pitchAngle: z.string().describe("One sentence: the argument this email makes."),
  selected: z.array(
    z.object({
      caseStudyId: z.string(),
      relevanceScore: z.number().min(0).max(100),
      rationale: z.string(),
      anglesToUse: z.array(z.string()),
      resultsToCite: z.array(z.string()).describe("Exact `delta` strings from that case study."),
    }),
  ),
  recommendedServices: z.array(
    z.object({
      serviceId: z.string(),
      why: z.string(),
      specsToSurface: z.array(z.string()).describe("Exact spec keys from the service definition."),
    }),
  ),
  rejected: z.array(z.object({ caseStudyId: z.string(), why: z.string() })),
  risks: z.array(z.string()).describe("Reasons this outreach could land badly."),
  disqualifierHits: z.array(z.string()),
});
export type MatchPlan = z.infer<typeof MatchPlanSchema>;

export const EmailDraftSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  body: z.string().describe("Plain-text email body, greeting through sign-off. No markdown."),
  claims: z.array(
    z.object({
      text: z.string().describe("The claim exactly as it appears in the body."),
      evidenceRef: z
        .string()
        .describe("src:<sourceId> for prospect facts, cs:<caseStudyId> for our results, profile:<field> for our own positioning."),
    }),
  ),
  cta: z.string(),
  toneNotes: z.string(),
  followUpSuggestion: z.string(),
  alternativeSubjects: z.array(z.string()),
});
export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export const VerificationSchema = z.object({
  verdict: z.enum(["pass", "revise", "block"]),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      kind: z.enum([
        "unsupported_claim",
        "overstated_claim",
        "confidentiality_breach",
        "forbidden_claim",
        "tone_mismatch",
        "factual_error",
        "compliance",
      ]),
      quote: z.string().describe("The exact text from the draft that triggered this."),
      issue: z.string(),
      suggestedFix: z.string(),
    }),
  ),
});
export type Verification = z.infer<typeof VerificationSchema>;

/* ──────────────────────────────────────────────────────────────────────────── */

export interface RunArtifacts {
  prospect: string;
  research: ProspectResearch;
  plan: MatchPlan;
  draft: EmailDraft;
  verification: Verification;
  /** Deterministic checks run in code, independent of any model. */
  gateFindings: GateFinding[];
  locale: LocaleProfile;
  industryStyle: IndustryStyle | null;
  usage: UsageTally;
  startedAt: string;
  finishedAt: string;
}

export interface GateFinding {
  severity: "blocker" | "major" | "minor";
  rule: string;
  detail: string;
}

export interface UsageTally {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  calls: number;
  estimatedCostUsd: number;
}
