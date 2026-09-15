#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import { loadAgentConfig } from "./config.js";
import { loadCorpus } from "./corpus/load.js";
import { findCrossBrandClients } from "./corpus/competitors.js";
import { isBlocked, runPipeline, type RunOptions } from "./pipeline.js";
import { renderBrief } from "./render/brief.js";
import { renderEmailBody } from "./render/email.js";
import { writeRun } from "./sinks/file.js";
import { createGmailDraft } from "./sinks/gmail.js";
import { log, setVerbose } from "./util/logger.js";
import { formatTally } from "./util/cost.js";
import { parseCsv } from "./corpus/load.js";

const program = new Command();

program
  .name("outreach")
  .description("Research a prospect, match your past work to them, and draft a grounded outreach email.")
  .version("0.1.0");

program
  .command("research", { isDefault: true })
  .argument("<company>", "prospect company name")
  .description("Run the full pipeline for one prospect")
  .option("-c, --contact <name>", "recipient's full name")
  .option("-T, --title <title>", "recipient's job title")
  .option("-w, --website <url>", "prospect website, if you already know it")
  .option("-C, --country <country>", "prospect country — skips a search and fixes the locale")
  .option("-n, --notes <text>", "anything you already know that the research should start from")
  .option("-i, --instructions <text>", "extra instructions for the drafting stage")
  .option("-l, --locale <code>", "force a locale code (e.g. DE) instead of inferring from HQ")
  .option("--to <email>", "recipient address — required for --gmail")
  .option("--gmail", "also create a Gmail draft (never sends)", false)
  .option("-o, --out <dir>", "output directory (default: from config)")
  .option("--config <file>", "agent config file", "config/agent.yaml")
  .option("-b, --brand <key>", "which brand is sending (see `outreach brands`)")
  .option("-v, --verbose", "log intermediate detail", false)
  .action(async (company: string, o) => {
    setVerbose(o.verbose);
    const cfg = loadAgentConfig(o.config, o.brand);
    const outDir = o.out ?? cfg.output.dir;

    if (o.gmail && !o.to) fail("--gmail needs --to <email>; a draft with no recipient is not much use.");

    const opts: RunOptions = {
      prospect: company,
      contactName: o.contact,
      contactTitle: o.title,
      website: o.website,
      country: o.country,
      notes: o.notes,
      instructions: o.instructions,
      localeCode: o.locale,
    };

    const result = await runPipeline(cfg, opts);
    const { artifacts, corpus } = result;

    const emailText = renderEmailBody(artifacts.draft, corpus.company, artifacts.locale);
    const brief = renderBrief(artifacts, corpus.company, result.shortlisted, result.researchNotes);
    const files = writeRun(outDir, artifacts, brief, emailText);

    console.log("");
    console.log(pc.bold(`Subject: ${artifacts.draft.subject}`));
    console.log("");
    console.log(emailText);
    console.log("");
    log.ok(`Brief:  ${files.brief}`);
    log.ok(`Email:  ${files.email}`);
    log.ok(`Run:    ${files.json}`);

    if (isBlocked(artifacts)) {
      log.error("This draft is BLOCKED. Read the findings in the brief before touching it.");
      if (o.gmail) log.error("Gmail draft not created.");
      if (cfg.output.failOnBlock) process.exitCode = 2;
      return;
    }
    if (artifacts.verification.verdict === "revise") {
      log.warn("Verifier asked for revisions — see the brief. Draft written anyway.");
    }

    if (o.gmail) {
      try {
        const draft = await createGmailDraft({
          to: o.to,
          from: `${corpus.company.sender.name} <${corpus.company.sender.email}>`,
          subject: artifacts.draft.subject,
          body: emailText,
        });
        log.ok(`Gmail draft created (not sent): ${draft.url}`);
      } catch (e) {
        log.error(`Gmail draft failed: ${(e as Error).message}`);
        log.info("The email is still on disk — nothing was lost.");
        process.exitCode = 1;
      }
    }
  });

