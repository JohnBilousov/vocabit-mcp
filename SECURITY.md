# Security Policy

## Supported versions

Only the latest published version on [npm](https://www.npmjs.com/package/vocabit-mcp) is
supported. Please upgrade before reporting an issue.

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/JohnBilousov/vocabit-mcp/security/advisories/new)
(Security tab → "Report a vulnerability") rather than a public issue. You should get a response
within a few days.

## Scope and design notes

- **`VOCABIT_AGENT_KEY` is a bearer credential.** It authenticates as the agent against a specific
  Vocabit backend and can create, modify, and delete study sets, and message the learner on
  Telegram. Treat it like any other API secret — don't commit it, don't log it. The server never
  writes it anywhere but the outgoing `X-Agent-Key` header.
- **Demo mode is entirely local.** With `VOCABIT_DEMO=1` (or no backend configured), nothing
  leaves the process — no network calls are made, and "learner activity" is a deterministic
  simulation, clearly labelled `demoNote` in tool output so it's never mistaken for a real session.
- **This server has no first-class defense against a malicious backend.** `VOCABIT_BASE_URL` is
  trusted input from whoever runs the server — pointing it at an untrusted host would let that
  host see the agent key and any card content sent to it. Only point this at a Vocabit backend you
  control or trust.
- Dependencies are limited to `@modelcontextprotocol/sdk` and `zod`; the HTTP client
  (`src/client/http.ts`) uses the platform `fetch`, not a third-party HTTP library.
