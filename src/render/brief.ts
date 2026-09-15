import type { ScoredCaseStudy } from "../corpus/match.js";
import { formatTally } from "../util/cost.js";
import { worstSeverity } from "../stages/gate.js";
import type { RunArtifacts } from "../types.js";
import type { CompanyProfile } from "../types.js";
import { renderEmailBody } from "./email.js";

/** The human-readable deliverable: everything a rep needs to decide to send. */
export function renderBrief(
  a: RunArtifacts,
  company: CompanyProfile,
  shortlisted: ScoredCaseStudy[],
  researchNotes: string,
): string {
  const r = a.research;
  const verdictLine =
    a.verification.verdict === "pass"
      ? "PASS — verifier found no blocking issues"
      : a.verification.verdict === "revise"
        ? "REVISE — fix the findings below before sending"
        : "BLOCK — do not send";

  const sourceLine = (id: string) => {
    const s = r.sources.find((x) => x.id === id);
    return s ? `[${id}] ${s.title} — ${s.url}` : `[${id}] (unresolved)`;
  };

  const md: string[] = [];
  md.push(`# Outreach brief — ${a.prospect}`);
  md.push("");
  md.push(`**From:** ${company.name}${company.group && company.group !== company.name ? ` (${company.group} group)` : ""}`);
  md.push("");
  md.push(`> ${verdictLine}.`);
  md.push(
    `> Research confidence: **${r.confidence}** · Gate: **${worstSeverity(a.gateFindings)}** · ` +
      `Generated ${a.finishedAt} · ${formatTally(a.usage)}`,
  );
  if (a.plan.disqualifierHits.length) {
    md.push("");
    md.push(`> ⚠️ **Disqualifiers fired — consider not sending at all:**`);
    a.plan.disqualifierHits.forEach((d) => md.push(`> - ${d}`));
  }

  /* ---------------- The email ---------------- */
  md.push("", "---", "", "## Draft email", "");
  md.push(`**Subject:** ${a.draft.subject}`);
  if (a.draft.preheader) md.push(`**Preheader:** ${a.draft.preheader}`);
  md.push("", "```text", renderEmailBody(a.draft, company, a.locale), "```");
  if (a.draft.alternativeSubjects.length) {
    md.push("", `**Alternative subjects:** ${a.draft.alternativeSubjects.map((s) => `“${s}”`).join(" · ")}`);
  }
  md.push("", `**Call to action:** ${a.draft.cta}`);
  md.push(`**Tone rationale:** ${a.draft.toneNotes}`);
  if (a.draft.followUpSuggestion) md.push(`**If no reply:** ${a.draft.followUpSuggestion}`);

  /* ---------------- Checks ---------------- */
  md.push("", "---", "", "## Checks", "");
  md.push(`### Deterministic gate`);
  if (a.gateFindings.length === 0) md.push("- Clean.");
  else a.gateFindings.forEach((f) => md.push(`- **${f.severity}** · \`${f.rule}\` — ${f.detail}`));

  md.push("", `### Grounding audit — ${a.verification.verdict.toUpperCase()}`);
  md.push(a.verification.summary);
  if (a.verification.findings.length === 0) md.push("", "- No findings.");
  else
    a.verification.findings.forEach((f) =>
      md.push("", `- **${f.severity} / ${f.kind}** — ${f.issue}`, `  > ${f.quote}`, `  *Fix:* ${f.suggestedFix}`),
    );

  md.push("", `### Claim ledger`);
  md.push("| Claim | Evidence |", "| --- | --- |");
  a.draft.claims.forEach((c) =>
    md.push(`| ${escapePipes(c.text)} | \`${c.evidenceRef}\` |`),
  );

  /* ---------------- Competitive position ---------------- */
  const ci = a.competitorIntel;
  md.push("", "---", "", "## Competitor overlap", "");
  if (r.competitors.length === 0) {
    md.push("Research named no competitors. That is usually a sign the research was thin, not that they have none.");
  } else {
    md.push(`Research named ${r.competitors.length} competitor(s):`);
    r.competitors.forEach((c) =>
      md.push(`- **${c.name}** — *${c.relationship}* — ${c.basis} ${c.sourceIds.map((x) => `[${x}]`).join("")}`),
    );
  }

  if (ci.leverage.length) {
    md.push("", "### Usable in the email");
    ci.leverage.forEach((l) =>
      md.push(`- **${l.referAs}** (${l.relationship} competitor) — ${l.note}`, `  - matched because ${l.match.reason}`),
    );
  }
  const siblings = [...ci.silent, ...ci.leverage].filter((l) => l.sibling);
  if (siblings.length) {
    md.push("", "### Held by a sibling brand — group conflict check");
    siblings.forEach((l) => md.push(`- **${l.competitor}** — client of **${l.heldBy}**, not ${a.research.company.displayName ? company.name : company.name}. ${l.note}`));
  }
  if (ci.silent.length) {
    md.push("", "### Real, but not referenceable");
    ci.silent.forEach((l) => md.push(`- **${l.competitor}** — ${l.note}`));
  }
  if (ci.possible.length) {
    md.push("", "### Needs your eyes — weak name match");
    ci.possible.forEach((l) =>
      md.push(
        `- **${l.competitor}** may be the same company as our client ${l.origin.kind === "case-study" ? l.origin.client : l.origin.name}: ${l.match.reason}. Not used in the email.`,
      ),
    );
  }
  if (ci.cautions.length) {
    md.push("", "### Cautions");
    ci.cautions.forEach((c) => md.push(`- **${c.severity}** — ${c.reason}`));
  }
  if (ci.unmatched.length) {
    md.push("", `No recorded relationship with: ${ci.unmatched.join(", ")}`);
  }

  /* ---------------- Why these proofs ---------------- */
  md.push("", "---", "", "## Why this pitch", "");
  md.push(`**Angle:** ${a.plan.pitchAngle}`, "");
  md.push(`### Case studies used`);
  a.plan.selected.forEach((s) => {
    md.push(`- **${s.caseStudyId}** (relevance ${s.relevanceScore}) — ${s.rationale}`);
    if (s.anglesToUse.length) md.push(`  - Angles: ${s.anglesToUse.join("; ")}`);
    if (s.resultsToCite.length) md.push(`  - Results cited: ${s.resultsToCite.join(" · ")}`);
  });
  md.push("", `### Services positioned`);
  a.plan.recommendedServices.forEach((s) =>
    md.push(`- **${s.serviceId}** — ${s.why}${s.specsToSurface.length ? ` *(specs: ${s.specsToSurface.join(", ")})*` : ""}`),
  );
  if (a.plan.rejected.length) {
    md.push("", `### Considered and rejected`);
    a.plan.rejected.forEach((s) => md.push(`- ${s.caseStudyId} — ${s.why}`));
  }
  if (a.plan.risks.length) {
    md.push("", `### Risks`);
    a.plan.risks.forEach((s) => md.push(`- ${s}`));
  }

  /* ---------------- Research ---------------- */
  md.push("", "---", "", "## Research", "");
  md.push(`**${r.company.displayName}**${r.company.legalName ? ` (${r.company.legalName})` : ""}`);
  md.push(
    [
      r.company.website,
      [r.company.hqCity, r.company.hqCountry].filter(Boolean).join(", "),
      r.company.employeeRange,
      r.company.foundedYear ? `founded ${r.company.foundedYear}` : null,
      r.company.ownership,
      r.company.fundingStage,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  md.push("", `**Industry:** ${r.industry.primary}${r.industry.subSectors.length ? ` (${r.industry.subSectors.join(", ")})` : ""} · **Model:** ${r.industry.businessModel}`);
  md.push(`**Markets:** ${r.market.countriesServed.join(", ") || "—"} · **Primary region:** ${r.market.primaryRegion} · **Languages:** ${r.market.languages.join(", ") || "—"}`);
  if (r.productsAndServices.length) md.push("", `**Products/services:** ${r.productsAndServices.join(" · ")}`);
  if (r.techSignals.length) md.push(`**Tech signals:** ${r.techSignals.join(" · ")}`);
  if (r.competitors.length) md.push(`**Competitors:** ${r.competitors.map((c) => c.name).join(", ")}`);

  if (r.recentDevelopments.length) {
    md.push("", `### Recent developments`);
    r.recentDevelopments.forEach((d) =>
      md.push(`- ${d.date ? `**${d.date}** — ` : ""}${d.headline} — ${d.whyItMatters} ${d.sourceIds.map((s) => `[${s}]`).join("")}`),
    );
  }
  if (r.likelyPains.length) {
    md.push("", `### Likely pains`);
    r.likelyPains.forEach((p) => md.push(`- **${p.pain}** — ${p.evidence} ${p.sourceIds.map((s) => `[${s}]`).join("")}`));
  }
  md.push("", `### Buying context`);
  md.push(`- Likely buyers: ${r.buyingContext.likelyBuyerTitles.join(", ") || "—"}`);
  md.push(`- Triggers: ${r.buyingContext.probableTriggers.join("; ") || "—"}`);
  if (r.buyingContext.procurementNotes) md.push(`- Procurement: ${r.buyingContext.procurementNotes}`);

  if (r.regionalNotes.length) {
    md.push("", `### Regional context (${a.locale.label})`);
    r.regionalNotes.forEach((n) => md.push(`- ${n}`));
  }
  if (r.regulatoryNotes.length) {
    md.push("", `### Regulatory notes`);
    r.regulatoryNotes.forEach((n) => md.push(`- ${n}`));
  }
  if (r.gaps.length) {
    md.push("", `### What we could not establish`);
    r.gaps.forEach((n) => md.push(`- ${n}`));
  }

  md.push("", `### Sources`);
  r.sources.forEach((s) =>
    md.push(`- ${sourceLine(s.id)}${s.publisher ? ` · ${s.publisher}` : ""}${s.publishedDate ? ` · ${s.publishedDate}` : ""}`),
  );

  /* ---------------- Appendix ---------------- */
  md.push("", "---", "", "<details><summary>Appendix: deterministic shortlist</summary>", "");
  shortlisted.forEach((s) =>
    md.push(`- \`${s.caseStudy.id}\` — score ${s.score} — ${s.reasons.join("; ") || "no signal"}`),
  );
  md.push("", "</details>", "");
  md.push("<details><summary>Appendix: raw analyst notes</summary>", "", researchNotes, "", "</details>", "");

  return md.join("\n");
}

const escapePipes = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
