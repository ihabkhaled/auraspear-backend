import { z } from 'zod';

export const CreateNoteSchema = z.object({
  body: z.string().min(1, 'Note body is required'),
});

export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;
