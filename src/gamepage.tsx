/* Attaches Moonbeam to the library game page (route patch based on the approach used by MoonDeck). */
import { afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import { FC, ReactElement, useEffect, useRef } from "react";
import { attachToGamePage, isPatchedType } from "./playbar";
import { dumpGamePage } from "./debugdump";
import { getCurrentState, useMoonbeamState } from "./store";
import { findHostApp } from "./match";
import { routerHook } from "@decky/api";
import { setShortcutPageShown } from "./steam";

const ROUTE = "/library/app/:appid";

/**
 * Invisible element on the game page. Moonbeam itself lives in Steam's play bar (playbar.tsx);
 * this attaches it to the page while it is shown, and saves a page snapshot with debug logging.
 */
const PageAnchor: FC<{ appId: number; appName: string }> = ({ appId, appName }) => {
  const state = useMoonbeamState();
  const anchor = useRef<HTMLDivElement>(null);
  const matches = findHostApp(appName, state.apps) !== null;

  // Only games with a matching host app; Steam's page is left completely alone otherwise
  useEffect(() => {
    return anchor.current === null || !matches ? undefined : attachToGamePage(anchor.current, appId, appName);
  }, [appId, appName, matches]);

  useEffect(() => {
    if (!state.settings.debugLog || !matches) {
      return undefined;
    }
    const timer = setTimeout(() => {
      dumpGamePage(anchor.current, appId, appName, isPatchedType).catch((e) => console.error("Moonbeam: snapshot failed", e));
    }, 4000);
    return () => clearTimeout(timer);
  }, [state.settings.debugLog, matches, appId, appName]);

  return <div ref={anchor} style={{ display: "none" }} />;
};

/** On the page of Moonbeam's own shortcut (shown by Steam when a stream ends). */
const ShortcutPageAnchor: FC = () => {
  useEffect(() => {
    setShortcutPageShown(true);
    return () => setShortcutPageShown(false);
  }, []);
  return null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function patchGamePage(): () => void {
  const patch = routerHook.addPatch(ROUTE, (tree: any) => {
    const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
    if (!routeProps) {
      return tree;
    }

    let appId: number | undefined;
    let appName: string | undefined;

    const handler = createReactTreePatcher([
      (tree: any) => {
        const children = findInReactTree(tree, (x: any) => x?.props?.children?.props?.overview)?.props?.children;
        const overview = children?.props?.overview;
        if (typeof overview?.appid !== "number" || typeof overview?.display_name !== "string") {
          return null;
        }

        ({ appid: appId, display_name: appName } = overview);
        return children;
      }
    ], (_: Array<Record<string, unknown>>, ret?: ReactElement) => {
      type Parent = ReactElement<{ children: Array<ReactElement<{ id?: string; overview?: unknown; onShowLaunchingDetails?: unknown }>>; className: string }>;
      const parent = findInReactTree(ret, (x: Parent) => Array.isArray(x?.props?.children) && x?.props?.className?.includes(appDetailsClasses.InnerContainer)) as Parent | undefined;
      if (typeof parent !== "object" || appId === undefined || appName === undefined) {
        return ret;
      }

      const appPanelIndex = parent.props.children.findIndex((x) => x?.props?.overview && x?.props?.onShowLaunchingDetails);
      const anchor = appId === getCurrentState().settings.shortcutAppId
        ? <ShortcutPageAnchor key="moonbeam" />
        : <PageAnchor key="moonbeam" appId={appId} appName={appName} />;
      parent.props.children.splice(appPanelIndex < 0 ? -1 : appPanelIndex - 1, 0, anchor);
      return ret;
    });

    afterPatch(routeProps, "renderFunc", handler);
    return tree;
  });

  return () => routerHook.removePatch(ROUTE, patch);
}
