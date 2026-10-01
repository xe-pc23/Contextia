import { z } from 'zod';

export const StoredSessionSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAtEpochSeconds: z.number().int().nonnegative()
});

const TokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresIn: z.number().int().positive()
});

export type StoredSession = z.infer<typeof StoredSessionSchema>;

export function toStoredSession(value: unknown, nowEpochSeconds: number): StoredSession | null {
  const parsed = TokenResponseSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(nowEpochSeconds) || nowEpochSeconds < 0) return null;

  return StoredSessionSchema.parse({
    accessToken: parsed.data.accessToken,
    ...(parsed.data.refreshToken === undefined ? {} : { refreshToken: parsed.data.refreshToken }),
    expiresAtEpochSeconds: Math.floor(nowEpochSeconds) + parsed.data.expiresIn
  });
}

export function parseStoredSession(value: unknown): StoredSession | null {
  const parsed = StoredSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