program
  .command("batch")
  .argument("<file>", "CSV with a 'company' column (optional: contact, title, website, country, to)")
  .description("Run the pipeline over a list of prospects, sequentially")
  .option("-o, --out <dir>", "output directory")
  .option("--config <file>", "agent config file", "config/agent.yaml")
  .option("-b, --brand <key>", "which brand is sending (see `outreach brands`)")
  .option("--continue-on-error", "keep going if one prospect fails", false)
  .option("-v, --verbose", "log intermediate detail", false)
  .action(async (file: string, o) => {
    setVerbose(o.verbose);
    const cfg = loadAgentConfig(o.config, o.brand);
    const outDir = o.out ?? cfg.output.dir;

    const rows = parseCsv(fs.readFileSync(file, "utf8"));
    const header = rows.shift()?.map((h) => h.trim().toLowerCase());
    if (!header?.includes("company")) fail(`${file} needs a 'company' column.`);

    // Load the corpus once and reuse it: the system prefix stays byte-identical
    // across prospects, so every run after the first reads it from cache.
    const corpus = loadCorpus(cfg);
    const results: { company: string; status: string; dir?: string }[] = [];

    for (const [i, row] of rows.entries()) {
      const get = (k: string) => row[header.indexOf(k)]?.trim() || undefined;
      const company = get("company");
      if (!company) continue;

      console.error(pc.bold(pc.cyan(`\n━━ ${i + 1}/${rows.length} · ${company} ━━`)));
      try {
        const result = await runPipeline(
          cfg,
          {
            prospect: company,
            contactName: get("contact"),
            contactTitle: get("title"),
            website: get("website"),
            country: get("country"),
            notes: get("notes"),
          },
          { corpus },
        );
        const emailText = renderEmailBody(result.artifacts.draft, corpus.company, result.artifacts.locale);
        const brief = renderBrief(result.artifacts, corpus.company, result.shortlisted, result.researchNotes);
        const files = writeRun(outDir, result.artifacts, brief, emailText);
        results.push({
          company,
          status: isBlocked(result.artifacts) ? "BLOCKED" : result.artifacts.verification.verdict,
          dir: files.dir,
        });
      } catch (e) {
        log.error(`${company}: ${(e as Error).message}`);
        results.push({ company, status: "ERROR" });
        if (!o.continueOnError) break;
      }
    }

    console.log("");
    console.log(pc.bold("Batch summary"));
    for (const r of results) {
      const mark = r.status === "pass" ? pc.green("✓") : r.status === "revise" ? pc.yellow("~") : pc.red("✗");
      console.log(`  ${mark} ${r.company.padEnd(36)} ${r.status}${r.dir ? `  ${pc.dim(r.dir)}` : ""}`);
    }
    if (results.some((r) => r.status === "BLOCKED" || r.status === "ERROR")) process.exitCode = 2;
  });

program
  .command("validate")
  .description("Load and check the reference material without calling the API")
  .option("--config <file>", "agent config file", "config/agent.yaml")
  .option("-b, --brand <key>", "validate one brand (default: all of them)")
  .action((o) => {
    setVerbose(true);
    const all = loadAgentConfig(o.config);
    const brands = o.brand ? [o.brand] : (Object.keys(all.brands).length ? Object.keys(all.brands) : [all.activeBrand]);
    for (const brand of brands) validateBrand(o.config, brand);
    log.ok(`${brands.length} brand(s) valid.`);
  });

function validateBrand(configFile: string, brand: string): void {
    const cfg = loadAgentConfig(configFile, brand);
    const corpus = loadCorpus(cfg);

    const byConfidentiality = corpus.caseStudies.reduce<Record<string, number>>((acc, cs) => {
      acc[cs.confidentiality] = (acc[cs.confidentiality] ?? 0) + 1;
      return acc;
    }, {});
    const verified = corpus.caseStudies.reduce((n, cs) => n + cs.results.filter((r) => r.verified).length, 0);
    const unverified = corpus.caseStudies.reduce((n, cs) => n + cs.results.filter((r) => !r.verified).length, 0);

    log.ok(`Company profile: ${corpus.company.name} · ${corpus.company.services.length} services`);
    log.ok(`Case studies: ${corpus.caseStudies.length} (${JSON.stringify(byConfidentiality)})`);
    log.ok(`Results: ${verified} verified, ${unverified} unverified (unverified numbers are never quoted)`);
    log.ok(`Clients: ${corpus.clients.length} · Locales: ${corpus.locales.length} · Industry styles: ${corpus.industries.length}`);
    if (unverified > verified) {
      log.warn("Most of your results are unverified. Verify them or the emails will be vague.");
    }
    if (!corpus.company.postalAddress?.trim()) {
      log.warn(`${corpus.company.name}: no postalAddress — sends will flag a compliance finding.`);
    }
    for (const todo of findTodos(corpus.company)) log.warn(`${corpus.company.name}: ${todo}`);
    const own = corpus.caseStudies.filter((c) => !c.brand || c.brand === corpus.brand);
    if (own.length === 0) {
      log.warn(`${corpus.company.name} has no case studies of its own — its emails will argue from positioning alone.`);
    }
}

