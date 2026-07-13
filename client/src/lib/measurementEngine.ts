/**
 * 計測エンジン
 * ホモグラフィ変換によるパース補正と実寸算出
 *
 * ■ 計測方法（共通ルール）
 * すべての計測は「2本の平行線間の最短距離」を算出し、mmに換算する。
 * 平行な2直線の最短距離 = 一方の直線上の任意点から他方の直線への垂線距離
 * = |（基準点 - 点線1上の点） · 点線1の法線ベクトル|
 *
 * ■ 線の定義
 * 点線1: 点9〜点10を通る直線（かかとライン、全計測の基準線）
 * 線2:   point5（またはbunionモードではpoint13）を通る、点線1に平行な直線（左足つま先ライン）
 * 線3:   point6（またはbunionモードではpoint14）を通る、点線1に平行な直線（右足つま先ライン）
 * 点線6: 左縦線（線4）の外側（左）に leftWidthHalf だけ離れた縦の点線
 * 点線7: 左縦線（線4）の内側（右）に leftWidthHalf だけ離れた縦の点線
 * 点線8: 右縦線（線5）の外側（右）に rightWidthHalf だけ離れた縦の点線
 * 点線9: 右縦線（線5）の内側（左）に rightWidthHalf だけ離れた縦の点線
 * 線10:  point13（1stIP制御点）の縦線上射影を通る、点線1に平行な直線（左1stIPライン）
 * 線11:  point14（1stIP制御点）の縦線上射影を通る、点線1に平行な直線（右1stIPライン）
 * 線12:  point11（HtoB制御点）の縦線上射影を通る、点線1に平行な直線（左HtoBライン）
 * 線13:  point12（HtoB制御点）の縦線上射影を通る、点線1に平行な直線（右HtoBライン）
 *
 * ■ 計測項目
 * 左足長:   線2  と 点線1 の最短距離 → mm変換
 * 右足長:   線3  と 点線1 の最短距離 → mm変換
 * 左足幅:   点線6 と 点線7 の最短距離 → mm変換
 * 右足幅:   点線8 と 点線9 の最短距離 → mm変換
 * 左1stIP:  線10 と 点線1 の最短距離 → mm変換
 * 右1stIP:  線11 と 点線1 の最短距離 → mm変換
 * 左HtoB:   線12 と 点線1 の最短距離 → mm変換
 * 右HtoB:   線13 と 点線1 の最短距離 → mm変換
 */

import type { MeasurementPoints, MeasurementResult, FlexUnitState } from "../../../shared/measurementTypes";
import { A4_WIDTH_MM, A4_HEIGHT_MM, getPaperDimensions } from "../../../shared/measurementTypes";
import type { PaperType } from "../../../shared/measurementTypes";
import { Matrix, EigenvalueDecomposition } from "ml-matrix";

export interface Point {
  x: number;
  y: number;
}

// ---- ホモグラフィ変換 ----

/**
 * 正規化ヘルパー: 点群を重心0・平均距離√2に正規化し、変換行列Tを返す
 */
function normalizePoints(pts: [Point, Point, Point, Point]): {
  normalized: [Point, Point, Point, Point];
  T: number[]; // 3x3行列（行優先）
} {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const meanDist =
    pts.reduce((sum, p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return sum + Math.sqrt(dx * dx + dy * dy);
    }, 0) / 4;
  const s = Math.sqrt(2) / (meanDist || 1);
  const normalized = pts.map((p) => ({
    x: s * (p.x - cx),
    y: s * (p.y - cy),
  })) as [Point, Point, Point, Point];
  // T = [[s,0,-s*cx],[0,s,-s*cy],[0,0,1]]
  const T = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  return { normalized, T };
}

