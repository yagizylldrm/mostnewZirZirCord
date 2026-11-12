/**
 * Android screen sharing needs a MediaProjection foreground service.
 * @livekit/react-native-webrtc ships the service; this turns it on in MainApplication
 * and declares it in the manifest.
 *
 * iOS screen sharing needs a Broadcast Upload Extension target (see README → Mobile).
 */
const { withMainApplication, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withScreenShare(config) {
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('WebRTCModuleOptions')) {
      src = src.replace(/^(package .*\n)/m, `$1\nimport com.oney.WebRTCModule.WebRTCModuleOptions\n`);
      src = src.replace(/super\.onCreate\(\)\n?/, (m) => `${m}    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true\n`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.service = app.service ?? [];
      const name = 'com.oney.WebRTCModule.MediaProjectionService';
      if (!app.service.some((s) => s.$['android:name'] === name)) {
        app.service.push({ $: { 'android:name': name, 'android:foregroundServiceType': 'mediaProjection', 'android:exported': 'false' } });
      }
    }
    return cfg;
  });
  return config;
};
