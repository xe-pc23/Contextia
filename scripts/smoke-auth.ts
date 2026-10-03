import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';
import { AuthenticationDetails, CognitoUser, CognitoUserPool, type ICognitoStorage } from 'amazon-cognito-identity-js';

type Environment = Record<string, string | undefined>;
type PasswordLogin = (clientId: string, username: string, password: string) => Promise<string>;
type SrpLogin = (poolId: string, clientId: string, username: string, password: string) => Promise<string>;
export const cognitoSrpLogin: SrpLogin = async (poolId, clientId, username, password) => {
  const values = new Map<string, string>();
  const storage: ICognitoStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => { values.clear(); } };
  const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId, Storage: storage });
  const user = new CognitoUser({ Username: username, Pool: pool, Storage: storage });
  user.setAuthenticationFlowType('USER_SRP_AUTH');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error('Mobile SRP smoke authentication unavailable'));
      timer = setTimeout(fail, 20_000);
      user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
        onSuccess: session => {
          const token = session.getAccessToken();
          const claims = z.object({ client_id: z.literal(clientId), token_use: z.literal('access'), exp: z.number().finite() }).safeParse(token.decodePayload());
          if (!session.isValid() || !token.getJwtToken() || !claims.success || claims.data.exp <= Date.now() / 1000 + 30) { fail(); return; }
          resolve(token.getJwtToken());
        },
        onFailure: fail, newPasswordRequired: fail, mfaRequired: fail, totpRequired: fail,
        customChallenge: fail, mfaSetup: fail, selectMFAType: fail
      });
    });
  } finally { if (timer) clearTimeout(timer); user.signOut(); values.clear(); }
};
export async function smokeMobileAuthentication(env: Environment, poolId: string | undefined, clientId: string | undefined, login: SrpLogin = cognitoSrpLogin): Promise<string> {
  if (env.SMOKE_MOBILE_ACCESS_TOKEN) return env.SMOKE_MOBILE_ACCESS_TOKEN;
  if (!poolId || !clientId || !env.SMOKE_USER_1_USERNAME || !env.SMOKE_USER_1_PASSWORD) throw new Error('Mobile SRP smoke credentials/configuration required');
  return login(poolId, clientId, env.SMOKE_USER_1_USERNAME, env.SMOKE_USER_1_PASSWORD);
}
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
