import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { addUsage } from "./util/cost.js";
import { log } from "./util/logger.js";
import type { UsageTally } from "./types.js";

export class ModelRefusal extends Error {
  constructor(
    public readonly category: string | null,
    public readonly explanation: string | null,
  ) {
    super(`Claude declined this request${category ? ` (${category})` : ""}: ${explanation ?? "no explanation given"}`);
    this.name = "ModelRefusal";
  }
}

export interface ModelOptions {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Server-side refusal fallback. On a policy decline the API re-runs the same
   * request on the fallback model inside the same call, so a single awkward
   * prospect name doesn't kill a batch run. Disable if your account or gateway
   * rejects the beta.
   */
  refusalFallback: { enabled: boolean; model: string };
  maxContinuations: number;
}

export interface GenerateRequest {
  system: SystemBlock[];
  userPrompt: string;
  /** Anthropic-hosted tools. Passed through untouched. */
  tools?: unknown[];
  maxTokens?: number;
  label: string;
}

export interface SystemBlock {
  text: string;
  /** Mark the last stable block so everything before it is cached. */
  cache?: boolean;
}

/** Thrown when a server tool reports an error instead of results. */
export class ServerToolError extends Error {}

export class Claude {
  private readonly client: Anthropic;

  constructor(
    private readonly opts: ModelOptions,
    private readonly tally: UsageTally,
    client?: Anthropic,
  ) {
    // Zero-arg construction resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
    // or an `ant auth login` profile — in that order, and lazily, so an unset
    // API key is not by itself an error. Missing credentials surface on the
    // first request and are translated in withRetry.
    this.client = client ?? new Anthropic();
  }

