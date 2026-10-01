/*
 * Moonbeam on Steam's game page, in Steam's own play bar.
 *
 * Steam shows its launch selector (the ▼ next to Play) when the game can be streamed from
 * another PC, i.e. when that PC is online. Moonbeam is only offered then, in one of two ways:
 * - Moonbeam menu (default): the ▼ opens a menu with "Moonbeam from <PC>" for each PC that
 *   has the game, and "Steam options…" (Steam's own menu). The choice is remembered per game
 *   (with its PC) and the main button becomes Moonbeam.
 * - Replace Steam's stream: the ▼ opens Steam's own menu, where "Stream from <PC>" becomes
 *   "Moonbeam from <PC>" when that PC has the game. When Steam's remembered choice for the
 *   game is such a PC (Steam's "Stream" state), the main button becomes Moonbeam from it.
 *
 * Moonlight's PCs and Steam's PCs are matched by name (or paired directly when there is only
 * one of each). Only PCs Steam sees online for the game are offered.
 *
 * Steam's play bar sits below MobX observer classes that can't be patched after their first
 * render, so the page isn't walked from the top. Instead, Steam's buttons are found on the page
 * (by Steam's own class names) and the components that render them get their render patched
 * once. The patched render only changes props of elements with those classes, on the open game
 * page, for games that match a host app. Everything else renders unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Menu, MenuItem, appActionButtonClasses, appDetailsClasses, showContextMenu } from "@decky/ui";
import { ReactElement, ReactNode, cloneElement, isValidElement } from "react";
import { findHostApp, findHostsForGame, normalizeName } from "./match";
import { getCurrentState, logToBackend, orderedHosts, updateSettings } from "./store";
import { dumpMenu } from "./debugdump";
import { streamGame } from "./steam";

const HOST_TAG = 5;
const CLASS_COMPONENT_TAG = 1;
const FORWARD_REF_TAG = 11;
const MEMO_TAG = 14;
const SIMPLE_MEMO_TAG = 15;
const MAX_FIBER_STEPS = 60;
const DISCOVERY_INTERVAL_MS = 300;
const DISCOVERY_TIMEOUT_MS = 10000;
const MENU_WATCH_INTERVAL_MS = 100;
const MENU_WATCH_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// The game page that is open
// ---------------------------------------------------------------------------

interface Game {
  appId: number;
  appName: string;
}

let currentGame: Game | null = null;
let pageDocument: Document | null = null;
// Steam's play bar component of the open page (has bShowStreamingSelector), re-rendered on changes
let playBarInstance: { forceUpdate?: () => void; props?: any } | null = null;

function refreshPlayBar(): void {
  try {
    playBarInstance?.forceUpdate?.();
  } catch (error) {
    console.error("Moonbeam: failed to refresh the play bar", error);
  }
}

/** Steam only shows its launch selector when the game can be streamed, i.e. the PC is online. */
function streamingAvailable(): boolean {
  return playBarInstance?.props?.bShowStreamingSelector === true;
}

// ---------------------------------------------------------------------------
// Steam's streaming clients of a game (this device and other PCs)
// ---------------------------------------------------------------------------

interface ClientData {
  clientid: string;
  client_name: string;
}

function getOverview(appId: number): any {
  const appStore = (window as any).appStore;
  return appStore?.m_mapApps?.get?.(appId) ?? appStore?.GetAppOverviewByAppID?.(appId) ?? null;
}

function remoteClients(overview: any): ClientData[] {
  const localId = overview?.local_per_client_data?.clientid ?? "0";
  const clients: ClientData[] = Array.isArray(overview?.per_client_data) ? overview.per_client_data : [];
  return clients.filter((client) => client?.clientid !== undefined && client.clientid !== localId && client.client_name);
}

/** The PC Steam currently streams the game from (its remembered choice), or null for this device. */
function selectedRemoteClient(overview: any): ClientData | null {
  const selectedId = overview?.selected_clientid ?? overview?.selected_per_client_data?.clientid;
  return remoteClients(overview).find((client) => client.clientid === selectedId) ?? null;
}

// ---------------------------------------------------------------------------
// Moonlight PCs that can stream the game now
// ---------------------------------------------------------------------------

interface StreamOption {
  // Moonlight's PC and its app for the game
  host: string;
  hostApp: string;
  // Steam's matching PC, null when Steam lists none but shows its selector (single PC)
  client: ClientData | null;
}

