/**
 * Google Sign-In.
 *
 * The app's only job is to obtain an ID token from Google and hand it to the
 * server. It deliberately does not decide anything: the token is verified
 * server-side against Google's published keys, because anything the app checks
 * a modified app can skip.
 *
 * Two configuration facts decide whether this works at all, and both live with
 * Google rather than in this code:
 *
 *   - The **Android OAuth client** must be registered against this app's
 *     package name and the SHA-1 of the certificate it is signed with. A
 *     debug-signed build and a release-signed build have different SHA-1s, so a
 *     client registered for one will silently reject the other.
 *   - The **web client id** must match what the server verifies against, since
 *     that is the audience baked into the token.
 *
 * When they are missing, `available()` is false and the button is not offered -
 * a sign-in button that cannot work is worse than no button.
 */

import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

// Completes the browser session when control returns to the app. Without this
// the auth screen can be left hanging on some Android versions.
WebBrowser.maybeCompleteAuthSession();

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '';

export function available(): boolean {
  return Boolean(GOOGLE_WEB_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID);
}

/**
 * The hook the sign-in screen uses.
 *
 * Returns a request, the last response, and a prompt function. The ID token is
 * pulled from the response rather than the access token: an access token proves
 * the app can call Google, an ID token is the signed statement about *who the
 * user is*, and only the latter can be verified by our server.
 */
export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    // The server needs an ID token, so ask for one explicitly.
    responseType: AuthSession.ResponseType.IdToken,
    scopes: ['openid', 'profile', 'email'],
  });

  return { request, response, promptAsync };
}

/** The ID token from a completed response, or null if there isn't one. */
export function idTokenFrom(
  response: ReturnType<typeof useGoogleAuth>['response'],
): string | null {
  if (!response || response.type !== 'success') return null;
  const params = response.params as Record<string, string> | undefined;
  return params?.id_token ?? null;
}

/** A message worth showing, or null when the user simply backed out. */
export function errorFrom(
  response: ReturnType<typeof useGoogleAuth>['response'],
): string | null {
  if (!response) return null;
  if (response.type === 'error') {
    return (
      response.error?.message ??
      'Google sign-in did not complete. Please try again.'
    );
  }
  // 'dismiss' and 'cancel' are the user changing their mind, which is not an
  // error and should not be reported as one.
  return null;
}
