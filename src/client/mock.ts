import type { Config } from "../config.js";
import {
  VocabitApiError,
  type Card,
  type CardProgress,
  type CardStatus,
  type CreateSetInput,
  type CreateSetResult,
  type DeleteSetResult,
  type GetSetResult,
  type HealthResult,
  type ListSetsInput,
  type ListSetsResult,
  type NotifyResult,
  type ProgressSummary,
  type SetResults,
  type UpdateSetInput,
  type UpdateSetResult,
  type VocabitClient,
} from "./types.js";

const DEMO_HOST = "https://demo.vocabit.app";
const DEMO_USER = "demo-learner-uid";
const MAX_CARDS = 300;
const DAY = 86_400_000;

interface StoredCard extends Card {
  id: string;
  status: CardStatus;
  difficultyScore: number;
  box: number;
  reviewCount: number;
  lastReviewed: number | null;
  nextReview: number | null;
}

interface StoredSet {
  setId: string;
  title: string;
  description?: string;
  topic: string | null;
  notes: string | null;
  cards: StoredCard[];
  visibility: "private" | "public";
  userId: string;
  termLanguage: string;
  definitionLanguage: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** Demo-only: whether the fake learner has already worked through this set. */
  studied: boolean;
}

const SCORE_BY_STATUS: Record<CardStatus, number> = {
  new: 0,
  struggling: 1,
  learning: 2,
  mastered: 3,
};

/** Stable per-term choice so demo output does not change between runs. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function toStoredCard(card: Card, index: number, seed: string): StoredCard {
  return {
    ...card,
    id: card.id ?? hash(`${seed}:${card.term}:${index}`).toString(16).padStart(8, "0").repeat(2).slice(0, 20),
    status: "new",
    difficultyScore: 0,
    box: 0,
    reviewCount: 0,
    lastReviewed: null,
    nextReview: null,
  };
}

/**
 * Deterministic stand-in for a learner working through a set in the app.
 * Roughly a fifth of the cards stay untouched, the rest land on a mix of
 * struggling / learning / mastered — enough for the analysis tools to have
 * something real to chew on.
 */
function simulateStudy(set: StoredSet, now: number): void {
  set.cards.forEach((card, index) => {
    const roll = hash(`${set.setId}:${card.term}`) % 10;
    if (roll < 2) return; // left untouched
    const status: CardStatus = roll < 4 ? "struggling" : roll < 7 ? "learning" : "mastered";
    const reviewCount = status === "struggling" ? 4 : status === "learning" ? 2 : 3;
    const lastReviewed = now - (index % 5) * 3_600_000;
    card.status = status;
    card.difficultyScore = SCORE_BY_STATUS[status];
    card.box = status === "struggling" ? 1 : status === "learning" ? 2 : 4;
    card.reviewCount = reviewCount;
    card.lastReviewed = lastReviewed;
    card.nextReview = lastReviewed + (status === "struggling" ? 0.5 : status === "learning" ? 2 : 7) * DAY;
  });
  set.studied = true;
}

function toCardProgress(card: StoredCard): CardProgress {
  return {
    cardId: card.id,
    term: card.term,
    definition: card.definition,
    status: card.status,
    difficultyScore: card.difficultyScore,
    box: card.box,
    reviewCount: card.reviewCount,
    lastReviewed: card.lastReviewed,
    nextReview: card.nextReview,
  };
}

function buildSummary(cards: StoredCard[], now: number): ProgressSummary {
  const total = cards.length;
  const counts = { new: 0, struggling: 0, learning: 0, mastered: 0 };
  let totalReviews = 0;
  let firstActivity: number | null = null;
  let lastActivity: number | null = null;
  let dueNow = 0;

  for (const card of cards) {
    counts[card.status] += 1;
    totalReviews += card.reviewCount;
    if (card.lastReviewed !== null) {
      firstActivity = firstActivity === null ? card.lastReviewed : Math.min(firstActivity, card.lastReviewed);
      lastActivity = lastActivity === null ? card.lastReviewed : Math.max(lastActivity, card.lastReviewed);
    }
    if (card.nextReview !== null && card.nextReview <= now) dueNow += 1;
  }

  const studied = total - counts.new;
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    totalCards: total,
    studied,
    notStarted: counts.new,
    struggling: counts.struggling,
    learning: counts.learning,
    mastered: counts.mastered,
    coveragePercent: total ? round((studied / total) * 100) : 0,
    masteryPercent: total ? round((counts.mastered / total) * 100) : 0,
    totalReviews,
    firstActivity,
    lastActivity,
    dueNow,
  };
}

