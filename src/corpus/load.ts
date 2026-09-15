import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { z } from "zod";
import {
  CaseStudySchema,
  ClientRecordSchema,
  CompanyProfileSchema,
  IndustryStyleSchema,
  LocaleProfileSchema,
  type CaseStudy,
  type ClientRecord,
  type CompanyProfile,
  type IndustryStyle,
  type LocaleProfile,
} from "../types.js";
import { formatZodError, readYaml, type AgentConfig } from "../config.js";
import { log } from "../util/logger.js";

export interface Corpus {
  company: CompanyProfile;
  caseStudies: CaseStudy[];
  clients: ClientRecord[];
  locales: LocaleProfile[];
  industries: IndustryStyle[];
}

export function loadCorpus(cfg: AgentConfig): Corpus {
  const company = readYaml(cfg.paths.companyProfile, CompanyProfileSchema, "company profile");
  const locales = readYaml(
    cfg.paths.locales,
    z.object({ locales: z.array(LocaleProfileSchema).min(1) }),
    "locale profiles",
  ).locales;
  const industries = fs.existsSync(cfg.paths.industries)
    ? readYaml(
        cfg.paths.industries,
        z.object({ industries: z.array(IndustryStyleSchema) }),
        "industry styles",
      ).industries
    : [];

  const caseStudies = loadCaseStudies(cfg.paths.caseStudies);
  const clients = loadClients(cfg.paths.clients);

  crossCheck(company, caseStudies);

  log.debug(
    `corpus: ${caseStudies.length} case studies, ${clients.length} clients, ` +
      `${company.services.length} services, ${locales.length} locales, ${industries.length} industry styles`,
  );
  return { company, caseStudies, clients, locales, industries };
}

/**
 * Case studies are markdown with YAML frontmatter: the structured fields the
 * matcher needs up top, the human narrative below. One file per engagement, so
 * they are reviewable in a pull request by people who don't write YAML for fun.
 */
function loadCaseStudies(dir: string): CaseStudy[] {
  if (!fs.existsSync(dir)) throw new Error(`Missing case-study directory: ${path.resolve(dir)}`);

  // Files starting with "_" and README.md are documentation, not engagements.
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
    .sort();
  if (files.length === 0) throw new Error(`No .md case studies found in ${path.resolve(dir)}`);

  const seen = new Set<string>();
  return files.map((file) => {
    const full = path.join(dir, file);
    const { data, content } = matter(fs.readFileSync(full, "utf8"));
    const parsed = CaseStudySchema.safeParse({
      ...data,
      id: data.id ?? path.basename(file, ".md"),
      narrative: content.trim(),
    });
    if (!parsed.success) {
      throw new Error(`Case study ${full} is invalid:\n${formatZodError(parsed.error)}`);
    }
    if (seen.has(parsed.data.id)) throw new Error(`Duplicate case-study id "${parsed.data.id}" (${full})`);
    seen.add(parsed.data.id);

    if (parsed.data.confidentiality === "anonymized" && !parsed.data.anonymousLabel) {
      throw new Error(
        `Case study ${full} is marked "anonymized" but has no anonymousLabel — ` +
          `the drafter needs something safe to call this client.`,
      );
    }
    return parsed.data;
  });
}

/** Minimal CSV reader: quoted fields with embedded commas and doubled quotes. */
function loadClients(file: string): ClientRecord[] {
  if (!fs.existsSync(file)) {
    log.debug(`no client list at ${file} — continuing without one`);
    return [];
  }
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows.shift();
  if (!header) return [];

  return rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((row, i) => {
      const record: Record<string, unknown> = {};
      header.forEach((key, idx) => {
        record[key.trim()] = row[idx]?.trim() ?? "";
      });
      if (typeof record.services === "string") {
        record.services = record.services ? record.services.split(";").map((s) => s.trim()) : [];
      }
      record.nameable = String(record.nameable ?? "").toLowerCase() === "true";
      if (!record.region) delete record.region;
      if (!record.since) delete record.since;

      const parsed = ClientRecordSchema.safeParse(record);
      if (!parsed.success) {
        throw new Error(`${file} row ${i + 2} is invalid:\n${formatZodError(parsed.error)}`);
      }
      return parsed.data;
    });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/** Catch the wiring mistakes that would otherwise show up as a vague email. */
function crossCheck(company: CompanyProfile, caseStudies: CaseStudy[]): void {
  const serviceIds = new Set(company.services.map((s) => s.id));
  const problems: string[] = [];

  for (const cs of caseStudies) {
    for (const used of cs.servicesUsed) {
      if (!serviceIds.has(used)) {
        problems.push(`case study "${cs.id}" references unknown service id "${used}"`);
      }
    }
    if (cs.confidentiality !== "internal_only" && cs.results.every((r) => !r.verified) && cs.results.length > 0) {
      log.warn(
        `case study "${cs.id}" has no verified results — its numbers will be withheld from outbound copy.`,
      );
    }
  }
  if (problems.length) throw new Error(`Reference material is inconsistent:\n  · ${problems.join("\n  · ")}`);
}

export function resolveLocale(locales: LocaleProfile[], country: string | null): LocaleProfile {
  const fallback = locales.find((l) => l.code === "DEFAULT") ?? locales[0]!;
  if (!country) return fallback;
  const needle = country.trim().toLowerCase();
  return (
    locales.find((l) => l.code.toLowerCase() === needle) ??
    locales.find((l) => l.label.toLowerCase() === needle) ??
    fallback
  );
}

export function resolveIndustryStyle(
  industries: IndustryStyle[],
  primary: string,
  subSectors: string[],
): IndustryStyle | null {
  const hay = [primary, ...subSectors].join(" ").toLowerCase();
  return (
    industries.find((s) => hay.includes(s.key.toLowerCase())) ??
    industries.find((s) => s.label.toLowerCase().split(/\s+/).some((w) => w.length > 4 && hay.includes(w))) ??
    industries.find((s) => s.key === "default") ??
    null
  );
}
