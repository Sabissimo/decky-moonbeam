import { createMatcher } from "./match";

const COLLECTION_TAG = "Moonbeam";
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

/** Makes the "Moonbeam" collection contain exactly the streamable games, or removes it when disabled. */
export async function syncCollection(apps: readonly string[], enabled: boolean, excludeAppId: number | null): Promise<number> {
  const collectionStore = getStores().collectionStore;
  if (!collectionStore) {
    console.error("Moonbeam: collectionStore is not available");
    return 0;
  }

  if (enabled && (getStores().appStore?.allApps?.length ?? 0) === 0) {
    // Library not loaded yet, don't drop the existing collection
    console.warn("Moonbeam: library is not loaded, skipping collection sync");
    return 0;
  }

  const id = collectionStore.GetCollectionIDByUserTag(COLLECTION_TAG);
  const collection = typeof id === "string" ? collectionStore.GetCollection(id) : undefined;
  const wanted = enabled ? findStreamableApps(apps, excludeAppId) : [];

  if (wanted.length === 0) {
    await collection?.Delete();
    return 0;
  }

  if (!collection) {
    await collectionStore.NewUnsavedCollection(COLLECTION_TAG, undefined, wanted)?.Save();
    return wanted.length;
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
  return wanted.length;
}
