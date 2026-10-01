import { z } from 'zod';

const PublicEnvironmentSchema = z.object({
  EXPO_PUBLIC_STAGE: z.enum(['dev', 'prod']).optional(),
  EXPO_PUBLIC_COGNITO_ISSUER: z.string().trim().url().optional(),
  EXPO_PUBLIC_COGNITO_CLIENT_ID: z.string().trim().min(1).optional(),
  EXPO_PUBLIC_COGNITO_REDIRECT_URI: z.string().trim().min(1).optional()
});

export type CognitoConfiguration = {
  stage: 'dev' | 'prod';
  scheme: `contextia-${'dev' | 'prod'}`;
  issuer: string;
  clientId: string;
  redirectUri: string;
};

export function readCognitoConfiguration(environment: unknown): CognitoConfiguration | null {
  const parsed = PublicEnvironmentSchema.safeParse(environment);
  if (!parsed.success) return null;

  const stage = parsed.data.EXPO_PUBLIC_STAGE ?? 'dev';
  const scheme = `contextia-${stage}` as const;
  const issuer = parsed.data.EXPO_PUBLIC_COGNITO_ISSUER;
  const clientId = parsed.data.EXPO_PUBLIC_COGNITO_CLIENT_ID;
  if (!issuer || !clientId) return null;

  try {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== 'https:' || issuerUrl.search || issuerUrl.hash) return null;

    const redirectUri = parsed.data.EXPO_PUBLIC_COGNITO_REDIRECT_URI ?? `${scheme}://auth`;
    const redirectUrl = new URL(redirectUri);
    if (redirectUrl.protocol !== `${scheme}:` || !redirectUrl.host || redirectUrl.search || redirectUrl.hash) return null;

    return { stage, scheme, issuer: issuerUrl.toString().replace(/\/$/, ''), clientId, redirectUri };
  } catch {
    return null;
  }
}
