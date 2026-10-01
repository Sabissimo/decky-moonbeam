/*
 * Moonbeam on Steam's game page, in Steam's own play bar.
 *
 * A PC can stream the game when Steam sees it (Steam shows its launch selector, the ▼ next to
 * Play, and lists the PC) or when the PC itself answers Moonbeam's online check. Without
 * Steam's ▼ (non-Steam games, Steam not running on the PC), Moonbeam adds its own. The ▼ opens one
 * "Play from" menu with this device, Steam's streaming from each PC and "Moonbeam from <PC>"
 * for each PC whose Moonlight app list has the game. With "Replace Steam's stream", a PC with
 * the game shows only Moonbeam instead of Steam's streaming. Like Steam's own menu, choosing
 * an item only selects it, remembered per game; the main button then plays, streams or
 * Moonbeams.
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
import { DialogButton, Menu, MenuItem, appActionButtonClasses, appDetailsClasses, showContextMenu } from "@decky/ui";
import { ReactElement, ReactNode, cloneElement, isValidElement } from "react";
import { findHostApp, findHostsForGame, normalizeName } from "./match";
import { checkHosts, getCurrentState, logToBackend, orderedHosts, updateSettings } from "./store";
import { streamGame } from "./steam";

const HOST_TAG = 5;
const CLASS_COMPONENT_TAG = 1;
const FORWARD_REF_TAG = 11;
const MEMO_TAG = 14;
const SIMPLE_MEMO_TAG = 15;
const MAX_FIBER_STEPS = 60;
const DISCOVERY_INTERVAL_MS = 300;
const DISCOVERY_TIMEOUT_MS = 10000;
const ONLINE_CHECK_INTERVAL_MS = 30000;

// ---------------------------------------------------------------------------
// The game page that is open
// ---------------------------------------------------------------------------

interface Game {
  appId: number;
  appName: string;
}

let currentGame: Game | null = null;
// Steam's play bar component of the open page (has bShowStreamingSelector), re-rendered on changes
let playBarInstance: { forceUpdate?: () => void; props?: any } | null = null;
// The open game page (its InnerContainer), where Steam's ▼ is looked for
let pageRoot: ParentNode | null = null;
// Steam's button component behind the Play button (also renders Steam's ▼)
let steamButtonType: any = null;
// Class of Moonbeam's own ▼, which carries Steam's selector class too (for Steam's styling)
const OWN_SELECTOR_CLASS = "moonbeam-selector";

function refreshPlayBar(): void {
  try {
    playBarInstance?.forceUpdate?.();
  } catch (error) {
    console.error("Moonbeam: failed to refresh the play bar", error);
  }
}

/**
 * Whether Steam shows its launch selector (the ▼), i.e. Steam can stream the game from a PC.
 * Looked for on the page: Steam's bShowStreamingSelector can be set while Steam doesn't draw the ▼
 * (Remote Play disabled).
 */
function streamingAvailable(): boolean {
  const className = appActionButtonClasses.StreamingSelector;
  if (pageRoot !== null && className) {
    return pageRoot.querySelector(`.${CSS.escape(className)}:not(.${OWN_SELECTOR_CLASS})`) !== null;
  }
  return playBarInstance?.props?.bShowStreamingSelector === true;
}

/** Renders the play bar again if Steam's ▼ came or went since the play button was rendered. */
function recheckSteamSelector(renderedWith: boolean): void {
  setTimeout(() => {
    if (currentGame !== null && streamingAvailable() !== renderedWith) {
      refreshPlayBar();
    }
  }, 0);
}

// ---------------------------------------------------------------------------
// Steam's streaming clients of a game (this device and other PCs)
// ---------------------------------------------------------------------------

interface ClientData {
  clientid: string;
  client_name: string;
}

function localClientId(overview: any): string {
  return overview?.local_per_client_data?.clientid ?? "0";
}

function selectedClientId(overview: any): string {
  return overview?.selected_clientid ?? overview?.selected_per_client_data?.clientid ?? localClientId(overview);
}