const SEED_SETS: Array<{
  setId: string;
  title: string;
  topic: string;
  notes: string;
  termLanguage: string;
  definitionLanguage: string;
  studied: boolean;
  ageDays: number;
  cards: Card[];
}> = [
  {
    setId: "demo00000000000000a1",
    title: "Kirche & Glaube — Grundwortschatz",
    topic: "church vocabulary",
    notes: "Watch the articles and the Dativ prepositions.",
    termLanguage: "de",
    definitionLanguage: "en",
    studied: true,
    ageDays: 3,
    cards: [
      { term: "die Gnade", definition: "grace", example: "Gnade sei mit euch." },
      { term: "der Glaube", definition: "faith", example: "Der Glaube versetzt Berge." },
      { term: "die Gemeinde", definition: "congregation" },
      { term: "die Buße", definition: "repentance" },
      { term: "der Segen", definition: "blessing", example: "Ein Segen für die Familie." },
      { term: "das Gebet", definition: "prayer" },
      { term: "die Barmherzigkeit", definition: "mercy" },
      { term: "der Trost", definition: "comfort, consolation" },
    ],
  },
  {
    setId: "demo00000000000000b2",
    title: "Standup phrases for engineers",
    topic: "workplace english",
    notes: "Freshly pushed to the app; the learner has not opened it yet.",
    termLanguage: "en",
    definitionLanguage: "uk",
    studied: false,
    ageDays: 0,
    cards: [
      { term: "to be blocked on", definition: "залежати від чогось, що заважає рухатись далі", example: "I'm blocked on the API key." },
      { term: "to pick something up", definition: "взяти задачу в роботу" },
      { term: "a heads-up", definition: "попередження заздалегідь", example: "Just a heads-up: deploy is at 5." },
      { term: "to circle back", definition: "повернутись до теми пізніше" },
      { term: "low-hanging fruit", definition: "найпростіші задачі з швидким результатом" },
    ],
  },
];

/**
 * In-memory Vocabit. Same contract as the live client, no network and no key,
 * so `npx vocabit-mcp` is a working server the moment it is installed.
 */
export class DemoVocabitClient implements VocabitClient {
  readonly mode = "demo" as const;
  private readonly sets = new Map<string, StoredSet>();
  private counter = 0;
  private readonly userId: string;
  private readonly now: () => number;

  constructor(config?: Partial<Config>, now: () => number = Date.now) {
    this.userId = config?.userId ?? DEMO_USER;
    this.now = now;
    this.seed(config);
  }

  private seed(config?: Partial<Config>): void {
    const now = this.now();
    for (const template of SEED_SETS) {
      const createdAt = now - template.ageDays * DAY;
      const set: StoredSet = {
        setId: template.setId,
        title: template.title,
        topic: template.topic,
        notes: template.notes,
        cards: template.cards.map((card, index) => toStoredCard(card, index, template.setId)),
        visibility: "private",
        userId: this.userId,
        termLanguage: config?.termLanguage ?? template.termLanguage,
        definitionLanguage: config?.definitionLanguage ?? template.definitionLanguage,
        createdBy: "vocabit-mcp demo",
        createdAt,
        updatedAt: createdAt,
        studied: false,
      };
      if (template.studied) simulateStudy(set, now);
      this.sets.set(set.setId, set);
    }
  }

  private require(setId: string): StoredSet {
    const set = this.sets.get(setId);
    if (!set) throw new VocabitApiError("Set not found", 404);
    return set;
  }

  private nextId(): string {
    this.counter += 1;
    return `demo${String(this.counter).padStart(16, "0")}`;
  }

  private links(setId: string) {
    return {
      deepLink: `${DEMO_HOST}/set/${setId}`,
      appSchemeLink: `vocabit://set/${setId}`,
    };
  }

  async health(): Promise<HealthResult> {
    return {
      success: true,
      mode: "demo",
      baseUrl: null,
      defaultUserId: this.userId,
      sets: this.sets.size,
      note: "Demo mode: everything lives in memory and disappears when the process exits. Set VOCABIT_BASE_URL and VOCABIT_AGENT_KEY to talk to a real backend.",
    };
  }

  async createSet(input: CreateSetInput): Promise<CreateSetResult> {
    if (input.cards.length === 0 || input.cards.length > MAX_CARDS) {
      throw new VocabitApiError(`A set needs between 1 and ${MAX_CARDS} cards (got ${input.cards.length})`, 400);
    }
    const now = this.now();
    const setId = this.nextId();
    const set: StoredSet = {
      setId,
      title: input.title,
      description: input.description,
      topic: input.topic ?? null,
      notes: input.notes ?? null,
      cards: input.cards.map((card, index) => toStoredCard(card, index, setId)),
      visibility: input.visibility ?? "private",
      userId: input.userId ?? this.userId,
      termLanguage: input.termLanguage ?? "de",
      definitionLanguage: input.definitionLanguage ?? "en",
      createdBy: input.createdBy ?? "vocabit-mcp",
      createdAt: now,
      updatedAt: now,
      studied: false,
    };
    this.sets.set(setId, set);

    return {
      success: true,
      setId,
      title: set.title,
      cardCount: set.cards.length,
      userId: set.userId,
      visibility: set.visibility,
      ...this.links(setId),
      notified: Boolean(input.notify),
    };
  }

