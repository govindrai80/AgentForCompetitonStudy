import type { UsageTally } from "../types.js";

/**
 * Published list prices, USD per million tokens, as of the Claude model table
 * this project was written against. Cache reads bill at ~0.1x input and cache
 * writes at ~1.25x input. Treat the output as an estimate for budgeting, not
 * an invoice — the authority is your Anthropic Console usage page.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const emptyTally = (): UsageTally => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  calls: 0,
  estimatedCostUsd: 0,
});

export function addUsage(
  tally: UsageTally,
  model: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): void {
  const p = PRICES[model] ?? PRICES["claude-opus-5"]!;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  tally.calls += 1;
  tally.inputTokens += input;
  tally.outputTokens += output;
  tally.cacheReadTokens += cacheRead;
  tally.cacheCreationTokens += cacheWrite;
  tally.estimatedCostUsd +=
    (input * p.input + cacheRead * p.input * 0.1 + cacheWrite * p.input * 1.25 + output * p.output) /
    1_000_000;
}

export const formatTally = (t: UsageTally): string =>
  `${t.calls} calls · ${t.inputTokens.toLocaleString()} in (+${t.cacheReadTokens.toLocaleString()} cached) · ` +
  `${t.outputTokens.toLocaleString()} out · ~$${t.estimatedCostUsd.toFixed(3)}`;
