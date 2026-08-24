import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { loadConfig } from "../src/config.js";
import { VERSION, createServer } from "../src/server.js";

async function connectDemoClient() {
  const config = loadConfig({ VOCABIT_DEMO: "1" } as NodeJS.ProcessEnv);
  const server = createServer(config);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("config", () => {
  it("falls back to demo mode when nothing is configured", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).demo).toBe(true);
  });

  it("rejects half a configuration", () => {
    expect(() => loadConfig({ VOCABIT_AGENT_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(/VOCABIT_BASE_URL/);
    expect(() => loadConfig({ VOCABIT_BASE_URL: "https://x.dev" } as NodeJS.ProcessEnv)).toThrow(/VOCABIT_AGENT_KEY/);
  });

  it("rejects a base URL without a scheme", () => {
    expect(() =>
      loadConfig({ VOCABIT_BASE_URL: "x.dev", VOCABIT_AGENT_KEY: "k" } as NodeJS.ProcessEnv),
    ).toThrow(/http/);
  });
});

describe("vocabit-mcp over MCP", () => {
  it("exposes the documented tool surface", async () => {
    const { client } = await connectDemoClient();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_study_set",
      "delete_study_set",
      "get_set_results",
      "get_study_set",
      "list_study_sets",
      "notify_learner",
      "update_study_set",
      "vocabit_health",
    ]);
  });

  it("marks the destructive tool as destructive", async () => {
    const { client } = await connectDemoClient();
    const { tools } = await client.listTools();
    const remove = tools.find((tool) => tool.name === "delete_study_set");
    expect(remove?.annotations?.destructiveHint).toBe(true);
    const list = tools.find((tool) => tool.name === "list_study_sets");
    expect(list?.annotations?.readOnlyHint).toBe(true);
  });

  it("reports demo mode from the health tool", async () => {
    const { client } = await connectDemoClient();
    const result = await client.callTool({ name: "vocabit_health", arguments: {} });
    expect(result.structuredContent).toMatchObject({ mode: "demo" });
  });

  it("runs the whole loop: create, list, analyse, extend", async () => {
    const { client } = await connectDemoClient();

    const created = await client.callTool({
      name: "create_study_set",
      arguments: {
        title: "Dativ prepositions",
        topic: "grammar",
        cards: [
          { term: "mit", definition: "with" },
          { term: "nach", definition: "after, to" },
          { term: "aus", definition: "out of, from" },
          { term: "bei", definition: "at, near" },
          { term: "seit", definition: "since" },
        ],
      },
    });
    const setId = (created.structuredContent as { setId: string }).setId;
    expect(setId).toBeTruthy();
    expect((created.structuredContent as { deepLink: string }).deepLink).toContain(setId);

    const listed = await client.callTool({
      name: "list_study_sets",
      arguments: { topic: "grammar" },
    });
    expect((listed.structuredContent as { count: number }).count).toBe(1);

    const results = await client.callTool({ name: "get_set_results", arguments: { setId } });
    const analysis = results.structuredContent as {
      summary: { totalCards: number; studied: number };
      weakCards: Array<{ term: string }>;
      demoNote?: string;
    };
    expect(analysis.summary.totalCards).toBe(5);
    expect(analysis.summary.studied).toBeGreaterThan(0);
    expect(analysis.demoNote).toMatch(/simulated/i);

    const extended = await client.callTool({
      name: "update_study_set",
      arguments: { setId, addCards: [{ term: "von", definition: "from, of" }] },
    });
    expect(JSON.stringify(extended.content)).toContain("6 cards");
  });

  it("refuses cards and addCards together instead of guessing", async () => {
    const { client } = await connectDemoClient();
    const result = await client.callTool({
      name: "update_study_set",
      arguments: {
        setId: "demo00000000000000a1",
        cards: [{ term: "a", definition: "b" }],
        addCards: [{ term: "c", definition: "d" }],
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("addCards");
  });

  it("returns a recoverable error with a hint for an unknown set", async () => {
    const { client } = await connectDemoClient();
    const result = await client.callTool({ name: "get_set_results", arguments: { setId: "nope" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("list_study_sets");
  });

  it("serves seeded sets as resources", async () => {
    const { client } = await connectDemoClient();
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);
    const read = await client.readResource({ uri: resources[0]!.uri });
    expect(read.contents[0]!.mimeType).toBe("application/json");
  });

  it("ships a study-session prompt", async () => {
    const { client } = await connectDemoClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("study-session");
    const prompt = await client.getPrompt({ name: "study-session", arguments: { topic: "Dativ" } });
    expect(JSON.stringify(prompt.messages)).toContain("get_set_results");
  });
});

describe("release metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const registry = JSON.parse(readFileSync("server.json", "utf8"));

  // The MCP Registry rejects a server.json that disagrees with the published
  // package, so the mismatch is worth catching here rather than at publish time.
  it("keeps package.json, server.json and the advertised version in step", () => {
    expect(VERSION).toBe(pkg.version);
    expect(registry.version).toBe(pkg.version);
    expect(registry.packages[0].version).toBe(pkg.version);
    expect(registry.packages[0].identifier).toBe(pkg.name);
    expect(registry.name).toBe(pkg.mcpName);
  });

  it("stays inside the registry's description limit", () => {
    expect(registry.description.length).toBeLessThanOrEqual(100);
  });
});