/** Moonlight PCs that have the game and that Steam sees online, the preferred PC first. */
function streamOptions(game: Game): StreamOption[] {
  const current = getCurrentState();
  const games = findHostsForGame(game.appName, orderedHosts(current));
  if (games.length === 0) {
    return [];
  }
  const clients = remoteClients(getOverview(game.appId));
  const single = current.hosts.length === 1;
  if (clients.length === 0) {
    // Steam shows the selector but doesn't say which PC: fine as long as there is only one
    return single && streamingAvailable() ? [{ ...games[0], client: null }] : [];
  }
  const options: StreamOption[] = [];
  for (const { host, hostApp } of games) {
    const name = normalizeName(host);
    const client = clients.find((candidate) => normalizeName(candidate.client_name) === name) ??
      (single && clients.length === 1 ? clients[0] : undefined);
    if (client !== undefined) {
      options.push({ host, hostApp, client });
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Remembered choice (Moonbeam menu mode)
// ---------------------------------------------------------------------------

/** The PC chosen for the game in the Moonbeam menu, if it can stream it now. */
function preferredOption(appId: number, options: StreamOption[]): StreamOption | null {
  const host = getCurrentState().settings.preferred[String(appId)];
  return options.find((option) => option.host === host) ?? null;
}

function setPreferred(appId: number, host: string | null): void {
  const preferred = { ...getCurrentState().settings.preferred };
  if (host === null) {
    delete preferred[String(appId)];
  } else {
    preferred[String(appId)] = host;
  }
  updateSettings({ preferred })
    .catch((e) => console.error(e))
    .finally(() => refreshPlayBar());
  // The store updates synchronously, saving to disk is what takes time
  refreshPlayBar();
}

// ---------------------------------------------------------------------------
// New props for Steam's elements
// ---------------------------------------------------------------------------

function classesOf(className: unknown): string[] {
  return typeof className === "string" ? className.split(/\s+/).filter((name) => name !== "") : [];
}

function eventTarget(event: any): EventTarget | undefined {
  return event?.currentTarget ?? event?.target ?? undefined;
}

function launch(game: Game, option: StreamOption): void {
  streamGame(game.appName, option.host, option.hostApp).catch((e) => console.error("Moonbeam:", e));
}

function openLaunchMenu(event: any, game: Game, steamOnClick: ((event: any) => void) | undefined): void {
  const target = eventTarget(event);
  const options = streamOptions(game);
  const preferred = preferredOption(game.appId, options);
  showContextMenu(
    <Menu label="Launch">
      {options.map((option) => (
        <MenuItem key={option.host} onSelected={() => setPreferred(game.appId, option.host)}>
          {option === preferred ? "✓ " : ""}Moonbeam from {option.host}
        </MenuItem>
      ))}
      <MenuItem onSelected={() => {
        setPreferred(game.appId, null);
        // Steam's own menu (Play on this device, Steam streaming, ...), after ours has closed
        setTimeout(() => steamOnClick?.({ currentTarget: target, target, preventDefault() { }, stopPropagation() { } }), 50);
      }}>
        {preferred ? "" : "✓ "}Steam options…
      </MenuItem>
    </Menu>,
    target);
}

/** Children as cloneElement arguments, so static children don't turn into a keyed list. */
function asChildArgs(children: ReactNode): ReactNode[] {
  return Array.isArray(children) ? children : [children];
}

/** Replaces the first text in the content, keeping Steam's layout. */
function replaceLabel(node: ReactNode, label: string, state: { done: boolean }): ReactNode {
  if (state.done) {
    return node;
  }
  if (typeof node === "string" && node.trim() !== "") {
    state.done = true;
    return label;
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => {
      const next = replaceLabel(child, label, state);
      // A copied element inside a list needs a key like any list item
      return next !== child && isValidElement(next) && next.key === null ? cloneElement(next, { key: `moonbeam-${index}` }) : next;
    });
  }
  if (isValidElement(node)) {
    const element = node as ReactElement<any>;
    if (element.props.children === undefined) {
      return node;
    }
    const children = replaceLabel(element.props.children, label, state);
    return state.done ? cloneElement(element, undefined, ...asChildArgs(children)) : node;
  }
  return node;
}

function withLabel(children: ReactNode, label: string): ReactNode {
  const labelState = { done: false };
  const replaced = replaceLabel(children, label, labelState);
  return labelState.done ? replaced : <span>{label}</span>;
}

/** All text in the content, to recognise Steam's menu items. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join(" ");
  }
  if (isValidElement(node)) {
    return textOf((node as ReactElement<any>).props.children);
  }
  return "";
}

/** Props Moonbeam renders Steam's element with, or null to leave it alone. */
function overrideProps(props: any): any | null {
  const game = currentGame;
  if (game === null || props === null || typeof props !== "object") {
    return null;
  }

  const classes = classesOf(props.className);
  const isSelector = classes.includes(appActionButtonClasses.StreamingSelector);
  const isPlayButton = classes.includes(appActionButtonClasses.PlayButton);
  const isMenuItem = classes.includes(appActionButtonClasses.StreamingContextMenuItem);
  if (!isSelector && !isPlayButton && !isMenuItem) {
    return null;
  }

  const { settings } = getCurrentState();
  const options = streamOptions(game);
  if (options.length === 0) {
    return null;
  }

  if (isSelector) {
    const steamOnClick = props.onClick;
    if (settings.replaceSteamStream) {
      // Steam's own menu, with its streaming item taken over once it shows up
      return { ...props, onClick: (event: any) => { steamOnClick?.(event); watchSteamMenu(game); } };
    }
    return { ...props, onClick: (event: any) => openLaunchMenu(event, game, steamOnClick) };
  }

  if (isPlayButton) {
    if (!streamingAvailable()) {
      return null;
    }
    let option: StreamOption | null;
    if (settings.replaceSteamStream) {
      const selected = selectedRemoteClient(getOverview(game.appId));
      option = selected === null ? null
        : options.find((candidate) => candidate.client === null || candidate.client.clientid === selected.clientid) ?? null;
    } else {
      option = preferredOption(game.appId, options);
    }
    if (option === null) {
      return null;
    }
    const chosen = option;
    return { ...props, children: withLabel(props.children, "Moonbeam"), disabled: false, onClick: () => launch(game, chosen) };
  }

  // Steam's menu item for streaming from another PC (replace mode)
  if (!settings.replaceSteamStream) {
    return null;
  }
  const text = textOf(props.children);
  const client = remoteClients(getOverview(game.appId)).find((candidate) => text.includes(candidate.client_name));
  const option = client === undefined ? undefined
    : options.find((candidate) => candidate.client === null || candidate.client.clientid === client.clientid);
  if (client === undefined || option === undefined) {
    return null;
  }
  const select = (): void => {
    // Remembered by Steam like its own choice, the main button then shows Moonbeam
    SteamClient.Apps.SetStreamingClientForApp(game.appId, client.clientid);
    launch(game, option);
    setTimeout(refreshPlayBar, 100);
  };
  const handlers: any = {};
  for (const key of ["onSelected", "onClick", "onActivate"]) {
    if (typeof props[key] === "function") {
      handlers[key] = select;
    }
  }
  if (Object.keys(handlers).length === 0) {
    handlers.onSelected = select;
  }
  return { ...props, ...handlers, children: withLabel(props.children, `Moonbeam from ${option.host}`) };
}

// ---------------------------------------------------------------------------
// Patching Steam's components
// ---------------------------------------------------------------------------

const patchedTypes = new WeakSet<object>();

function wrapRender(render: (...args: any[]) => any): (...args: any[]) => any {
  return function (this: unknown, props: any, ...rest: any[]) {
    let nextProps = props;
    try {
      nextProps = overrideProps(props) ?? props;
    } catch (error) {
      console.error("Moonbeam: failed to change Steam's element", error);
    }
    return render.call(this, nextProps, ...rest);
  };
}

/**
 * Patches the render of the component behind a fiber, once: forwardRef components (render is
 * read on every render) and memo components (used by elements created afterwards, e.g. menus).
 * Returns whether the type is patched.
 */
function patchFiberType(fiber: any): boolean {
  const type = fiber.elementType;
  if (type === null || typeof type !== "object") {
    return false;
  }
  if (patchedTypes.has(type)) {
    return true;
  }
  if (fiber.tag === FORWARD_REF_TAG && typeof type.render === "function") {
    type.render = wrapRender(type.render);
  } else if ((fiber.tag === MEMO_TAG || fiber.tag === SIMPLE_MEMO_TAG) && typeof type.type === "function") {
    type.type = wrapRender(type.type);
  } else {
    return false;
  }
  patchedTypes.add(type);
  return true;
}

function reactFiber(element: Element): any {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  return key === undefined ? undefined : (element as any)[key];
}

interface Found {
  patched: boolean;
  // Nearest class component above the element (can be re-rendered)
  instance: any;
  // Kinds of components carrying the class, for debugging
  kinds: string[];
}

/** Patches the component that renders an element with the class, walking up from the element. */
function patchFromElement(element: Element, className: string): Found {
  const found: Found = { patched: false, instance: null, kinds: [] };
  let fiber = reactFiber(element);
  for (let i = 0; fiber && i < MAX_FIBER_STEPS; i++, fiber = fiber.return) {
    const carriesClass = classesOf(fiber.memoizedProps?.className).includes(className);
    if (!found.patched && carriesClass && fiber.tag !== HOST_TAG) {
      found.kinds.push(String(fiber.tag));
      found.patched = patchFiberType(fiber);
    }
    if (found.patched && fiber.tag === CLASS_COMPONENT_TAG && typeof fiber.stateNode?.forceUpdate === "function") {
      found.instance = fiber.stateNode;
      break;
    }
  }
  return found;
}

interface Discovery {
  selector: boolean;
  playButton: boolean;
  patched: boolean;
  playBar: boolean;
}

/** Finds Steam's Play button and launch selector, patches their component and finds the play bar. */
function discover(root: ParentNode): Discovery {
  const result: Discovery = { selector: false, playButton: false, patched: false, playBar: false };
  const targets: Array<["selector" | "playButton", string]> = [
    ["playButton", appActionButtonClasses.PlayButton],
    ["selector", appActionButtonClasses.StreamingSelector]
  ];
  for (const [name, className] of targets) {
    const element = className ? root.querySelector(`.${CSS.escape(className)}`) : null;
    if (element === null) {
      continue;
    }
    result[name] = true;
    const found = patchFromElement(element, className);
    result.patched = result.patched || found.patched;
    if (found.instance !== null) {
      playBarInstance = found.instance;
      result.playBar = true;
    }
  }
  return result;
}

const menuReported = new Set<number>();

/** Replace mode: after Steam's menu opens, takes over its item for streaming from another PC. */
function watchSteamMenu(game: Game): void {
  const doc = pageDocument;
  const className = appActionButtonClasses.StreamingContextMenuItem;
  if (doc === null || !className) {
    return;
  }
  const started = Date.now();
  const check = (): void => {
    const items = [...doc.querySelectorAll(`.${CSS.escape(className)}`)];
    if (items.length === 0) {
      if (Date.now() - started < MENU_WATCH_TIMEOUT_MS) {
        setTimeout(check, MENU_WATCH_INTERVAL_MS);
      } else {
        logToBackend(`Steam's launch menu for ${game.appId} not found (expected ${className}).`);
      }
      return;
    }

    const found = patchFromElement(items[0], className);
    // Show the new label right away; patched menus render it from the next time on anyway
    try {
      found.instance?.forceUpdate?.();
    } catch (error) {
      console.error("Moonbeam: failed to refresh Steam's menu", error);
    }
    if (!menuReported.has(game.appId)) {
      menuReported.add(game.appId);
      logToBackend(`Steam's launch menu for ${game.appId}: ${items.length} streaming items, patched: ${found.patched}, ` +
        `component kinds: ${found.kinds.join(",") || "none"}, re-rendered: ${found.instance !== null}.`);
      if (getCurrentState().settings.debugLog) {
        dumpMenu(doc, game.appId, (type) => type !== null && typeof type === "object" && patchedTypes.has(type))
          .catch((e) => console.error("Moonbeam: menu snapshot failed", e));
      }
    }
  };
  setTimeout(check, MENU_WATCH_INTERVAL_MS);
}

/**
 * Called by the game page (from an element on it) while it is shown, only for games with a
 * matching host app. Returns a cleanup function.
 */
export function attachToGamePage(anchor: Element, appId: number, appName: string): () => void {
  currentGame = { appId, appName };
  pageDocument = anchor.ownerDocument;
  const root: ParentNode = anchor.closest(`.${CSS.escape(appDetailsClasses.InnerContainer)}`) ?? anchor.ownerDocument;
  const started = Date.now();
  let last: Discovery | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = (): void => {
    try {
      last = discover(root);
    } catch (error) {
      console.error("Moonbeam: play bar discovery failed", error);
    }
    if (last?.patched && last.playBar) {
      // Render Steam's play bar again, now through the patched component
      refreshPlayBar();
      return;
    }
    if (Date.now() - started < DISCOVERY_TIMEOUT_MS) {
      timer = setTimeout(attempt, DISCOVERY_INTERVAL_MS);
    }
  };
  attempt();

  const report = setTimeout(() => {
    if (findHostApp(appName, getCurrentState().apps) !== null) {
      logToBackend(`Game page ${appId} (${appName}): play button: ${last?.playButton}, selector: ${last?.selector}, ` +
        `patched: ${last?.patched}, play bar: ${last?.playBar}, streaming available: ${streamingAvailable()}.`);
    }
  }, 4000);

  return () => {
    clearTimeout(timer);
    clearTimeout(report);
    if (currentGame?.appId === appId) {
      currentGame = null;
      playBarInstance = null;
    }
  };
}

/** For the debug snapshot: whether this component type is patched by Moonbeam. */
export function isPatchedType(type: unknown): boolean {
  return type !== null && typeof type === "object" && patchedTypes.has(type);
}

