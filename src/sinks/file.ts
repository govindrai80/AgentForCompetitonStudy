import fs from "node:fs";
import path from "node:path";
import type { RunArtifacts } from "../types.js";

export interface WrittenFiles {
  dir: string;
  brief: string;
  email: string;
  json: string;
}

export function writeRun(
  outDir: string,
  artifacts: RunArtifacts,
  brief: string,
  emailText: string,
): WrittenFiles {
  const stamp = artifacts.startedAt.replace(/[:.]/g, "-");
  const dir = path.join(outDir, `${slug(artifacts.prospect)}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    dir,
    brief: path.join(dir, "brief.md"),
    email: path.join(dir, "email.txt"),
    json: path.join(dir, "run.json"),
  };

  fs.writeFileSync(files.brief, brief, "utf8");
  fs.writeFileSync(files.email, `Subject: ${artifacts.draft.subject}\n\n${emailText}\n`, "utf8");
  fs.writeFileSync(
    files.json,
    JSON.stringify(artifacts, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2),
    "utf8",
  );

  return files;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "prospect";
