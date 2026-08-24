import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Config } from "./config.js";
import { DemoVocabitClient } from "./client/mock.js";
import { HttpVocabitClient } from "./client/http.js";
import { VocabitApiError, type VocabitClient } from "./client/types.js";
import { formatCreated, formatHealth, formatList, formatResults, formatSet } from "./format.js";
import {
  createStudySetOutput,
  createStudySetShape,
  deleteStudySetOutput,
  getResultsOutput,
  getResultsShape,
  getStudySetOutput,
  listStudySetsOutput,
  listStudySetsShape,
  notifyLearnerOutput,
  notifyShape,
  setIdShape,
  updateStudySetOutput,
  updateStudySetShape,
} from "./schemas.js";

export const VERSION = "0.1.3";

export function createClient(config: Config): VocabitClient {
  return config.demo ? new DemoVocabitClient(config) : new HttpVocabitClient(config);
}

/**
 * Turns a thrown error into a tool result the model can recover from: what
 * failed, and what to do about it. Throwing raw would surface a protocol error
 * with no guidance attached.
 */
function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof VocabitApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Vocabit error (${error.status || "network"}): ${error.message}\n${error.hint}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: `Unexpected failure: ${message}` }] };
}

async function run(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return toErrorResult(error);
  }
}

export function createServer(
  config: Config,
  client: VocabitClient = createClient(config),
): McpServer {
  const server = new McpServer(
    { name: "vocabit-mcp", version: VERSION },
    {
      instructions: [
        "Vocabit is a flashcard app. These tools let you build a study set, push it straight to the",
        "learner's phone, and later read back how they actually did — which cards they marked hard,",
        "which they never reached. Use get_set_results before building the next set: the point is the",
        "loop, not one-off generation.",
        config.demo
          ? "Running in DEMO mode: everything is in-memory, nothing reaches a real app or a real learner."
          : "Running against a live backend: created sets appear on a real device and notifications reach a real person.",
      ].join(" "),
    },
  );

  server.registerTool(
    "vocabit_health",
    {
      title: "Check Vocabit connection",
      description:
        "Verify the server can reach Vocabit and report which mode it is in (live backend or in-memory demo). Call this first if anything else fails.",
      outputSchema: {
        mode: z.string(),
        baseUrl: z.string().nullable(),
        defaultUserId: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      run(async () => {
        const health = await client.health();
        return {
          content: [{ type: "text", text: formatHealth(health) }],
          structuredContent: {
            mode: health.mode,
            baseUrl: health.baseUrl ?? null,
            defaultUserId: health.defaultUserId ?? null,
          },
        };
      }),
  );

  server.registerTool(
    "create_study_set",
    {
      title: "Create a study set",
      description:
        "Build a flashcard set and publish it to the learner's Vocabit app. Returns a deep link that opens the set on their device. Prefer one focused topic and 8-15 cards per set — long sets get abandoned. Use the notes field for what you want to check afterwards; the learner never sees it.",
      inputSchema: createStudySetShape,
      outputSchema: createStudySetOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(async () => {
        const result = await client.createSet({
          ...args,
          userId: args.userId ?? config.userId,
          termLanguage: args.termLanguage ?? config.termLanguage,
          definitionLanguage: args.definitionLanguage ?? config.definitionLanguage,
          createdBy: "vocabit-mcp",
        });
        return {
          content: [{ type: "text", text: formatCreated(result) }],
          structuredContent: {
            setId: result.setId,
            title: result.title,
            cardCount: result.cardCount,
            visibility: result.visibility,
            userId: result.userId,
            deepLink: result.deepLink,
            appSchemeLink: result.appSchemeLink,
            notified: result.notified ?? false,
          },
        };
      }),
  );

  server.registerTool(
    "list_study_sets",
    {
      title: "List study sets",
      description:
        "List the sets you created for this learner, newest first, each with a progress summary. Use it to find a setId, or to see at a glance which sets were never opened.",
      inputSchema: listStudySetsShape,
      outputSchema: listStudySetsOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      run(async () => {
        const result = await client.listSets({ ...args, userId: args.userId ?? config.userId });
        return {
          content: [{ type: "text", text: formatList(result) }],
          structuredContent: { count: result.count, sets: result.sets },
        };
      }),
  );

  server.registerTool(
    "get_study_set",
    {
      title: "Get study set contents",
      description:
        "Read the full contents of a set — every card, plus the topic and notes you attached when you created it.",
      inputSchema: setIdShape,
      outputSchema: getStudySetOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ setId }) =>
      run(async () => {
        const result = await client.getSet(setId);
        const set = result.set;
        const cards = Array.isArray(set.cards) ? set.cards : [];
        return {
          content: [{ type: "text", text: formatSet(result) }],
          structuredContent: {
            // The backend's own doc has no guaranteed id field on every shape
            // it can return; the input argument is always correct.
            setId,
            title: typeof set.title === "string" ? set.title : "",
            description: typeof set.description === "string" ? set.description : null,
            cardCount: typeof set.cardCount === "number" ? set.cardCount : cards.length,
            cards: cards.map((card) => {
              const c = card as { id?: unknown; term?: unknown; definition?: unknown };
              return {
                id: typeof c.id === "string" ? c.id : undefined,
                term: typeof c.term === "string" ? c.term : "",
                definition: typeof c.definition === "string" ? c.definition : "",
              };
            }),
            topic: result.agentContext.topic,
            notes: result.agentContext.notes,
            deepLink: result.deepLink,
          },
        };
      }),
  );

  server.registerTool(
    "get_set_results",
    {
      title: "Get how the learner did",
      description:
        "Read back real study results for a set: which cards the learner marked hard (weakCards), which they never reached (untouchedCards), and per-card review counts. This is the feedback half of the loop — read it before writing the next set, and build the follow-up out of weakCards.",
      inputSchema: getResultsShape,
      outputSchema: getResultsOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ setId, userId }) =>
      run(async () => {
        const results = await client.getResults(setId, userId ?? config.userId);
        const demoNote = (results as { demoNote?: string }).demoNote;
        return {
          content: [{ type: "text", text: formatResults(results) }],
          structuredContent: {
            setId: results.setId,
            title: results.title,
            topic: results.topic ?? null,
            notes: results.notes ?? null,
            completed: results.completed,
            summary: results.summary,
            weakCards: results.weakCards,
            untouchedCards: results.untouchedCards,
            cards: results.cards,
            dueCardIds: results.dueCardIds,
            ...(demoNote ? { demoNote } : {}),
          },
        };
      }),
  );

  server.registerTool(
    "update_study_set",
    {
      title: "Update a study set",
      description:
        "Change a set in place: retitle it, retag it, or add cards. Pass addCards to append (the usual case after reviewing results) or cards to replace the list wholesale — never both. Replacing the cards resets what the learner has already studied.",
      inputSchema: updateStudySetShape,
      outputSchema: updateStudySetOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ setId, ...patch }) =>
      run(async () => {
        if (patch.cards && patch.addCards) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Pass either cards (replace the whole list) or addCards (append), not both. To add words after a review, use addCards.",
              },
            ],
          };
        }
        const result = await client.updateSet(setId, patch);
        return {
          content: [
            {
              type: "text",
              text: `Updated ${result.setId}: ${result.updated.join(", ") || "nothing"}. Now ${result.cardCount} cards.`,
            },
          ],
          structuredContent: {
            setId: result.setId,
            cardCount: result.cardCount,
            updated: result.updated,
          },
        };
      }),
  );

  server.registerTool(
    "notify_learner",
    {
      title: "Ping the learner",
      description:
        "Send the learner a Telegram message that a set is waiting. Use sparingly — one ping per set, right after you create it.",
      inputSchema: notifyShape,
      outputSchema: notifyLearnerOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ setId, text }) =>
      run(async () => {
        const result = await client.notify(setId, text, config.telegramId);
        return {
          content: [
            {
              type: "text",
              text: result.notified
                ? `Pinged the learner about ${setId}.`
                : "Notification was not delivered.",
            },
          ],
          structuredContent: {
            setId: result.setId,
            notified: result.notified,
            telegramId: result.telegramId,
          },
        };
      }),
  );

  server.registerTool(
    "delete_study_set",
    {
      title: "Delete a study set",
      description:
        "Remove a set from the learner's app. Study history is kept on the backend, but the set disappears from their device. Ask before calling this.",
      inputSchema: setIdShape,
      outputSchema: deleteStudySetOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ setId }) =>
      run(async () => {
        const result = await client.deleteSet(setId);
        return {
          content: [{ type: "text", text: `Deleted ${result.setId} from the app.` }],
          structuredContent: { setId: result.setId, deleted: result.deleted },
        };
      }),
  );

  server.registerResource(
    "study-set",
    new ResourceTemplate("vocabit://set/{setId}", {
      list: async () => {
        const { sets } = await client.listSets({ limit: 50 });
        return {
          resources: sets.map((set) => ({
            uri: `vocabit://set/${set.setId}`,
            name: set.title,
            description: `${set.cardCount} cards${set.topic ? ` · ${set.topic}` : ""}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Study set",
      description: "The contents of one Vocabit set as JSON.",
      mimeType: "application/json",
    },
    async (uri, { setId }) => {
      const id = Array.isArray(setId) ? setId[0] : setId;
      if (!id) throw new Error(`Malformed resource URI: ${uri.href}`);
      const result = await client.getSet(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.set, null, 2),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "study-session",
    {
      title: "Run a study session",
      description:
        "Teach a topic, publish it as a set, and follow up on the last set's weak cards.",
      argsSchema: {
        topic: z.string().describe("What to study, e.g. 'Dativ prepositions' or 'standup phrases'"),
        language: z.string().optional().describe("Language being learned, e.g. 'German'"),
      },
    },
    ({ topic, language }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Let's do a ${language ?? ""} study session on: ${topic}.`.replace(/\s+/g, " "),
              "",
              "1. Check list_study_sets and pull get_set_results for my most recent set.",
              "2. Teach me the topic briefly, folding in any cards I struggled with last time.",
              "3. Create one set of 8-15 cards with create_study_set, put what to watch for in notes, and give me the deep link.",
              "4. After I tell you I'm done, read get_set_results and build the follow-up from weakCards.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