/** Surface placeholders left in a profile before they reach a prospect. */
function findTodos(company: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (/\bTODO\b/.test(node)) out.push(`${path} is still a TODO`);
    } else if (Array.isArray(node)) {
      node.forEach((v, idx) => walk(v, `${path}[${idx}]`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(company, "");
  return out;
}

program
  .command("brands")
  .description("List the configured brands and how ready each is to send")
  .option("--config <file>", "agent config file", "config/agent.yaml")
  .action((o) => {
    const all = loadAgentConfig(o.config);
    const keys = Object.keys(all.brands);
    if (keys.length === 0) return console.log("No brands configured; using config/agent.yaml paths directly.");

    for (const key of keys) {
      const cfg = loadAgentConfig(o.config, key);
      const corpus = loadCorpus(cfg);
      const own = corpus.caseStudies.filter((c) => !c.brand || c.brand === key);
      const verified = own.reduce((n, c) => n + c.results.filter((r) => r.verified).length, 0);
      const todos = findTodos(corpus.company).length;
      const mark = todos === 0 && verified > 0 ? pc.green("ready") : pc.yellow("needs work");

      console.log(
        `${pc.bold(key.padEnd(12))} ${corpus.company.name.padEnd(14)} ` +
          `${String(own.length).padStart(2)} case studies · ${String(verified).padStart(2)} verified results · ` +
          `${String(todos).padStart(2)} TODOs  ${mark}`,
      );
    }
    const overlaps = findCrossBrandClients(loadCorpus(loadAgentConfig(o.config, all.defaultBrand)).clients);
    if (overlaps.length) {
      console.log(`\n${pc.bold("Clients held by more than one brand")}`);
      console.log(
        pc.dim("  Two brands can pitch the same account in the same week, and a conflict one\n" +
               "  brand has cleared is not cleared for another. Check before a campaign.\n"),
      );
      for (const o2 of overlaps) {
        const mark = o2.confidence === "weak" ? pc.yellow("?") : " ";
        const alias = o2.aliases.length ? pc.dim(` (also recorded as ${o2.aliases.join(", ")})`) : "";
        console.log(`  ${mark} ${o2.name.padEnd(26)} ${o2.brands.join(" + ")}${alias}`);
      }
      if (overlaps.some((x) => x.confidence === "weak")) {
        console.log(pc.dim("\n  ? = weak name match. Confirm these are the same company."));
      }
    }

    console.log(`\n${pc.dim(`Default brand: ${all.defaultBrand}. Use --brand <key> to switch.`)}`);
  });

program
  .command("estimate")
  .description("Show the per-prospect cost model without running anything")
  .option("--config <file>", "agent config file", "config/agent.yaml")
  .action((o) => {
    const cfg = loadAgentConfig(o.config);
    console.log(
      [
        `Model: ${cfg.model} · effort ${cfg.effort}`,
        ``,
        `Per prospect the pipeline makes five calls:`,
        `  1. research      — web search + fetch, long output   (the expensive one)`,
        `  2. structure     — prose → schema, no tools`,
        `  3. select        — shortlist → match plan`,
        `  4. draft         — evidence pack → email`,
        `  5. verify        — email + evidence pack → audit`,
        ``,
        `Typical spend on claude-opus-5 is a few tens of cents per prospect, dominated`,
        `by step 1. Actual usage is printed after every run and stored in run.json.`,
        `Lower it by reducing research.maxSearches, dropping effort to "medium", or`,
        `running batches — the seller-context prefix is cached for an hour, so every`,
        `prospect after the first reads it at a tenth of the price.`,
      ].join("\n"),
    );
  });

function fail(msg: string): never {
  log.error(msg);
  process.exit(1);
}

program.parseAsync(process.argv).catch((e: unknown) => {
  log.error((e as Error).message);
  if (process.env.OUTREACH_DEBUG) console.error(e);
  process.exit(1);
});