/** Selects where Steam plays the game (this device or another PC), like Steam's own menu. */
function selectSteamClient(appId: number, clientId: string): void {
  try {
    SteamClient.Apps.SetStreamingClientForApp(appId, clientId);
  } catch (error) {
    console.error("Moonbeam: failed to select Steam's streaming client", error);
  }
}

function getOverview(appId: number): any {
  const appStore = (window as any).appStore;
  return appStore?.m_mapApps?.get?.(appId) ?? appStore?.GetAppOverviewByAppID?.(appId) ?? null;
}

function remoteClients(overview: any): ClientData[] {
  const localId = localClientId(overview);
  const clients: ClientData[] = Array.isArray(overview?.per_client_data) ? overview.per_client_data : [];
  return clients.filter((client) => client?.clientid !== undefined && client.clientid !== localId && client.client_name);
}

/** The PC Steam currently streams the game from (its remembered choice), or null for this device. */
function selectedRemoteClient(overview: any): ClientData | null {
  const selectedId = selectedClientId(overview);
  return remoteClients(overview).find((client) => client.clientid === selectedId) ?? null;
}

// ---------------------------------------------------------------------------
// Moonlight PCs that can stream the game now
// ---------------------------------------------------------------------------

interface StreamOption {
  // Moonlight's PC and its app for the game
  host: string;
  hostApp: string;
  // Steam's matching PC, or null when Steam doesn't list it (found online by Moonbeam itself)
  client: ClientData | null;
}

// Moonlight's PCs that answered the last online check, by name
let onlineHosts: Record<string, boolean> = {};

async function updateOnlineHosts(): Promise<void> {
  try {
    const result = await checkHosts();
    const changed = JSON.stringify(result) !== JSON.stringify(onlineHosts);
    onlineHosts = result;
    if (changed) {
      refreshPlayBar();
    }
  } catch (error) {
    console.error("Moonbeam: online check failed", error);
  }
}

/** Steam's PCs for the game, when Steam can stream it (it shows its ▼). */
function steamClients(game: Game): ClientData[] {
  return streamingAvailable() ? remoteClients(getOverview(game.appId)) : [];
}

