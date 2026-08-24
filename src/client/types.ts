/**
 * Wire types for the Vocabit agent API, plus the client contract the tools
 * depend on. Live and demo clients implement the same interface, so tool code
 * never branches on which mode it is running in.
 */

export interface Card {
  term: string;
  definition: string;
  example?: string;
  imageUrl?: string;
  id?: string;
}

/** Spaced-repetition state a card reaches after the learner reviews it. */
export type CardStatus = "new" | "struggling" | "learning" | "mastered";

export interface CardProgress {
  cardId: string;
  term: string;
  definition: string;
  status: CardStatus;
  difficultyScore: number;
  box: number;
  reviewCount: number;
  lastReviewed: number | null;
  nextReview: number | null;
}

export interface ProgressSummary {
  totalCards: number;
  studied: number;
  notStarted: number;
  struggling: number;
  learning: number;
  mastered: number;
  coveragePercent: number;
  masteryPercent: number;
  totalReviews: number;
  firstActivity: number | null;
  lastActivity: number | null;
  dueNow: number;
}

export interface CreateSetInput {
  title: string;
  cards: Card[];
  description?: string;
  termLanguage?: string;
  definitionLanguage?: string;
  visibility?: "private" | "public";
  userId?: string;
  topic?: string;
  notes?: string;
  creatorName?: string;
  createdBy?: string;
  notify?: boolean;
  telegramId?: number;
}

export interface CreateSetResult {
  success: boolean;
  setId: string;
  title: string;
  cardCount: number;
  userId: string;
  visibility: string;
  /** Universal link — opens the set in the app, falls back to a web page. */
  deepLink: string;
  /** vocabit:// scheme link — only clickable where custom schemes work. */
  appSchemeLink: string;
  notified: boolean;
}

export interface SetSummary {
  setId: string;
  title: string;
  topic: string | null;
  cardCount: number;
  visibility: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  progress?: ProgressSummary | null;
}

export interface ListSetsInput {
  userId?: string;
  topic?: string;
  limit?: number;
  includeProgress?: boolean;
}

export interface ListSetsResult {
  success: boolean;
  count: number;
  sets: SetSummary[];
}

export interface GetSetResult {
  success: boolean;
  set: Record<string, unknown>;
  agentContext: {
    topic: string | null;
    notes: string | null;
    createdBy: string | null;
    trackedByAgent: boolean;
  };
  deepLink: string;
  appSchemeLink: string;
}

export interface SetResults {
  success: boolean;
  setId: string;
  title: string;
  topic: string | null;
  notes: string | null;
  userId: string;
  createdAt: number | null;
  /** True once no card is left in the `new` state. */
  completed: boolean;
  summary: ProgressSummary;
  cards: CardProgress[];
  /** Cards the learner marked "hard" — the ones worth re-teaching. */
  weakCards: CardProgress[];
  untouchedCards: CardProgress[];
  dueCardIds: string[];
}

export interface UpdateSetInput {
  title?: string;
  description?: string;
  /** Full replacement of the card list. Mutually exclusive with addCards. */
  cards?: Card[];
  /** Append to the existing card list. Mutually exclusive with cards. */
  addCards?: Card[];
  visibility?: "private" | "public";
  topic?: string;
  notes?: string;
}

export interface UpdateSetResult {
  success: boolean;
  setId: string;
  cardCount: number;
  updated: string[];
}

export interface DeleteSetResult {
  success: boolean;
  setId: string;
  deleted: boolean;
}

export interface NotifyResult {
  success: boolean;
  setId: string;
  notified: boolean;
  telegramId?: number;
}

export interface HealthResult {
  success: boolean;
  mode: "live" | "demo";
  baseUrl: string | null;
  defaultUserId: string | null;
  [key: string]: unknown;
}

export interface VocabitClient {
  readonly mode: "live" | "demo";
  health(): Promise<HealthResult>;
  createSet(input: CreateSetInput): Promise<CreateSetResult>;
  listSets(input: ListSetsInput): Promise<ListSetsResult>;
  getSet(setId: string): Promise<GetSetResult>;
  getResults(setId: string, userId?: string): Promise<SetResults>;
  updateSet(setId: string, input: UpdateSetInput): Promise<UpdateSetResult>;
  deleteSet(setId: string): Promise<DeleteSetResult>;
  notify(setId: string, text?: string, telegramId?: number): Promise<NotifyResult>;
}

/**
 * Error carrying enough context for the model to fix its own call —
 * status code plus the backend's own message, not a bare "request failed".
 */
export class VocabitApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "VocabitApiError";
  }

  /** Guidance appended to the tool result so the model knows what to do next. */
  get hint(): string {
    switch (this.status) {
      case 400:
        return "The request was rejected as malformed. Check card count (1-300) and that you did not pass both cards and addCards.";
      case 401:
        return "The agent key was missing or wrong. Set VOCABIT_AGENT_KEY, or run the server with VOCABIT_DEMO=1 to try it without a backend.";
      case 404:
        return "No set with that id. Call list_study_sets to see which sets exist.";
      case 502:
        return "The backend reached Firestore or Telegram and got an error. This is usually transient — retry once.";
      case 503:
        return "The agent API is disabled on the backend (no AGENT_API_KEYS configured) or Firestore is unreachable.";
      default:
        return "Unexpected backend error.";
    }
  }
}
