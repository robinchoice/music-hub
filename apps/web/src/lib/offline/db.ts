import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type OfflineQuality = 'stream' | 'original';

export interface OfflineVersionRecord {
  versionId: string;
  trackId: string;
  projectId: string;
  title: string;
  versionNumber: number;
  downloadedAt: number;
  sizeBytes: number;
  mimeType: string;
  quality: OfflineQuality;
}

interface MusicHubDB extends DBSchema {
  offlineVersions: {
    key: string;
    value: OfflineVersionRecord;
    indexes: {
      byTrack: string;
      byProject: string;
    };
  };
}

let _db: IDBPDatabase<MusicHubDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<MusicHubDB>> {
  if (_db) return _db;
  _db = await openDB<MusicHubDB>('musichub', 1, {
    upgrade(db) {
      const store = db.createObjectStore('offlineVersions', { keyPath: 'versionId' });
      store.createIndex('byTrack', 'trackId');
      store.createIndex('byProject', 'projectId');
    },
  });
  return _db;
}

export async function getAllOfflineVersions(): Promise<OfflineVersionRecord[]> {
  const db = await getDb();
  return db.getAll('offlineVersions');
}

export async function getOfflineVersion(versionId: string): Promise<OfflineVersionRecord | undefined> {
  const db = await getDb();
  return db.get('offlineVersions', versionId);
}

export async function saveOfflineVersion(record: OfflineVersionRecord): Promise<void> {
  const db = await getDb();
  await db.put('offlineVersions', record);
}

export async function deleteOfflineVersion(versionId: string): Promise<void> {
  const db = await getDb();
  await db.delete('offlineVersions', versionId);
}
