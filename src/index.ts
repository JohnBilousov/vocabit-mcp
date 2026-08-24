#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, loadConfig } from "./config.js";
import { VERSION, createServer } from "./server.js";

const HELP = `vocabit-mcp ${VERSION}

An MCP server for Vocabit: create flashcard sets inside the app and read back
how the learner actually did.

Usage:
  vocabit-mcp              start the server on stdio
  vocabit-mcp --demo       start in demo mode (in-memory, no backend, no key)
  vocabit-mcp --version    print the version
  vocabit-mcp --help       print this message

Environment:
  VOCABIT_BASE_URL         backend base URL, e.g. https://vocabit.example.com
  VOCABIT_AGENT_KEY        agent key (X-Agent-Key) issued by that backend
  VOCABIT_USER_ID          optional Firebase UID of the learner
  VOCABIT_TERM_LANGUAGE    optional default term language, e.g. de
  VOCABIT_DEFINITION_LANGUAGE  optional default definition language, e.g. en
  VOCABIT_TELEGRAM_ID      optional Telegram id for notify_learner
  VOCABIT_TIMEOUT_MS       request timeout, default 20000
  VOCABIT_DEMO=1           force demo mode

With neither VOCABIT_BASE_URL nor VOCABIT_AGENT_KEY set, the server starts in
demo mode so it is useful before it is configured.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes("--demo")) process.env.VOCABIT_DEMO = "1";

  const config = loadConfig();
  const server = createServer(config);

  // stdout is the transport; anything human-readable goes to stderr.
  console.error(
    config.demo
      ? "vocabit-mcp: demo mode — in-memory fixtures, nothing leaves this process."
      : `vocabit-mcp: live mode — ${config.baseUrl}`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`vocabit-mcp: ${error.message}`);
    process.exit(2);
  }
  console.error("vocabit-mcp failed to start:", error);
  process.exit(1);
});
