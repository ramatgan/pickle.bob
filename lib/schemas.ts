import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  pin: z.string().min(4).max(32)
});

export const unlockSchema = z.object({
  pin: z.string().min(4).max(32)
});

export const playersMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: z.string().min(1).max(80),
    rating: z.number().min(0).max(8)
  }),
  z.object({
    action: z.literal("presence"),
    updates: z.array(
      z.object({
        playerId: z.string().uuid(),
        isPresent: z.boolean()
      })
    )
  }),
  z.object({
    action: z.literal("update"),
    playerId: z.string().uuid(),
    name: z.string().min(1).max(80).optional(),
    rating: z.number().min(0).max(8).optional()
  })
]);

export const submitScoreSchema = z.object({
  playerIds: z.array(z.string().uuid()).length(4),
  teamA: z.array(z.string().uuid()).length(2),
  teamB: z.array(z.string().uuid()).length(2),
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99)
});

export const editScoreSchema = z.object({
  matchId: z.string().uuid(),
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99)
});
