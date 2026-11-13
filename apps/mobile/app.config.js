/**
 * Wraps app.json. Android only allows plain-HTTP traffic in builds that need it:
 * a dev build pointed at an http:// server (EXPO_PUBLIC_API_URL), or when
 * EXPO_PUBLIC_ALLOW_HTTP=1. Release builds talk to the HTTPS API only.
 */
module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const allowHttp = process.env.EXPO_PUBLIC_ALLOW_HTTP === '1' || apiUrl.startsWith('http://');
  const plugins = (config.plugins ?? []).map((p) =>
    Array.isArray(p) && p[0] === 'expo-build-properties'
      ? [p[0], { ...p[1], android: { ...p[1].android, usesCleartextTraffic: allowHttp } }]
      : p,
  );
  // Every APK that replaces an installed one needs a higher versionCode; CI passes the run number.
  const versionCode = Number(process.env.ANDROID_VERSION_CODE) || config.android?.versionCode || 1;
  return { ...config, android: { ...config.android, versionCode }, plugins };
};
