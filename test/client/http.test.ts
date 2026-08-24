import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../../src/config.js";
import { HttpVocabitClient } from "../../src/client/http.js";
import { VocabitApiError } from "../../src/client/types.js";

function textResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

function jsonResponse(status: number, body: unknown): Response {
  return textResponse(status, JSON.stringify(body));
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    demo: false,
    baseUrl: "https://vocabit.example.com",
    agentKey: "test-agent-key",
    timeoutMs: 5_000,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpVocabitClient — outgoing requests", () => {
  it("sends the agent key on every call, and Content-Type only when there is a body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sets: [] }));
    await new HttpVocabitClient(config()).listSets({});

    const [, getInit] = fetchMock.mock.calls[0]!;
    expect((getInit.headers as Record<string, string>)["X-Agent-Key"]).toBe("test-agent-key");
    expect((getInit.headers as Record<string, string>)["Content-Type"]).toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { setId: "s1" }));
    await new HttpVocabitClient(config()).createSet({ title: "t", cards: [{ term: "a", definition: "b" }] });

    const [, postInit] = fetchMock.mock.calls[1]!;
    expect((postInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(postInit.body as string)).toMatchObject({ title: "t" });
  });

  it("encodes query parameters and omits undefined ones", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sets: [] }));
    await new HttpVocabitClient(config()).listSets({ limit: 5, includeProgress: true, topic: undefined });

    const [url] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("includeProgress")).toBe("true");
    expect(parsed.searchParams.has("topic")).toBe(false);
  });

  it("omits userId from the results query when not given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { summary: {} }));
    await new HttpVocabitClient(config()).getResults("set-1");

    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.has("userId")).toBe(false);
  });

  it("sends an empty object body when notify is called with nothing to say", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { notified: true }));
    await new HttpVocabitClient(config()).notify("set-1");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe("{}");
  });
});

describe("HttpVocabitClient — error responses", () => {
  it("uses the backend's detail message when present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "Set not found" }));

    await expect(new HttpVocabitClient(config()).getSet("missing")).rejects.toMatchObject({
      name: "VocabitApiError",
      status: 404,
      message: "Set not found",
    });
  });

  it("falls back to a bare status when the JSON body has no detail field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { success: false }));

    const error = await new HttpVocabitClient(config()).getSet("x").catch((e) => e as VocabitApiError);
    expect(error.message).toBe("HTTP 503");
    expect(error.detail).toEqual({ success: false });
  });

  it("uses a non-JSON error body as the message directly", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(500, "Internal Server Error"));

    await expect(new HttpVocabitClient(config()).getSet("x")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("falls back to a bare status when the error body is empty", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(401, ""));

    await expect(new HttpVocabitClient(config()).getSet("x")).rejects.toMatchObject({
      status: 401,
      message: "HTTP 401",
    });
  });

  it("attaches a hint the model can act on for a 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "bad key" }));
    const error = await new HttpVocabitClient(config()).getSet("x").catch((e) => e as VocabitApiError);
    expect(error.hint).toMatch(/VOCABIT_DEMO/);
  });
});

describe("HttpVocabitClient — network failures", () => {
  it("reports a timeout distinctly from other network errors", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const promise = new HttpVocabitClient(config({ timeoutMs: 3_000 })).getSet("x");
    const settled = expect(promise).rejects.toThrow(/timed out after 3000ms/);
    await vi.advanceTimersByTimeAsync(3_000);
    await settled;
  });

  it("names the backend URL when the connection itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(new HttpVocabitClient(config()).getSet("x")).rejects.toMatchObject({
      message: expect.stringContaining("https://vocabit.example.com"),
    });
  });
});

describe("HttpVocabitClient — health", () => {
  it("prefers the configured userId over whatever the backend reports", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { defaultUserId: "backend-uid" }));
    const health = await new HttpVocabitClient(config({ userId: "configured-uid" })).health();
    expect(health.defaultUserId).toBe("configured-uid");
    expect(health.mode).toBe("live");
  });

  it("falls back to the backend's own default when none is configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { defaultUserId: "backend-uid" }));
    const health = await new HttpVocabitClient(config()).health();
    expect(health.defaultUserId).toBe("backend-uid");
  });
});
