import { createMatcher } from "./match";

const COLLECTION_TAG = "Moonbeam";
const HOST_COLLECTION_PREFIX = "Moonbeam: ";
const APP_TYPE_GAME = 1;
const APP_TYPE_SHORTCUT = 1073741824;

interface AppOverview {
  appid: number;
  app_type: number;
  display_name: string;
}

interface Collection {
  AsDragDropCollection(): { AddApps(overviews: AppOverview[]): void; RemoveApps(overviews: AppOverview[]): void };
  Save(): Promise<void>;
  Delete(): Promise<void>;
  allApps: AppOverview[];
  apps: { has(appId: number): boolean };
}

interface CollectionStore {
  GetCollectionIDByUserTag(tag: string): string | null;
  GetCollection(id: string): Collection | undefined;
  NewUnsavedCollection(tag: string, filter: unknown, overviews: AppOverview[]): Collection | undefined;
  userCollections?: Array<Collection & { displayName?: string }>;
}

function getStores(): { appStore?: { allApps?: AppOverview[] }; collectionStore?: CollectionStore } {
  return window as unknown as { appStore?: { allApps?: AppOverview[] }; collectionStore?: CollectionStore };
}

/** Library games (and non-Steam shortcuts) that have a matching host app. */
export function findStreamableApps(apps: readonly string[], excludeAppId: number | null): AppOverview[] {
  const match = createMatcher(apps);
  return (getStores().appStore?.allApps ?? []).filter((overview) =>
    (overview.app_type === APP_TYPE_GAME || overview.app_type === APP_TYPE_SHORTCUT) &&
    overview.appid !== excludeAppId &&
    typeof overview.display_name === "string" &&
    match(overview.display_name) !== null);
}

/** Makes the collection with the tag contain exactly the given games, or removes it when there are none. */
async function syncOne(collectionStore: CollectionStore, tag: string, wanted: AppOverview[]): Promise<void> {
  const id = collectionStore.GetCollectionIDByUserTag(tag);
  const collection = typeof id === "string" ? collectionStore.GetCollection(id) : undefined;

  if (wanted.length === 0) {
    await collection?.Delete();
    return;
  }

  if (!collection) {
    await collectionStore.NewUnsavedCollection(tag, undefined, wanted)?.Save();
    return;
  }

  const wantedIds = new Set(wanted.map((overview) => overview.appid));
  const toRemove = collection.allApps.filter((overview) => !wantedIds.has(overview.appid));
  const toAdd = wanted.filter((overview) => !collection.apps.has(overview.appid));
  if (toRemove.length > 0) {
    collection.AsDragDropCollection().RemoveApps(toRemove);
  }
  if (toAdd.length > 0) {
    collection.AsDragDropCollection().AddApps(toAdd);
  }
  if (toRemove.length > 0 || toAdd.length > 0) {
    await collection.Save();
  }
}

export function hostCollectionTag(host: string): string {
  return `${HOST_COLLECTION_PREFIX}${host}`;
}

/**
 * Keeps the "Moonbeam" collection (games of any PC) and, with several PCs, a "Moonbeam: <PC>"
 * collection per PC. Removes them when disabled. Returns the number of games in "Moonbeam".
 */
export async function syncCollections(hosts: ReadonlyArray<{ name: string; apps: readonly string[] }>, enabled: boolean,
  excludeAppId: number | null): Promise<number> {
  const collectionStore = getStores().collectionStore;
  if (!collectionStore) {
    console.error("Moonbeam: collectionStore is not available");
    return 0;
  }

  if (enabled && (getStores().appStore?.allApps?.length ?? 0) === 0) {
    // Library not loaded yet, don't drop the existing collections
    console.warn("Moonbeam: library is not loaded, skipping collection sync");
    return 0;
  }

  const all = enabled ? findStreamableApps(hosts.flatMap((host) => host.apps), excludeAppId) : [];
  await syncOne(collectionStore, COLLECTION_TAG, all);

  // With one PC its collection would be the same as "Moonbeam"
  const perHost = enabled && hosts.length > 1 ? hosts : [];
  for (const host of perHost) {
    await syncOne(collectionStore, hostCollectionTag(host.name), findStreamableApps(host.apps, excludeAppId));
  }

  // Collections of PCs that are gone (or all of them when not wanted)
  const keep = new Set(perHost.map((host) => hostCollectionTag(host.name)));
  for (const collection of collectionStore.userCollections ?? []) {
    const name = collection.displayName;
    if (typeof name === "string" && name.startsWith(HOST_COLLECTION_PREFIX) && !keep.has(name)) {
      await collection.Delete();
    }
  }
  return all.length;
}
