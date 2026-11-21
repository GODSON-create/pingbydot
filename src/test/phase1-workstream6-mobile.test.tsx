import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const browserOpenMock = vi.fn().mockResolvedValue(undefined);
const browserCloseMock = vi.fn().mockResolvedValue(undefined);
const statusBarMock = {
  setStyle: vi.fn().mockResolvedValue(undefined),
  setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  setBackgroundColor: vi.fn().mockResolvedValue(undefined),
};
const splashMock = { hide: vi.fn().mockResolvedValue(undefined) };
const networkMock = {
  getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: "wifi" }),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
};
const keyboardMock = {
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
};
const appListeners = new Map<string, (payload: any) => void>();
const appMock = {
  exitApp: vi.fn(),
  addListener: vi.fn().mockImplementation(async (event: string, cb: (payload: any) => void) => {
    appListeners.set(event, cb);
    return { remove: vi.fn() };
  }),
};
const cameraMock = {
  checkPermissions: vi.fn().mockResolvedValue({ camera: "prompt", photos: "prompt" }),
  requestPermissions: vi.fn().mockResolvedValue({ camera: "granted", photos: "granted" }),
  chooseFromGallery: vi.fn().mockResolvedValue({
    results: [
      {
        type: "photo",
        saved: false,
        webPath: "https://localhost/_capacitor_file_/pic.jpg",
        metadata: { format: "jpeg" },
      },
    ],
  }),
  takePhoto: vi.fn().mockResolvedValue({
    type: "photo",
    saved: false,
    webPath: "https://localhost/_capacitor_file_/pic.jpg",
    metadata: { format: "jpeg" },
  }),
};
const pushListeners = new Map<string, (payload: any) => void>();
const pushMock = {
  checkPermissions: vi.fn().mockResolvedValue({ receive: "prompt" }),
  requestPermissions: vi.fn().mockResolvedValue({ receive: "granted" }),
  register: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn().mockImplementation(async (event: string, cb: (payload: any) => void) => {
    pushListeners.set(event, cb);
    return { remove: vi.fn() };
  }),
};

const root = process.cwd();
const readRepo = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

