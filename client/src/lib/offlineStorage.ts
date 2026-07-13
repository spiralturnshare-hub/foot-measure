/**
 * offlineStorage.ts
 * IndexedDBを使ったオフライン計測データの一時保存・取得・同期ユーティリティ
 *
 * オフラインモード時に計測結果をブラウザ内に保存し、
 * オンライン復帰時にサーバーDBへ同期する。
 */

const DB_NAME = "feet-meter-offline";
const DB_VERSION = 1;
const STORE_MEASUREMENTS = "measurements";

export interface OfflineMeasurement {
  /** ローカル一意ID（タイムスタンプベース） */
  localId: string;
  /** サーバー同期後に付与されるサーバーID（未同期時はnull） */
  serverId: number | null;
  /** 同期済みフラグ */
  synced: boolean;
  /** 作成日時（UTC ms） */
  createdAt: number;
  /** 顧客名 */
  customerName: string | null;
  /** 備考 */
  notes: string | null;
  /** 計測日 */
  measureDate: number;
  /** 足画像（DataURL） */
  imageDataUrl: string | null;
  /** 画像幅 */
  imageWidth: number;
  /** 画像高さ */
  imageHeight: number;
  /** 計測点JSON（standardとbunionを含む） */
  pointsJson: unknown;
  /** 計測結果 */
  result: {
    leftFootLength: number | null;
    rightFootLength: number | null;
    leftFootWidth: number | null;
    rightFootWidth: number | null;
    leftFirstIP: number | null;
    rightFirstIP: number | null;
    leftHeelToMp: number | null;
    rightHeelToMp: number | null;
    leftLEB: number | null;
    rightLEB: number | null;
  } | null;
  /** 足の状態評価 */
  footCondition: unknown;
  /** 用紙種類 */
  paperType: string;
  /** 中敷き画像（DataURL） */
  insoleImageDataUrl: string | null;
  /** 中敷き計測点JSON */
  insolePointsJson: unknown;
  /** 中敷きサイズmm */
  insoleLength: number | null;
}

/** IndexedDBを開く（なければ作成） */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_MEASUREMENTS)) {
        const store = db.createObjectStore(STORE_MEASUREMENTS, { keyPath: "localId" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** オフライン計測データを保存する */
export async function saveOfflineMeasurement(
  data: Omit<OfflineMeasurement, "localId" | "synced" | "createdAt">
): Promise<OfflineMeasurement> {
  const db = await openDB();
  const record: OfflineMeasurement = {
    ...data,
    localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    synced: false,
    createdAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEASUREMENTS, "readwrite");
    const store = tx.objectStore(STORE_MEASUREMENTS);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/** オフライン計測データを更新する */
export async function updateOfflineMeasurement(
  localId: string,
  updates: Partial<OfflineMeasurement>
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEASUREMENTS, "readwrite");
    const store = tx.objectStore(STORE_MEASUREMENTS);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const existing = getReq.result as OfflineMeasurement | undefined;
      if (!existing) {
        reject(new Error(`Record ${localId} not found`));
        return;
      }
      const updated = { ...existing, ...updates };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** 全オフライン計測データを取得する（新しい順） */
export async function getAllOfflineMeasurements(): Promise<OfflineMeasurement[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEASUREMENTS, "readonly");
    const store = tx.objectStore(STORE_MEASUREMENTS);
    const req = store.getAll();
    req.onsuccess = () => {
      const results = (req.result as OfflineMeasurement[]).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 未同期のオフライン計測データを取得する */
export async function getUnsyncedMeasurements(): Promise<OfflineMeasurement[]> {
  const all = await getAllOfflineMeasurements();
  return all.filter((m) => !m.synced);
}

/** オフライン計測データを削除する */
export async function deleteOfflineMeasurement(localId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEASUREMENTS, "readwrite");
    const store = tx.objectStore(STORE_MEASUREMENTS);
    const req = store.delete(localId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 特定のオフライン計測データを取得する */
export async function getOfflineMeasurement(localId: string): Promise<OfflineMeasurement | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEASUREMENTS, "readonly");
    const store = tx.objectStore(STORE_MEASUREMENTS);
    const req = store.get(localId);
    req.onsuccess = () => resolve((req.result as OfflineMeasurement) ?? null);
    req.onerror = () => reject(req.error);
  });
}
