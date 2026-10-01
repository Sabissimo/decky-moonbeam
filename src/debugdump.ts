/*
 * Debug snapshot of a game page, written to the plugin's log folder when Moonbeam could not be
 * added to Steam's launch selector. It describes the page's elements (classes, handlers, text) and
 * the React component chain above Steam's Play button and launch selector, to see where the play
 * bar patch loses track.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { appActionButtonClasses, appDetailsClasses, playSectionClasses } from "@decky/ui";
import { callable } from "@decky/api";

/** Tells whether a component type is patched by Moonbeam. */
export type IsPatched = (type: unknown) => boolean;

const saveDebug = callable<[name: string, content: string], string>("save_debug");

const MAX_NODES = 6000;
const MAX_FIBERS = 80;
const HANDLER_KEYS = ["onClick", "onActivate", "onOKButton", "onMenuButton", "onSecondaryButton", "onOptionsButton", "onFocus"];

const FIBER_KINDS: Record<number, string> = {
  0: "function", 1: "class", 2: "indeterminate", 3: "root", 4: "portal", 5: "host", 6: "text", 7: "fragment",
  8: "mode", 9: "context-consumer", 10: "context-provider", 11: "forwardRef", 12: "profiler", 13: "suspense",
  14: "memo", 15: "simple-memo", 16: "lazy", 22: "offscreen"
};

function reactKey(element: Element, prefix: string): any {
  const key = Object.keys(element).find((name) => name.startsWith(prefix));
  return key === undefined ? undefined : (element as any)[key];
}

function handlersOf(props: any): string[] {
  return props ? HANDLER_KEYS.filter((key) => typeof props[key] === "function") : [];
}

function typeName(type: any): string {
  if (typeof type === "string") {
    return type;
  }
  if (typeof type === "function") {
    return type.displayName || type.name || "anonymous";
  }
  if (type && typeof type === "object") {
    const inner = type.type ?? type.render;
    return type.displayName || (inner ? typeName(inner) : String(type.$$typeof?.description ?? "object"));
  }
  return String(type);
}

/** Elements of the page as an indented outline. */
function describeElements(root: Element): string[] {
  const lines: string[] = [];
  const walk = (element: Element, depth: number): void => {
    if (lines.length >= MAX_NODES) {
      return;
    }
    const tag = element.tagName.toLowerCase();
    const classes = typeof element.className === "string" ? element.className : element.getAttribute("class") ?? "";
    const handlers = handlersOf(reactKey(element, "__reactProps$"));
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === 3 && node.textContent?.trim())
      .map((node) => node.textContent!.trim()).join(" ").slice(0, 60);
    lines.push(`${"  ".repeat(depth)}<${tag}${classes ? ` class="${classes}"` : ""}>` +
      `${handlers.length ? ` [${handlers.join(",")}]` : ""}${text ? ` "${text}"` : ""}`);
    if (tag === "svg") {
      return;
    }
    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  if (lines.length >= MAX_NODES) {
    lines.push(`... cut at ${MAX_NODES} elements`);
  }
  return lines;
}

/** React components above an element, up to the play section (the component with the app overview). */
function describeFibers(element: Element, isPatched: IsPatched): string[] {
  const lines: string[] = [];
  let fiber = reactKey(element, "__reactFiber$");
  for (let i = 0; fiber && i < MAX_FIBERS; i++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    const patched = isPatched(fiber.elementType ?? fiber.type);
    const keys = props && typeof props === "object" ? Object.keys(props).slice(0, 15).join(",") : typeof props;
    const className = typeof props?.className === "string" ? ` class="${props.className}"` : "";
    lines.push(`${i}: ${FIBER_KINDS[fiber.tag] ?? `tag${fiber.tag}`} ${typeName(fiber.elementType ?? fiber.type)}${className}` +
      `${patched ? " PATCHED" : ""} handlers=[${handlersOf(props).join(",")}] props=[${keys}]` +
      `${typeof props?.children === "function" ? " children=function" : ""}`);
    if (typeof props?.className === "string" && props.className.split(/\s+/).includes(appDetailsClasses.InnerContainer)) {
      lines.push("(page content container reached)");
      break;
    }
  }
  return lines;
}

const dumped = new Set<number>();

/** Writes the snapshot for a game page once per session, using an element on that page. */
export async function dumpGamePage(anchor: Element | null, appId: number, appName: string, isPatched: IsPatched): Promise<void> {
  if (anchor === null || dumped.has(appId)) {
    return;
  }
  dumped.add(appId);

  const doc = anchor.ownerDocument;
  const root = anchor.closest(`.${appDetailsClasses.InnerContainer}`) ?? doc.body;
  const sections = [
    `Moonbeam game page snapshot for ${appId} (${appName}), ${new Date().toISOString()}`,
    `Steam classes: PlayButton=${appActionButtonClasses.PlayButton} StreamingSelector=${appActionButtonClasses.StreamingSelector} ` +
    `PlayButtonContainer=${appActionButtonClasses.PlayButtonContainer} PlayBar=${playSectionClasses.PlayBar} ` +
    `MenuButton=${playSectionClasses.MenuButton} InnerContainer=${appDetailsClasses.InnerContainer}`,
    ""
  ];

  const targets: Array<[string, string | undefined]> = [
    ["StreamingSelector", appActionButtonClasses.StreamingSelector],
    ["PlayButton", appActionButtonClasses.PlayButton],
    ["PlayButtonContainer", appActionButtonClasses.PlayButtonContainer]
  ];
  for (const [name, className] of targets) {
    const element = className ? root.querySelector(`.${CSS.escape(className)}`) : null;
    sections.push(`== Components above ${name} (${className}) ==`);
    sections.push(...(element ? describeFibers(element, isPatched) : ["not found on the page"]), "");
  }

  sections.push(`== Page elements (from ${root === doc.body ? "body" : "InnerContainer"}) ==`, ...describeElements(root));
  const path = await saveDebug(`gamepage-${appId}.txt`, sections.join("\n"));
  console.log(`Moonbeam: game page snapshot saved to ${path}`);
}

