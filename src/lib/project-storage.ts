import type { DetectionSettings, KeepRange, VideoMetadata } from "./types";

const DATABASE = "autocut-projects";
const STORE = "projects";

export type PersistedProject = {
  id: string;
  name: string;
  sourceFingerprint: string;
  metadata: VideoMetadata;
  settings: DetectionSettings;
  ranges: KeepRange[];
  updatedAt: number;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProject(project: PersistedProject) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(project);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function sourceFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
