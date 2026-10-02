import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';

type Environment = Record<string, string | undefined>;
type PasswordLogin = (clientId: string, username: string, password: string) => Promise<string>;
export function smokeMode(stage: 'dev' | 'prod', env: Environment): 'public' | 'authenticated' {
  return z.enum(['public', 'authenticated']).parse(env.SMOKE_MODE ?? (stage === 'dev' ? 'authenticated' : 'public'));
}
export async function cognitoPasswordLogin(clientId: string, username: string, password: string): Promise<string> {
  const value = await new CognitoIdentityProviderClient({ region: 'ap-northeast-1' }).send(new InitiateAuthCommand({ ClientId: clientId, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: username, PASSWORD: password } }));
  if (value.ChallengeName || !value.AuthenticationResult?.AccessToken) throw new Error('Smoke user authentication is not ready');
  return value.AuthenticationResult.AccessToken;
}
/** Return transient tokens directly; never write them into logs, files or workflow outputs. */
export async function smokeAuthentication(env: Environment, clientId: string | undefined, login: PasswordLogin = cognitoPasswordLogin): Promise<{ accessToken: string; secondUserToken: string }> {
  if (env.SMOKE_ACCESS_TOKEN || env.SMOKE_SECOND_USER_ACCESS_TOKEN) {
    if (!env.SMOKE_ACCESS_TOKEN || !env.SMOKE_SECOND_USER_ACCESS_TOKEN || env.SMOKE_ACCESS_TOKEN === env.SMOKE_SECOND_USER_ACCESS_TOKEN) throw new Error('Two smoke users with distinct access tokens are required');
    return { accessToken: env.SMOKE_ACCESS_TOKEN, secondUserToken: env.SMOKE_SECOND_USER_ACCESS_TOKEN };
  }
  const { SMOKE_USER_1_USERNAME: first, SMOKE_USER_1_PASSWORD: firstPassword, SMOKE_USER_2_USERNAME: second, SMOKE_USER_2_PASSWORD: secondPassword } = env;
  if (!clientId || !first || !second || !firstPassword || !secondPassword || first === second) throw new Error('Two smoke users and dev Web client configuration are required');
  const [accessToken, secondUserToken] = await Promise.all([login(clientId, first, firstPassword), login(clientId, second, secondPassword)]);
  if (!accessToken || !secondUserToken || accessToken === secondUserToken) throw new Error('Two smoke users with distinct access tokens are required');
  return { accessToken, secondUserToken };
}
