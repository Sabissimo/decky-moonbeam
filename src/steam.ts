import type { AppDetails, ELaunchSource } from "@decky/ui/dist/globals/steam-client/App";
import { getCurrentState, logToBackend, updateSettings } from "./store";
import { Navigation, Router } from "@decky/ui";
import { toaster } from "@decky/api";

const FLATPAK_EXE = "/usr/bin/flatpak";
const MOONLIGHT_ID = "com.moonlight_stream.Moonlight";
const SHORTCUT_NAME = "Moonbeam";

interface AppOverview {
  appid: number;
  gameid: string;
  display_name: string;
}

interface AppStore {
  m_mapApps: { get(appId: number): AppOverview | undefined };
}

interface CollectionStore {
  BIsHidden(appId: number): boolean;
  SetAppsAsHidden(appIds: number[], hide: boolean): void;
}

function getOverview(appId: number): AppOverview | null {
  const appStore = (window as unknown as { appStore?: AppStore }).appStore;
  return appStore?.m_mapApps.get(appId) ?? null;
}

function getCollectionStore(): CollectionStore | null {
  return (window as unknown as { collectionStore?: CollectionStore }).collectionStore ?? null;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function getAppDetails(appId: number): Promise<AppDetails | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (details: AppDetails | null): void => {
      if (!done) {
        done = true;
        registration.unregister();
        resolve(details);
      }
    };
    const registration = SteamClient.Apps.RegisterForAppDetails(appId, (details) => finish(details));
    setTimeout(() => finish(null), 1000);
  });
}

/** Quotes a value for the shortcut's launch options, which Steam passes through a shell. */
function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function isOurShortcut(details: AppDetails | null): boolean {
  return details !== null && details.strShortcutExe.includes("flatpak");
}

/** Returns the hidden Moonbeam shortcut, creating it if needed. */
async function ensureShortcut(): Promise<number | null> {
  const stored = getCurrentState().settings.shortcutAppId;
  if (stored !== null && getOverview(stored) !== null && isOurShortcut(await getAppDetails(stored))) {
    return stored;
  }

  const appId = await SteamClient.Apps.AddShortcut(SHORTCUT_NAME, FLATPAK_EXE, "", "");
  if (typeof appId !== "number" || !await waitFor(() => getOverview(appId) !== null)) {
    console.error("Moonbeam: failed to add shortcut", appId);
    return null;
  }

  getCollectionStore()?.SetAppsAsHidden([appId], true);
  await updateSettings({ shortcutAppId: appId });
  return appId;
}

export function buildLaunchOptions(host: string, hostApp: string, quitAfter: boolean): string {
  const args = ["run", MOONLIGHT_ID];
  if (quitAfter) {
    args.push("--quit-after");
  }
  args.push("stream", shellQuote(host), shellQuote(hostApp));
  return args.join(" ");
}

export async function streamGame(gameName: string, host: string, hostApp: string): Promise<void> {
  const { settings } = getCurrentState();

  const appId = await ensureShortcut();
  if (appId === null) {
    toaster.toast({ title: "Moonbeam", body: "Failed to create the Moonlight shortcut. Try restarting Steam." });
    return;
  }

  // Shortcut name is what Steam shows while the stream is running
  const launchOptions = buildLaunchOptions(host, hostApp, settings.quitAfter);
  SteamClient.Apps.SetShortcutName(appId, gameName);
  SteamClient.Apps.SetAppLaunchOptions(appId, launchOptions);
  const applied = await waitFor(async () => (await getAppDetails(appId))?.strLaunchOptions === launchOptions);
  const gameId = getOverview(appId)?.gameid;
  if (!applied || !gameId) {
    toaster.toast({ title: "Moonbeam", body: "Failed to prepare the Moonlight shortcut. Try restarting Steam." });
    return;
  }

  console.log(`Moonbeam: streaming "${hostApp}" from ${host}`);
  SteamClient.Apps.RunGame(gameId, "", -1, 100 as ELaunchSource);
}

// ---------------------------------------------------------------------------
// Back to the game's page after the stream
// ---------------------------------------------------------------------------

// When a non-Steam app exits, Steam leaves the user on that app's page: here Moonbeam's hidden
// shortcut, named like the game. The game's real page is one step back.
const RETURN_WINDOW_MS = 10000;
let shortcutPageShown = false;
let streamEndedAt = 0;

/** Path of the main window, e.g. /routes/library/app/<appid>, when Steam exposes it. */
function currentPath(): string {
  try {
    return Router.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow?.location?.pathname ?? "";
  } catch {
    return "";
  }
}

function leaveShortcutPage(): void {
  if (streamEndedAt === 0 || Date.now() - streamEndedAt > RETURN_WINDOW_MS) {
    return;
  }
  const shortcutAppId = getCurrentState().settings.shortcutAppId;
  const path = currentPath();
  const onShortcutPage = shortcutPageShown || (shortcutAppId !== null && path.endsWith(`/library/app/${shortcutAppId}`));
  logToBackend(`Stream ended. Shortcut page shown: ${shortcutPageShown}, path: ${path || "unknown"}.`);
  if (!onShortcutPage) {
    return;
  }
  streamEndedAt = 0;
  Navigation.NavigateBack();
}

/** Called by the game page while Moonbeam's shortcut page is shown. */
export function setShortcutPageShown(shown: boolean): void {
  shortcutPageShown = shown;
  if (shown) {
    setTimeout(leaveShortcutPage, 300);
  }
}

/** Watches Moonbeam's shortcut exiting (the stream ended). Returns a cleanup function. */
export function watchStreamEnd(): () => void {
  const registration = SteamClient.GameSessions.RegisterForAppLifetimeNotifications((notification) => {
    const shortcutAppId = getCurrentState().settings.shortcutAppId;
    if (shortcutAppId === null || notification.unAppID !== shortcutAppId) {
      return;
    }
    streamEndedAt = notification.bRunning ? 0 : Date.now();
    if (!notification.bRunning) {
      // Give Steam a moment to show the library again
      setTimeout(leaveShortcutPage, 500);
    }
  });
  return () => registration.unregister();
}
