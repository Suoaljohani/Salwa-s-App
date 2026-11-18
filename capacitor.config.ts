import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.salwa.medstats',
  appName: 'إحصاء سلوى',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0B1E22',
    scheme: 'App',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
