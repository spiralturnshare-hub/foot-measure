/**
 * オフラインモード・IndexedDB保存ロジックのユニットテスト
 * 
 * Note: IndexedDB はブラウザ環境でのみ動作するため、
 * ここではオフラインモードのロジック（データ変換・フィルタリング）をテストする。
 */

import { describe, it, expect } from "vitest";

// OfflineMeasurement の型定義をインラインで定義（テスト用）
interface OfflineMeasurementResult {
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
}

interface OfflineMeasurement {
  localId: string;
  serverId: number | null;
  synced: boolean;
  createdAt: number;
  measureDate: number;
  customerName: string | null;
  notes: string | null;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  pointsJson: unknown;
  result: OfflineMeasurementResult | null;
  footCondition: unknown;
  paperType: string;
  insoleImageDataUrl: string | null;
  insolePointsJson: unknown;
  insoleLength: number | null;
}

// オフラインデータをオンライン形式に変換するロジック（History.tsxと同じ）
function convertOfflineToDisplay(m: OfflineMeasurement) {
  return {
    id: m.localId,
    customerName: m.customerName,
    notes: m.notes,
    createdAt: m.measureDate,
    imageUrl: m.imageDataUrl,
    leftFootLength: m.result?.leftFootLength ?? null,
    rightFootLength: m.result?.rightFootLength ?? null,
    status: m.synced ? "completed" : "draft",
    isOffline: true,
    localId: m.localId,
    synced: m.synced,
  };
}

// 検索フィルタリングロジック（History.tsxと同じ）
function filterBySearch(items: { customerName: string | null }[], search: string) {
  if (!search) return items;
  return items.filter((m) =>
    m.customerName?.toLowerCase().includes(search.toLowerCase())
  );
}

describe("オフラインモード - データ変換ロジック", () => {
  const mockOfflineMeasurement: OfflineMeasurement = {
    localId: "local-001",
    serverId: null,
    synced: false,
    createdAt: 1715000000000,
    measureDate: 1715000000000,
    customerName: "テスト顧客",
    notes: "備考テスト",
    imageDataUrl: "data:image/jpeg;base64,/9j/test",
    imageWidth: 1920,
    imageHeight: 1080,
    pointsJson: null,
    result: {
      leftFootLength: 255.5,
      rightFootLength: 253.2,
      leftFootWidth: 98.3,
      rightFootWidth: 97.1,
      leftFirstIP: 180.0,
      rightFirstIP: 178.5,
      leftHeelToMp: 185.0,
      rightHeelToMp: 183.0,
      leftLEB: 45.2,
      rightLEB: 44.8,
    },
    footCondition: null,
    paperType: "A4",
    insoleImageDataUrl: null,
    insolePointsJson: null,
    insoleLength: null,
  };

  it("オフラインデータを表示形式に正しく変換できる", () => {
    const display = convertOfflineToDisplay(mockOfflineMeasurement);
    expect(display.id).toBe("local-001");
    expect(display.customerName).toBe("テスト顧客");
    expect(display.leftFootLength).toBe(255.5);
    expect(display.rightFootLength).toBe(253.2);
    expect(display.status).toBe("draft"); // 未同期は "draft"
    expect(display.isOffline).toBe(true);
    expect(display.synced).toBe(false);
  });

  it("同期済みデータは status が 'completed' になる", () => {
    const syncedMeasurement = { ...mockOfflineMeasurement, synced: true };
    const display = convertOfflineToDisplay(syncedMeasurement);
    expect(display.status).toBe("completed");
    expect(display.synced).toBe(true);
  });

  it("result が null の場合、足長・足幅は null になる", () => {
    const noResultMeasurement = { ...mockOfflineMeasurement, result: null };
    const display = convertOfflineToDisplay(noResultMeasurement);
    expect(display.leftFootLength).toBeNull();
    expect(display.rightFootLength).toBeNull();
  });

  it("顧客名なしの場合、customerName は null になる", () => {
    const noNameMeasurement = { ...mockOfflineMeasurement, customerName: null };
    const display = convertOfflineToDisplay(noNameMeasurement);
    expect(display.customerName).toBeNull();
  });
});

describe("オフラインモード - 検索フィルタリング", () => {
  const items = [
    { customerName: "田中太郎" },
    { customerName: "山田花子" },
    { customerName: null },
    { customerName: "田中次郎" },
  ];

  it("検索文字列なしの場合、全件返す", () => {
    const result = filterBySearch(items, "");
    expect(result).toHaveLength(4);
  });

  it("顧客名で絞り込みができる", () => {
    const result = filterBySearch(items, "田中");
    expect(result).toHaveLength(2);
    expect(result[0].customerName).toBe("田中太郎");
    expect(result[1].customerName).toBe("田中次郎");
  });

  it("大文字小文字を区別しない（英語名の場合）", () => {
    const englishItems = [
      { customerName: "John Smith" },
      { customerName: "Jane Doe" },
    ];
    const result = filterBySearch(englishItems, "john");
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("John Smith");
  });

  it("顧客名が null のデータは検索でヒットしない", () => {
    const result = filterBySearch(items, "null");
    expect(result).toHaveLength(0);
  });
});

describe("オフラインモード - 未同期件数カウント", () => {
  const measurements: OfflineMeasurement[] = [
    {
      localId: "local-001",
      serverId: null,
      synced: false,
      createdAt: 1715000000000,
      measureDate: 1715000000000,
      customerName: "顧客A",
      notes: null,
      imageDataUrl: "data:image/jpeg;base64,test1",
      imageWidth: 1920,
      imageHeight: 1080,
      pointsJson: null,
      result: null,
      footCondition: null,
      paperType: "A4",
      insoleImageDataUrl: null,
      insolePointsJson: null,
      insoleLength: null,
    },
    {
      localId: "local-002",
      serverId: 5,
      synced: true,
      createdAt: 1715000001000,
      measureDate: 1715000001000,
      customerName: "顧客B",
      notes: null,
      imageDataUrl: "data:image/jpeg;base64,test2",
      imageWidth: 1920,
      imageHeight: 1080,
      pointsJson: null,
      result: null,
      footCondition: null,
      paperType: "A4",
      insoleImageDataUrl: null,
      insolePointsJson: null,
      insoleLength: null,
    },
    {
      localId: "local-003",
      serverId: null,
      synced: false,
      createdAt: 1715000002000,
      measureDate: 1715000002000,
      customerName: "顧客C",
      notes: null,
      imageDataUrl: "data:image/jpeg;base64,test3",
      imageWidth: 1920,
      imageHeight: 1080,
      pointsJson: null,
      result: null,
      footCondition: null,
      paperType: "A4",
      insoleImageDataUrl: null,
      insolePointsJson: null,
      insoleLength: null,
    },
  ];

  it("未同期件数を正しくカウントできる", () => {
    const unsyncedCount = measurements.filter((m) => !m.synced).length;
    expect(unsyncedCount).toBe(2);
  });

  it("同期済み件数を正しくカウントできる", () => {
    const syncedCount = measurements.filter((m) => m.synced).length;
    expect(syncedCount).toBe(1);
  });
});
