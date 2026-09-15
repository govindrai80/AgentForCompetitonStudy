import pc from "picocolors";

let verbose = false;
export const setVerbose = (v: boolean) => {
  verbose = v;
};

const stamp = () => pc.dim(new Date().toISOString().slice(11, 19));

export const log = {
  step: (n: number, total: number, msg: string) =>
    console.error(`${stamp()} ${pc.cyan(`[${n}/${total}]`)} ${msg}`),
  info: (msg: string) => console.error(`${stamp()} ${msg}`),
  ok: (msg: string) => console.error(`${stamp()} ${pc.green("✓")} ${msg}`),
  warn: (msg: string) => console.error(`${stamp()} ${pc.yellow("!")} ${msg}`),
  error: (msg: string) => console.error(`${stamp()} ${pc.red("✗")} ${msg}`),
  debug: (msg: string) => {
    if (verbose) console.error(`${stamp()} ${pc.dim(msg)}`);
  },
};
