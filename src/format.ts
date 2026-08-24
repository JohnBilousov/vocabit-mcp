import type {
  CardProgress,
  CreateSetResult,
  ListSetsResult,
  ProgressSummary,
  SetResults,
} from "./client/types.js";

/**
 * Tool results carry structuredContent for the model and a short text block
 * for the human reading the transcript. The text is a summary, never a dump of
 * the JSON that sits right next to it.
 */

export function formatCreated(result: CreateSetResult): string {
  const lines = [
    `Created "${result.title}" with ${result.cardCount} card${result.cardCount === 1 ? "" : "s"}.`,
    `Open on the learner's device: ${result.deepLink}`,
  ];
  if (result.notified) lines.push("Telegram ping sent.");
  lines.push("Progress only appears once the set is worked through in the app's Learn Mode.");
  return lines.join("\n");
}

function summaryLine(progress: ProgressSummary): string {
  return [
    `${progress.studied}/${progress.totalCards} studied`,
    `${progress.mastered} mastered`,
    `${progress.learning} learning`,
    `${progress.struggling} struggling`,
    `${progress.notStarted} untouched`,
  ].join(" · ");
}

export function formatList(result: ListSetsResult): string {
  if (result.count === 0) return "No sets yet.";
  const lines = result.sets.map((set) => {
    const head = `${set.title} (${set.setId}) — ${set.cardCount} cards${set.topic ? `, topic: ${set.topic}` : ""}`;
    return set.progress ? `${head}\n    ${summaryLine(set.progress)}` : head;
  });
  return [`${result.count} set${result.count === 1 ? "" : "s"}:`, ...lines.map((line) => `  • ${line}`)].join("\n");
}

function cardLine(card: CardProgress): string {
  const reviews = card.reviewCount ? ` — ${card.reviewCount} review${card.reviewCount === 1 ? "" : "s"}` : "";
  return `  • ${card.term} — ${card.definition}${reviews}`;
}

export function formatResults(results: SetResults): string {
  const { summary } = results;
  const lines = [`"${results.title}" — ${summaryLine(summary)}`];

  if (summary.studied === 0) {
    lines.push("The learner has not opened this set yet, so there is nothing to analyse.");
    return lines.join("\n");
  }

  lines.push(`Coverage ${summary.coveragePercent}% · mastery ${summary.masteryPercent}%`);

  if (results.weakCards.length > 0) {
    lines.push(`\nStruggling with ${results.weakCards.length}:`);
    lines.push(...results.weakCards.slice(0, 15).map(cardLine));
    if (results.weakCards.length > 15) lines.push(`  … and ${results.weakCards.length - 15} more`);
  } else {
    lines.push("\nNothing marked hard.");
  }

  const untouched = results.untouchedCards ?? [];
  if (untouched.length > 0) {
    lines.push(`\nNot reached yet: ${untouched.slice(0, 10).map((card) => card.term).join(", ")}`);
  }

  if (results.completed) lines.push("\nEvery card has been reviewed at least once.");

  const demoNote = (results as SetResults & { demoNote?: string }).demoNote;
  if (demoNote) lines.push(`\n${demoNote}`);

  return lines.join("\n");
}

export function formatHealth(health: Record<string, unknown>): string {
  const mode = health.mode === "demo" ? "demo (in-memory, no backend)" : `live → ${health.baseUrl}`;
  const lines = [`Vocabit MCP is up in ${mode} mode.`];
  if (health.defaultUserId) lines.push(`Default learner: ${health.defaultUserId}`);
  if (typeof health.note === "string") lines.push(health.note);
  return lines.join("\n");
}
