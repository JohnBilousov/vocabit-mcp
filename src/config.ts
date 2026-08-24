import type { VocabitClient } from "./client/types.js";

export interface Config {
  demo: boolean;
  baseUrl: string;
  agentKey: string;
  userId?: string;
  termLanguage?: string;
  definitionLanguage?: string;
  telegramId?: number;
  timeoutMs: number;
}

export class ConfigError extends Error {}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Demo mode is explicit (VOCABIT_DEMO=1) or implied: with no base URL and no
 * key there is nothing to talk to, so a first-time user gets a working server
 * instead of a stack trace. Half a config is treated as a mistake, not a hint.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.VOCABIT_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const agentKey = env.VOCABIT_AGENT_KEY?.trim() ?? "";
  const explicitDemo = truthy(env.VOCABIT_DEMO);
  const demo = explicitDemo || (!baseUrl && !agentKey);

  if (!demo) {
    if (!baseUrl) {
      throw new ConfigError(
        "VOCABIT_AGENT_KEY is set but VOCABIT_BASE_URL is missing. Set both, or run with VOCABIT_DEMO=1.",
      );
    }
    if (!agentKey) {
      throw new ConfigError(
        "VOCABIT_BASE_URL is set but VOCABIT_AGENT_KEY is missing. Set both, or run with VOCABIT_DEMO=1.",
      );
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new ConfigError(
        `VOCABIT_BASE_URL must start with http:// or https:// (got "${baseUrl}").`,
      );
    }
  }

  const telegramRaw = env.VOCABIT_TELEGRAM_ID?.trim();
  const telegramId = telegramRaw ? Number(telegramRaw) : undefined;
  if (telegramRaw && !Number.isInteger(telegramId)) {
    throw new ConfigError(`VOCABIT_TELEGRAM_ID must be an integer (got "${telegramRaw}").`);
  }

  const timeoutRaw = env.VOCABIT_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`VOCABIT_TIMEOUT_MS must be a positive number (got "${timeoutRaw}").`);
  }

  return {
    demo,
    baseUrl,
    agentKey,
    userId: env.VOCABIT_USER_ID?.trim() || undefined,
    termLanguage: env.VOCABIT_TERM_LANGUAGE?.trim() || undefined,
    definitionLanguage: env.VOCABIT_DEFINITION_LANGUAGE?.trim() || undefined,
    telegramId,
    timeoutMs,
  };
}

export type ClientFactory = (config: Config) => VocabitClient;