  async listSets(input: ListSetsInput): Promise<ListSetsResult> {
    const now = this.now();
    const limit = input.limit ?? 20;
    const sets = [...this.sets.values()]
      .filter((set) => !input.topic || set.topic === input.topic)
      .filter((set) => !input.userId || set.userId === input.userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((set) => ({
        setId: set.setId,
        title: set.title,
        topic: set.topic,
        cardCount: set.cards.length,
        visibility: set.visibility,
        userId: set.userId,
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
        progress: input.includeProgress === false ? null : buildSummary(set.cards, now),
      }));

    return { success: true, count: sets.length, sets };
  }

  async getSet(setId: string): Promise<GetSetResult> {
    const set = this.require(setId);
    return {
      success: true,
      set: {
        id: set.setId,
        title: set.title,
        description: set.description ?? null,
        userId: set.userId,
        visibility: set.visibility,
        termLanguage: set.termLanguage,
        definitionLanguage: set.definitionLanguage,
        cardCount: set.cards.length,
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
        createdByAgent: true,
        agentTopic: set.topic,
        cards: set.cards.map(({ id, term, definition, example, imageUrl }) => ({
          id,
          term,
          definition,
          ...(example ? { example } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        })),
      },
      agentContext: {
        topic: set.topic,
        notes: set.notes,
        createdBy: set.createdBy,
        trackedByAgent: true,
      },
      ...this.links(setId),
    };
  }

  /**
   * Demo behaviour: the first time results are requested for a set nobody has
   * studied yet, a fake learner works through it. That makes the full loop —
   * create, study, analyse — visible in a single session. The response is
   * flagged so nobody mistakes simulated activity for real learner data.
   */
  async getResults(setId: string, userId?: string): Promise<SetResults> {
    const set = this.require(setId);
    const now = this.now();
    let simulated = false;
    if (!set.studied) {
      simulateStudy(set, now);
      simulated = true;
    }

    const cards = set.cards.map(toCardProgress);
    const summary = buildSummary(set.cards, now);

    return {
      success: true,
      setId,
      title: set.title,
      topic: set.topic,
      notes: set.notes,
      userId: userId ?? set.userId,
      createdAt: set.createdAt,
      completed: summary.notStarted === 0,
      summary,
      cards,
      weakCards: cards.filter((card) => card.status === "struggling"),
      untouchedCards: cards.filter((card) => card.status === "new"),
      dueCardIds: cards.filter((card) => card.nextReview !== null && card.nextReview <= now).map((card) => card.cardId),
      ...(simulated
        ? { demoNote: "Demo mode: this learner activity was simulated, not recorded from a real app session." }
        : {}),
    } as SetResults;
  }

  async updateSet(setId: string, input: UpdateSetInput): Promise<UpdateSetResult> {
    const set = this.require(setId);
    if (input.cards && input.addCards) {
      throw new VocabitApiError("Pass either cards (full replacement) or addCards (append), not both", 400);
    }

    const updated: string[] = [];
    if (input.title !== undefined) (set.title = input.title), updated.push("title");
    if (input.description !== undefined) (set.description = input.description), updated.push("description");
    if (input.visibility !== undefined) (set.visibility = input.visibility), updated.push("visibility");
    if (input.topic !== undefined) (set.topic = input.topic), updated.push("topic");
    if (input.notes !== undefined) (set.notes = input.notes), updated.push("notes");

    if (input.cards) {
      if (input.cards.length > MAX_CARDS) throw new VocabitApiError(`A set holds at most ${MAX_CARDS} cards`, 400);
      set.cards = input.cards.map((card, index) => toStoredCard(card, index, setId));
      set.studied = false;
      updated.push("cards");
    }
    if (input.addCards) {
      if (set.cards.length + input.addCards.length > MAX_CARDS) {
        throw new VocabitApiError(`A set holds at most ${MAX_CARDS} cards`, 400);
      }
      const offset = set.cards.length;
      set.cards.push(...input.addCards.map((card, index) => toStoredCard(card, offset + index, setId)));
      updated.push("addCards");
    }

    set.updatedAt = this.now();
    return { success: true, setId, cardCount: set.cards.length, updated };
  }

  async deleteSet(setId: string): Promise<DeleteSetResult> {
    this.require(setId);
    this.sets.delete(setId);
    return { success: true, setId, deleted: true };
  }

  async notify(setId: string, _text?: string, telegramId?: number): Promise<NotifyResult> {
    this.require(setId);
    return { success: true, setId, notified: true, ...(telegramId ? { telegramId } : {}) };
  }
}
