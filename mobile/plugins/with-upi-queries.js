/**
 * Declares the UPI apps this app needs to see.
 *
 * Android 11 (API 30) made other installed apps invisible by default. Without a
 * matching `<queries>` entry, `Linking.canOpenURL('upi://pay?...')` returns
 * false even when GPay is installed and would have handled it perfectly well.
 *
 * The symptom is not an error. The UPI app list simply comes back empty and the
 * screen says no UPI apps were found, on a phone with three of them. That is a
 * miserable thing to debug from the app side, because every line of JavaScript
 * involved is correct.
 *
 * Two kinds of entry are declared:
 *   - the `upi://` intent, which covers every compliant UPI app at once;
 *   - the specific packages, so the app can offer "Google Pay" by name rather
 *     than handing the user a system chooser.
 *
 * Package visibility is not a permission - nothing here grants access to those
 * apps' data. It only lets this app ask whether they can handle a payment.
 */

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const UPI_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay
  'com.phonepe.app', // PhonePe
  'net.one97.paytm', // Paytm
  'in.org.npci.upiapp', // BHIM
  'in.amazon.mShop.android.shopping', // Amazon Pay
  'com.myairtelapp', // Airtel Thanks
];

const UPI_SCHEMES = ['upi', 'tez', 'phonepe', 'paytmmp'];

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];

    queries.package = queries.package ?? [];
    queries.intent = queries.intent ?? [];

    const declared = new Set(
      queries.package.map((entry) => entry.$?.['android:name']),
    );
    for (const name of UPI_PACKAGES) {
      if (!declared.has(name)) {
        queries.package.push({ $: { 'android:name': name } });
      }
    }

    const schemes = new Set(
      queries.intent
        .flatMap((entry) => entry.data ?? [])
        .map((entry) => entry.$?.['android:scheme']),
    );
    for (const scheme of UPI_SCHEMES) {
      if (schemes.has(scheme)) continue;
      queries.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      });
    }

    return mod;
  });
};

// Re-exported so the plugin can be referenced without duplicating the list.
module.exports.UPI_PACKAGES = UPI_PACKAGES;
module.exports.UPI_SCHEMES = UPI_SCHEMES;
