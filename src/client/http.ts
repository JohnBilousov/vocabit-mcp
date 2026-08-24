import type { Config } from "../config.js";
import {
  VocabitApiError,
  type CreateSetInput,
  type CreateSetResult,
  type DeleteSetResult,
  type GetSetResult,
  type HealthResult,
  type ListSetsInput,
  type ListSetsResult,
  type NotifyResult,
  type SetResults,
  type UpdateSetInput,
  type UpdateSetResult,
  type VocabitClient,
} from "./types.js";

/** Talks to a real Vocabit backend at {baseUrl}/api/v1/agent. */
export class HttpVocabitClient implements VocabitClient {
  readonly mode = "live" as const;
  private readonly api: string;

  constructor(private readonly config: Config) {
    this.api = `${config.baseUrl}/api/v1/agent`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> {
    const url = new URL(this.api + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "X-Agent-Key": this.config.agentKey,
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `timed out after ${this.config.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new VocabitApiError(
        `Could not reach the Vocabit backend at ${this.config.baseUrl}: ${reason}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let parsed: unknown = undefined;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object" && "detail" in parsed
          ? (parsed as { detail: unknown }).detail
          : parsed;
      const message = typeof detail === "string" ? detail : `HTTP ${response.status}`;
      throw new VocabitApiError(message, response.status, detail);
    }

    return parsed as T;
  }

  async health(): Promise<HealthResult> {
    const result = await this.request<Record<string, unknown>>("GET", "/health");
    return {
      ...result,
      success: true,
      mode: "live",
      baseUrl: this.config.baseUrl,
      defaultUserId: this.config.userId ?? (result.defaultUserId as string | undefined) ?? null,
    };
  }

  createSet(input: CreateSetInput): Promise<CreateSetResult> {
    return this.request<CreateSetResult>("POST", "/sets", { body: input });
  }

  listSets(input: ListSetsInput): Promise<ListSetsResult> {
    return this.request<ListSetsResult>("GET", "/sets", {
      query: {
        userId: input.userId,
        topic: input.topic,
        limit: input.limit,
        includeProgress: input.includeProgress,
      },
    });
  }

  getSet(setId: string): Promise<GetSetResult> {
    return this.request<GetSetResult>("GET", `/sets/${encodeURIComponent(setId)}`);
  }

  getResults(setId: string, userId?: string): Promise<SetResults> {
    return this.request<SetResults>("GET", `/sets/${encodeURIComponent(setId)}/results`, {
      query: { userId },
    });
  }

  updateSet(setId: string, input: UpdateSetInput): Promise<UpdateSetResult> {
    return this.request<UpdateSetResult>("PATCH", `/sets/${encodeURIComponent(setId)}`, {
      body: input,
    });
  }

  deleteSet(setId: string): Promise<DeleteSetResult> {
    return this.request<DeleteSetResult>("DELETE", `/sets/${encodeURIComponent(setId)}`);
  }

  notify(setId: string, text?: string, telegramId?: number): Promise<NotifyResult> {
    return this.request<NotifyResult>("POST", `/sets/${encodeURIComponent(setId)}/notify`, {
      body: { ...(text ? { text } : {}), ...(telegramId ? { telegramId } : {}) },
    });
  }
}
