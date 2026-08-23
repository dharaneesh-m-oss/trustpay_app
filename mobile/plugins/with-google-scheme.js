/**
 * Registers the redirect scheme Google Sign-In returns to on Android.
 *
 * Google does not redirect back to the app's own scheme. It redirects to the
 * *reversed client ID* — an Android client `123-abc.apps.googleusercontent.com`
 * redirects to `com.googleusercontent.apps.123-abc:/oauth2redirect`. If no
 * activity claims that scheme, the browser opens, the user signs in, and then
 * nothing happens: no error, no return, just a browser tab sitting there.
 *
 * That scheme cannot be hardcoded because it contains the client id, which is
 * per-deployment. So it is derived at prebuild time from
 * `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, and when that variable is absent the
 * plugin does nothing — which is correct, since a build with no client id has
 * no sign-in button to return to.
 */

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/** `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc` */
function reversedScheme(clientId) {
  const trimmed = (clientId || '').trim();
  if (!trimmed.endsWith('.apps.googleusercontent.com')) return null;
  const id = trimmed.slice(0, -'.apps.googleusercontent.com'.length);
  if (!id) return null;
  return `com.googleusercontent.apps.${id}`;
}

module.exports = function withGoogleScheme(config) {
  return withAndroidManifest(config, (mod) => {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    const scheme = reversedScheme(clientId);

    if (!scheme) {
      if (clientId) {
        // A value that is set but malformed is worth saying out loud: it will
        // otherwise fail silently at the sign-in screen.
        console.warn(
          '[with-google-scheme] EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is set but ' +
            'does not look like a Google client id, so no redirect scheme was ' +
            'added. Google sign-in will not return to the app.',
        );
      }
      return mod;
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    const activity = (application.activity ?? []).find(
      (entry) => entry.$?.['android:name'] === '.MainActivity',
    );
    if (!activity) return mod;

    activity['intent-filter'] = activity['intent-filter'] ?? [];

    const already = activity['intent-filter'].some((filter) =>
      (filter.data ?? []).some(
        (entry) => entry.$?.['android:scheme'] === scheme,
      ),
    );
    if (already) return mod;

    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ],
      data: [{ $: { 'android:scheme': scheme } }],
    });

    console.log(`[with-google-scheme] registered redirect scheme ${scheme}`);
    return mod;
  });
};

module.exports.reversedScheme = reversedScheme;
