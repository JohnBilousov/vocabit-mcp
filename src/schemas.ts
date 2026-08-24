import { z } from "zod";

export const MAX_CARDS = 300;

export const cardSchema = z
  .object({
    term: z.string().min(1).max(500).describe("The word or phrase in the language being learned"),
    definition: z.string().min(1).max(1000).describe("Translation or definition, in the learner's own language"),
    example: z.string().max(1000).optional().describe("A short sentence showing the term in use"),
    imageUrl: z.string().max(1000).optional().describe("Optional illustration URL"),
  })
  .describe("One flashcard");

export const visibilitySchema = z.enum(["private", "public"]);

/** Input shapes are exported as raw shapes — that is what registerTool expects. */
export const createStudySetShape = {
  title: z.string().min(1).max(200).describe("Set title as the learner will see it in the app"),
  cards: z
    .array(cardSchema)
    .min(1)
    .max(MAX_CARDS)
    .describe(`The flashcards, 1-${MAX_CARDS}. Keep a set to one theme and around 8-15 cards for a single session`),
  description: z.string().max(2000).optional().describe("Short description shown under the title"),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe("Topic tag used to group sets and to filter them later, e.g. 'church vocabulary'"),
  notes: z
    .string()
    .max(4000)
    .optional()
    .describe("Your own notes about what to check when reviewing results. Never shown to the learner"),
  termLanguage: z.string().max(10).optional().describe("Language of the terms, e.g. 'de'"),
  definitionLanguage: z.string().max(10).optional().describe("Language of the definitions, e.g. 'en'"),
  visibility: visibilitySchema.optional().describe("Defaults to private"),
  userId: z.string().optional().describe("Firebase UID of the learner. Omit to use the server default"),
  notify: z.boolean().optional().describe("Ping the learner on Telegram that the set is ready"),
};

export const listStudySetsShape = {
  limit: z.number().int().min(1).max(100).optional().describe("How many sets to return, newest first (default 20)"),
  topic: z.string().max(500).optional().describe("Only sets with this exact topic tag"),
  includeProgress: z.boolean().optional().describe("Attach a progress summary to each set (default true)"),
  userId: z.string().optional().describe("Firebase UID of the learner. Omit to use the server default"),
};

export const setIdShape = {
  setId: z.string().min(1).describe("Set id returned by create_study_set or list_study_sets"),
};

export const getResultsShape = {
  ...setIdShape,
  userId: z.string().optional().describe("Read progress for a different learner than the set owner"),
};

export const updateStudySetShape = {
  ...setIdShape,
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  cards: z
    .array(cardSchema)
    .max(MAX_CARDS)
    .optional()
    .describe("Replace the whole card list. Cannot be combined with addCards"),
  addCards: z
    .array(cardSchema)
    .max(MAX_CARDS)
    .optional()
    .describe("Append cards to the existing list. Cannot be combined with cards"),
  visibility: visibilitySchema.optional(),
  topic: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
};

export const notifyShape = {
  ...setIdShape,
  text: z.string().max(2000).optional().describe("Custom message. Omit for the default 'your set is ready' ping"),
};

/**
 * Output shapes stay permissive on everything but the identifying fields:
 * a backend that grows a field should not turn a working tool into an error.
 */
export const progressSummaryShape = z.object({
  totalCards: z.number(),
  studied: z.number(),
  notStarted: z.number(),
  struggling: z.number(),
  learning: z.number(),
  mastered: z.number(),
  coveragePercent: z.number(),
  masteryPercent: z.number(),
  totalReviews: z.number().optional(),
  firstActivity: z.number().nullable().optional(),
  lastActivity: z.number().nullable().optional(),
  dueNow: z.number().optional(),
});

export const cardProgressShape = z.object({
  cardId: z.string(),
  term: z.string(),
  definition: z.string(),
  status: z.enum(["new", "struggling", "learning", "mastered"]),
  difficultyScore: z.number().optional(),
  box: z.number().optional(),
  reviewCount: z.number().optional(),
  lastReviewed: z.number().nullable().optional(),
  nextReview: z.number().nullable().optional(),
});

export const createStudySetOutput = {
  setId: z.string(),
  title: z.string(),
  cardCount: z.number(),
  visibility: z.string().optional(),
  userId: z.string().optional(),
  deepLink: z.string().describe("Universal link that opens the set in the app"),
  appSchemeLink: z.string().optional(),
  notified: z.boolean().optional(),
};

export const listStudySetsOutput = {
  count: z.number(),
  sets: z.array(
    z.object({
      setId: z.string(),
      title: z.string(),
      topic: z.string().nullable().optional(),
      cardCount: z.number(),
      visibility: z.string().optional(),
      userId: z.string().optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
      progress: progressSummaryShape.nullable().optional(),
    }),
  ),
};

export const getResultsOutput = {
  setId: z.string(),
  title: z.string(),
  topic: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  completed: z.boolean(),
  summary: progressSummaryShape,
  weakCards: z.array(cardProgressShape),
  untouchedCards: z.array(cardProgressShape).optional(),
  cards: z.array(cardProgressShape).optional(),
  dueCardIds: z.array(z.string()).optional(),
  demoNote: z.string().optional(),
};

export const getStudySetOutput = {
  setId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  cardCount: z.number(),
  cards: z.array(z.object({ id: z.string().optional(), term: z.string(), definition: z.string() })),
  topic: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  deepLink: z.string(),
};

export const updateStudySetOutput = {
  setId: z.string(),
  cardCount: z.number(),
  updated: z.array(z.string()).describe("Which fields changed, e.g. ['title', 'addCards']"),
};

export const notifyLearnerOutput = {
  setId: z.string(),
  notified: z.boolean(),
  telegramId: z.number().optional(),
};

export const deleteStudySetOutput = {
  setId: z.string(),
  deleted: z.boolean(),
};

export type CardInput = z.infer<typeof cardSchema>;
