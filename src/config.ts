import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const AgentConfigSchema = z.object({
  model: z.string().default("claude-opus-5"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  refusalFallback: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default("claude-opus-4-8"),
    })
    .prefault({}),
  research: z
    .object({
      maxSearches: z.number().int().min(1).max(25).default(12),
      maxFetches: z.number().int().min(0).max(25).default(8),
      maxContinuations: z.number().int().min(0).max(10).default(4),
      allowedDomains: z.array(z.string()).default([]),
      blockedDomains: z.array(z.string()).default([]),
    })
    .prefault({}),
  matching: z
    .object({
      /** How many case studies survive the deterministic prefilter. */
      shortlistSize: z.number().int().min(1).max(50).default(12),
      /** How many make it into the email. Two is usually one too many. */
      maxCited: z.number().int().min(1).max(5).default(2),
    })
    .prefault({}),
  output: z
    .object({
      dir: z.string().default("out"),
      /** Refuse to emit a draft the verifier blocked. */
      failOnBlock: z.boolean().default(true),
    })
    .prefault({}),
  /** Brand used when --brand is not given. */
  defaultBrand: z.string().default("insomniacs"),
  /**
   * Per-brand overrides of `paths`. A brand that omits a path inherits the
   * default, so sibling brands can share a client list while keeping their own
   * profile and case studies.
   */
  brands: z
    .record(
      z.string(),
      z.object({
        companyProfile: z.string().optional(),
        locales: z.string().optional(),
        industries: z.string().optional(),
        caseStudies: z.string().optional(),
        clients: z.string().optional(),
      }),
    )
    .default({}),
  paths: z
    .object({
      companyProfile: z.string().default("config/company.yaml"),
      locales: z.string().default("config/locales.yaml"),
      industries: z.string().default("config/industries.yaml"),
      caseStudies: z.string().default("data/case-studies"),
      clients: z.string().default("data/clients.csv"),
    })
    .prefault({}),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface ResolvedConfig extends AgentConfig {
  /** The brand this run speaks as. */
  activeBrand: string;
}

export function loadAgentConfig(file = "config/agent.yaml", brand?: string): ResolvedConfig {
  const raw = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, "utf8")) ?? {} : {};
  const cfg = AgentConfigSchema.parse(raw);

  const activeBrand = brand ?? cfg.defaultBrand;
  const known = Object.keys(cfg.brands);
  if (known.length && !cfg.brands[activeBrand]) {
    throw new Error(
      `Unknown brand "${activeBrand}". Configured brands: ${known.join(", ")}.`,
    );
  }

  const envModel = process.env.OUTREACH_MODEL?.trim();
  return {
    ...cfg,
    ...(envModel ? { model: envModel } : {}),
    activeBrand,
    paths: { ...cfg.paths, ...(cfg.brands[activeBrand] ?? {}) },
  };
}

export function readYaml<S extends z.ZodType>(file: string, schema: S, what: string): z.infer<S> {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${what}: ${path.resolve(file)}`);
  }
  const parsed = schema.safeParse(YAML.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`${what} (${file}) is invalid:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}