/** 3x3行列の逆行列（行優先配列） */
function inv3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, k] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) throw new Error("singular matrix");
  const inv = 1 / det;
  return [
    (e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv,
    (f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/** 3x3行列の積（行優先配列） */
function mul3x3(A: number[], B: number[]): number[] {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}

/**
 * 4点対応からホモグラフィ行列を算出（Normalized DLT + SVD）
 * src: 画像上の4点 (p1=TL, p2=TR, p3=BL, p4=BR)
 * dst: 正規化された矩形 (A4サイズ相当)
 */
export function computeHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point]
): number[] | null {
  try {
    // --- 正規化 ---
    const { normalized: srcN, T: Tsrc } = normalizePoints(src);
    const { normalized: dstN, T: Tdst } = normalizePoints(dst);

    // --- DLT行列構築（正規化済み座標で） ---
    const rows: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const { x: sx, y: sy } = srcN[i];
      const { x: dx, y: dy } = dstN[i];
      rows.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
      rows.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
    }

    // --- A^T A の固有値分解で最小固有値に対応する固有ベクトルを取得 ---
    // A は 8x9 (m<n) のため SVD の代わりに A^T A (9x9) の固有値分解を使用
    const Amat = new Matrix(rows);
    const AtA = Amat.transpose().mmul(Amat); // 9x9
    const eig = new EigenvalueDecomposition(AtA, { assumeSymmetric: true });
    // 固有値は昇順に並ぶ。最小固有値（インデックス0）に対応する固有ベクトルがh
    const eigVecs = eig.eigenvectorMatrix; // 9x9
    const hVec: number[] = [];
    for (let r = 0; r < 9; r++) hVec.push(eigVecs.get(r, 0)); // 最初の列が最小固有値

    // --- 非正規化: H = Tdst^{-1} * Hn * Tsrc ---
    const Hn = hVec; // 既に行優先 3x3 として扱う
    const TdstInv = inv3x3(Tdst);
    const H = mul3x3(TdstInv, mul3x3(Hn, Tsrc));

    // h[8] で正規化
    if (Math.abs(H[8]) < 1e-15) return null;
    return H.map((v) => v / H[8]);
  } catch {
    return null;
  }
}

/**
 * ホモグラフィ行列でピクセル座標を変換
 */
export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const x = (h[0] * p.x + h[1] * p.y + h[2]) / w;
  const y = (h[3] * p.x + h[4] * p.y + h[5]) / w;
  return { x, y };
}

// ---- 実寸算出 ----

/**
 * 2点間のユークリッド距離
 */
export function pixelDistance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * A4用紙の4角からホモグラフィ行列とmm/pixel比率を算出
 */
export function computeMmPerPixel(
  points: MeasurementPoints,
  a4Orientation: 'portrait' | 'landscape' = 'portrait',
  paperType: PaperType = 'A4'
): {
  mmPerPixelH: number;
  mmPerPixelV: number;
  homography: number[] | null;
} {
  const { point1, point2, point3, point4 } = points;

  // 用紙の実寸（mm）を用紙種類と向きに応じて設定
  // portrait（縦置き）: 点1〜2が短辺、点1〜3が長辺
  // landscape（横置き）: 点1〜2が長辺、点1〜3が短辺
  const { widthMm, heightMm } = getPaperDimensions(paperType, a4Orientation);

  const dst: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: 0, y: heightMm },
    { x: widthMm, y: heightMm },
  ];

  const src: [Point, Point, Point, Point] = [point1, point2, point3, point4];
  const homography = computeHomography(src, dst);

  // 水平方向: 点1→点2 の距離でmm/pixel算出
  const horizPx = pixelDistance(point1, point2);
  const vertPx = pixelDistance(point1, point3);

  const mmPerPixelH = horizPx > 0 ? widthMm / horizPx : 1;
  const mmPerPixelV = vertPx > 0 ? heightMm / vertPx : 1;

  return { mmPerPixelH, mmPerPixelV, homography };
}

/**
 * 屈折基準線上の点を求める（footTipを屈折基準線に射影）
 * center: 屈折点の座標、angle: 屈折角度、footTip: 足先点
 */
