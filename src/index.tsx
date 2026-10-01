import { ButtonItem, Dropdown, Field, PanelSection, PanelSectionRow, TextField, ToggleField, staticClasses } from "@decky/ui";
import { ScannedHost, State, loadState, refreshHostApps, scanHosts, subscribe, updateSettings, useMoonbeamState } from "./store";
import { definePlugin, toaster } from "@decky/api";
import { FaMoon } from "react-icons/fa";
import { patchGamePage } from "./gamepage";
import { watchStreamEnd } from "./steam";
import { syncCollection } from "./collection";
import { useState } from "react";

function toast(body: string): void {
  toaster.toast({ title: "Moonbeam", body });
}

function NetworkScan() {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<ScannedHost[] | null>(null);

  const scan = async (): Promise<void> => {
    setScanning(true);
    try {
      setFound(await scanHosts());
    } finally {
      setScanning(false);
    }
  };

  return (
    <PanelSection title="Network">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={scanning} onClick={() => { scan().catch((e) => console.error(e)); }}>
          {scanning ? "Scanning..." : "Scan for PCs"}
        </ButtonItem>
      </PanelSectionRow>
      {found !== null && found.length === 0 &&
        <PanelSectionRow>No PCs found. Check that Vibepollo/Sunshine is running and on the same network.</PanelSectionRow>}
      {found?.map((host) => (
        <PanelSectionRow key={`${host.name}-${host.address}`}>
          <Field
            label={host.name}
            description={host.paired ? `${host.address} · paired` : `${host.address} · not paired, pair it in the Moonlight app first`}
          />
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}

function Content() {
  const state = useMoonbeamState();
  const [refreshing, setRefreshing] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const { settings, hosts, apps } = state;

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const results = await refreshHostApps();
      const lines = results.map(({ host, source, apps: count, error }) => (source === "saved"
        ? `${host}: not reachable, using saved list. ${error ?? ""}`
        : `${host}: ${count} apps from ${source === "moonlight" ? "Moonlight" : "the PC directly"}`));
      toast(lines.join("\n"));
    } finally {
      setRefreshing(false);
    }
  };

  if (!state.loaded) {
    if (state.error === null) {
      return <PanelSection><PanelSectionRow>Loading...</PanelSectionRow></PanelSection>;
    }
    return (
      <PanelSection title="Backend error">
        <PanelSectionRow>{state.error}. Check ~/homebrew/logs/Moonbeam/ on the Deck.</PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => { loadState().catch((e) => console.error(e)); }}>Retry</ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (hosts.length === 0) {
    return (
      <>
        <PanelSection title="No paired PC">
          <PanelSectionRow>
            Pair your PC in the Moonlight app (Flatpak) and open its app list once, then reload.
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => { loadState().catch((e) => console.error(e)); }}>Reload</ButtonItem>
          </PanelSectionRow>
        </PanelSection>
        <NetworkScan />
      </>
    );
  }

  return (
    <>
      <PanelSection title={hosts.length > 1 ? "PCs" : "PC"}>
        {hosts.length > 1 && <PanelSectionRow>
          <Field label="Preferred PC" description="Listed first, refreshed with the address below" />
        </PanelSectionRow>}
        <PanelSectionRow>
          <Dropdown
            rgOptions={hosts.map((host) => ({ data: host.name, label: host.name }))}
            selectedOption={settings.host}
            onChange={(option) => { updateSettings({ host: option.data as string }).catch((e) => console.error(e)); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          {hosts.length > 1
            ? `${apps.length} apps known (${hosts.map((host) => `${host.name}: ${host.apps.length}`).join(", ")}).`
            : `${apps.length} apps known.`} Games with a matching name get Moonbeam on their page.
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={refreshing} onClick={() => { refresh().catch((e) => console.error(e)); }}>
            {refreshing ? "Refreshing..." : hosts.length > 1 ? "Refresh app lists from PCs" : "Refresh app list from PC"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="PC address (optional)"
            description={hosts.length > 1
              ? "IP or name of the preferred PC, used when Moonlight's saved addresses don't work"
              : "IP or name of the PC running Vibepollo/Sunshine, used when Moonlight's saved addresses don't work"}
            value={address ?? settings.address}
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => {
              if (address !== null && address !== settings.address) {
                updateSettings({ address: address.trim() }).catch((e) => console.error(e));
              }
              setAddress(null);
            }}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Options">
        <PanelSectionRow>
          <ToggleField
            label="Moonbeam collection"
            description="Keep a collection in your library with every game you can stream"
            checked={settings.collection}
            onChange={(value) => { updateSettings({ collection: value }).catch((e) => console.error(e)); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Close game on PC when stream ends"
            checked={settings.quitAfter}
            onChange={(value) => { updateSettings({ quitAfter: value }).catch((e) => console.error(e)); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Replace Steam's stream"
            description="Steam's own “Stream from PC” becomes Moonbeam, instead of adding a Moonbeam menu to the ▼"
            checked={settings.replaceSteamStream}
            onChange={(value) => { updateSettings({ replaceSteamStream: value }).catch((e) => console.error(e)); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Debug logging"
            description="Detailed log and game page snapshots in ~/homebrew/logs/Moonbeam/"
            checked={settings.debugLog}
            onChange={(value) => { updateSettings({ debugLog: value }).catch((e) => console.error(e)); }}
          />
        </PanelSectionRow>
      </PanelSection>
      <NetworkScan />
    </>
  );
}

/** Keeps the Moonbeam collection in sync whenever the app list or the related settings change. */
function watchCollection(): () => void {
  let lastKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onChange = (state: State): void => {
    const { settings, apps, loaded } = state;
    const key = JSON.stringify([settings.host, settings.collection, settings.shortcutAppId, apps]);
    if (!loaded || key === lastKey) {
      return;
    }

    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncCollection(apps, settings.collection, settings.shortcutAppId)
        .then((count) => console.log(`Moonbeam: collection has ${count} games`))
        .catch((e) => console.error("Moonbeam: failed to sync collection", e));
    }, 1000);
  };

  const unsubscribe = subscribe(onChange);
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

export default definePlugin(() => {
  const unwatchCollection = watchCollection();
  loadState().catch((e) => console.error("Moonbeam: failed to load state", e));
  const unpatchGamePage = patchGamePage();
  const unwatchStreamEnd = watchStreamEnd();

  return {
    name: "Moonbeam",
    titleView: <div className={staticClasses.Title}>Moonbeam</div>,
    content: <Content />,
    icon: <FaMoon />,
    onDismount() {
      unpatchGamePage();
      unwatchStreamEnd();
      unwatchCollection();
    }
  };
});