/** Moonlight PCs that have the game and are online (seen by Steam or answering), the preferred PC first. */
function streamOptions(game: Game): StreamOption[] {
  const current = getCurrentState();
  const games = findHostsForGame(game.appName, orderedHosts(current));
  if (games.length === 0) {
    return [];
  }
  const clients = steamClients(game);
  const single = current.hosts.length === 1;
  const options: StreamOption[] = [];
  for (const { host, hostApp } of games) {
    const name = normalizeName(host);
    const client = clients.find((candidate) => normalizeName(candidate.client_name) === name) ??
      (single && clients.length === 1 ? clients[0] : undefined);
    if (client !== undefined) {
      options.push({ host, hostApp, client });
    } else if (onlineHosts[host] === true || (single && streamingAvailable() && clients.length === 0)) {
      // Online by its own answer, or Steam shows its ▼ without naming the only PC
      options.push({ host, hostApp, client: null });
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Remembered choice
// ---------------------------------------------------------------------------

/** The Moonbeam PC chosen for the game, if it can stream it now. */
function chosenOption(game: Game, options: StreamOption[]): StreamOption | null {
  const { settings } = getCurrentState();
  const host = settings.preferred[String(game.appId)];
  const preferred = options.find((option) => option.host === host);
  if (preferred !== undefined) {
    return preferred;
  }
  if (settings.replaceSteamStream && streamingAvailable()) {
    // Steam's own choice of a PC with the game means Moonbeam from it
    const selected = selectedRemoteClient(getOverview(game.appId));
    if (selected !== null) {
      return options.find((option) => option.client?.clientid === selected.clientid) ??
        (getCurrentState().hosts.length === 1 ? options.find((option) => option.client === null) : undefined) ?? null;
    }
  }
  return null;
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

interface MenuEntry {
  label: string;
  checked: boolean;
  select: () => void;
}

/** "Play from" entries: this device, then per PC Steam's streaming and/or Moonbeam. */
function menuEntries(game: Game): MenuEntry[] {
  const { settings } = getCurrentState();
  const overview = getOverview(game.appId);
  const options = streamOptions(game);
  const chosen = chosenOption(game, options);
  const selectedId = selectedClientId(overview);
  const steam = (clientId: string): void => {
    setPreferred(game.appId, null);
    selectSteamClient(game.appId, clientId);
  };
  const moonbeam = (option: StreamOption): void => {
    setPreferred(game.appId, option.host);
    if (option.client !== null) {
      // Steam then treats the game as streamed from that PC, also when Moonbeam is not running
      selectSteamClient(game.appId, option.client.clientid);
    }
  };

  const clients = steamClients(game);
  const entries: MenuEntry[] = [{
    label: "This Steam Deck",
    checked: chosen === null && clients.every((client) => client.clientid !== selectedId),
    select: () => steam(localClientId(overview))
  }];
  const used = new Set<StreamOption>();
  for (const client of clients) {
    const option = options.find((candidate) => candidate.client?.clientid === client.clientid);
    if (option === undefined || !settings.replaceSteamStream) {
      entries.push({
        label: `Stream from: ${client.client_name}`,
        checked: chosen === null && client.clientid === selectedId,
        select: () => steam(client.clientid)
      });
    }
    if (option !== undefined) {
      used.add(option);
      entries.push({ label: `Moonbeam from: ${option.host}`, checked: option === chosen, select: () => moonbeam(option) });
    }
  }
  // PCs Steam doesn't list, online by their own answer
  for (const option of options.filter((candidate) => !used.has(candidate))) {
    entries.push({ label: `Moonbeam from: ${option.host}`, checked: option === chosen, select: () => moonbeam(option) });
  }
  return entries;
}

function openLaunchMenu(event: any, game: Game): void {
  showContextMenu(
    <Menu label="Play from">
      {menuEntries(game).map((entry) => (
        <MenuItem key={entry.label} onSelected={entry.select}>
          {entry.checked ? "✓ " : ""}{entry.label}
        </MenuItem>
      ))}
    </Menu>,
    eventTarget(event));
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

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6 L8 11 L13 6" />
    </svg>
  );
}

/** Moonbeam's own ▼, next to Play when Steam shows none (Steam can't stream the game). */
function ownSelector(game: Game): ReactNode {
  // Steam's own button component (the one rendering Play) with Steam's ▼ class, so it looks like Steam's ▼
  const Button = steamButtonType ?? DialogButton;
  return (
    <Button
      key="moonbeam-selector"
      noFocusRing
      className={`${appActionButtonClasses.StreamingSelector} ${OWN_SELECTOR_CLASS}`}
      onClick={(event: any) => openLaunchMenu(event, game)}
    >
      <Chevron />
    </Button>
  );
}

interface Override {
  // Props Moonbeam renders Steam's element with
  props: any;
  // Rendered right after the element
  after?: ReactNode;
}

/** How Moonbeam changes Steam's element, or null to leave it alone. */
function overrideProps(props: any): Override | null {
  const game = currentGame;
  if (game === null || props === null || typeof props !== "object") {
    return null;
  }

  const classes = classesOf(props.className);
  const isSelector = classes.includes(appActionButtonClasses.StreamingSelector);
  const isPlayButton = classes.includes(appActionButtonClasses.PlayButton);
  if (!isSelector && !isPlayButton) {
    return null;
  }

  const options = streamOptions(game);
  if (options.length === 0) {
    return null;
  }

  if (isSelector) {
    return { props: { ...props, onClick: (event: any) => openLaunchMenu(event, game) } };
  }

  // Without Steam's ▼, Moonbeam's own one follows the Play button
  const steamSelector = streamingAvailable();
  recheckSteamSelector(steamSelector);
  const after = steamSelector ? undefined : ownSelector(game);
  const option = chosenOption(game, options);
  if (option === null) {
    return after === undefined ? null : { props, after };
  }
  // Which PC, when there is more than one to choose from
  const label = getCurrentState().hosts.length > 1 ? `Moonbeam: ${option.host}` : "Moonbeam";
  return {
    props: { ...props, children: withLabel(props.children, label), disabled: false, onClick: () => launch(game, option) },
    after
  };
}

// ---------------------------------------------------------------------------
// Patching Steam's components
// ---------------------------------------------------------------------------

const patchedTypes = new WeakSet<object>();

function wrapRender(render: (...args: any[]) => any): (...args: any[]) => any {
  return function (this: unknown, props: any, ...rest: any[]) {
    let override: Override | null = null;
    try {
      override = overrideProps(props);
    } catch (error) {
      console.error("Moonbeam: failed to change Steam's element", error);
    }
    const rendered = render.call(this, override?.props ?? props, ...rest);
    return override?.after === undefined ? rendered : <>{rendered}{override.after}</>;
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
  // The patched component (Steam's button component, for the play button)
  type: any;
  // Nearest class component above the element (can be re-rendered)
  instance: any;
}

/** Patches the component that renders an element with the class, walking up from the element. */
function patchFromElement(element: Element, className: string): Found {
  const found: Found = { patched: false, type: null, instance: null };
  let fiber = reactFiber(element);
  for (let i = 0; fiber && i < MAX_FIBER_STEPS; i++, fiber = fiber.return) {
    const carriesClass = classesOf(fiber.memoizedProps?.className).includes(className);
    if (!found.patched && carriesClass && fiber.tag !== HOST_TAG) {
      found.patched = patchFiberType(fiber);
      found.type = found.patched ? fiber.elementType : null;
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
    const element = className ? root.querySelector(`.${CSS.escape(className)}:not(.${OWN_SELECTOR_CLASS})`) : null;
    if (element === null) {
      continue;
    }
    result[name] = true;
    const found = patchFromElement(element, className);
    result.patched = result.patched || found.patched;
    if (name === "playButton" && found.type !== null) {
      steamButtonType = found.type;
    }
    if (found.instance !== null) {
      playBarInstance = found.instance;
      result.playBar = true;
    }
  }
  return result;
}

/**
 * Called by the game page (from an element on it) while it is shown, only for games with a
 * matching host app. Returns a cleanup function.
 */
export function attachToGamePage(anchor: Element, appId: number, appName: string): () => void {
  currentGame = { appId, appName };
  const root: ParentNode = anchor.closest(`.${CSS.escape(appDetailsClasses.InnerContainer)}`) ?? anchor.ownerDocument;
  pageRoot = root;
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

  // Which PCs answer, now and while the page is open (the last answers are used meanwhile)
  updateOnlineHosts().catch(() => undefined);
  const onlineCheck = setInterval(() => { updateOnlineHosts().catch(() => undefined); }, ONLINE_CHECK_INTERVAL_MS);

  const report = setTimeout(() => {
    if (findHostApp(appName, getCurrentState().apps) !== null) {
      logToBackend(`Game page ${appId} (${appName}): play button: ${last?.playButton}, selector: ${last?.selector}, ` +
        `patched: ${last?.patched}, play bar: ${last?.playBar}, Steam's ▼ shown: ${streamingAvailable()} ` +
        `(bShowStreamingSelector: ${playBarInstance?.props?.bShowStreamingSelector}), ` +
        `online PCs: ${JSON.stringify(onlineHosts)}.`);
    }
  }, 4000);

  return () => {
    clearTimeout(timer);
    clearTimeout(report);
    clearInterval(onlineCheck);
    if (currentGame?.appId === appId) {
      currentGame = null;
      playBarInstance = null;
      pageRoot = null;
    }
  };
}

/** For the debug snapshot: whether this component type is patched by Moonbeam. */
export function isPatchedType(type: unknown): boolean {
  return type !== null && typeof type === "object" && patchedTypes.has(type);
}