function getFlexHeelIntersectionEngine(
  center: Point,
  angle: number,
  footTip: Point
): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const A = { x: center.x - cos * 10000, y: center.y - sin * 10000 };
  const B = { x: center.x + cos * 10000, y: center.y + sin * 10000 };
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return center;
  const t = ((footTip.x - A.x) * dx + (footTip.y - A.y) * dy) / len2;
  return { x: A.x + t * dx, y: A.y + t * dy };
}

/**
 * 点線1（かかとライン）上の点を求める
 * 点9・点10を結ぶ直線上で、linePointの垂直投影点
 */
export function getIntersectionOnLine1(
  point9: Point,
  point10: Point,
  linePoint: Point
): Point {
  const dx = point10.x - point9.x;
  const dy = point10.y - point9.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return point9;

  const t = ((linePoint.x - point9.x) * dx + (linePoint.y - point9.y) * dy) / len2;
  return {
    x: point9.x + t * dx,
    y: point9.y + t * dy,
  };
}

/**
 * 点を直線（a→b）上に射影する
 */
function projectOntoSegment(a: Point, b: Point, p: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * 縦線（toePoint→heelPoint）に垂直な方向の単位ベクトル
 */
function getVerticalPerp(toePoint: Point, heelPoint: Point): Point {
  const dx = heelPoint.x - toePoint.x;
  const dy = heelPoint.y - toePoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 1, y: 0 };
  // 縦線方向に垂直な方向（左側）
  return { x: -dy / len, y: dx / len };
}

/**
 * 平行な2直線の最短距離（mm座標系）
 *
 * 計算原理:
 * - 直線Lは点9mm〜点10mmを通る（点線1のmm座標）
 * - 直線Mは anchorMm を通り、直線Lと平行
 * - 最短距離 = anchorMm から直線Lへの垂線距離
 *            = |(anchorMm - point9mm) × 点線1の単位方向ベクトル|
 *            = |(anchorMm - point9mm) · 点線1の法線ベクトル|
 *
 * @param anchorMm  計測対象の線（線2/3/10〜13）上の基準点（mm座標）
 * @param line1P9mm 点線1上の点（点9のmm座標）
 * @param line1P10mm 点線1上の点（点10のmm座標）
 * @returns 2直線間の最短距離（mm）
 */
function distanceFromLine1(
  anchorMm: Point,
  line1P9mm: Point,
  line1P10mm: Point
): number {
  const dx = line1P10mm.x - line1P9mm.x;
  const dy = line1P10mm.y - line1P9mm.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return pixelDistance(anchorMm, line1P9mm);

  // 点線1の法線ベクトル（単位ベクトル）
  const nx = -dy / len;
  const ny = dx / len;

  // anchorMm から点線1への垂線距離 = 内積の絶対値
  const vx = anchorMm.x - line1P9mm.x;
  const vy = anchorMm.y - line1P9mm.y;
  return Math.abs(vx * nx + vy * ny);
}

/**
 * 全計測値を算出
 *
 * ■ 計測方法（共通ルール）
 * すべての計測は「2本の平行線間の最短距離」をmm座標で算出する。
 * 手順:
 * 1. A4の4角からホモグラフィ行列Hを算出（画像px → A4mm座標）
 * 2. 各制御点をHで変換してmm座標を得る
 * 3. 各線の「基準点（anchor）のmm座標」から点線1のmm直線への垂線距離を計算
 *
 * ■ 各計測値の基準点（anchor）
 * 足長（左）:   線2の基準点 = point5のmm座標（standardモード）
 * 足長（右）:   線3の基準点 = point6のmm座標（standardモード）
 * 足幅（左）:   点線6と点線7の間の距離 = leftWidthHalf × 2（mm変換後）
 * 足幅（右）:   点線8と点線9の間の距離 = rightWidthHalf × 2（mm変換後）
 * 左1stIP:     線10の基準点 = point13の縦線上射影のmm座標
 * 右1stIP:     線11の基準点 = point14の縦線上射影のmm座標
 * 左HtoB:      線12の基準点 = point11の縦線上射影のmm座標
 * 右HtoB:      線13の基準点 = point12の縦線上射影のmm座標
 */
