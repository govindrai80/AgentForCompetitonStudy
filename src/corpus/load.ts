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
import { formatZodError, readYaml, type AgentConfig, type ResolvedConfig } from "../config.js";
import { log } from "../util/logger.js";

export interface Corpus {
  /** The brand this corpus speaks as. */
  brand: string;
  company: CompanyProfile;
  caseStudies: CaseStudy[];
  clients: ClientRecord[];
  locales: LocaleProfile[];
  industries: IndustryStyle[];
}

export function loadCorpus(cfg: AgentConfig | ResolvedConfig): Corpus {
  const company = readYaml(cfg.paths.companyProfile, CompanyProfileSchema, "company profile");
  const activeBrand = "activeBrand" in cfg ? cfg.activeBrand : company.brand;
  if (company.brand !== activeBrand) {
    throw new Error(
      `Brand mismatch: --brand resolved to "${activeBrand}" but ${cfg.paths.companyProfile} declares brand "${company.brand}".`,
    );
  }
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

  crossCheck(company, caseStudies, activeBrand);

  log.debug(
    `corpus[${activeBrand}]: ${caseStudies.length} case studies, ${clients.length} clients, ` +
      `${company.services.length} services, ${locales.length} locales, ${industries.length} industry styles`,
  );
  return { brand: activeBrand, company, caseStudies, clients, locales, industries };
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
  // Strip "#" comment lines so the file can document its own conventions.
  const text = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const rows = parseCsv(text);
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
      if (!record.brand) delete record.brand;
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
function crossCheck(company: CompanyProfile, caseStudies: CaseStudy[], activeBrand: string): void {
  const serviceIds = new Set(company.services.map((s) => s.id));
  const problems: string[] = [];

  for (const cs of caseStudies) {
    // Service ids are per brand, so only check the ones this brand owns. A
    // sibling's engagement is still loaded — the competitor scan needs it — but
    // its service ids belong to that sibling's profile, not this one.
    if (cs.brand && cs.brand !== activeBrand) continue;
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

/**
 * Resolve the locale profile, city first.
 *
 * Country-level calibration is too coarse where the real differences are
 * metro-level — a Mumbai developer and a Bengaluru developer buy differently
 * enough that one "India" profile would flatten the thing that makes the email
 * land. An explicit override beats both.
 */
export function resolveLocale(
  locales: LocaleProfile[],
  country: string | null,
  city?: string | null,
): LocaleProfile {
  const fallback = locales.find((l) => l.code === "DEFAULT") ?? locales[0]!;
  const byName = (needle: string) =>
    locales.find((l) => l.code.toLowerCase() === needle) ??
    locales.find((l) => l.label.toLowerCase() === needle) ??
    // "Mumbai" should reach "Mumbai Metropolitan Region".
    locales.find((l) => l.label.toLowerCase().includes(needle) && needle.length >= 4);

  for (const candidate of [city, country]) {
    if (!candidate) continue;
    const hit = byName(candidate.trim().toLowerCase());
    if (hit) return hit;
  }
  return fallback;
}

/**
 * Pick the register profile, most specific first.
 *
 * Sub-sectors are checked before the primary industry, because the generic
 * segment would otherwise shadow the specific one: a luxury residential
 * developer matched "real estate" before it ever reached "luxury", and got the
 * blander of the two profiles.
 */
export function resolveIndustryStyle(
  industries: IndustryStyle[],
  primary: string,
  subSectors: string[],
): IndustryStyle | null {
  const fallback = industries.find((s) => s.key === "default") ?? null;
  const generic = (s: IndustryStyle) => s.key === "default";

  const matchIn = (text: string) => {
    const hay = text.toLowerCase();
    // Longest key first, so "plotted development" beats "plotted".
    return [...industries]
      .filter((s) => !generic(s))
      .sort((a, b) => b.key.length - a.key.length)
      .find((s) => hay.includes(s.key.toLowerCase()));
  };

  return (
    matchIn(subSectors.join(" ")) ??
    matchIn(primary) ??
    industries.find(
      (s) => !generic(s) && s.label.toLowerCase().split(/\s+/).some((w) => w.length > 4 && primary.toLowerCase().includes(w)),
    ) ??
    fallback
  );
}
