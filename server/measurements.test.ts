import { describe, expect, it } from "vitest";
import { calculateMeasurements } from "../client/src/lib/measurementEngine";
import { applyRegression, DEFAULT_REGRESSION_COEFFICIENTS } from "../shared/measurementTypes";
import type { MeasurementPoints } from "../shared/measurementTypes";
/**
 * 計測エンジンのユニットテスト
 */
const mockPoints: MeasurementPoints = {
  // A4用紙の4角（1000x1414px の画像上で A4=297x210mm を模擬）
  // 画像幅1000px = A4横210mm → 1px ≈ 0.21mm
  // 画像高1414px = A4縦297mm → 1px ≈ 0.21mm
  point1: { x: 100, y: 50 },   // 左上
  point2: { x: 900, y: 50 },   // 右上
  point3: { x: 100, y: 1464 }, // 左下
  point4: { x: 900, y: 1464 }, // 右下
  point5: { x: 350, y: 600 },  // 左つま先
  point6: { x: 650, y: 600 },  // 右つま先
  point7: { x: 350, y: 850 },  // 左足幅
  point8: { x: 650, y: 850 },  // 右足幅
  point9: { x: 50, y: 1200 },  // かかとライン左端
  point10: { x: 950, y: 1200 }, // かかとライン右端
};

// 横置き用モックポイント（1414x1000px の画像上で A4横置き=297x210mm を模擬）
// 横長の画像に横長のA4を配置
const mockPointsLandscape: MeasurementPoints = {
  point1: { x: 100, y: 100 },    // 左上
  point2: { x: 1314, y: 100 },   // 右上（横297mm幅）
  point3: { x: 100, y: 900 },    // 左下（縦210mm高）
  point4: { x: 1314, y: 900 },   // 右下
  point5: { x: 450, y: 300 },    // 左つま先
  point6: { x: 950, y: 300 },    // 右つま先
  point7: { x: 450, y: 500 },    // 左足幅
  point8: { x: 950, y: 500 },    // 右足幅
  point9: { x: 100, y: 750 },    // かかとライン左端
  point10: { x: 1314, y: 750 },  // かかとライン右端
};

describe("calculateMeasurements", () => {
  it("足長が正の値で算出される", () => {
    const result = calculateMeasurements(mockPoints, 1000, 1500);
    expect(result.leftFootLength).toBeGreaterThan(0);
    expect(result.rightFootLength).toBeGreaterThan(0);
  });
  it("足幅が正の値で算出される", () => {
    const result = calculateMeasurements(mockPoints, 1000, 1500);
    expect(result.leftFootWidth).toBeGreaterThan(0);
    expect(result.rightFootWidth).toBeGreaterThan(0);
  });
  it("左右の足長が近い値になる（対称な点配置）", () => {
    const result = calculateMeasurements(mockPoints, 1000, 1500);
    const diff = Math.abs((result.leftFootLength ?? 0) - (result.rightFootLength ?? 0));
    expect(diff).toBeLessThan(5); // 5mm以内の誤差
  });
  it("かかと〜MP関節が足長より短い", () => {
    const result = calculateMeasurements(mockPoints, 1000, 1500);
    expect(result.leftHeelToMp ?? 0).toBeLessThan(result.leftFootLength ?? 1000);
    expect(result.rightHeelToMp ?? 0).toBeLessThan(result.rightFootLength ?? 1000);
  });
});

describe("a4Orientation: portrait vs landscape", () => {
  it("縦置き(portrait)と横置き(landscape)で異なる計測結果になる", () => {
    // 同じ点配置でもorientation違いで結果が変わることを確認
    const resultPortrait = calculateMeasurements(mockPoints, 1000, 1500, 'portrait');
    const resultLandscape = calculateMeasurements(mockPoints, 1000, 1500, 'landscape');
    // 縦置きと横置きでは長辺・短辺が逆になるため足長が異なるはず
    expect(resultPortrait.leftFootLength).not.toBeCloseTo(resultLandscape.leftFootLength ?? 0, 0);
  });

  it("横置き(landscape)で足長が正の値で算出される", () => {
    const result = calculateMeasurements(mockPointsLandscape, 1414, 1000, 'landscape');
    expect(result.leftFootLength).toBeGreaterThan(0);
    expect(result.rightFootLength).toBeGreaterThan(0);
  });

  it("横置き(landscape)で足幅が正の値で算出される", () => {
    const result = calculateMeasurements(mockPointsLandscape, 1414, 1000, 'landscape');
    expect(result.leftFootWidth).toBeGreaterThan(0);
    expect(result.rightFootWidth).toBeGreaterThan(0);
  });

  it("横置き(landscape)でかかと〜MP関節が足長より短い", () => {
    const result = calculateMeasurements(mockPointsLandscape, 1414, 1000, 'landscape');
    expect(result.leftHeelToMp ?? 0).toBeLessThan(result.leftFootLength ?? 1000);
    expect(result.rightHeelToMp ?? 0).toBeLessThan(result.rightFootLength ?? 1000);
  });

  it("デフォルト引数(portrait)は明示的なportrait指定と同じ結果になる", () => {
    const resultDefault = calculateMeasurements(mockPoints, 1000, 1500);
    const resultPortrait = calculateMeasurements(mockPoints, 1000, 1500, 'portrait');
    expect(resultDefault.leftFootLength).toBeCloseTo(resultPortrait.leftFootLength ?? 0, 5);
    expect(resultDefault.rightFootLength).toBeCloseTo(resultPortrait.rightFootLength ?? 0, 5);
  });
});

describe("applyRegression", () => {
  it("デフォルト係数で推定値が算出される", () => {
    const measurement = {
      leftFootLength: 250,
      rightFootLength: 252,
      leftFootWidth: 95,
      rightFootWidth: 96,
      leftHeelToMp: 150,
      rightHeelToMp: 151,
    };
    const result = applyRegression(measurement, DEFAULT_REGRESSION_COEFFICIENTS);
    expect(result.leftShoeSize).toBeDefined();
    expect(result.rightShoeSize).toBeDefined();
  });
  it("足長が大きいほど推定シューズサイズが大きい", () => {
    const small = applyRegression(
      { leftFootLength: 230, rightFootLength: 230, leftFootWidth: 90, rightFootWidth: 90, leftHeelToMp: 138, rightHeelToMp: 138 },
      DEFAULT_REGRESSION_COEFFICIENTS
    );
    const large = applyRegression(
      { leftFootLength: 270, rightFootLength: 270, leftFootWidth: 100, rightFootWidth: 100, leftHeelToMp: 162, rightHeelToMp: 162 },
      DEFAULT_REGRESSION_COEFFICIENTS
    );
    expect((large.leftShoeSize ?? 0)).toBeGreaterThan((small.leftShoeSize ?? 0));
  });
  it("null値があっても推定値がnullになる", () => {
    const result = applyRegression(
      { leftFootLength: null, rightFootLength: null, leftFootWidth: null, rightFootWidth: null, leftHeelToMp: null, rightHeelToMp: null },
      DEFAULT_REGRESSION_COEFFICIENTS
    );
    expect(result.leftShoeSize).toBeUndefined();
  });
});