export function calculateMeasurements(
  points: MeasurementPoints,
  imageWidth: number,
  imageHeight: number,
  a4Orientation: 'portrait' | 'landscape' = 'portrait',
  paperType: PaperType = 'A4',
  showFlexAxis1: boolean = false,
  showFlexAxis2: boolean = false,
  flexUnit1?: FlexUnitState,
  flexUnit2?: FlexUnitState
): MeasurementResult {
  // ホモグラフィ行列を算出
  const { homography, mmPerPixelH, mmPerPixelV } = computeMmPerPixel(points, a4Orientation, paperType);

  // ホモグラフィ変換関数（フォールバック付き）
  const toMm = (p: Point): Point => {
    if (homography) return applyHomography(homography, p);
    // フォールバック: 単純なmm/pixel変換（ホモグラフィが計算できない場合）
    return { x: p.x * mmPerPixelH, y: p.y * mmPerPixelV };
  };

  // ---- 点線1のmm座標（全計測の基準） ----
  const line1P9mm = toMm(points.point9);
  const line1P10mm = toMm(points.point10);

  // ---- ダイアゴナルモード対応: 左右独立の基準線のmm座標 ----
  // ダイアゴナルモードON時は屈折基準線（屈折点を通る回転後の線）、OFF時は点線1（点9〜10）
  const fu1 = flexUnit1 ?? { active: true, angle: 0 };
  const fu2 = flexUnit2 ?? { active: true, angle: 0 };
  const flex1Center = points.point15 ?? {
    x: (points.point9.x + points.point10.x) * 0.4,
    y: (points.point9.y + points.point10.y) / 2,
  };
  const flex2Center = points.point16 ?? {
    x: (points.point9.x + points.point10.x) * 0.6,
    y: (points.point9.y + points.point10.y) / 2,
  };

  // 屈折基準線のmm座標（屈折点の近傍点をmm変換して方向ベクトルを求め、mm座標系で延長）
  // 注意: ±10000pxのような画像外の極端な座標をtoMm()で変換すると
  // ホモグラフィの射影変換により方向が大きく歪むため、近傍1px先の点を変換して
  // mm座標系での正確な方向ベクトルを求める
  const getFlexLineMm = (center: Point, angle: number): [Point, Point] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 屈折点とその1px先の点をmm変換して方向ベクトルを求める
    const centerMm = toMm(center);
    const nearPt = { x: center.x + cos, y: center.y + sin };
    const nearMm = toMm(nearPt);
    // mm座標系での方向ベクトル（正規化）
    const ddx = nearMm.x - centerMm.x;
    const ddy = nearMm.y - centerMm.y;
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dlen === 0) return [centerMm, centerMm];
    const ndx = ddx / dlen;
    const ndy = ddy / dlen;
    // mm座標系で±10000mm延長（mm座標系なので歪みなし）
    return [
      { x: centerMm.x - ndx * 10000, y: centerMm.y - ndy * 10000 },
      { x: centerMm.x + ndx * 10000, y: centerMm.y + ndy * 10000 },
    ];
  };

  const [leftFlexLineA, leftFlexLineB] = getFlexLineMm(flex1Center, fu1.angle);
  const [rightFlexLineA, rightFlexLineB] = getFlexLineMm(flex2Center, fu2.angle);

  // 左足の基準線（ダイアゴナルモードON時は屈折基準線、OFF時は点線1）
  const leftBaseLineA = showFlexAxis1 ? leftFlexLineA : line1P9mm;
  const leftBaseLineB = showFlexAxis1 ? leftFlexLineB : line1P10mm;
  // 右足の基準線
  const rightBaseLineA = showFlexAxis2 ? rightFlexLineA : line1P9mm;
  const rightBaseLineB = showFlexAxis2 ? rightFlexLineB : line1P10mm;

  // ---- 足長の計算 ----
  // 線2（point5を通る、基準線に平行な直線）と基準線の最短距離
  const leftToeMm = toMm(points.point5);
  const rightToeMm = toMm(points.point6);

  const leftLengthMm = distanceFromLine1(leftToeMm, leftBaseLineA, leftBaseLineB);
  const rightLengthMm = distanceFromLine1(rightToeMm, rightBaseLineA, rightBaseLineB);

  // ---- 足幅の計算 ----
  // 点線6と点線7の最短距離 = leftWidthHalf × 2
  // 点線6/7は縦線（線4）の左右に leftWidthHalf だけ離れた縦の点線
  // leftWidthHalf = point7の縦線上射影からかかとラインまでの距離（ピクセル）
  //
  // 計算方法:
  // 1. かかとライン上の交点（縦線の足元）を求める
  //    屈折ユニットON時は屈折基準線との交点を使用（縦線の方向が変わるため）
  // 2. point7を縦線上に射影した点から縦線の垂直方向に leftWidthHalf 離れた2点を求める
  // 3. その2点をmm変換して距離を計算
  const leftHeelPointPx = showFlexAxis1
    ? getFlexHeelIntersectionEngine(flex1Center, fu1.angle, points.point5)
    : getIntersectionOnLine1(points.point9, points.point10, points.point5);
  const rightHeelPointPx = showFlexAxis2
    ? getFlexHeelIntersectionEngine(flex2Center, fu2.angle, points.point6)
    : getIntersectionOnLine1(points.point9, points.point10, points.point6);

  const leftPerpDir = getVerticalPerp(points.point5, leftHeelPointPx);
  const rightPerpDir = getVerticalPerp(points.point6, rightHeelPointPx);

  // point7/8のratioを算出し、computeWidthHalfと同じratioベース線形マッピングでwidthHalfPxを計算
  // これにより描画（canvas）と計測値（mm）が完全に一致する
  const leftLineLenPx = pixelDistance(points.point5, leftHeelPointPx);
  const rightLineLenPx = pixelDistance(points.point6, rightHeelPointPx);

  // point7を縦線上に射影してratioを算出（つま先からの比率）
  const p7proj = projectOntoSegment(points.point5, leftHeelPointPx, points.point7);
  const leftRatio = leftLineLenPx > 0
    ? Math.max(0.05, Math.min(0.95, pixelDistance(points.point5, p7proj) / leftLineLenPx))
    : 0.5;

  const p8proj = projectOntoSegment(points.point6, rightHeelPointPx, points.point8);
  const rightRatio = rightLineLenPx > 0
    ? Math.max(0.05, Math.min(0.95, pixelDistance(points.point6, p8proj) / rightLineLenPx))
    : 0.5;

  // ratioベース線形マッピング（computeWidthHalfと同じ式）
  // ratio=0.05（つま先寄り）→ maxHalf=lineLen*0.475（最大幅）
  // ratio=0.95（かかと寄り）→ minHalf=lineLen*0.05（最小幅）
  const leftMaxHalf = leftLineLenPx * 0.475;
  const leftMinHalf = leftLineLenPx * 0.05;
  const leftT = (leftRatio - 0.05) / (0.95 - 0.05);
  const leftWidthHalfPx = Math.max(10, leftMaxHalf + (leftMinHalf - leftMaxHalf) * leftT);

  const rightMaxHalf = rightLineLenPx * 0.475;
  const rightMinHalf = rightLineLenPx * 0.05;
  const rightT = (rightRatio - 0.05) / (0.95 - 0.05);
  const rightWidthHalfPx = Math.max(10, rightMaxHalf + (rightMinHalf - rightMaxHalf) * rightT);

  // 縦線の中点を基準に、垂直方向に幅の半分だけ離れた2点をmm変換して幅を計算
  // 中点 = 縦線の中央（つま先とかかとの中間）
  const leftMidPx = {
    x: (points.point5.x + leftHeelPointPx.x) / 2,
    y: (points.point5.y + leftHeelPointPx.y) / 2,
  };
  const rightMidPx = {
    x: (points.point6.x + rightHeelPointPx.x) / 2,
    y: (points.point6.y + rightHeelPointPx.y) / 2,
  };

  // 点線6（外側）と点線7（内側）の代表点（縦線中点から垂直方向に幅の半分）
  const leftWidthPtA = {
    x: leftMidPx.x + leftPerpDir.x * leftWidthHalfPx,
    y: leftMidPx.y + leftPerpDir.y * leftWidthHalfPx,
  };
  const leftWidthPtB = {
    x: leftMidPx.x - leftPerpDir.x * leftWidthHalfPx,
    y: leftMidPx.y - leftPerpDir.y * leftWidthHalfPx,
  };
  const rightWidthPtA = {
    x: rightMidPx.x + rightPerpDir.x * rightWidthHalfPx,
    y: rightMidPx.y + rightPerpDir.y * rightWidthHalfPx,
  };
  const rightWidthPtB = {
    x: rightMidPx.x - rightPerpDir.x * rightWidthHalfPx,
    y: rightMidPx.y - rightPerpDir.y * rightWidthHalfPx,
  };

  // mm座標に変換して幅を計算（点線6と点線7の最短距離）
  const leftWidthMm = pixelDistance(toMm(leftWidthPtA), toMm(leftWidthPtB));
  const rightWidthMm = pixelDistance(toMm(rightWidthPtA), toMm(rightWidthPtB));

  // ---- HtoBの計算 ----
  // 線12（point11の縦線上射影を通る、基準線に平行な直線）と基準線の最短距離
  // ダイアゴナルモードON時は屈折基準線、OFF時は点線1が基準線
  let leftHtoBMm: number | null = null;
  let rightHtoBMm: number | null = null;

  if (points.point11) {
    const p11proj = projectOntoSegment(points.point5, leftHeelPointPx, points.point11);
    const p11projMm = toMm(p11proj);
    leftHtoBMm = distanceFromLine1(p11projMm, leftBaseLineA, leftBaseLineB);
  }
  if (points.point12) {
    const p12proj = projectOntoSegment(points.point6, rightHeelPointPx, points.point12);
    const p12projMm = toMm(p12proj);
    rightHtoBMm = distanceFromLine1(p12projMm, rightBaseLineA, rightBaseLineB);
  }

  // ---- 1stIPの計算 ----
  // 線10（point13の縦線上射影を通る、基準線に平行な直線）と基準線の最短距離
  // ダイアゴナルモードON時は屈折基準線、OFF時は点線1が基準線
  // point13/14がない場合はpoint5/6基準（足長と同値）にフォールバック
  let leftFirstIPMm: number;
  let rightFirstIPMm: number;

  if (points.point13) {
    const p13proj = projectOntoSegment(points.point5, leftHeelPointPx, points.point13);
    const p13projMm = toMm(p13proj);
    leftFirstIPMm = distanceFromLine1(p13projMm, leftBaseLineA, leftBaseLineB);
  } else {
    leftFirstIPMm = leftLengthMm;
  }

  if (points.point14) {
    const p14proj = projectOntoSegment(points.point6, rightHeelPointPx, points.point14);
    const p14projMm = toMm(p14proj);
    rightFirstIPMm = distanceFromLine1(p14projMm, rightBaseLineA, rightBaseLineB);
  } else {
    rightFirstIPMm = rightLengthMm;
  }

  // ====== デバッグログ ======
  const dbg = {
    // 用紙設定
    paperOrientation: a4Orientation,
    paperType,
    widthMm: getPaperDimensions(paperType, a4Orientation).widthMm,
    heightMm: getPaperDimensions(paperType, a4Orientation).heightMm,
    // ホモグラフィ行列
    homographyMatrix: homography ? homography.map(v => +v.toFixed(6)) : null,
    // 用紙4角のmm変換結果（正確なら (0,0),(w,0),(0,h),(w,h) になるはず）
    corner1_mm: toMm(points.point1),
    corner2_mm: toMm(points.point2),
    corner3_mm: toMm(points.point3),
    corner4_mm: toMm(points.point4),
    // かかとライン（点線1）のmm座標
    heel9_mm: line1P9mm,
    heel10_mm: line1P10mm,
    // つま先のmm座標
    leftToe_mm: leftToeMm,
    rightToe_mm: rightToeMm,
    // 足長計算（かかとラインへの垂線距離）
    leftLength_raw: leftLengthMm,
    rightLength_raw: rightLengthMm,
    // 足幅計算
    leftWidthHalfPx,
    rightWidthHalfPx,
    leftWidthPtA_mm: toMm(leftWidthPtA),
    leftWidthPtB_mm: toMm(leftWidthPtB),
    leftWidth_raw: leftWidthMm,
    rightWidth_raw: rightWidthMm,
    // HtoB
    leftHtoB_raw: leftHtoBMm,
    rightHtoB_raw: rightHtoBMm,
    // スケール確認（点1→点2の距離がwidthMmと一致するか）
    p1p2_px: pixelDistance(points.point1, points.point2),
    p1p3_px: pixelDistance(points.point1, points.point3),
    mmPerPixelH,
    mmPerPixelV,
  };
  console.log('[MEASURE_DEBUG]', JSON.stringify(dbg, null, 2));
  // ====== デバッグログ終了 ======

  return {
    leftFootLength: Math.round(leftLengthMm),
    rightFootLength: Math.round(rightLengthMm),
    leftFootWidth: Math.round(leftWidthMm),
    rightFootWidth: Math.round(rightWidthMm),
    leftHeelToMp: leftHtoBMm != null ? Math.round(leftHtoBMm) : null,
    rightHeelToMp: rightHtoBMm != null ? Math.round(rightHtoBMm) : null,
    leftFirstIP: Math.round(leftFirstIPMm),
    rightFirstIP: Math.round(rightFirstIPMm),
  };
}

