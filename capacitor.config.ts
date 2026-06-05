import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rebarplanner.app',
  appName: 'Rebar Planner',
  webDir: 'public',
  server: {
    url: 'https://rebar-planner.vercel.app',
    cleartext: false
  }
};

export default config;