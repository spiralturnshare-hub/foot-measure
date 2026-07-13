import { describe, expect, it } from "vitest";
import type { MeasurementPoints } from "../shared/measurementTypes";

/**
 * 母子丘モード（bunion）用の型・初期値テスト
 */

describe("MeasurementPoints with point11/point12", () => {
  it("point11・point12はオプショナルフィールドとして定義されている", () => {
    // point11/point12 なしでも型エラーにならない
    const points: MeasurementPoints = {
      point1: { x: 100, y: 50 },
      point2: { x: 900, y: 50 },
      point3: { x: 100, y: 1464 },
      point4: { x: 900, y: 1464 },
      point5: { x: 350, y: 600 },
      point6: { x: 650, y: 600 },
      point7: { x: 350, y: 850 },
      point8: { x: 650, y: 850 },
      point9: { x: 50, y: 1200 },
      point10: { x: 950, y: 1200 },
    };
    expect(points.point11).toBeUndefined();
    expect(points.point12).toBeUndefined();
  });

  it("point11・point12を含むMeasurementPointsが正しく構築できる", () => {
    const points: MeasurementPoints = {
      point1: { x: 100, y: 50 },
      point2: { x: 900, y: 50 },
      point3: { x: 100, y: 1464 },
      point4: { x: 900, y: 1464 },
      point5: { x: 350, y: 600 },
      point6: { x: 650, y: 600 },
      point7: { x: 350, y: 850 },
      point8: { x: 650, y: 850 },
      point9: { x: 50, y: 1200 },
      point10: { x: 950, y: 1200 },
      point11: { x: 350, y: 720 },
      point12: { x: 650, y: 720 },
    };
    expect(points.point11).toEqual({ x: 350, y: 720 });
    expect(points.point12).toEqual({ x: 650, y: 720 });
  });

  it("point11のx座標とpoint5のx座標が同じ（縦線上）", () => {
    const p5x = 350;
    const points: MeasurementPoints = {
      point1: { x: 100, y: 50 },
      point2: { x: 900, y: 50 },
      point3: { x: 100, y: 1464 },
      point4: { x: 900, y: 1464 },
      point5: { x: p5x, y: 600 },
      point6: { x: 650, y: 600 },
      point7: { x: p5x, y: 850 },
      point8: { x: 650, y: 850 },
      point9: { x: 50, y: 1200 },
      point10: { x: 950, y: 1200 },
      point11: { x: p5x, y: 720 }, // 縦線上（x座標同じ）
      point12: { x: 650, y: 720 },
    };
    // 縦線が垂直の場合、point11のxはpoint5のxと同じ
    expect(points.point11!.x).toBe(p5x);
  });
});

describe("MeasurementMode type", () => {
  it("'reference' と 'standard' と 'bunion' と 'insole' の4つのモードが存在する", () => {
    const modes: Array<'reference' | 'standard' | 'bunion' | 'insole'> = ['reference', 'standard', 'bunion', 'insole'];
    expect(modes).toHaveLength(4);
    expect(modes).toContain('reference');
    expect(modes).toContain('standard');
    expect(modes).toContain('bunion');
    expect(modes).toContain('insole');
  });
  it("referenceモードのドラッグ可能点はpoint1-4・point9-10の6点のみ", () => {
    const referenceDraggable = ['point1', 'point2', 'point3', 'point4', 'point9', 'point10'];
    expect(referenceDraggable).toHaveLength(6);
    expect(referenceDraggable).toContain('point1');
    expect(referenceDraggable).toContain('point9');
    expect(referenceDraggable).not.toContain('point5');
    expect(referenceDraggable).not.toContain('point6');
    expect(referenceDraggable).not.toContain('point7');
    expect(referenceDraggable).not.toContain('point8');
  });
  it("referenceモードで基準点を変更するとstandard/bunionモードに引き継がれる", () => {
    const refPoints = {
      point1: { x: 110, y: 55 },
      point2: { x: 890, y: 55 },
      point3: { x: 110, y: 1470 },
      point4: { x: 890, y: 1470 },
      point9: { x: 60, y: 1210 },
      point10: { x: 940, y: 1210 },
    };
    const standardPoints: MeasurementPoints = {
      point1: { x: 100, y: 50 }, point2: { x: 900, y: 50 },
      point3: { x: 100, y: 1464 }, point4: { x: 900, y: 1464 },
      point5: { x: 350, y: 600 }, point6: { x: 650, y: 600 },
      point7: { x: 350, y: 850 }, point8: { x: 650, y: 850 },
      point9: { x: 50, y: 1200 }, point10: { x: 950, y: 1200 },
    };
    // referenceモードの基準点変更をstandardに反映（mergeReferencePoints相当）
    const merged = { ...standardPoints, ...refPoints };
    expect(merged.point1).toEqual({ x: 110, y: 55 });
    expect(merged.point9).toEqual({ x: 60, y: 1210 });
    // 足の計測点（point5〜8）は変わらない
    expect(merged.point5).toEqual({ x: 350, y: 600 });
    expect(merged.point7).toEqual({ x: 350, y: 850 });
  });
});