  private systemParam(blocks: SystemBlock[]): Anthropic.Beta.BetaTextBlockParam[] {
    return blocks.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: "ephemeral" as const, ttl: "1h" as const } } : {}),
    }));
  }

  private betas(): string[] {
    return this.opts.refusalFallback.enabled ? ["server-side-fallback-2026-06-01"] : [];
  }

  private fallbackParam() {
    return this.opts.refusalFallback.enabled
      ? { fallbacks: [{ model: this.opts.refusalFallback.model }] }
      : {};
  }

  /**
   * Long-form generation, optionally with Anthropic-hosted tools (web search,
   * web fetch). Streams so a large `max_tokens` can't trip the HTTP timeout,
   * and resumes `pause_turn` so a research call that exhausts the server-side
   * tool loop keeps going instead of returning half an answer.
   */
  async generate(req: GenerateRequest): Promise<string> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: req.userPrompt },
    ];

    for (let attempt = 0; attempt <= this.opts.maxContinuations; attempt++) {
      const response = await this.withRetry(req.label, async () => {
        const stream = this.client.beta.messages.stream({
          model: this.opts.model,
          max_tokens: req.maxTokens ?? 32000,
          thinking: { type: "adaptive" },
          output_config: { effort: this.opts.effort },
          system: this.systemParam(req.system),
          messages,
          ...(req.tools ? { tools: req.tools as Anthropic.Beta.BetaToolUnion[] } : {}),
          betas: this.betas(),
          ...this.fallbackParam(),
        });
        return stream.finalMessage();
      });

      addUsage(this.tally, this.opts.model, response.usage);

      if (response.stop_reason === "refusal") {
        const d = response.stop_details as { category?: string; explanation?: string } | null;
        throw new ModelRefusal(d?.category ?? null, d?.explanation ?? null);
      }

      assertNoServerToolErrors(response.content, req.label);

      if (response.stop_reason === "pause_turn") {
        // The server-side tool loop hit its iteration cap. Echo the paused turn
        // back verbatim — no "continue" message; the API resumes on its own.
        log.debug(`${req.label}: pause_turn, resuming (${attempt + 1}/${this.opts.maxContinuations})`);
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason === "max_tokens") {
        log.warn(`${req.label}: hit max_tokens — output may be truncated.`);
      }

      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }

    throw new Error(
      `${req.label}: still paused after ${this.opts.maxContinuations} continuations. ` +
        `Narrow the research scope or raise maxContinuations.`,
    );
  }

  /**
   * Turn prose into a validated object. No tools, no streaming — the input is
   * already in hand, so this is a short, cheap, schema-constrained call.
   */
  async extract<S extends z.ZodType>(args: {
    schema: S;
    schemaName: string;
    system: SystemBlock[];
    userPrompt: string;
    label: string;
    maxTokens?: number;
  }): Promise<z.infer<S>> {
    const response = await this.withRetry(args.label, () =>
      this.client.messages.parse({
        model: this.opts.model,
        max_tokens: args.maxTokens ?? 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: this.opts.effort,
          format: zodOutputFormat(args.schema as never),
        },
        system: this.systemParam(args.system) as unknown as Anthropic.TextBlockParam[],
        messages: [{ role: "user", content: args.userPrompt }],
      }),
    );

    addUsage(this.tally, this.opts.model, response.usage);

    if (response.stop_reason === "refusal") {
      const d = response.stop_details as { category?: string; explanation?: string } | null;
      throw new ModelRefusal(d?.category ?? null, d?.explanation ?? null);
    }
    if (response.parsed_output == null) {
      throw new Error(
        `${args.label}: the model did not return output matching the ${args.schemaName} schema ` +
          `(stop_reason: ${response.stop_reason}).`,
      );
    }
    return response.parsed_output as z.infer<S>;
  }

  /** Retries only what is worth retrying: rate limits, 5xx, and connection drops. */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const delays = [2000, 4000, 8000, 16000];
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (error) {
        // Thrown by the SDK before any request when no credential source
        // resolves. It has no typed class, hence the message check.
        if (!(error instanceof Anthropic.APIError) && /authentication method/i.test((error as Error).message)) {
          throw new Error(
            `No Anthropic credentials found. Copy .env.example to .env and set ANTHROPIC_API_KEY ` +
              `(https://console.anthropic.com/settings/keys), or run \`ant auth login\`.`,
          );
        }
        if (error instanceof Anthropic.BadRequestError) {
          throw new Error(
            `${label}: the API rejected the request — ${error.message}\n` +
              `If this mentions a beta flag or 'fallbacks', set refusalFallback.enabled to false in config/agent.yaml.`,
          );
        }
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error(
            `${label}: authentication failed. Set ANTHROPIC_API_KEY in .env, or run \`ant auth login\`.`,
          );
        }
        if (error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) {
          throw new Error(`${label}: ${error.status} — ${error.message}`);
        }

        const retryable =
          error instanceof Anthropic.RateLimitError ||
          error instanceof Anthropic.InternalServerError ||
          error instanceof Anthropic.APIConnectionError;

        const delay = delays[i];
        if (!retryable || delay === undefined) throw error;

        log.warn(`${label}: ${(error as Error).message} — retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

/**
 * Server tools fail with HTTP 200 and an error object inside the result block,
 * not a thrown exception. A success `content` is an array; an error `content`
 * is an object — branch on that before indexing.
 */
function assertNoServerToolErrors(content: Anthropic.Beta.BetaContentBlock[], label: string): void {
  for (const block of content) {
    if (block.type !== "web_search_tool_result" && block.type !== "web_fetch_tool_result") continue;
    const inner = (block as { content?: unknown }).content;
    if (inner && !Array.isArray(inner) && typeof inner === "object" && "error_code" in inner) {
      const code = String((inner as { error_code: unknown }).error_code);
      if (code === "max_uses_exceeded") {
        log.warn(`${label}: web tool budget exhausted — research continued with what it had.`);
        continue;
      }
      throw new ServerToolError(`${label}: ${block.type} failed with ${code}`);
    }
  }
}
