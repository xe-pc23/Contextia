type CognitoBrowserLogoutInput = {
  authorizationEndpoint: string | undefined;
  clientId: string;
  redirectUri: string;
};

type AuthSessionResult = { type: string };
type OpenAuthSession = (url: string, redirectUri: string) => Promise<AuthSessionResult>;

export function createCognitoLogoutUrl(input: CognitoBrowserLogoutInput): string | null {
  try {
    if (!input.authorizationEndpoint || !input.clientId.trim() || !input.redirectUri.trim()) return null;

    const authorizationUrl = new URL(input.authorizationEndpoint);
    if (
      authorizationUrl.protocol !== 'https:' ||
      authorizationUrl.username ||
      authorizationUrl.password ||
      authorizationUrl.pathname !== '/oauth2/authorize' ||
      authorizationUrl.search ||
      authorizationUrl.hash
    ) return null;

    const logoutUrl = new URL('/logout', authorizationUrl.origin);
    logoutUrl.searchParams.set('client_id', input.clientId);
    logoutUrl.searchParams.set('logout_uri', input.redirectUri);
    return logoutUrl.toString();
  } catch {
    return null;
  }
}

/** Ends the Hosted UI browser session and waits for Cognito's allowlisted app callback. */
export async function performCognitoBrowserLogout(
  input: CognitoBrowserLogoutInput,
  openAuthSession: OpenAuthSession
): Promise<boolean> {
  const logoutUrl = createCognitoLogoutUrl(input);
  if (!logoutUrl) return false;

  try {
    const result = await openAuthSession(logoutUrl, input.redirectUri);
    return result.type === 'success';
  } catch {
    return false;
  }
}
