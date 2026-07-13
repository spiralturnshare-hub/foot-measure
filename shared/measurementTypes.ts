/**
 * 計測ウィジェットで使用する点・線の座標定義
 * 仕様書の識別子に準拠
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Canvas上の全計測点・線の座標
 */
export interface MeasurementPoints {
  /** A4枠の4角 */
  point1: Point; // 左上
  point2: Point; // 右上
  point3: Point; // 左下
  point4: Point; // 右下

  /** つま先ライン制御点 */
  point5: Point; // 左足つま先ライン（L、黄色）
  point6: Point; // 右足つま先ライン（R、黄色）

  /** 足幅ライン制御点（赤） */
  point7: Point; // 左足幅（L、赤）
  point8: Point; // 右足幅（R、赤）

  /** 点線1（かかとライン）の端点 */
  point9: Point;  // 左端
  point10: Point; // 右端

  /** 母子丘最突出部計測モード用制御点 */
  point11?: Point; // 左足母子丘横線の位置制御（線4上を上下移動）
  point12?: Point; // 右足母子丘横線の位置制御（線5上を上下移動）
  /** 1stIP横線（線10/11）高さ制御点（bunionモード専用） */
  point13?: Point; // 左足1stIP横線の高さ制御（線4上を上下移動）
  point14?: Point; // 右足1stIP横線の高さ制御（線5上を上下移動）
  /** 屈折点（点線1上をスライド） */
  point15?: Point | null; // 屈折点1
  point16?: Point | null; // 屈折点2
}

/**
 * 屈折ユニットの状態
 * 左足用（ユニット1）・右足用（ユニット2）それぞれ独立して管理
 */
export interface FlexUnitState {
  /** 常時アクティブ（常にtrue） */
  active: boolean;
  /** 屈折基準線の回転角度（ラジアン、0=水平） */
  angle: number;
  /** 屈折軸の長さ（ピクセル単位、未設定時はデフォルト値を使用） */
  axisLength?: number;
}

/** デフォルトの屈折ユニット状態 */
export const DEFAULT_FLEX_UNIT_STATE: FlexUnitState = {
  active: true,
  angle: 0,
};

/**
 * 算出された実寸値（mm）
 */
export interface MeasurementResult {
  leftFootLength: number | null;
  rightFootLength: number | null;
  leftFootWidth: number | null;
  rightFootWidth: number | null;
  leftHeelToMp: number | null;
  rightHeelToMp: number | null;
  leftFirstIP: number | null;
  rightFirstIP: number | null;
}

/**
 * 重回帰推定値
 * 係数・定数は後日提供されるため差し替え可能な構造
 */
export interface RegressionCoefficients {
  /** 左足推定サイズ（例: シューズサイズ cm） */
  leftShoeSize?: { intercept: number; lengthCoeff: number; widthCoeff: number };
  rightShoeSize?: { intercept: number; lengthCoeff: number; widthCoeff: number };
  /** 追加の推定項目は後日拡張 */
  [key: string]: unknown;
}

export interface RegressionResult {
  leftShoeSize?: number | null;
  rightShoeSize?: number | null;
  [key: string]: unknown;
}

/**
 * デフォルトの重回帰係数（後日実際の係数に差し替え）
 */
export const DEFAULT_REGRESSION_COEFFICIENTS: RegressionCoefficients = {
  leftShoeSize: { intercept: 0, lengthCoeff: 0.1, widthCoeff: 0 },
  rightShoeSize: { intercept: 0, lengthCoeff: 0.1, widthCoeff: 0 },
};

/**
 * 重回帰推定値を算出する
 */
export function applyRegression(
  result: MeasurementResult,
  coefficients: RegressionCoefficients = DEFAULT_REGRESSION_COEFFICIENTS
): RegressionResult {
  const reg: RegressionResult = {};

  if (coefficients.leftShoeSize && result.leftFootLength != null) {
    const { intercept, lengthCoeff, widthCoeff } = coefficients.leftShoeSize;
    reg.leftShoeSize =
      intercept +
      lengthCoeff * result.leftFootLength +
      widthCoeff * (result.leftFootWidth ?? 0);
  }

  if (coefficients.rightShoeSize && result.rightFootLength != null) {
    const { intercept, lengthCoeff, widthCoeff } = coefficients.rightShoeSize;
    reg.rightShoeSize =
      intercept +
      lengthCoeff * result.rightFootLength +
      widthCoeff * (result.rightFootWidth ?? 0);
  }

  return reg;
}

/**
 * A4用紙サイズ（mm）
 */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/**
 * 対応用紙サイズの種類
 */
export type PaperType = 'A4' | 'B5' | 'Letter';

/**
 * 用紙サイズ定義（mm）- 短辺 × 長辺
 */
export const PAPER_SIZES: Record<PaperType, { width: number; height: number; label: string }> = {
  A4:     { width: 210, height: 297, label: 'A4' },
  B5:     { width: 182, height: 257, label: 'B5' },
  Letter: { width: 216, height: 279, label: 'Letter' },
};

/**
 * 用紙タイプと向きから実寸（mm）を返す
 * portrait: 点1〜2が短辺, 点1〜3が長辺
 * landscape: 点1〜2が長辺, 点1〜3が短辺
 */
export function getPaperDimensions(
  paperType: PaperType,
  orientation: 'portrait' | 'landscape'
): { widthMm: number; heightMm: number } {
  const { width, height } = PAPER_SIZES[paperType];
  if (orientation === 'landscape') {
    return { widthMm: height, heightMm: width }; // 点1〜2が長辺
  }
  return { widthMm: width, heightMm: height }; // 点1〜2が短辺
}
