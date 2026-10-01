import { callable } from "@decky/api";
import { useEffect, useState } from "react";

export interface Settings {
  host: string | null;
  address: string;
  quitAfter: boolean;
  shortcutAppId: number | null;
  collection: boolean;
  // Games whose main button launches Moonbeam, with the PC chosen in the launch selector
  preferred: Record<string, string>;
  // Take over Steam's own "Stream from <PC>" instead of adding a Moonbeam menu
  replaceSteamStream: boolean;
  // Detailed log lines and game page snapshots for troubleshooting
  debugLog: boolean;
}

export interface Host {
  name: string;
  uuid: string;
  apps: string[];
  // Moonlight saved the PC's MAC address, needed for Wake-on-LAN
  canWake: boolean;
}

export interface State {
  settings: Settings;
  hosts: Host[];
  // Apps of all hosts (a game can be streamed when any host has it)
  apps: string[];
  loaded: boolean;
  error: string | null;
}

const getState = callable<[], { settings: Settings; hosts: Host[] }>("get_state");
const saveSettings = callable<[settings: Partial<Settings>], void>("set_settings");
export type AppSource = "moonlight" | "host" | "saved";

const refreshApps = callable<[host: string], { apps: string[]; hosts: Host[]; source: AppSource; error: string | null }>("refresh_apps");

export interface ScannedHost {
  name: string;
  address: string;
  paired: boolean;
}

const scanHostsCall = callable<[], ScannedHost[]>("scan_hosts");
export interface PowerResult {
  ok: boolean;
  error: string | null;
}

/** Sends Wake-on-LAN packets to the PC. */
export const wakeHost = callable<[host: string], PowerResult>("wake_host");
/** Starts the PC's "Shut down" app, without streaming. */
export const shutdownHost = callable<[host: string], PowerResult>("shutdown_host");

/** Which of Moonlight's PCs answer right now, by name. */
export const checkHosts = callable<[], Record<string, boolean>>("check_hosts");
const logCall = callable<[message: string], void>("log");

/** Writes a message to the plugin log on the Deck (~/homebrew/logs/Moonbeam/), when debug logging is on. */
export function logToBackend(message: string): void {
  console.log(`Moonbeam: ${message}`);
  if (state.settings.debugLog) {
    logCall(message).catch((e) => console.error(e));
  }
}

type Listener = (state: State) => void;

let state: State = {
  settings: { host: null, address: "", quitAfter: false, shortcutAppId: null, collection: true, preferred: {}, replaceSteamStream: false, debugLog: false },
  hosts: [],
  apps: [],
  loaded: false,
  error: null
};
const listeners = new Set<Listener>();

function setState(update: Partial<State>): void {
  state = { ...state, ...update };
  for (const listener of listeners) {
    listener(state);
  }
}

/** All hosts' apps, the preferred host first. */
function allApps(hosts: Host[]): string[] {
  return [...new Set(hosts.flatMap((host) => host.apps))];
}

/** Hosts with the preferred one first. */
export function orderedHosts(current: State = state): Host[] {
  const preferred = current.settings.host;
  return [...current.hosts].sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred));
}

export function getCurrentState(): State {
  return state;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000}s`)), ms))
  ]);
}

export async function loadState(): Promise<void> {
  let response: { settings: Settings; hosts: Host[] };
  try {
    setState({ error: null });
    response = await withTimeout(getState(), 10000, "Moonbeam backend");
  } catch (error) {
    setState({ error: String(error) });
    throw error;
  }

  const { settings, hosts } = response;
  // Pick the only/first known host automatically
  if (settings.host === null && hosts.length > 0) {
    settings.host = hosts[0].name;
    await saveSettings({ host: settings.host });
  }
  setState({ settings, hosts, apps: allApps(hosts), loaded: true });
}

export async function updateSettings(update: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...update };
  setState({ settings });
  await saveSettings(update);
}

export interface RefreshResult {
  host: string;
  source: AppSource;
  apps: number;
  error: string | null;
}

/** Refreshes the app lists of all hosts (via Moonlight, or directly), falling back to the saved ones. */
export async function refreshHostApps(): Promise<RefreshResult[]> {
  const names = orderedHosts().map((host) => host.name);
  const results = await Promise.all(names.map(async (name): Promise<RefreshResult> => {
    try {
      const result = await refreshApps(name);
      return { host: name, source: result.source, apps: result.apps.length, error: result.error };
    } catch (error) {
      return { host: name, source: "saved", apps: 0, error: String(error) };
    }
  }));
  // Each answer has every host; the backend's saved lists now include all refreshed ones
  const { hosts } = await getState();
  setState({ hosts, apps: allApps(hosts) });
  return results;
}

/** Finds hosts on the network, remembering the addresses of paired ones for the direct app list. */
export async function scanHosts(): Promise<ScannedHost[]> {
  return await scanHostsCall();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useMoonbeamState(): State {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    return () => { listeners.delete(setCurrent); };
  }, []);
  return current;
}
