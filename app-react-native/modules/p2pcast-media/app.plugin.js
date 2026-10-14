const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const SERVICE_NAME = 'expo.modules.p2pcastmedia.service.StreamForegroundService';
const PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
];

function withP2PCastMedia(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const usesPermissions = manifest['uses-permission'] ?? [];
    for (const permission of PERMISSIONS) {
      if (!usesPermissions.some((entry) => entry.$?.['android:name'] === permission)) {
        usesPermissions.push({ $: { 'android:name': permission } });
      }
    }
    manifest['uses-permission'] = usesPermissions;

    const application = manifest.application?.[0];
    if (!application) throw new Error('O AndroidManifest não tem uma aplicação configurada.');

    application.service ??= [];
    let service = application.service.find((entry) => entry.$?.['android:name'] === SERVICE_NAME);
    if (!service) {
      service = { $: { 'android:name': SERVICE_NAME } };
      application.service.push(service);
    }
    service.$ = {
      ...service.$,
      'android:name': SERVICE_NAME,
      'android:exported': 'false',
      'android:stopWithTask': 'false',
      'android:foregroundServiceType': 'mediaProjection|camera|microphone',
    };

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity.$ = {
      ...activity.$,
      'android:supportsPictureInPicture': 'true',
      'android:configChanges': Array.from(new Set([
        ...(activity.$['android:configChanges'] ?? '').split('|').filter(Boolean),
        'screenSize',
        'smallestScreenSize',
        'screenLayout',
        'orientation',
        'uiMode',
      ])).join('|'),
    };
    return mod;
  });
}

module.exports = withP2PCastMedia;
