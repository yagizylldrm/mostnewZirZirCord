/**
 * Signs the Android release build with our own key instead of the debug key.
 * The key comes from environment variables, so nothing secret lives in the repo:
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 * Without them the release build falls back to the debug key (fine for local testing, not for
 * sharing: updates only install over an app signed with the same key).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'ZZ_RELEASE_SIGNING';

module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARKER)) return cfg;

    g = g.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        // ${MARKER}
        if (System.getenv('ANDROID_KEYSTORE_PATH')) {
            release {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`,
    );
    // Only the release block's debug fallback is replaced (the first match is inside "debug { ... }").
    g = g.replace(
      /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = g;
    return cfg;
  });
};
