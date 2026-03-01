import { z } from 'zod';

export const AiHuntSchema = z.object({
  query: z.string().min(1, 'Hunt query is required'),
  context: z.string().optional(),
});

export type AiHuntDto = z.infer<typeof AiHuntSchema>;