describe("Phase 1 Workstream 6: Native Mobile Application & Distribution Readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appListeners.clear();
    pushListeners.clear();
    vi.resetModules();
  });

  it("configures native package identity, offline webDir, brand assets, entitlements, and signing hygiene", () => {
    const capConfig = readRepo("capacitor.config.ts");
    expect(capConfig).toContain('appId: "app.lovable.pingbydot"');
    expect(capConfig).toContain('appName: "Ping by DOT"');
    expect(capConfig).toContain('webDir: ".output/mobile"');
    expect(capConfig).not.toContain('url: "https://pingbydot.lovable.app"');

    const stringsXml = readRepo("android/app/src/main/res/values/strings.xml");
    expect(stringsXml).toContain('<string name="package_name">app.lovable.pingbydot</string>');
    expect(stringsXml).toContain('<string name="custom_url_scheme">pingbydot</string>');

    const manifest = readRepo("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
    expect(manifest).toContain("android.support.customtabs.action.CustomTabsService");

    const buildGradle = readRepo("android/app/build.gradle");
    expect(buildGradle).toContain('applicationId "app.lovable.pingbydot"');
    expect(buildGradle).toContain("minifyEnabled true");
    expect(buildGradle).toContain("shrinkResources true");
    expect(buildGradle).toContain("keystore.properties");

    const androidIgnore = readRepo("android/.gitignore");
    expect(androidIgnore).toMatch(/^\*\.keystore/m);
    expect(androidIgnore).toMatch(/^\*\.jks/m);
    expect(androidIgnore).toMatch(/^keystore\.properties/m);

    const rootIgnore = readRepo(".gitignore");
    expect(rootIgnore).toMatch(/^\*\.keystore/m);
    expect(rootIgnore).toMatch(/^\*\.jks/m);
    expect(rootIgnore).toMatch(/^\*\.p8/m);

    const iosPlist = readRepo("ios/App/App/Info.plist");
    expect(iosPlist).toContain("<string>Ping by DOT</string>");
    expect(iosPlist).toContain("<string>pingbydot</string>");
    expect(iosPlist).toContain("<key>ITSAppUsesNonExemptEncryption</key>");

    const entitlements = readRepo("ios/App/App/App.entitlements");
    expect(entitlements).toContain("aps-environment");
    expect(entitlements).toContain("applinks:pingbydot.lovable.app");

    const pbxproj = readRepo("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbxproj).toContain("PRODUCT_BUNDLE_IDENTIFIER = app.lovable.pingbydot;");
    expect(pbxproj).toContain("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;");

    expect(
      fs.existsSync(path.resolve(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png")),
    ).toBe(true);
    expect(fs.existsSync(path.resolve(root, "android/app/src/main/res/drawable/splash.png"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.resolve(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
      ),
    ).toBe(true);
  });

  it("handles native OAuth redirect URIs, in-app browser close, hardware back interception, and opt-in push & camera", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      },
    }));
    vi.doMock("@capacitor/app", () => ({ App: appMock }));
    vi.doMock("@capacitor/browser", () => ({
      Browser: { open: browserOpenMock, close: browserCloseMock },
    }));
    vi.doMock("@capacitor/status-bar", () => ({
      StatusBar: statusBarMock,
      Style: { Dark: "DARK" },
    }));
    vi.doMock("@capacitor/splash-screen", () => ({ SplashScreen: splashMock }));
    vi.doMock("@capacitor/network", () => ({ Network: networkMock }));
    vi.doMock("@capacitor/keyboard", () => ({ Keyboard: keyboardMock }));
    vi.doMock("@capacitor/camera", () => ({
      Camera: cameraMock,
      MediaType: { Photo: "photo", Video: "video" },
      MediaTypeSelection: { Photo: "photo", Video: "video", All: "all" },
      CameraErrorCode: {
        ChooseMediaCancelled: "OS-PLUG-CAMR-0005",
        TakePhotoCancelled: "OS-PLUG-CAMR-0003",
        RecordVideoCancelled: "OS-PLUG-CAMR-0006",
        EditPhotoCancelled: "OS-PLUG-CAMR-0007",
        CameraPermissionDenied: "OS-PLUG-CAMR-0017",
        GalleryPermissionDenied: "OS-PLUG-CAMR-0020",
        NoCameraAvailable: "OS-PLUG-CAMR-0010",
      },
    }));
    vi.doMock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
    vi.doMock("@capacitor/push-notifications", () => ({ PushNotifications: pushMock }));

    const native = await import("@/lib/native");
    const navigate = vi.fn();
    const backIntercept = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(native.getAuthRedirectUri("/explore")).toBe("pingbydot://login?next=%2Fexplore");
    expect(native.getSignupConfirmationRedirectUri("/hubs")).toBe(
      "https://pingbydot.lovable.app/login?next=%2Fonboarding%3Fnext%3D%252Fhubs",
    );

    await native.openNativeAuthBrowser("https://accounts.google.com/o/oauth2/auth");
    expect(browserOpenMock).toHaveBeenCalledWith({
      url: "https://accounts.google.com/o/oauth2/auth",
      presentationStyle: "popover",
    });

    await native.initializeNativeApp(navigate, backIntercept);
    expect(pushMock.requestPermissions).not.toHaveBeenCalled();

    // OAuth callback closes in-app browser and navigates cleanly
    appListeners.get("appUrlOpen")?.({ url: "pingbydot://login?code=pkce_test&next=%2Fexplore" });
    expect(browserCloseMock).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login?code=pkce_test&next=%2Fexplore");

    // Hardware back intercepts open overlay first before exiting on root
    window.history.replaceState(null, "", "/");
    appListeners.get("backButton")?.({ canGoBack: false });
    expect(appMock.exitApp).not.toHaveBeenCalled();
    appListeners.get("backButton")?.({ canGoBack: false });
    expect(appMock.exitApp).toHaveBeenCalledTimes(1);

    // Push notifications request permission ONLY when user invokes opt-in
    const pushRes = await native.enablePushNotifications(navigate);
    expect(pushMock.requestPermissions).toHaveBeenCalledTimes(1);
    expect(pushMock.register).toHaveBeenCalledTimes(1);
    expect(pushRes.status).toBe("granted");

    // Push tap routes deep link cleanly
    pushListeners.get("pushNotificationActionPerformed")?.({
      notification: { data: { url: "https://pingbydot.lovable.app/messages" } },
    });
    expect(navigate).toHaveBeenCalledWith("/messages");

    // Camera permissions requested on demand and returned as File
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(new Blob(["abc"], { type: "image/jpeg" }), { status: 200 }));
    const file = await native.captureNativeMediaFile("prompt");
    expect(cameraMock.requestPermissions).toHaveBeenCalledTimes(1);
    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe("image/jpeg");
    globalThis.fetch = origFetch;
  });
});
