import { Claude } from "./anthropic.js";
import type { AgentConfig } from "./config.js";
import { loadCorpus, resolveIndustryStyle, resolveLocale, type Corpus } from "./corpus/load.js";
import type { ScoredCaseStudy } from "./corpus/match.js";
import { analyseCompetitors } from "./corpus/competitors.js";
import { researchProspect } from "./stages/research.js";
import { selectEvidence } from "./stages/select.js";
import { buildEvidencePack } from "./stages/evidence.js";
import { draftEmail } from "./stages/draft.js";
import { verifyDraft } from "./stages/verify.js";
import { runGate, worstSeverity } from "./stages/gate.js";
import { emptyTally, formatTally } from "./util/cost.js";
import { log } from "./util/logger.js";
import type { RunArtifacts } from "./types.js";

export interface RunOptions {
  prospect: string;
  contactName?: string;
  contactTitle?: string;
  website?: string;
  country?: string;
  notes?: string;
  instructions?: string;
  /** Force a locale instead of inferring it from the prospect's HQ. */
  localeCode?: string;
}

/** Seams for tests: inject a stubbed SDK client instead of calling the API. */
export interface RunDeps {
  corpus?: Corpus;
  sdkClient?: ConstructorParameters<typeof Claude>[2];
}

export interface RunResult {
  artifacts: RunArtifacts;
  shortlisted: ScoredCaseStudy[];
  researchNotes: string;
  corpus: Corpus;
}

const TOTAL_STEPS = 6;

export async function runPipeline(
  cfg: AgentConfig,
  opts: RunOptions,
  deps: RunDeps = {},
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const tally = emptyTally();

  log.step(1, TOTAL_STEPS, "Loading reference material");
  const loaded = deps.corpus ?? loadCorpus(cfg);
  log.ok(
    `Sending as ${loaded.company.name} · ${loaded.caseStudies.filter((c) => !c.brand || c.brand === loaded.brand).length} own case studies · ` +
      `${loaded.company.services.length} services · ${loaded.clients.length} group clients`,
  );

  const claude = new Claude(
    {
      model: cfg.model,
      effort: cfg.effort,
      refusalFallback: cfg.refusalFallback,
      maxContinuations: cfg.research.maxContinuations,
    },
    tally,
    deps.sdkClient,
  );

  log.step(2, TOTAL_STEPS, `Researching ${opts.prospect} (web search, up to ${cfg.research.maxSearches} queries)`);
  const { research, notes } = await researchProspect(claude, cfg, loaded, {
    prospect: opts.prospect,
    hints: {
      website: opts.website,
      country: opts.country,
      contactName: opts.contactName,
      contactTitle: opts.contactTitle,
      notes: opts.notes,
    },
  });
  log.ok(
    `${research.industry.primary} · ${research.company.hqCountry ?? "country unknown"} · ` +
      `${research.sources.length} sources · confidence ${research.confidence}`,
  );
  if (research.confidence === "low") {
    log.warn("Research confidence is LOW. Read the brief before sending anything.");
  }

  // Deterministic, no model call: cross-reference the prospect's competitors
  // against our own client base before anything decides what to pitch.
  const competitorIntel = analyseCompetitors(loaded, research);
  if (competitorIntel.leverage.length) {
    log.ok(
      `Competitor leverage: ${competitorIntel.leverage.map((l) => l.referAs).join(", ")} ` +
        `(${competitorIntel.leverage.length} of the prospect's rivals are our clients)`,
    );
  }
  for (const caution of competitorIntel.cautions) {
    log.warn(`Competitor caution: ${caution.reason}`);
  }
  if (competitorIntel.silent.length) {
    log.warn(
      `${competitorIntel.silent.length} competitor relationship(s) exist but cannot be referenced: ` +
        competitorIntel.silent.map((l) => l.competitor).join(", "),
    );
  }
  if (competitorIntel.possible.length) {
    log.warn(
      `${competitorIntel.possible.length} weak competitor name match(es) need a human to confirm — see the brief.`,
    );
  }

  const locale = opts.localeCode
    ? resolveLocale(loaded.locales, opts.localeCode)
    : resolveLocale(loaded.locales, research.company.hqCountry, research.company.hqCity);
  const industryStyle = resolveIndustryStyle(
    loaded.industries,
    research.industry.primary,
    research.industry.subSectors,
  );
  log.debug(`locale=${locale.code} industryStyle=${industryStyle?.key ?? "none"}`);

  log.step(3, TOTAL_STEPS, "Matching past work to the prospect");
  const { plan, shortlisted } = await selectEvidence(claude, cfg, loaded, research, competitorIntel);
  log.ok(
    plan.selected.length
      ? `Selected ${plan.selected.map((s) => s.caseStudyId).join(", ")}`
      : "No case study was judged relevant — the email will argue from positioning alone.",
  );
  if (plan.disqualifierHits.length) {
    log.warn(`Disqualifiers fired: ${plan.disqualifierHits.join("; ")}`);
  }

  log.step(4, TOTAL_STEPS, `Drafting (${locale.label} tone, ${industryStyle?.label ?? "generic"} register)`);
  const evidence = buildEvidencePack(loaded, research, plan, competitorIntel);
  const draft = await draftEmail(claude, cfg, loaded, {
    prospect: opts.prospect,
    contactName: opts.contactName,
    contactTitle: opts.contactTitle,
    locale,
    industryStyle,
    research,
    plan,
    evidence,
    extraInstructions: opts.instructions,
  });
  log.ok(`Subject: "${draft.subject}" · ${draft.body.trim().split(/\s+/).length} words · ${draft.claims.length} claims`);

  log.step(5, TOTAL_STEPS, "Checking every claim against the evidence pack");
  const gateFindings = runGate({ draft, evidence, corpus: loaded, locale, competitorIntel });
  const verification = await verifyDraft(claude, loaded, { draft, evidence, locale, industryStyle });

  const gateWorst = worstSeverity(gateFindings);
  if (gateWorst === "blocker") log.error(`Gate: ${gateFindings.filter((f) => f.severity === "blocker").length} blocker(s)`);
  else if (gateWorst === "none") log.ok("Gate: clean");
  else log.warn(`Gate: ${gateWorst} findings`);

  if (verification.verdict === "pass") log.ok("Grounding audit: pass");
  else if (verification.verdict === "revise") log.warn(`Grounding audit: revise (${verification.findings.length} findings)`);
  else log.error(`Grounding audit: BLOCK — ${verification.summary}`);

  log.step(6, TOTAL_STEPS, `Done · ${formatTally(tally)}`);

  return {
    artifacts: {
      prospect: opts.prospect,
      research,
      competitorIntel,
      plan,
      draft,
      verification,
      gateFindings,
      locale,
      industryStyle,
      usage: tally,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    shortlisted,
    researchNotes: notes,
    corpus: loaded,
  };
}

/** True when the run produced something nobody should put in front of a prospect. */
export const isBlocked = (a: RunArtifacts): boolean =>
  a.verification.verdict === "block" || a.gateFindings.some((f) => f.severity === "blocker");