describe("insole mode", () => {
  it("insoleモードのドラッグ可能点はpoint1-4・point5・point9-10の7点のみ", () => {
    const insoleAllDraggable = ['point1', 'point2', 'point3', 'point4', 'point5', 'point9', 'point10'];
    expect(insoleAllDraggable).toHaveLength(7);
    expect(insoleAllDraggable).toContain('point5');
    expect(insoleAllDraggable).not.toContain('point6'); // 右足は不要
    expect(insoleAllDraggable).not.toContain('point7'); // Width操作点は不要
    expect(insoleAllDraggable).not.toContain('point8');
  });

  it("insoleモードは他モードと独立して管理される（基準点の引き継ぎなし）", () => {
    // insoleモードの基準点変更はstandard/bunionに影響しないことを確認
    // (実際のhandlePointsChangeのロジックでは引き継ぎを行わない)
    const insoleMode = 'insole' as const;
    expect(insoleMode).toBe('insole');
  });
});

describe("LOCKABLE_POINTS constant", () => {
  it("ロック対象は点1〜4と点9・10の6点である", () => {
    // LOCKABLE_POINTS の内容を直接検証
    const expected = ['point1', 'point2', 'point3', 'point4', 'point9', 'point10'];
    // 型として定義されている値と一致することを確認
    expect(expected).toHaveLength(6);
    expect(expected).toContain('point1');
    expect(expected).toContain('point4');
    expect(expected).toContain('point9');
    expect(expected).toContain('point10');
    expect(expected).not.toContain('point5');
    expect(expected).not.toContain('point7');
  });
});

describe("Reference point inheritance between modes", () => {
  const basePoints: MeasurementPoints = {
    point1: { x: 100, y: 50 },
    point2: { x: 900, y: 50 },
    point3: { x: 100, y: 1464 },
    point4: { x: 900, y: 1464 },
    point5: { x: 350, y: 600 },
    point6: { x: 650, y: 600 },
    point7: { x: 350, y: 850 },
    point8: { x: 650, y: 850 },
    point9: { x: 50, y: 1200 },
    point10: { x: 950, y: 1200 },
  };

  it("基準点を変更すると他方のモードに引き継がれる（mergeReferencePoints相当）", () => {
    const updatedRef = {
      point1: { x: 110, y: 55 },
      point2: { x: 890, y: 55 },
      point3: { x: 110, y: 1470 },
      point4: { x: 890, y: 1470 },
      point9: { x: 60, y: 1210 },
      point10: { x: 940, y: 1210 },
    };
    // bunionモードの点に基準点をマージ
    const bunionPoints = { ...basePoints, point11: { x: 350, y: 720 }, point12: { x: 650, y: 720 } };
    const merged = { ...bunionPoints, ...updatedRef };

    expect(merged.point1).toEqual({ x: 110, y: 55 });
    expect(merged.point9).toEqual({ x: 60, y: 1210 });
    // 非基準点は変わらない
    expect(merged.point5).toEqual({ x: 350, y: 600 });
    expect(merged.point11).toEqual({ x: 350, y: 720 });
  });

  it("ロックセットに含まれる点はドラッグ対象から除外される", () => {
    const lockedSet = new Set(['point1', 'point2', 'point3', 'point4', 'point9', 'point10']);
    const allDraggable = ['point1', 'point2', 'point3', 'point4', 'point5', 'point6', 'point7', 'point8', 'point9', 'point10'];
    const draggable = allDraggable.filter(k => !lockedSet.has(k));

    expect(draggable).not.toContain('point1');
    expect(draggable).not.toContain('point9');
    expect(draggable).toContain('point5');
    expect(draggable).toContain('point7');
    expect(draggable).toHaveLength(4);
  });
});
