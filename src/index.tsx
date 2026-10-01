import { ButtonItem, ConfirmModal, Dropdown, Field, PanelSection, PanelSectionRow, TextField, ToggleField, showModal, staticClasses } from "@decky/ui";
import { Host, ScannedHost, State, checkHosts, loadState, refreshHostApps, scanHosts, shutdownHost, subscribe, updateSettings,
  useMoonbeamState, wakeHost } from "./store";
import { definePlugin, toaster } from "@decky/api";
import { MoonbeamIcon } from "./icon";
import { patchGamePage } from "./gamepage";
import { watchStreamEnd } from "./steam";
import { syncCollections } from "./collection";
import { useEffect, useState } from "react";

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

const STATUS_INTERVAL_MS = 10000;
const WAKING_INTERVAL_MS = 3000;
const WAKING_TIMEOUT_MS = 120000;

/** Whether the PC's app list has the "Shut down" app that Shut down starts. */
function hasShutdownApp(host: Host): boolean {
  return host.apps.some((app) => app.toLowerCase().replace(/[^0-9a-z]/g, "") === "shutdown");
}

/** Each PC's status, with Wake (offline) or Shut down (online, when the PC has the app for it). */
function PcPower({ hosts }: { hosts: Host[] }) {
  const [online, setOnline] = useState<Record<string, boolean> | null>(null);
  // PCs woken recently (checked more often until they answer), by name
  const [waking, setWaking] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const anyWaking = Object.values(waking).some((started) => Date.now() - started < WAKING_TIMEOUT_MS);
  useEffect(() => {
    let active = true;
    const update = (): void => {
      checkHosts()
        .then((result) => {
          if (!active) {
            return;
          }
          setOnline(result);
          setWaking((current) => {
            const next = { ...current };
            for (const name of Object.keys(next)) {
              if (result[name]) {
                toast(`${name} is awake`);
                delete next[name];
              } else if (Date.now() - next[name] >= WAKING_TIMEOUT_MS) {
                toast(`${name} didn't wake up. Check that Wake-on-LAN is enabled on it.`);
                delete next[name];
              }
            }
            return next;
          });
        })
        .catch((e) => console.error(e));
    };
    update();
    const timer = setInterval(update, anyWaking ? WAKING_INTERVAL_MS : STATUS_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [anyWaking]);

  const wake = async (host: Host): Promise<void> => {
    setBusy(host.name);
    try {
      const result = await wakeHost(host.name);
      if (result.ok) {
        setWaking((current) => ({ ...current, [host.name]: Date.now() }));
        toast(`Wake signal sent to ${host.name}`);
      } else {
        toast(`Couldn't wake ${host.name}: ${result.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const shutDown = async (host: Host): Promise<void> => {
    setBusy(host.name);
    try {
      const result = await shutdownHost(host.name);
      toast(result.ok ? `${host.name} is shutting down` : `Couldn't shut down ${host.name}: ${result.error ?? "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const confirmShutDown = (host: Host): void => {
    showModal(
      <ConfirmModal
        strTitle={`Shut down ${host.name}?`}
        strDescription="A game running on it is closed without saving."
        strOKButtonText="Shut down"
        bDestructiveWarning
        onOK={() => { shutDown(host).catch((e) => console.error(e)); }}
      />
    );
  };

  return (
    <PanelSection title="Power">
      {hosts.map((host) => {
        const isOnline = online?.[host.name] === true;
        const status = online === null ? "Checking..." : waking[host.name] !== undefined ? "Waking up..." : isOnline ? "Online" : "Offline";
        return (
          <PanelSectionRow key={host.name}>
            <Field label={host.name} description={status} bottomSeparator="none" />
            {isOnline
              ? hasShutdownApp(host) &&
                <ButtonItem layout="below" disabled={busy !== null} onClick={() => confirmShutDown(host)}>Shut down</ButtonItem>
              : <ButtonItem layout="below" disabled={busy !== null || !host.canWake || online === null} onClick={() => { wake(host).catch((e) => console.error(e)); }}>
                {host.canWake ? "Wake" : "Wake (connect once in Moonlight first)"}
              </ButtonItem>}
          </PanelSectionRow>
        );
      })}
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
          <Field label="Preferred PC" description="The PC the address below belongs to" />
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
      <PcPower hosts={hosts} />
      <PanelSection title="Options">
        <PanelSectionRow>
          <ToggleField
            label="Moonbeam collection"
            description={hosts.length > 1
              ? "Keep collections in your library with every game you can stream, from any PC and from each PC"
              : "Keep a collection in your library with every game you can stream"}
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
            description="In the ▼ menu, PCs that have the game offer only Moonbeam, not Steam's “Stream from”"
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
    const { settings, hosts, loaded } = state;
    const key = JSON.stringify([settings.collection, settings.shortcutAppId, hosts.map((host) => [host.name, host.apps])]);
    if (!loaded || key === lastKey) {
      return;
    }

    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncCollections(hosts, settings.collection, settings.shortcutAppId)
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
    icon: <MoonbeamIcon />,
    onDismount() {
      unpatchGamePage();
      unwatchStreamEnd();
      unwatchCollection();
    }
  };
});