/**
 * 点線1の方向ベクトル（単位ベクトル）
 */
export function getLine1Direction(point9: Point, point10: Point): Point {
  const dx = point10.x - point9.x;
  const dy = point10.y - point9.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/**
 * 点線1に直角な方向ベクトル
 */
export function getPerpendicularDirection(point9: Point, point10: Point): Point {
  const dir = getLine1Direction(point9, point10);
  return { x: -dir.y, y: dir.x };
}


// ============================================================
// 台形補正歪み分析・向き判定
// ============================================================

export type DistortionLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface DistortionAnalysis {
  /** 総合歪みスコア（0〜∞, 高いほど歪みが大きい） */
  score: number;
  /** 4段階の誤差レベル */
  level: DistortionLevel;
  /** 内訳: 上下辺の長さ比率の差 */
  sideRatioH: number;
  /** 内訳: 左右辺の長さ比率の差 */
  sideRatioV: number;
  /** 内訳: 対角線の長さの差の比率 */
  diagRatio: number;
  /** 内訳: 面積の差の比率 */
  areaRatio: number;
  /**
   * 縦紙／横紙の向き不一致の有無
   * - 'ok': 設定と実際の向きが一致
   * - 'mismatch': 設定と実際の向きが不一致（警告を出すべき）
   * - 'ambiguous': 辺の長さが近く判定不能
   */
  orientationCheck: 'ok' | 'mismatch' | 'ambiguous';
  /** 点1〜2の辺が実際に長辺かどうか */
  p12IsLonger: boolean;
  /**
   * ヨー（平面内回転）の推定角度（度）
   * 計測誤差には影響しないが、大きいと点の配置が難しくなる
   */
  yawDeg: number;
  /** ヨーが大きい場合に注意を促すか（20度以上で true） */
  yawWarning: boolean;
}

/**
 * 用紙サイズ別の誤差レベル閾値補正係数
 * A4を基準(1.0)とし、用紙面積が小さいほど閾値を小さくする
 * （小さい用紙では同じ側面比でも実際の山度が大きくなるため）
 */
const PAPER_THRESHOLD_FACTOR: Record<string, number> = {
  'A4':     1.00,  // 基準
  'B5':     0.87,  // B5はA4の約75%の面積 → 閾値を約13%小さく
  'Letter': 0.97,  // LetterはA4とほぼ同じ面積 → ときどき調整のみ
};

/**
 * 4点の歪みを分析し、誤差レベルと向き不一致を返す
 * @param p1 点1（左上）
 * @param p2 点2（右上）
 * @param p3 点3（左下）
 * @param p4 点4（右下）
 * @param orientation 現在の縦紙／横紙設定
 * @param paperType 用紙サイズ（閾値補正に使用）
 */
export function analyzeDistortion(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
  orientation: 'portrait' | 'landscape',
  paperType: string = 'A4'
): DistortionAnalysis {
  const dist = (a: Point, b: Point) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  const top    = dist(p1, p2); // 点1〜2の辺
  const bottom = dist(p3, p4); // 点3〜4の辺
  const left   = dist(p1, p3); // 点1〜3の辺
  const right  = dist(p2, p4); // 点2〜4の辺
  const diag1  = dist(p1, p4); // 対角線1
  const diag2  = dist(p2, p3); // 対角線2

  // 各指標（0以上）
  const sideRatioH = Math.max(top, bottom) / (Math.min(top, bottom) + 1e-9) - 1.0;
  const sideRatioV = Math.max(left, right) / (Math.min(left, right) + 1e-9) - 1.0;
  const diagRatio  = Math.abs(diag1 - diag2) / (Math.max(diag1, diag2) + 1e-9);

  // 面積（三角形2つに分割）
  const triArea = (a: Point, b: Point, c: Point) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  const actualArea = triArea(p1, p2, p4) + triArea(p1, p4, p3);
  const idealArea  = ((top + bottom) / 2) * ((left + right) / 2);
  const areaRatio  = Math.abs(actualArea - idealArea) / (idealArea + 1e-9);

  // 総合スコア: max(sH, sV) × 0.5 + diagRatio × 0.3 + areaRatio × 0.2
  const score = Math.max(sideRatioH, sideRatioV) * 0.5
              + diagRatio  * 0.3
              + areaRatio  * 0.2;

  // 用紙サイズ別閾値補正
  const factor = PAPER_THRESHOLD_FACTOR[paperType] ?? 1.0;
  const t1 = 0.03 * factor; // minimal/lowの境界
  const t2 = 0.08 * factor; // low/mediumの境界
  const t3 = 0.15 * factor; // medium/highの境界

  // 4段階レベル判定
  let level: DistortionLevel;
  if      (score < t1) level = 'minimal';
  else if (score < t2) level = 'low';
  else if (score < t3) level = 'medium';
  else                 level = 'high';

  // 向き判定: 点1〜2の辺が長辺かどうか
  const p12IsLonger = top > left;
  const ratio = top / (left + 1e-9);
  let orientationCheck: 'ok' | 'mismatch' | 'ambiguous';
  if (ratio > 0.9 && ratio < 1.1) {
    orientationCheck = 'ambiguous';
  } else {
    // landscape = 点1〜2が長辺であるべき
    // portrait  = 点1〜2が短辺であるべき
    const expectLonger = orientation === 'landscape';
    orientationCheck = (p12IsLonger === expectLonger) ? 'ok' : 'mismatch';
  }

  // ヨー（平面内回転）の推定
  // 点1〜2の辺の水平からの角度を計算
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angleRad = Math.atan2(Math.abs(dy), Math.abs(dx));
  const angleDeg = angleRad * 180 / Math.PI;
  // 辺が縦方向に近い場合（portrait）は90度から引く
  const normalizedYaw = p12IsLonger
    ? angleDeg          // 横長の辺: 水平からのずれ
    : Math.abs(90 - angleDeg); // 縦長の辺: 垂直からのずれ
  const yawWarning = normalizedYaw >= 20;

  return {
    score,
    level,
    sideRatioH,
    sideRatioV,
    diagRatio,
    areaRatio,
    orientationCheck,
    p12IsLonger,
    yawDeg: normalizedYaw,
    yawWarning,
  };
}
