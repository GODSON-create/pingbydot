import type { CapacitorConfig } from "@capacitor/cli";

const devServerUrl = process.env["CAPACITOR_SERVER_URL"]?.trim();

const config: CapacitorConfig = {
  appId: "app.lovable.pingbydot",
  appName: "Ping by DOT",
  webDir: ".output/mobile",
  server: {
    ...(devServerUrl
      ? {
          url: devServerUrl,
          cleartext: devServerUrl.startsWith("http://"),
        }
      : {}),
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: false,
      backgroundColor: "#090B0A",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#090B0A",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "body",
      style: "DARK",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
