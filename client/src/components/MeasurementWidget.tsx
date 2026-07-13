/**
 * 計測ウィジェット（Canvas）
 *
 * ■ 点線6・点線7の仕様（左足）
 *   - 線4（黄色縦線: 点5→かかと交点）を中心に、左右に「幅」だけ離れた縦の点線
 *   - 点線6: 線4の左側（外側）
 *   - 点線7: 線4の右側（内側）
 *   - 点7は線4上を上下にスライドする制御点
 *     - 点7を上（つま先側）に動かす → 幅が広がる
 *     - 点7を下（かかと側）に動かす → 幅が縮まる
 *   - 幅 = 点7からつま先（点5）までの距離 × 係数
 *
 * ■ 点線8・点線9の仕様（右足）
 *   - 線5（黄色縦線: 点6→かかと交点）を中心に、左右に「幅」だけ離れた縦の点線
 *   - 点線9: 線5の左側（内側）
 *   - 点線8: 線5の右側（外側）
 *   - 点8は線5上を上下にスライドする制御点（同様の幅制御）
 *
 * ■ 線4の垂直方向（左右オフセット方向）
 *   - 線4は縦線（点5→かかと交点）なので、その垂直方向 = 横方向（左右）
 *   - 垂直方向ベクトル = 縦線方向を90度回転したもの
 *
 * ■ その他の制約
 *   - 線2・線3は点線1（点9〜点10）と常に平行
 *   - 全ての線は元の太さの70%
 *   - ハンドル円は元の半分のサイズ
 *   - 点5・点6・点9・点10を動かすと点7・点8が縦線上に追従
 *
 * ■ 母子丘モード（mode='bunion'）
 *   - 点線6〜9・点7・点8を非表示
 *   - 線4・線5に垂直な横線（点11・点12で位置制御）を追加
 *   - 点11: 左足の母子丘横線制御点（線4上を上下移動）
 *   - 点12: 右足の母子丘横線制御点（線5上を上下移動）
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { MeasurementPoints, PaperType, FlexUnitState } from "../../../shared/measurementTypes";
import { getPaperDimensions } from "../../../shared/measurementTypes";
import {
  getIntersectionOnLine1,
  getLine1Direction,
} from "../lib/measurementEngine";

export type MeasurementMode = 'standard' | 'bunion' | 'insole' | 'reference';

/** ロック対象の点キー（基準固定で動かなくなる点） */
export type LockedPointKey = 'point1' | 'point2' | 'point3' | 'point4' | 'point9' | 'point10';
export const LOCKABLE_POINTS: LockedPointKey[] = ['point1', 'point2', 'point3', 'point4', 'point9', 'point10'];

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** 画像回転角度（0/90/180/270度） */
  imageRotation?: 0 | 90 | 180 | 270;
  points: MeasurementPoints;
  onPointsChange: (points: MeasurementPoints) => void;
  readOnly?: boolean;
  mode?: MeasurementMode;
  /** ロックされている点のセット（これらはドラッグ不可） */
  lockedPoints?: Set<LockedPointKey>;
  /** 基準固定中かどうか（枚1・点線1の色をピンクに変える） */
  isLocked?: boolean;
  /** 用紙の向き（portrait=縦置き/点1〜2が短辺, landscape=横置き/点1〜2が長辺） */
  a4Orientation?: 'portrait' | 'landscape';
  /** 用紙種類（A4/B5/Letter） */
  paperType?: PaperType;
  /** 屈折ユニット1（左足用）の状態 */
  flexUnit1?: FlexUnitState;
  onFlexUnit1Change?: (state: FlexUnitState) => void;
  /** 屈折ユニット2（右足用）の状態 */
  flexUnit2?: FlexUnitState;
  onFlexUnit2Change?: (state: FlexUnitState) => void;
  /** ダイアゴナルモード1のON/OFF（外部から制御する場合） */
  showFlexAxis1Prop?: boolean;
  onShowFlexAxis1Change?: (val: boolean) => void;
  /** ダイアゴナルモード2のON/OFF（外部から制御する場合） */
  showFlexAxis2Prop?: boolean;
  onShowFlexAxis2Change?: (val: boolean) => void;
}

type PointKey = keyof MeasurementPoints;
// 操作プロキシキー（Length/Width操作点・1stIP/HtoB操作点）
type ProxyKey = 'lengthProxy5' | 'lengthProxy6' | 'widthProxy7' | 'widthProxy8' | 'firstipProxy5' | 'firstipProxy6' | 'htobProxy11' | 'htobProxy12';
// 屈折ユニット基準線ドラッグキー（flexLine1=ユニット1の基準線、flexLine2=ユニット2の基準線）
// 屈折操作点キー（flexOp5=ユニット1軸先端, flexOp6=ユニット2軸先端, flexCenter1/2=屈折点1/2）
type FlexOpKey = 'flexOp5' | 'flexOp6' | 'flexCenter1' | 'flexCenter2';
type DragKey = PointKey | ProxyKey | FlexOpKey;

// ハンドルサイズ（元の半分）
const HANDLE_RADIUS = 9;
const TOUCH_RADIUS = 26;

// 線の太さ係数（最大lineWidthが2*LW=0.75になるよう設定）
const LW = 0.375;

// 色定義
// 共通明るい緑（枠1・点線1・母艦丘横線全て）
const BRIGHT_GREEN = "#39FF6A";
// 中敷きサイズ計測タブ専用色（中底タブ文字と同じ黄色オレンジ）
const INSOLE_COLOR = "#FF1493"; // 中敷きタブもビビットピンクに統一
const COLORS = {
  a4FrameDash: BRIGHT_GREEN,
  leftYellow: "#FF1493",
  rightYellow: "#FF1493",
  leftRed: "#FF3B30",
  rightRed: "#FF3B30",
  heelLine: BRIGHT_GREEN,
  widthDash: "#FF1493", // 足幅点線（ビビットピンク）
  bunionLine: "#FF1493", // H2B横線（ビビットピンク）
};

// ---- ジオメトリヘルパー ----

/** 点Pを直線AB上に射影した点を返す（延長線上も含む） */
function projectOntoLine(
  A: { x: number; y: number },
  B: { x: number; y: number },
  P: { x: number; y: number }
): { x: number; y: number } {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...A };
  const t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
  return { x: A.x + t * dx, y: A.y + t * dy };
}

/**
 * 縦線（toePoint→heelPoint）の垂直方向（左右）の単位ベクトルを返す。
 * 縦線方向を90度回転することで、左右方向を得る。
 * 「左」方向（足の外側）を正とする。
 */
function getVerticalLinePerp(
  toePoint: { x: number; y: number },
  heelPoint: { x: number; y: number }
): { x: number; y: number } {
  const dx = heelPoint.x - toePoint.x;
  const dy = heelPoint.y - toePoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: -1, y: 0 };
  // 縦線方向 (dx/len, dy/len) を90度回転 → (-dy/len, dx/len) が左方向
  return { x: -dy / len, y: dx / len };
}

/**
 * 点線1（点9〜点10）の方向に平行で、基準点 basePoint を通る直線の端点を返す
 */
function getParallelLineEndpoints(
  line1Dir: { x: number; y: number },
  basePoint: { x: number; y: number },
  halfLen: number
): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: basePoint.x - line1Dir.x * halfLen, y: basePoint.y - line1Dir.y * halfLen },
    { x: basePoint.x + line1Dir.x * halfLen, y: basePoint.y + line1Dir.y * halfLen },
  ];
}

/**
 * 点線6・7・8・9の幅を決める関数。
 * point7のratio（つま先からの比率 0.05〜0.95）に線形比例してWidthが変化する。
 * ratio=0.05（つま先寄り）→ 最大Width（A4横向き≈523px / A4縦向き≈740px）
 * ratio=0.95（かかと寄り）→ 最小Width（縦線長さの5%×2）
 * ratio=0.05〜0.95の全範囲で均等に線形変化する。
 */
function computeWidthHalf(
  toePoint: { x: number; y: number },
  heelPoint: { x: number; y: number },
  controlPoint: { x: number; y: number }
): number {
  // 縦線の全長を算出
  const lineLen = Math.sqrt(
    (heelPoint.x - toePoint.x) ** 2 + (heelPoint.y - toePoint.y) ** 2
  );
  if (lineLen === 0) return 10;

  // point7を縦線（toePoint→heelPoint）上に射影してratioを算出
  const proj = projectOntoLine(toePoint, heelPoint, controlPoint);
  const distFromToe = Math.sqrt(
    (proj.x - toePoint.x) ** 2 + (proj.y - toePoint.y) ** 2
  );
  // ratio = つま先からの比率（0.05〜0.95にclamp）
  const ratio = Math.max(0.05, Math.min(0.95, distFromToe / lineLen));

  // 最大half（ratio=0.05時）= 縦線長さ × 0.475
  // → A4横向き(550.6px): maxHalf=261.5px → Width=523px
  // → A4縦向き(778.8px): maxHalf=370.0px → Width=740px
  const maxHalf = lineLen * 0.475;
  // 最小half（ratio=0.95時）= 縦線長さ × 0.05
  const minHalf = lineLen * 0.05;

  // ratio=0.05〜0.95で線形マッピング
  const t = (ratio - 0.05) / (0.95 - 0.05); // 0.0（最大）〜1.0（最小）
  const widthHalf = maxHalf + (minHalf - maxHalf) * t;

  return Math.max(10, widthHalf);
}

// ---- 屈折ユニット計算ヘルパー ----
/**
 * 屈折ユニットの屈折基準線の端点を計算する
 * @param center 屈折点（point15/16）の位置
 * @param angle 回転角度（ラジアン、0=水平）
 * @param halfLen 半幅（片側の長さ）
 */
function getFlexBaseLineEndpoints(
  center: { x: number; y: number },
  angle: number,
  halfLen: number
): [{ x: number; y: number }, { x: number; y: number }] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    { x: center.x - cos * halfLen, y: center.y - sin * halfLen },
    { x: center.x + cos * halfLen, y: center.y + sin * halfLen },
  ];
}

/**
 * 屈折ユニットの屈折軸の方向ベクトルを計算する（基準線に垂直）
 * @param angle 基準線の回転角度（ラジアン）
 */
function getFlexAxisDirection(angle: number): { x: number; y: number } {
  // 基準線の方向を90度回転 → 上向き垂直方向（Canvas座標系: Y軸下向きなので -cos が上）
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

/**
 * 屈折ユニットがアクティブな場合の「かかとライン上の交点」を計算する
 * 屈折基準線（回転後）上に点5/6を射影した点を返す
 * @param center 屈折点の位置
 * @param angle 基準線の回転角度
 * @param footTip 足のつま先点（point5 or point6）
 */
function getFlexHeelIntersection(
  center: { x: number; y: number },
  angle: number,
  footTip: { x: number; y: number }
): { x: number; y: number } {
  // 屈折基準線の方向ベクトル
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // 屈折基準線の端点（十分に長い）
  const A = { x: center.x - cos * 10000, y: center.y - sin * 10000 };
  const B = { x: center.x + cos * 10000, y: center.y + sin * 10000 };
  // footTipを屈折基準線上に射影
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return center;
  const t = ((footTip.x - A.x) * dx + (footTip.y - A.y) * dy) / len2;
  return { x: A.x + t * dx, y: A.y + t * dy };
}

export default function MeasurementWidget({
  imageUrl,
  imageWidth,
  imageHeight,
  imageRotation = 0,
  points,
  onPointsChange,
  readOnly = false,
  mode = 'standard',
  lockedPoints,
  isLocked = false,
  a4Orientation = 'portrait',
  paperType = 'A4',
  flexUnit1,
  onFlexUnit1Change,
  flexUnit2,
  onFlexUnit2Change,
  showFlexAxis1Prop,
  onShowFlexAxis1Change,
  showFlexAxis2Prop,
  onShowFlexAxis2Change,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState<DragKey | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // devicePixelRatioをstateで管理（スマホ・タブレットで確実に高解像度化）
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 3));
  useEffect(() => {
    const updateDpr = () => setDpr(Math.min(window.devicePixelRatio || 1, 3));
    // matchMediaでdpr変化を監視（画面切り替え時など）
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', updateDpr);
    updateDpr(); // 初回即時反映
    return () => mq.removeEventListener('change', updateDpr);
  }, []);

  // ピンチズーム用 state
  const [pinchScale, setPinchScale] = useState(1);
  // ピンチ中心点（canvas要素内の相対座標 %）
  const [pinchOrigin, setPinchOrigin] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const isPinchingRef = useRef(false);
  // パン：スクロール方式で実現（panOffset stateは不要）
  const panStartRef = useRef<{ midX: number; midY: number; panX: number; panY: number } | null>(null);

  // ロック状態をrefで同期管理（ポインタイベントのクロージャから即時参照できるように）
  const lockedPointsRef = useRef<Set<LockedPointKey> | undefined>(lockedPoints);
  lockedPointsRef.current = lockedPoints;

  // 拡大モード: ダブルタップした操作点キー（nullなら通常モード）
  const [zoomPointKey, setZoomPointKey] = useState<DragKey | null>(null);
  // ダブルタップ検出用: 最後のタップ時刻と操作点キー
  const lastTapRef = useRef<{ key: DragKey; time: number } | null>(null);
  // 屈折軸の表示フラグ（ダブルタップで切り替え）
  const [showFlexAxis1Local, setShowFlexAxis1Local] = useState(false);
  const [showFlexAxis2Local, setShowFlexAxis2Local] = useState(false);
  // propsが渡されている場合はそちらを優先する（外部制御）、なければローカル状態を使う
  const showFlexAxis1 = showFlexAxis1Prop !== undefined ? showFlexAxis1Prop : showFlexAxis1Local;
  const showFlexAxis2 = showFlexAxis2Prop !== undefined ? showFlexAxis2Prop : showFlexAxis2Local;
  const setShowFlexAxis1 = (val: boolean) => {
    setShowFlexAxis1Local(val);
    onShowFlexAxis1Change?.(val);
  };
  const setShowFlexAxis2 = (val: boolean) => {
    setShowFlexAxis2Local(val);
    onShowFlexAxis2Change?.(val);
  };
  // 拡大モード中のドラッグ開始位置（1/4縮小計算用）
  const zoomDragStartRef = useRef<{ x: number; y: number } | null>(null);
  // 拡大モード中のドラッグ開始時の点座標
  const zoomDragPointStartRef = useRef<{ x: number; y: number } | null>(null);

  // 屈折ユニット角度変更時に操作点を再配置するuseEffect
  // ※ point5/6 の位置は変えない（ユーザーが設定した位置を保持）
  const prevAngle1Ref = useRef<number | undefined>(undefined);
  const prevAngle2Ref = useRef<number | undefined>(undefined);
  const prevShow1Ref = useRef<boolean | undefined>(undefined);
  const prevShow2Ref = useRef<boolean | undefined>(undefined);

  useEffect(() => {
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

    const prevAngle1 = prevAngle1Ref.current;
    const prevAngle2 = prevAngle2Ref.current;

    // 角度変化の検出（初回マウント時は再配置しない）
    const angle1Changed = prevAngle1 !== undefined && prevAngle1 !== fu1.angle;
    const angle2Changed = prevAngle2 !== undefined && prevAngle2 !== fu2.angle;

    prevAngle1Ref.current = fu1.angle;
    prevAngle2Ref.current = fu2.angle;

    if (!angle1Changed && !angle2Changed) return;

    let updatedPoints = { ...points };

    // 左足の再配置（angle1が変化した場合）
    if (angle1Changed) {
      // 旧かかと（変化前の角度で計算）
      const oldHeel1 = getFlexHeelIntersection(flex1Center, prevAngle1!, points.point5);
      // 新かかと（変化後の角度で計算）
      const newHeel1 = getFlexHeelIntersection(flex1Center, fu1.angle, points.point5);

      const controls1 = [points.point7, points.point11 ?? null, points.point13 ?? null];
      const newCtrl1 = reanchorControlsOnFlexChange(points.point5, oldHeel1, newHeel1, controls1);
      if (newCtrl1[0]) updatedPoints.point7 = newCtrl1[0];
      if (newCtrl1[1]) updatedPoints.point11 = newCtrl1[1];
      if (newCtrl1[2]) updatedPoints.point13 = newCtrl1[2];
    }

    // 右足の再配置（angle2が変化した場合）
    if (angle2Changed) {
      // 旧かかと（変化前の角度で計算）
      const oldHeel2 = getFlexHeelIntersection(flex2Center, prevAngle2!, points.point6);
      // 新かかと（変化後の角度で計算）
      const newHeel2 = getFlexHeelIntersection(flex2Center, fu2.angle, points.point6);

      const controls2 = [points.point8, points.point12 ?? null, points.point14 ?? null];
      const newCtrl2 = reanchorControlsOnFlexChange(points.point6, oldHeel2, newHeel2, controls2);
      if (newCtrl2[0]) updatedPoints.point8 = newCtrl2[0];
      if (newCtrl2[1]) updatedPoints.point12 = newCtrl2[1];
      if (newCtrl2[2]) updatedPoints.point14 = newCtrl2[2];
    }

    onPointsChange(updatedPoints);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flexUnit1?.angle, flexUnit2?.angle]);

  // showFlexAxis1/2 切替時に point7/8/11/12/13/14 を新基準で再配置
  useEffect(() => {
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
    const prevShow1 = prevShow1Ref.current;
    const prevShow2 = prevShow2Ref.current;
    const show1Changed = prevShow1 !== undefined && prevShow1 !== showFlexAxis1;
    const show2Changed = prevShow2 !== undefined && prevShow2 !== showFlexAxis2;
    prevShow1Ref.current = showFlexAxis1;
    prevShow2Ref.current = showFlexAxis2;
    if (!show1Changed && !show2Changed) return;
    let updatedPoints = { ...points };
    if (show1Changed) {
      const oldHeel1 = prevShow1
        ? getFlexHeelIntersection(flex1Center, fu1.angle, points.point5)
        : getIntersectionOnLine1(points.point9, points.point10, points.point5);
      const newHeel1 = showFlexAxis1
        ? getFlexHeelIntersection(flex1Center, fu1.angle, points.point5)
        : getIntersectionOnLine1(points.point9, points.point10, points.point5);
      const controls1 = [points.point7, points.point11 ?? null, points.point13 ?? null];
      const newCtrl1 = reanchorControlsOnFlexChange(points.point5, oldHeel1, newHeel1, controls1);
      if (newCtrl1[0]) updatedPoints.point7 = newCtrl1[0];
      if (newCtrl1[1]) updatedPoints.point11 = newCtrl1[1];
      if (newCtrl1[2]) updatedPoints.point13 = newCtrl1[2];
    }
    if (show2Changed) {
      const oldHeel2 = prevShow2
        ? getFlexHeelIntersection(flex2Center, fu2.angle, points.point6)
        : getIntersectionOnLine1(points.point9, points.point10, points.point6);
      const newHeel2 = showFlexAxis2
        ? getFlexHeelIntersection(flex2Center, fu2.angle, points.point6)
        : getIntersectionOnLine1(points.point9, points.point10, points.point6);
      const controls2 = [points.point8, points.point12 ?? null, points.point14 ?? null];
      const newCtrl2 = reanchorControlsOnFlexChange(points.point6, oldHeel2, newHeel2, controls2);
      if (newCtrl2[0]) updatedPoints.point8 = newCtrl2[0];
      if (newCtrl2[1]) updatedPoints.point12 = newCtrl2[1];
      if (newCtrl2[2]) updatedPoints.point14 = newCtrl2[2];
    }
    onPointsChange(updatedPoints);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFlexAxis1, showFlexAxis2]);

  // 線2/3ドラッグ開始時のクリック位置と点5/6の差分（オフセット）を保存
  // これによりクリック位置を維持したままドラッグできる（点にスナップしない）
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // 屈折基準線ドラッグ開始時の情報（デルタ回転方式）
  const flexDragStartRef = useRef<{
    startX: number; startY: number;
    startAngle: number;
    startAxisLength: number;
    centerX: number; centerY: number;
  } | null>(null);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Compute scale to fill container
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      if (!containerW || !containerH || !imageWidth || !imageHeight) return;
      // scale計算: 90/270度回転時はwidth/heightを入れ替えてコンテナに収まるよう計算
      // Canvasサイズは常に元画像サイズ固定（操作点の座標系は元画像固定）
      const effectiveW = (imageRotation === 90 || imageRotation === 270) ? imageHeight : imageWidth;
      const effectiveH = (imageRotation === 90 || imageRotation === 270) ? imageWidth : imageHeight;
      const scaleX = containerW / effectiveW;
      const scaleY = containerH / effectiveH;
      setScale(Math.min(scaleX, scaleY));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", updateScale);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [imageWidth, imageHeight, imageRotation]);

  // Draw everything
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 90/270度回転時はCanvasサイズを入れ替える（縦長表示になる）
    // 横長画像を挿入した後に90度回転した際、縦長の画角になるようにする
    const isRot90 = imageRotation === 90 || imageRotation === 270;
    // canvasW/H: 回転後の表示サイズ（90/270度時は入れ替え）
    const canvasW = Math.round(isRot90 ? imageHeight * scale : imageWidth * scale);
    const canvasH = Math.round(isRot90 ? imageWidth * scale : imageHeight * scale);
    // origW/H: 元画像のスケール後サイズ（画像描画用）
    const origW = Math.round(imageWidth * scale);
    const origH = Math.round(imageHeight * scale);
    canvas.width = Math.round(canvasW * dpr);
    canvas.height = Math.round(canvasH * dpr);
    ctx.scale(dpr, dpr);

    // Draw image with rotation
    // 90/270度回転時: canvasは縦長、画像をcanvas内に回転して描画
    if (imageRef.current) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (imageRotation === 0) {
        ctx.drawImage(imageRef.current, 0, 0, origW, origH);
      } else if (imageRotation === 90) {
        // 90度回転: canvasは(imageHeight*scale) x (imageWidth*scale)
        // 画像をcanvas内に収まるよう回転して描画
        ctx.save();
        ctx.translate(canvasW / 2, canvasH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(imageRef.current, -origW / 2, -origH / 2, origW, origH);
        ctx.restore();
      } else if (imageRotation === 180) {
        // 180度回転: canvasは元画像と同じサイズ
        ctx.save();
        ctx.translate(canvasW / 2, canvasH / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(imageRef.current, -origW / 2, -origH / 2, origW, origH);
        ctx.restore();
      } else if (imageRotation === 270) {
        // 270度回転: canvasは(imageHeight*scale) x (imageWidth*scale)
        ctx.save();
        ctx.translate(canvasW / 2, canvasH / 2);
        ctx.rotate(3 * Math.PI / 2);
        ctx.drawImage(imageRef.current, -origW / 2, -origH / 2, origW, origH);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // 横線の長さ: 画面幅（containerW）の8%を基準とし、最小30px・最大80pxにクランプ
    // これにより解像度・デバイスに関わらず常に同じ見た目の横線長さになる
    const containerWForLine = containerRef.current?.clientWidth ?? 400;
    const lineHalfLen_base = Math.max(30, Math.min(80, containerWForLine * 0.08));
    const lineHalfLenMult = lineHalfLen_base / 60; // 60pxを基準値として倍率に変換

    // スケール変換ヘルパー（元画像座標 → Canvas座標）
    // 画像のみ回転、点は常に元画像座標系のまま描画（回転しない）
    // どの回転角度でも点はその場に残る
    const s = (pt: { x: number; y: number }): { x: number; y: number } => {
      return { x: pt.x * scale, y: pt.y * scale };
    };

    const p = {
      p1: s(points.point1),
      p2: s(points.point2),
      p3: s(points.point3),
      p4: s(points.point4),
      p5: s(points.point5),
      p6: s(points.point6),
      p7: s(points.point7),
      p8: s(points.point8),
      p9: s(points.point9),
      p10: s(points.point10),
      p11: points.point11 ? s(points.point11) : null,
      p12: points.point12 ? s(points.point12) : null,
      p13: points.point13 ? s(points.point13) : null,
      p14: points.point14 ? s(points.point14) : null,
      p15: points.point15 ? s(points.point15) : null,
      p16: points.point16 ? s(points.point16) : null,
    };

    // ---- 点線1の方向ベクトル（単位ベクトル） ----
    const line1Dir = getLine1Direction(points.point9, points.point10);

    // ---- かかとライン上の交点（線4・線5の足元） ----
    // 屈折ユニットがアクティブな場合は屈折基準線上の交点を使用する
    const fu1 = flexUnit1 ?? { active: false, angle: 0 };
    const fu2 = flexUnit2 ?? { active: false, angle: 0 };
    const flex1Center = points.point15 ?? { x: (points.point9.x + points.point10.x) * 0.4, y: (points.point9.y + points.point10.y) / 2 };
    const flex2Center = points.point16 ?? { x: (points.point9.x + points.point10.x) * 0.6, y: (points.point9.y + points.point10.y) / 2 };
    const leftHeelRaw = showFlexAxis1
      ? getFlexHeelIntersection(flex1Center, fu1.angle, points.point5)
      : getIntersectionOnLine1(points.point9, points.point10, points.point5);
    const rightHeelRaw = showFlexAxis2
      ? getFlexHeelIntersection(flex2Center, fu2.angle, points.point6)
      : getIntersectionOnLine1(points.point9, points.point10, points.point6);
    const leftHeel = s(leftHeelRaw);
    const rightHeel = s(rightHeelRaw);

    // ---- ダイアゴナルモード対応: 左右独立の移動線方向ベクトル ----
    // ダイアゴナルモードON時は屈折基準線の方向、OFF時は点線1（点9〜10）の方向
    const leftLine1Dir: { x: number; y: number } = showFlexAxis1
      ? { x: Math.cos(fu1.angle), y: Math.sin(fu1.angle) }
      : line1Dir;
    const rightLine1Dir: { x: number; y: number } = showFlexAxis2
      ? { x: Math.cos(fu2.angle), y: Math.sin(fu2.angle) }
      : line1Dir;

    // ---- 線4・線5の垂直方向（左右オフセット方向） ----
    const leftPerp = getVerticalLinePerp(p.p5, leftHeel);
    const rightPerp = getVerticalLinePerp(p.p6, rightHeel);

    // ロック中は枠1・点線1・ハンドルをピンク、解除時は緑
    const frameColor = isLocked ? "#4488FF" : BRIGHT_GREEN;

    // ---- 枚1: A4基準枚（点線矩形） ----
    ctx.save();
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 1.5 * LW;
    if (isLocked) {
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([3, 3]);
    }
    ctx.beginPath();
    ctx.moveTo(p.p1.x, p.p1.y);
    ctx.lineTo(p.p2.x, p.p2.y);
    ctx.lineTo(p.p4.x, p.p4.y);
    ctx.lineTo(p.p3.x, p.p3.y);
    ctx.closePath();
    // 基準固定前後ともに枠内部を黒透遈85%で塗りつぶす
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ---- Short/Longラベル: 点1〜点2の線の中心上に表示 ----
    {
      const midX = (p.p1.x + p.p2.x) / 2;
      const midY = (p.p1.y + p.p2.y) / 2;
      // 点1〜点2の方向ベクトル
      const dx12 = p.p2.x - p.p1.x;
      const dy12 = p.p2.y - p.p1.y;
      const len12 = Math.sqrt(dx12 * dx12 + dy12 * dy12);
      // 線に垂直な外側方向（上側）にオフセット
      const perpX = len12 > 0 ? dy12 / len12 : 0;
      const perpY = len12 > 0 ? -dx12 / len12 : -1;
      const offset = 11; // 辺への距離を半分に（22→ 11）
      const labelX = midX + perpX * offset;
      const labelY = midY + perpY * offset;
      const { widthMm } = getPaperDimensions(paperType, a4Orientation);
      const longShort = a4Orientation === 'landscape' ? 'Long' : 'Short';
      const label = `${longShort}${widthMm}mm(${paperType})`;
      const labelColor = '#FFFFFF';
      ctx.save();
      ctx.font = `bold ${Math.round(14.3 * LW * 2)}px sans-serif`; // フォントサイズを65%に調整（22→14.3）
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 軌跡の角度に合わせてラベルを回転
      const angle = Math.atan2(dy12, dx12);
      ctx.translate(labelX, labelY);
      ctx.rotate(angle);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    // ---- 点線1: かかとライン（点9〜点10） ----
    // 点9と点10を通る直線をキャンバス端まで延長する
    {
      const dx = p.p10.x - p.p9.x;
      const dy = p.p10.y - p.p9.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const ux = dx / len, uy = dy / len;
        // キャンバス内に収まる十分大きな値（画像対角線以上）
        const extend = Math.sqrt(origW * origW + origH * origH);
        const x1 = p.p9.x - ux * extend;
        const y1 = p.p9.y - uy * extend;
        const x2 = p.p10.x + ux * extend;
        const y2 = p.p10.y + uy * extend;
        ctx.save();
        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 1.5 * LW;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // referenceモード: 足の線・点を全て非表示（A4枠・かかとラインのみ表示）
    if (mode === 'reference') {
      // A4枠コーナーと赤い操作点の描画（ハンドル描画関数を先に定義）
      const drawHandleRef = (
        pt: { x: number; y: number },
        color: string,
        shape: "circle" | "dot" = "circle"
      ) => {
        ctx.save();
        if (shape === "circle") {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2 * LW;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          const arm = HANDLE_RADIUS * 0.55;
          ctx.beginPath();
          ctx.moveTo(pt.x - arm, pt.y);
          ctx.lineTo(pt.x + arm, pt.y);
          ctx.moveTo(pt.x, pt.y - arm);
          ctx.lineTo(pt.x, pt.y + arm);
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 0.8 * LW;
          ctx.stroke();
        }
        ctx.restore();
      };
      drawHandleRef(p.p1, frameColor, "circle");
      drawHandleRef(p.p2, frameColor, "circle");
      drawHandleRef(p.p3, frameColor, "circle");
      drawHandleRef(p.p4, frameColor, "circle");
      if (!isLocked) {
        const frameCx = (p.p1.x + p.p2.x + p.p3.x + p.p4.x) / 4;
        const frameCy = (p.p1.y + p.p2.y + p.p3.y + p.p4.y) / 4;
        const proxyOffset = 28;
        const proxyRadius = 4;
        for (const [pt] of [
          [p.p1], [p.p2], [p.p3], [p.p4]
        ] as [{ x: number; y: number }][]) {
          const toCenterX = frameCx - pt.x;
          const toCenterY = frameCy - pt.y;
          const toCenterLen = Math.sqrt(toCenterX ** 2 + toCenterY ** 2);
          if (toCenterLen === 0) continue;
          const outX = -(toCenterX / toCenterLen) * proxyOffset;
          const outY = -(toCenterY / toCenterLen) * proxyOffset;
          ctx.save();
          ctx.fillStyle = frameColor;
          ctx.beginPath();
          ctx.arc(pt.x + outX, pt.y + outY, proxyRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      drawHandleRef(p.p9, frameColor, "dot");
      drawHandleRef(p.p10, frameColor, "dot");

      // ---- 屈折ユニット1・2の描画（referenceモード） ----
      {
        const fu1 = flexUnit1 ?? { active: false, angle: 0 };
        const fu2 = flexUnit2 ?? { active: false, angle: 0 };
        // flexUnitHalfLen: Canvas座標系で一定サイズになるよう計算（containerWの8%を基準）
        const containerWForFlex = containerRef.current?.clientWidth ?? 400;
        const flexHalfLenCanvas = Math.max(40, Math.min(100, containerWForFlex * 0.08));
        const flexUnitHalfLen = flexHalfLenCanvas / scale; // 画像座標系に変換
        const FLEX_COLOR = '#FFA07A'; // 薄いオレンジ色（ライトサーモン）
        const DIAG_FONT_SIZE = Math.round(14.3 * LW * 2); // Long/Shortと同じフォントサイズ
        const drawFlexUnit = (
          center: { x: number; y: number },
          unit: { active: boolean; angle: number; axisLength?: number },
          unitIndex: 1 | 2,
          showAxis: boolean,
          label: string
        ) => {
          // 屈折点（center）を常に描画 - 塗りつぶし小丸（半径4px）
          ctx.save();
          ctx.fillStyle = FLEX_COLOR;
          ctx.beginPath();
          ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          // 屈折点の下にラベルを常時描画（Long/Shortと同じフォントサイズ・同じオレンジ色）
          ctx.save();
          ctx.font = `bold ${DIAG_FONT_SIZE}px sans-serif`;
          ctx.fillStyle = FLEX_COLOR;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, center.x, center.y + 6);
          ctx.restore();
          // ダイアゴナルモードOFF時はここで終了（屈折基準線・屈折軸・操作点5/6は非表示）
          if (!showAxis) {
            void unitIndex;
            return;
          }
          // ダイアゴナルモードON時のみ屈折基準線・屈折軸・操作点5/6を描画
          const axisDir = getFlexAxisDirection(unit.angle);
          const baseHalfLen = flexUnitHalfLen * scale;
          const [baseLeft, baseRight] = getFlexBaseLineEndpoints(center, unit.angle, baseHalfLen);
          const defaultAxisLen = baseHalfLen * 0.8 * 2;
          const axisTopLen = (unit.axisLength != null ? unit.axisLength * scale : defaultAxisLen);
          const axisTop = { x: center.x + axisDir.x * axisTopLen, y: center.y + axisDir.y * axisTopLen };
          ctx.save();
          ctx.strokeStyle = FLEX_COLOR;
          ctx.lineCap = 'round';
          ctx.setLineDash([]);
          // 屈折基準線
          ctx.lineWidth = 2.8 * LW;
          ctx.beginPath();
          ctx.moveTo(baseLeft.x, baseLeft.y);
          ctx.lineTo(baseRight.x, baseRight.y);
          ctx.stroke();
          // 屈折軸（上方向のみ）
          ctx.lineWidth = 2.8 * LW;
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.lineTo(axisTop.x, axisTop.y);
          ctx.stroke();
          // 屈折軸先端に操作点を描画（flexOp5/6）- 塗りつぶし小丸（半径4px）
          ctx.fillStyle = FLEX_COLOR;
          ctx.beginPath();
          ctx.arc(axisTop.x, axisTop.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          void unitIndex;
        };
         const flex1Pos = p.p15 ?? { x: (p.p9.x + p.p10.x) * 0.4, y: (p.p9.y + p.p10.y) / 2 };
        const flex2Pos = p.p16 ?? { x: (p.p9.x + p.p10.x) * 0.6, y: (p.p9.y + p.p10.y) / 2 };
        drawFlexUnit(flex1Pos, fu1, 1, showFlexAxis1, isLocked ? '' : '左傾');
        drawFlexUnit(flex2Pos, fu2, 2, showFlexAxis2, isLocked ? '' : '右傾');
      }
      return;
    }

    // 縦線・横線の色: bunionモードは緑、insoleモードは黄色オレンジ、standardモードはビビットピンク
    // bunion/insoleモードもビビットピンクに統一
    const lineColor = COLORS.leftYellow;
    const lineColorR = COLORS.rightYellow;

    // ---- 線1004: 左足中央縦線（bunion:緑 / standard:黄、点5→かかと交点） ----
    // bunionモードでは1stIP（p.p13）より上の縦線は非表示（縦線はp.p13までのみ）
    // ダイアゴナルモードON時は屈折軸方向（屈折基準線に垂直）で描画
    {
      const line4Top = (mode === 'bunion' && p.p13) ? p.p13 : p.p5;
      // ダイアゴナルモードON時: 縦線の方向を屈折軸方向に変更
      let line4End = leftHeel;
      if (mode === 'bunion' && showFlexAxis1 && p.p13) {
        // 屈折軸方向（屈折基準線に垂直）→ 下方向（かかと方向）に反転
        const axisDir = getFlexAxisDirection(fu1.angle);
        const dist = Math.sqrt((leftHeel.x - p.p13.x) ** 2 + (leftHeel.y - p.p13.y) ** 2);
        // axisDirはCanvas座標系で上方向なので、下方向（かかと方向）に反転して使用
        line4End = { x: p.p13.x - axisDir.x * dist, y: p.p13.y - axisDir.y * dist };
      }
      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2 * LW;
      ctx.beginPath();
      ctx.moveTo(line4Top.x, line4Top.y);
      ctx.lineTo(line4End.x, line4End.y);
      ctx.stroke();
      ctx.restore();
    }

    // ---- 線1005: 右足中央縦線（bunion:緑 / standard:黄、点5→かかと交点） ----
    // insoleモードでは右足縦線を非表示
    // bunionモードでは1stIP（p.p14）より上の縦線は非表示（縦線はp.p14までのみ）
    // ダイアゴナルモードON時は屈折軸方向（屈折基準線に垂直）で描画
    if (mode !== 'insole') {
      const line5Top = (mode === 'bunion' && p.p14) ? p.p14 : p.p6;
      let line5End = rightHeel;
      if (mode === 'bunion' && showFlexAxis2 && p.p14) {
        const axisDir = getFlexAxisDirection(fu2.angle);
        const dist = Math.sqrt((rightHeel.x - p.p14.x) ** 2 + (rightHeel.y - p.p14.y) ** 2);
        // axisDirはCanvas座標系で上方向なので、下方向（かかと方向）に反転して使用
        line5End = { x: p.p14.x - axisDir.x * dist, y: p.p14.y - axisDir.y * dist };
      }
      ctx.save();
      ctx.strokeStyle = lineColorR;
      ctx.lineWidth = 2 * LW;
      ctx.beginPath();
      ctx.moveTo(line5Top.x, line5Top.y);
      ctx.lineTo(line5End.x, line5End.y);
      ctx.stroke();
      ctx.restore();
    }

    // ---- 線2: 左つま先ライン（bunion:緑 / standard:黄、点5を通る） ----
    // bunionモードではpoint13の高さに描画（1stIP横線）、standardモードはpoint5基準
    // ダイアゴナルモードON時は屈折基準線1の方向、OFF時は点線1方向
    const line2Anchor = (mode === 'bunion' && p.p13) ? p.p13 : p.p5;
    const line2HalfLen = 60 * lineHalfLenMult; // Canvas座標固定（解像度非依存）
    const [line2Start, line2End] = getParallelLineEndpoints(leftLine1Dir, line2Anchor, line2HalfLen);
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5 * LW;
    ctx.beginPath();
    ctx.moveTo(line2Start.x, line2Start.y);
    ctx.lineTo(line2End.x, line2End.y);
    ctx.stroke();
    ctx.restore();

    // 線2のラベル（左横）
    {
      const labelText = (mode === 'bunion') ? '1stCPP' : 'Length'; // insoleモードでも 'Length'
      const labelColor = COLORS.leftYellow; // 全モードでビビットピンク
      // line2の左端より少し外側に描画
      const leftPt = line2Start.x < line2End.x ? line2Start : line2End;
      ctx.save();
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = labelColor;
      ctx.textAlign = "right";
      ctx.fillText(labelText, leftPt.x - 4, leftPt.y + 4);
      ctx.restore();
      // Length操作点（ビビットピンク丸）: 「Length」テキストの右隣（左足の操作点はテキストの右隔に配置）（standard/insoleモード）
      if (mode === 'standard' || mode === 'insole') {
        const proxyR = 4;
        const proxyGap = 4; // テキスト右端からの隔間
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        const textW = ctx.measureText(labelText).width;
        ctx.restore();
        // テキストは textAlign="right" で leftPt.x - 4 に描画される
        // テキスト右端 = leftPt.x - 4（textAlign=rightなので右端がleftPt.x-4）
        const proxyX = leftPt.x - 4 + proxyGap + proxyR;
        // fillTextのY座標はベースラインを指定するため、テキストの視覚的中央に合わせるためフォントサイズの半分を引く
        const proxyY = leftPt.y + 4 - 4; // 小文字「e」の視覚的中央：ベースラインから小文字アセントの半分≈フォントサイズ*0.35≈、4
        ctx.save();
        ctx.fillStyle = mode === 'insole' ? INSOLE_COLOR : COLORS.leftYellow;
        ctx.beginPath();
        ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 1stIP操作点（緑丸）: 「1stIP」テキストの右端（「P」の右横）に配置（bunionModeのみ）
      if (mode === 'bunion') {
        const proxyR = 4;
        const proxyGap = 6;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        const textW = ctx.measureText(labelText).width;
        ctx.restore();
        // テキストは textAlign="right" で leftPt.x - 4 に描画されるので、テキスト左端 = leftPt.x - 4 - textW
        // テキスト右端 = leftPt.x - 4（textAlign=rightなので右端が leftPt.x-4）
        const textRightX = leftPt.x - 4;
        const proxyX = textRightX + proxyGap + proxyR;
        // 「s」の視覚的中央：小文字アセントの中央≈ベースライン - 4
        const proxyY = leftPt.y + 4 - 4;
        ctx.save();
        ctx.fillStyle = COLORS.leftYellow; // bunionモードの1stCPP操作点もビビットピンク
        ctx.beginPath();
        ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ---- 線3: 右つま先ライン（bunion:緑 / standard:黄、点6を通る） ----
    // bunionモードではpoint14の高さに描画（1stIP横線）、standardモードはpoint6基準
    // insoleモードでは線3（右足つま先ライン）を非表示
    // ダイアゴナルモードON時は屈折基準線2の方向、OFF時は点線1方向
    const line3Anchor = (mode === 'bunion' && p.p14) ? p.p14 : p.p6;
    const line3HalfLen = 60 * lineHalfLenMult; // Canvas座標固定（解像度非依存）
    const [line3Start, line3End] = getParallelLineEndpoints(rightLine1Dir, line3Anchor, line3HalfLen);
    if (mode !== 'insole') {
      ctx.save();
      ctx.strokeStyle = lineColorR;
      ctx.lineWidth = 1.5 * LW;
      ctx.beginPath();
      ctx.moveTo(line3Start.x, line3Start.y);
      ctx.lineTo(line3End.x, line3End.y);
      ctx.stroke();
      ctx.restore();
    }

    // 線3のラベル（右横）
    if (mode !== 'insole') {
      const labelText = mode === 'bunion' ? '1stCPP' : 'Length';
      const labelColor = COLORS.rightYellow; // 全モードでビビットピンク
      const rightPt = line3Start.x > line3End.x ? line3Start : line3End;
      ctx.save();
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = labelColor;
      ctx.textAlign = "left";
      ctx.fillText(labelText, rightPt.x + 4, rightPt.y + 4);
      ctx.restore();
      // Length操作点（ビビットピンク丸）: 「Length」テキストの左隣（右足の操作点はテキストの左隔に配置）（standardModeのみ）
      if (mode === 'standard') {
        const proxyR = 4;
        const proxyGap = 4; // テキスト左端からの隔間
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        const textW = ctx.measureText(labelText).width;
        ctx.restore();
        // テキストは textAlign="left" で rightPt.x + 4 に描画される
        // テキスト左端 = rightPt.x + 4（textAlign=leftなので左端がrightPt.x+4）
        const proxyX = rightPt.x + 4 - proxyGap - proxyR;
        const proxyY = rightPt.y + 4 - 4;
        ctx.save();
        ctx.fillStyle = COLORS.rightYellow;
        ctx.beginPath();
        ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 1stIP操作点（緑丸）: 「1stIP」テキストの左端（「1」の左横）に配置（bunionModeのみ）
      if (mode === 'bunion') {
        const proxyR = 4;
        const proxyGap = 6;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        const textW = ctx.measureText(labelText).width;
        ctx.restore();
        // テキストは textAlign="left" で rightPt.x + 4 に描画されるので、テキスト左端 = rightPt.x + 4
        const textLeftX = rightPt.x + 4;
        const proxyX = textLeftX - proxyGap - proxyR;
        const proxyY = rightPt.y + 4 - 4;
        ctx.save();
        ctx.fillStyle = COLORS.rightYellow; // bunionモードの1stCPP右操作点もビビットピンク
        ctx.beginPath();
        ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ---- 足幅点線====================================================
    // 標準モード: 点線6〜9（足幅ライン）
    // ========================================================
    if (mode === 'standard') {
      // 点7の縦線上位置から幅を算出
      const leftWidthHalf = computeWidthHalf(p.p5, leftHeel, p.p7);

      const dot6Top = { x: p.p5.x + leftPerp.x * leftWidthHalf, y: p.p5.y + leftPerp.y * leftWidthHalf };
      const dot6Bot = { x: leftHeel.x + leftPerp.x * leftWidthHalf, y: leftHeel.y + leftPerp.y * leftWidthHalf };
      const dot7Top = { x: p.p5.x - leftPerp.x * leftWidthHalf, y: p.p5.y - leftPerp.y * leftWidthHalf };
      const dot7Bot = { x: leftHeel.x - leftPerp.x * leftWidthHalf, y: leftHeel.y - leftPerp.y * leftWidthHalf };

      ctx.save();
      ctx.strokeStyle = COLORS.widthDash;
      ctx.lineWidth = 1.5 * LW;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(dot6Top.x, dot6Top.y); ctx.lineTo(dot6Bot.x, dot6Bot.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dot7Top.x, dot7Top.y); ctx.lineTo(dot7Bot.x, dot7Bot.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 点線6の左側に "Width" ラベル
      {
        const outerX = Math.min(dot6Top.x, dot6Bot.x);
        const midY = (dot6Top.y + dot6Bot.y) / 2;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = COLORS.widthDash;
        ctx.textAlign = "right";
        ctx.fillText("Width", outerX - 4, midY + 4);
        ctx.restore();

      }

      const rightWidthHalf = computeWidthHalf(p.p6, rightHeel, p.p8);

      const dot9Top = { x: p.p6.x + rightPerp.x * rightWidthHalf, y: p.p6.y + rightPerp.y * rightWidthHalf };
      const dot9Bot = { x: rightHeel.x + rightPerp.x * rightWidthHalf, y: rightHeel.y + rightPerp.y * rightWidthHalf };
      const dot8Top = { x: p.p6.x - rightPerp.x * rightWidthHalf, y: p.p6.y - rightPerp.y * rightWidthHalf };
      const dot8Bot = { x: rightHeel.x - rightPerp.x * rightWidthHalf, y: rightHeel.y - rightPerp.y * rightWidthHalf };

      ctx.save();
      ctx.strokeStyle = COLORS.widthDash;
      ctx.lineWidth = 1.5 * LW;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(dot9Top.x, dot9Top.y); ctx.lineTo(dot9Bot.x, dot9Bot.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dot8Top.x, dot8Top.y); ctx.lineTo(dot8Bot.x, dot8Bot.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 点線8の右側に "Width" ラベル
      {
        const outerX = Math.max(dot8Top.x, dot8Bot.x);
        const midY = (dot8Top.y + dot8Bot.y) / 2;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = COLORS.widthDash;
        ctx.textAlign = "left";
        ctx.fillText("Width", outerX + 4, midY + 4);
        ctx.restore();

      }
    }

    // ========================================================
    // 母子丘モード: 線4・線5に垂直な横線（点11・点12で位置制御）
    // ========================================================
    if (mode === 'bunion') {
      // 左足母子丘横線（点11の位置を通る）
      // ダイアゴナルモードON時は屈折基準線1方向、OFF時は線4に垂直（leftPerp）
      if (p.p11) {
        const p11proj = projectOntoLine(p.p5, leftHeel, p.p11);
        const bunionHalfLen = 60 * lineHalfLenMult; // Canvas座標固定（解像度非依存）: 1stCPPと同じ長さ
        // 縦線に垂直方向（屈折ユニットON/OFF問わず）
        const htoBLeftDir = leftPerp;
        const [bL1Start, bL1End] = getParallelLineEndpoints(htoBLeftDir, p11proj, bunionHalfLen);
        ctx.save();
        ctx.strokeStyle = COLORS.bunionLine;
        ctx.lineWidth = 1.5 * LW;
        ctx.beginPath();
        ctx.moveTo(bL1Start.x, bL1Start.y);
        ctx.lineTo(bL1End.x, bL1End.y);
        ctx.stroke();
        ctx.restore();
        // H2B ラベル（左横線の左側）
        const leftBunionPt = bL1Start.x < bL1End.x ? bL1Start : bL1End;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = COLORS.bunionLine;
        ctx.textAlign = "right";
        ctx.fillText("HtoB", leftBunionPt.x - 4, leftBunionPt.y + 4);
        ctx.restore();
        // HtoB操作点（白丸）: HtoBテキストのTとOの間の下に配置
        {
          const proxyR = 4;
          const proxyGapBelow = 8; // テキスト下からの隔間
          ctx.save();
          ctx.font = "bold 12px sans-serif";
          const textW = ctx.measureText("HtoB").width;
          const wHt = ctx.measureText("Ht").width;  // Hとtの幅
          const wHto = ctx.measureText("Hto").width; // Hとtとoの幅
          ctx.restore();
          // textAlign="right" で leftBunionPt.x - 4 に描画される
          // テキスト左端 = leftBunionPt.x - 4 - textW
          // tの右端 = テキスト左端 + wHt
          // oの左端 = テキスト左端 + wHt（= tの右端）
          // tとoの間の中心 = テキスト左端 + (wHt + wHto) / 2
          const textLeftX = leftBunionPt.x - 4 - textW;
          const proxyX = textLeftX + (wHt + wHto) / 2; // tとoの間の中心
          // テキストのベースラインは leftBunionPt.y + 4
          const proxyY = leftBunionPt.y + 4 + proxyGapBelow + proxyR;
          ctx.save();
          ctx.fillStyle = COLORS.bunionLine;
          ctx.beginPath();
          ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 右足母子丘横線（点12の位置を通る）
      // ダイアゴナルモードON時は屈折基準線2方向、OFF時は線5に垂直（rightPerp）
      if (p.p12) {
        const p12proj = projectOntoLine(p.p6, rightHeel, p.p12);
        const bunionHalfLen = 60 * lineHalfLenMult; // Canvas座標固定（解像度非依存）: 1stCPPと同じ長さ
        const htoBRightDir = rightPerp;
        const [bR1Start, bR1End] = getParallelLineEndpoints(htoBRightDir, p12proj, bunionHalfLen);
        ctx.save();
        ctx.strokeStyle = COLORS.bunionLine;
        ctx.lineWidth = 1.5 * LW;
        ctx.beginPath();
        ctx.moveTo(bR1Start.x, bR1Start.y);
        ctx.lineTo(bR1End.x, bR1End.y);
        ctx.stroke();
        ctx.restore();
        // H2B ラベル（右横線の右側）
        const rightBunionPt = bR1Start.x > bR1End.x ? bR1Start : bR1End;
        ctx.save();
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = COLORS.bunionLine;
        ctx.textAlign = "left";
        ctx.fillText("HtoB", rightBunionPt.x + 4, rightBunionPt.y + 4);
        ctx.restore();
        // HtoB操作点（白丸）: HtoBテキストのTとOの間の下に配置
        {
          const proxyR = 4;
          const proxyGapBelow = 8; // テキスト下からの隔間
          ctx.save();
          ctx.font = "bold 12px sans-serif";
          const wHt = ctx.measureText("Ht").width;  // Hとtの幅
          const wHto = ctx.measureText("Hto").width; // Hとtとoの幅
          ctx.restore();
          // textAlign="left" で rightBunionPt.x + 4 から描画される
          // テキスト左端 = rightBunionPt.x + 4
          // tとoの間の中心 = テキスト左端 + (wHt + wHto) / 2
          const textLeftX = rightBunionPt.x + 4;
          const proxyX = textLeftX + (wHt + wHto) / 2; // tとoの間の中心
          // テキストのベースラインは rightBunionPt.y + 4
          const proxyY = rightBunionPt.y + 4 + proxyGapBelow + proxyR;
          ctx.save();
          ctx.fillStyle = COLORS.bunionLine;
          ctx.beginPath();
          ctx.arc(proxyX, proxyY, proxyR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // ---- ハンドル描画 ----
    const drawHandle = (
      pt: { x: number; y: number },
      color: string,
      label: string,
      labelPos: "top" | "bottom" | "left" | "right" = "top",
      shape: "circle" | "dot" = "circle"
    ) => {
      ctx.save();
      if (shape === "circle") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 * LW;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        if (!isLocked) {
          const arm = HANDLE_RADIUS * 0.55;
          ctx.beginPath();
          ctx.moveTo(pt.x - arm, pt.y);
          ctx.lineTo(pt.x + arm, pt.y);
          ctx.moveTo(pt.x, pt.y - arm);
          ctx.lineTo(pt.x, pt.y + arm);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 0.8 * LW;
        ctx.stroke();
      }

      if (label) {
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = color;
        const lx = labelPos === "left" ? pt.x - 14 : labelPos === "right" ? pt.x + 10 : pt.x;
        const ly = labelPos === "top" ? pt.y - 10 : labelPos === "bottom" ? pt.y + 16 : pt.y - 3;
        ctx.textAlign = "center";
        ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    };

    // A4枠コーナー（ロック中はピンク、解除時は緑）
    drawHandle(p.p1, frameColor, "", "top", "circle");
    drawHandle(p.p2, frameColor, "", "top", "circle");
    drawHandle(p.p3, frameColor, "", "top", "circle");
    drawHandle(p.p4, frameColor, "", "top", "circle");

    // ---- 赤い操作点: 点1〜4の各コーナー外側に配置 ----
    // ロック中は非表示
    if (!isLocked) {
      // 枠の中心点を計算
      const frameCx = (p.p1.x + p.p2.x + p.p3.x + p.p4.x) / 4;
      const frameCy = (p.p1.y + p.p2.y + p.p3.y + p.p4.y) / 4;
      // 操作点のオフセット距離（画面上28px相当）
      const proxyOffset = 28;
      const proxyRadius = 4;
      const proxyColor = frameColor;
      // 各コーナーの外側方向に操作点を配置
      for (const [pt, corner] of [
        [p.p1, 'p1'], [p.p2, 'p2'], [p.p3, 'p3'], [p.p4, 'p4']
      ] as [{ x: number; y: number }, string][]) {
        // コーナーから枠中心方向の単位ベクトルを求め、逆方向（外側）に配置
        const toCenterX = frameCx - pt.x;
        const toCenterY = frameCy - pt.y;
        const toCenterLen = Math.sqrt(toCenterX ** 2 + toCenterY ** 2);
        if (toCenterLen === 0) continue;
        const outX = -(toCenterX / toCenterLen) * proxyOffset;
        const outY = -(toCenterY / toCenterLen) * proxyOffset;
        const proxyX = pt.x + outX;
        const proxyY = pt.y + outY;
        ctx.save();
        ctx.fillStyle = proxyColor;
        ctx.beginPath();
        ctx.arc(proxyX, proxyY, proxyRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        void corner; // 使用宣言を抑制
      }
    }

    // 点5・点6のハンドルは非表示（線2・線3を直接ドラッグして上下移動）

    // 点7・点8の白い操作点（標準モードのみ表示）
    if (mode === 'standard') {
      // 点7: 縦線（線4）上の射影位置に白い点を描画
      const p7proj = projectOntoLine(p.p5, leftHeel, p.p7);
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p7proj.x, p7proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 点8: 縦線（線5）上の射影位置に白い点を描画
      const p8proj = projectOntoLine(p.p6, rightHeel, p.p8);
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p8proj.x, p8proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 点9・点10: かかとライン端点（ロック中はピンク、解除時は緑）
    drawHandle(p.p9, frameColor, "", "top", "dot");
    drawHandle(p.p10, frameColor, "", "top", "dot");

    // ---- 屈折ユニット1・2の描画（standard/bunionモード）----
    // 屈折点（point15/16）は常に描画（ダイアゴナルモードのON/OFFに関わらず）
    {
      const fu1 = flexUnit1 ?? { active: false, angle: 0 };
      const fu2 = flexUnit2 ?? { active: false, angle: 0 };
      const containerWForFlex = containerRef.current?.clientWidth ?? 400;
      const flexHalfLenCanvas = Math.max(40, Math.min(100, containerWForFlex * 0.08));
      const flexUnitHalfLen = flexHalfLenCanvas / scale; // 画像座標系に変換
      // ロック中は青色、未ロック時はオレンジ色
      const FLEX_LOCKED_COLOR = '#4488FF';
      const FLEX_COLOR_STD = '#FFA07A';
      const flexColor = isLocked ? FLEX_LOCKED_COLOR : FLEX_COLOR_STD;
      const DIAG_FONT_SIZE_STD = Math.round(14.3 * LW * 2);
      const drawFlexUnitStd = (
        center: { x: number; y: number },
        unit: { active: boolean; angle: number; axisLength?: number },
        showAxis: boolean,
        label: string,
        hideAxisLine = false
      ) => {
        // 屈折点（center）を常に描画 - 塗りつぶし小丸（半径4px）
        ctx.save();
        ctx.fillStyle = flexColor;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 屈折点の下にラベルを常時描画
        ctx.save();
        ctx.font = `bold ${DIAG_FONT_SIZE_STD}px sans-serif`;
        ctx.fillStyle = flexColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, center.x, center.y + 6);
        ctx.restore();
        // ダイアゴナルモードOFF時はここで終了
        if (!showAxis) return;
        // ダイアゴナルモードON時は屈折基準線・屈折軸・操作点5/6を描画
        const axisDir = getFlexAxisDirection(unit.angle);
        const baseHalfLen = flexUnitHalfLen * scale;
        const [baseLeft, baseRight] = getFlexBaseLineEndpoints(center, unit.angle, baseHalfLen);
        const defaultAxisLen = baseHalfLen * 0.8 * 2;
        const axisTopLen = (unit.axisLength != null ? unit.axisLength * scale : defaultAxisLen);
        const axisTop = { x: center.x + axisDir.x * axisTopLen, y: center.y + axisDir.y * axisTopLen };
        ctx.save();
        ctx.strokeStyle = flexColor;
        ctx.lineCap = 'round';
        ctx.setLineDash([]);
        // 屈折基準線（常に表示）
        ctx.lineWidth = 2.8 * LW;
        ctx.beginPath();
        ctx.moveTo(baseLeft.x, baseLeft.y);
        ctx.lineTo(baseRight.x, baseRight.y);
        ctx.stroke();
        // hideAxisLine=trueの場合は屈折軸・操作点5/6を非表示
        if (!hideAxisLine) {
          // 屈折軸（上方向のみ）
          ctx.lineWidth = 2.8 * LW;
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.lineTo(axisTop.x, axisTop.y);
          ctx.stroke();
          // 屈折軸先端に操作点を描画（flexOp5/6）- 塗りつぶし小丸（半径4px）
          // ロック中は操作不可（描画のみ）
          ctx.fillStyle = flexColor;
          ctx.beginPath();
          ctx.arc(axisTop.x, axisTop.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };
       if (mode !== 'insole') {
        // standard/bunionモード: 屈折ユニット1・2を描画
        const flex1Pos = p.p15 ?? { x: (p.p9.x + p.p10.x) * 0.4, y: (p.p9.y + p.p10.y) / 2 };
        const flex2Pos = p.p16 ?? { x: (p.p9.x + p.p10.x) * 0.6, y: (p.p9.y + p.p10.y) / 2 };
        // standard/bunionタブ+isLocked=true時は屈折軸を非表示（屈折基準線のみ表示）
        const hideAxisForLocked = isLocked;
        drawFlexUnitStd(flex1Pos, fu1, showFlexAxis1, hideAxisForLocked ? '' : '左傾', hideAxisForLocked);
        drawFlexUnitStd(flex2Pos, fu2, showFlexAxis2, hideAxisForLocked ? '' : '右傾', hideAxisForLocked);
      } else {
        // insoleモード: 屈折ユニット1のみ、ラベルは'傾き'
        const flex1Pos = p.p15 ?? { x: (p.p9.x + p.p10.x) * 0.5, y: (p.p9.y + p.p10.y) / 2 };
        drawFlexUnitStd(flex1Pos, fu1, showFlexAxis1, isLocked ? '' : '傾き');
      }
    }
    // bunionモード: 点11・点12のL/Rハンドルは削除（HtoB操作点で上下移動するため不要）

  }, [points, scale, imageLoaded, imageWidth, imageHeight, mode, isLocked, dpr, imageRotation, a4Orientation, paperType, showFlexAxis1, showFlexAxis2, flexUnit1, flexUnit2]);

  // ---- ドラッグ操作 ----

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      // getBoundingClientRect() は CSS transform 後の実際画面上の矩形を返すため、
      // ピンチズーム中は rect.width = cssW * pinchScale になる。
      const rect = canvas.getBoundingClientRect();
      // canvas内の相対位置（0.0、1.0）
      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;
      // 画像のみ回転、点は常に元画像座標系のまま（回転しない）
      // 90/270度回転時はcanvasサイズが入れ替わる（imageHeight*scale × imageWidth*scale）
      if (imageRotation === 90 || imageRotation === 270) {
        // 90/270度回転時: canvasは(imageHeight*scale) x (imageWidth*scale)
        // 左右方向(nx)が元画像のx方向（0～imageHeight）に対応
        // 上下方向(ny)が元画像のy方向（0～imageWidth）に対応
        return { x: nx * imageHeight, y: ny * imageWidth };
      } else {
        // 0/180度: canvasは(imageWidth*scale) x (imageHeight*scale)
        return { x: nx * imageWidth, y: ny * imageHeight };
      }
    },
    [imageWidth, imageHeight, imageRotation]
  );

  const findNearestPoint = useCallback(
    (cx: number, cy: number): DragKey | null => {
      // 画面上のピクセルを画像座標に変換するスケール（ピンチズームを考慮）
      const effectiveScale = scale * pinchScale;
      // 横線の長さ（ヒットテスト用）: 描画コードと同じ計算式で統一
      const containerWForLineHit = containerRef.current?.clientWidth ?? 400;
      const lineHalfLen_baseHit = Math.max(30, Math.min(80, containerWForLineHit * 0.08));
      const lineHalfLenMultHit = lineHalfLen_baseHit / 60;
      // ズーム時も操作点を操作しやすくするため、最小閘値を設定する
      // ピンチスケールに関係なく画面上で常にTOUCH_RADIUS相当の判定半径を確保
      const threshold = TOUCH_RADIUS / scale; // pinchScaleに関係なく常に画面上でTOUCH_RADIUS相当

      // モードに応じてドラッグ可能な点を決定し、ロック中の点を除外
      const currentLocked = lockedPointsRef.current;
      const allDraggable: PointKey[] = mode === 'bunion'
        ? ['point1', 'point2', 'point3', 'point4', 'point5', 'point6', 'point9', 'point10', 'point11', 'point12', 'point15', 'point16']
        : mode === 'insole'
        ? ['point1', 'point2', 'point3', 'point4', 'point5', 'point9', 'point10', 'point15']
        : mode === 'reference'
        ? ['point1', 'point2', 'point3', 'point4', 'point9', 'point10', 'point15', 'point16']
        : ['point1', 'point2', 'point3', 'point4', 'point5', 'point6', 'point7', 'point8', 'point9', 'point10', 'point15', 'point16'];
      // isLocked=true時はpoint15/16（屈折点）もドラッグ不可にする
      const draggableKeys: PointKey[] = currentLocked
        ? allDraggable.filter(k => !currentLocked.has(k as LockedPointKey) && !(isLocked && mode !== 'reference' && (k === 'point15' || k === 'point16')))
        : isLocked
        ? allDraggable.filter(k => mode === 'reference' || (k !== 'point15' && k !== 'point16'))
        : allDraggable;

      // 赤い操作点（点1〜4の外側プロキシ点）のタッチ判定（最優先）
      // ロック中は操作点が非表示なので判定もスキップ
      if (!isLocked) {
        // 枠の中心点（画像座標）
        const frameCx = (points.point1.x + points.point2.x + points.point3.x + points.point4.x) / 4;
        const frameCy = (points.point1.y + points.point2.y + points.point3.y + points.point4.y) / 4;
        // 操作点のオフセット距離（画面上28px相当を画像座標に変換）
        const proxyOffsetImg = 28 / effectiveScale;
        // タッチ判定半径：pinchScaleに関係なく画面上で常にTOUCH_RADIUS相当を確保
        const proxyHitRadius = TOUCH_RADIUS / scale;
        const cornerProxyPairs: [PointKey, { x: number; y: number }][] = [
          ['point1', points.point1], ['point2', points.point2],
          ['point3', points.point3], ['point4', points.point4],
        ];
        for (const [key, pt] of cornerProxyPairs) {
          if (!draggableKeys.includes(key)) continue;
          const toCenterX = frameCx - pt.x;
          const toCenterY = frameCy - pt.y;
          const toCenterLen = Math.sqrt(toCenterX ** 2 + toCenterY ** 2);
          if (toCenterLen === 0) continue;
          const proxyX = pt.x - (toCenterX / toCenterLen) * proxyOffsetImg;
          const proxyY = pt.y - (toCenterY / toCenterLen) * proxyOffsetImg;
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitRadius) {
            return key;
          }
        }
      }

      // Length/Width操作点のヒットテスト（線2/3・点線6/8のラベル横の丸）
      // standard/insoleMode、ロック中は無効化しない（Length/Width操作点はロック対象外）
      if (mode === 'standard' || mode === 'insole') {
        const proxyHitR = TOUCH_RADIUS / scale; // pinchScaleに関係なく画面上で常にTOUCH_RADIUS相当
        // ヒットテストの操作点位置計算は画像座標系
        // 画像座標での距離 = Canvas座標での距離 / scale
        // 例: Canvas座標で60px → 画像座標で60（scaleに依存しない定数）
        const fontSizeImg = 12 / scale; // 画像座標でのフォントサイズ
        const textWImg = 6 * 0.6 * fontSizeImg; // 「Length」の近似幅（画像座標）
        const proxyGapImg = 6 / scale;
        const proxyR_img = 4 / scale;
        const line1DirPx = getLine1Direction(points.point9, points.point10);
        // line2HalfLenPx: 画像座標での横線の半長
        // 描画コード: line2HalfLen = 60 * lineHalfLenMult（Canvas座標固定）
        // 画像座標に変換: Canvas座標 / scale
        const line2HalfLenPx = 60 * lineHalfLenMultHit / scale;
        const [l2Start, l2End] = getParallelLineEndpoints(line1DirPx, points.point5, line2HalfLenPx);
        const leftPt5 = l2Start.x < l2End.x ? l2Start : l2End;
        // 線2左操作点（lengthProxy5）: テキスト右端の右隔（左足の操作点はテキストの右隔に移動）
        {
          // textAlign=rightなのでテキスト右端 = leftPt5.x - 4/scale
          const proxyX = leftPt5.x - 4 / scale + proxyGapImg + proxyR_img;
          const proxyY = leftPt5.y;
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitR) return 'lengthProxy5';
        }
        // insoleモードでは線3（右足）およびWidth操作点は非表示なのでヒットテストもスキップ
        if (mode !== 'insole') {
          const [l3Start, l3End] = getParallelLineEndpoints(line1DirPx, points.point6, line2HalfLenPx);
          const rightPt6 = l3Start.x > l3End.x ? l3Start : l3End;
          // 線3右操作点（lengthProxy6）: テキスト左端の左隔（右足の操作点はテキストの左隔に移動）
          {
            // textAlign=leftなのでテキスト左端 = rightPt6.x + 4/scale
            const proxyX = rightPt6.x + 4 / scale - proxyGapImg - proxyR_img;
            const proxyY = rightPt6.y;
            const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
            if (d < proxyHitR) return 'lengthProxy6';
          }

          // widthProxy7（左Width操作点）: 点第線（線4）上射影位置
          // showFlexAxis1=trueの場合は屈折基準線上の交点を使用（描画側と一致させる）
          {
            const fu1w = flexUnit1 ?? { active: false, angle: 0 };
            const flex1Cw = points.point15 ?? { x: (points.point9.x + points.point10.x) * 0.4, y: (points.point9.y + points.point10.y) / 2 };
            const leftHeelW7 = showFlexAxis1
              ? getFlexHeelIntersection(flex1Cw, fu1w.angle, points.point5)
              : getIntersectionOnLine1(points.point9, points.point10, points.point5);
            const p7projW = projectOntoLine(points.point5, leftHeelW7, points.point7);
            const d = Math.sqrt((cx - p7projW.x) ** 2 + (cy - p7projW.y) ** 2);
            if (d < proxyHitR) return 'widthProxy7';
          }

          // widthProxy8（右Width操作点）: 点講線（線5）上射影位置
          // showFlexAxis2=trueの場合は屈折基準線上の交点を使用（描画側と一致させる）
          {
            const fu2w = flexUnit2 ?? { active: false, angle: 0 };
            const flex2Cw = points.point16 ?? { x: (points.point9.x + points.point10.x) * 0.6, y: (points.point9.y + points.point10.y) / 2 };
            const rightHeelW8 = showFlexAxis2
              ? getFlexHeelIntersection(flex2Cw, fu2w.angle, points.point6)
              : getIntersectionOnLine1(points.point9, points.point10, points.point6);
            const p8projW = projectOntoLine(points.point6, rightHeelW8, points.point8);
            const d = Math.sqrt((cx - p8projW.x) ** 2 + (cy - p8projW.y) ** 2);
            if (d < proxyHitR) return 'widthProxy8';
          }
        }
      }

      // 1stIP/HtoB操作点のヒットテスト（bunionModeのみ）
      if (mode === 'bunion') {
        const proxyHitR = TOUCH_RADIUS / scale; // pinchScaleに関係なく画面上で常にTOUCH_RADIUS相当
        // ヒットテストの操作点位置計算は画像座標系
        const fontSizeImg = 12 / scale; // 画像座標でのフォントサイズ
        const textWImg_1stIP = 5 * 0.6 * fontSizeImg; // 「1stIP」の近似幅（画像座標）
        const textWImg_HtoB = 4 * 0.6 * fontSizeImg;  // 「HtoB」の近似幅（画像座標）
        const proxyGapImg = 6 / scale;
        const proxyR_img = 4 / scale;
        const line1DirPx = getLine1Direction(points.point9, points.point10);
        // line2HalfLenPx: 画像座標での横線の半長（描画コードと同じ: Canvas座標固定 / scale）
        const line2HalfLenPx = 60 * lineHalfLenMultHit / scale;

        // firstipProxy5（左1stIP操作点）: 線2の左端ラベルの右横
        // bunionモードではpoint13の高さ基準（描画コードと同じ）
        {
          const ip5Anchor = points.point13 ?? points.point5;
          const [l2Start, l2End] = getParallelLineEndpoints(line1DirPx, ip5Anchor, line2HalfLenPx);
          const leftPt5 = l2Start.x < l2End.x ? l2Start : l2End;
          // テキストは textAlign="right" で leftPt.x - 4 に描画されるので、テキスト右端 = leftPt.x - 4
          const textRightX = leftPt5.x - 4 / scale;
          const proxyX = textRightX + proxyGapImg + proxyR_img;
          const proxyY = leftPt5.y; // 描画コード: leftPt.y + 4 - 4 = leftPt.y
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitR) return 'firstipProxy5';
        }

        // firstipProxy6（右1stIP操作点）: 線3の右端ラベルの左横
        // bunionモードではpoint14の高さ基準（描画コードと同じ）
        {
          const ip6Anchor = points.point14 ?? points.point6;
          const [l3Start, l3End] = getParallelLineEndpoints(line1DirPx, ip6Anchor, line2HalfLenPx);
          const rightPt6 = l3Start.x > l3End.x ? l3Start : l3End;
          // テキストは textAlign="left" で rightPt.x + 4 に描画されるので、テキスト左端 = rightPt.x + 4
          const textLeftX = rightPt6.x + 4 / scale;
          const proxyX = textLeftX - proxyGapImg - proxyR_img;
          const proxyY = rightPt6.y; // 描画コード: rightPt.y + 4 - 4 = rightPt.y
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitR) return 'firstipProxy6';
        }

        // htobProxy11（左HtoB操作点）: HtoBテキストのtとoの間の下に配置（描画コードと同じ基準）
        // showFlexAxis1=trueの場合は屈折基準線上の交点を使用（描画側と一致させる）
        if (points.point11) {
          const fu1h = flexUnit1 ?? { active: false, angle: 0 };
          const flex1Ch = points.point15 ?? { x: (points.point9.x + points.point10.x) * 0.4, y: (points.point9.y + points.point10.y) / 2 };
          const leftHeelHit = showFlexAxis1
            ? getFlexHeelIntersection(flex1Ch, fu1h.angle, points.point5)
            : getIntersectionOnLine1(points.point9, points.point10, points.point5);
          const leftPerpHit = getVerticalLinePerp(points.point5, leftHeelHit);
          const p11projHit = projectOntoLine(points.point5, leftHeelHit, points.point11);
          const bL1HalfLen = 60 * lineHalfLenMultHit / scale; // Canvas座標固定 / scale（描画側と統一）
          const [bL1Start, bL1End] = getParallelLineEndpoints(leftPerpHit, p11projHit, bL1HalfLen);
          const leftBunionPt = bL1Start.x < bL1End.x ? bL1Start : bL1End;
          const proxyGapBelowImg = 8 / scale;
          // テキスト左端（画像座標）= leftBunionPt.x - 4/scale - textWImg
          const textLeftXImg = leftBunionPt.x - 4 / scale - textWImg_HtoB;
          // tとoの間の中心 = テキスト左端 + textWImg * 1.5 / 4
          // "HtoB"の各文字幅比率: H:t:o:B ≈ 1.1:0.55:0.9:1.0 (bold sans-serifの概算)
          // wHt / wHtoB ≈ (1.1+0.55)/(1.1+0.55+0.9+1.0) = 1.65/3.55 ≈ 0.465
          // wHto / wHtoB ≈ (1.1+0.55+0.9)/3.55 ≈ 0.718
          const proxyX = textLeftXImg + textWImg_HtoB * (0.465 + 0.718) / 2;
          // テキストベースラインの下に配置
          const proxyY = leftBunionPt.y + 4 / scale + proxyGapBelowImg + proxyR_img;
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitR) return 'htobProxy11';

          // HtoB横線×縦線の交点（第2操作点）: htobProxy11と同じ動作
          // 交点 = point11を縦線（point5→かかと）に射影した点
          const d11cross = Math.sqrt((cx - p11projHit.x) ** 2 + (cy - p11projHit.y) ** 2);
          if (d11cross < proxyHitR) return 'htobProxy11';
        }

        // htobProxy12（右HtoB操作点）: HtoBテキストのtとoの間の下に配置（描画コードと同じ基準）
        // showFlexAxis2=trueの場合は屈折基準線上の交点を使用（描画側と一致させる）
        if (points.point12) {
          const fu2h = flexUnit2 ?? { active: false, angle: 0 };
          const flex2Ch = points.point16 ?? { x: (points.point9.x + points.point10.x) * 0.6, y: (points.point9.y + points.point10.y) / 2 };
          const rightHeelHit = showFlexAxis2
            ? getFlexHeelIntersection(flex2Ch, fu2h.angle, points.point6)
            : getIntersectionOnLine1(points.point9, points.point10, points.point6);
          const rightPerpHit = getVerticalLinePerp(points.point6, rightHeelHit);
          const p12projHit = projectOntoLine(points.point6, rightHeelHit, points.point12);
          const bR1HalfLen = 60 * lineHalfLenMultHit / scale; // Canvas座標固定 / scale（描画側と統一）
          const [bR1Start, bR1End] = getParallelLineEndpoints(rightPerpHit, p12projHit, bR1HalfLen);
          const rightBunionPt = bR1Start.x > bR1End.x ? bR1Start : bR1End;
          const proxyGapBelowImg = 8 / scale;
          // テキスト左端（画像座標）= rightBunionPt.x + 4/scale
          const textLeftXImg = rightBunionPt.x + 4 / scale;
          // tとoの間の中心 = テキスト左端 + textWImg * (0.465 + 0.718) / 2
          // "HtoB"の各文字幅比率: H:t:o:B ≈ 1.1:0.55:0.9:1.0 (bold sans-serifの概算)
          const proxyX = textLeftXImg + textWImg_HtoB * (0.465 + 0.718) / 2;
          // テキストベースラインの下に配置
          const proxyY = rightBunionPt.y + 4 / scale + proxyGapBelowImg + proxyR_img;
          const d = Math.sqrt((cx - proxyX) ** 2 + (cy - proxyY) ** 2);
          if (d < proxyHitR) return 'htobProxy12';

          // HtoB横線×縦線の交点（第2操作点）: htobProxy12と同じ動作
          // 交点 = point12を縦線（point6→かかと）に射影した点
          const d12cross = Math.sqrt((cx - p12projHit.x) ** 2 + (cy - p12projHit.y) ** 2);
          if (d12cross < proxyHitR) return 'htobProxy12';
        }

        // 1stCPP横線×縦線の交点（第2操作点）: firstipProxy5と同じ動作
        // 交点 = point13を縦線（point5→かかと）に射影した点
        if (points.point13) {
          const ip5Heel = getIntersectionOnLine1(points.point9, points.point10, points.point5);
          const p13projCross = projectOntoLine(points.point5, ip5Heel, points.point13);
          const d13cross = Math.sqrt((cx - p13projCross.x) ** 2 + (cy - p13projCross.y) ** 2);
          if (d13cross < proxyHitR) return 'firstipProxy5';
        }

        // 1stCPP横線×縦線の交点（右・第2操作点）: firstipProxy6と同じ動作
        // 交点 = point14を縦線（point6→かかと）に射影した点
        if (points.point14) {
          const ip6Heel = getIntersectionOnLine1(points.point9, points.point10, points.point6);
          const p14projCross = projectOntoLine(points.point6, ip6Heel, points.point14);
          const d14cross = Math.sqrt((cx - p14projCross.x) ** 2 + (cy - p14projCross.y) ** 2);
          if (d14cross < proxyHitR) return 'firstipProxy6';
        }
      }

      // 線2・線3の線上へのタッチ判定（次優先）
      // 点5・点6のハンドルが非表示のため、線上のどこをタップしても反応するよう、他の点より優先して判定する
      const line1Dir = getLine1Direction(points.point9, points.point10);
      // lineHalfLen: 画面上60px相当を画像座標に変換（線方向）
      const lineHalfLen = 60 / effectiveScale;
      // lineThreshold: 線2/3専用の垂直方向タッチ範囲（画面上40px相当）
      // 通常のthreshold（26px）より広くして、線2/3から少し離れた位置でも反応するようにする
      const lineThreshold = 40 / effectiveScale;
      const lx = line1Dir.x, ly = line1Dir.y;

      // 点5（線2）の線上判定
      if (draggableKeys.includes('point5')) {
        const pt5 = points.point5;
        const dx5 = cx - pt5.x, dy5 = cy - pt5.y;
        const along5 = dx5 * lx + dy5 * ly;
        const perp5 = Math.abs(dx5 * (-ly) + dy5 * lx);
        if (Math.abs(along5) <= lineHalfLen && perp5 < lineThreshold) {
          return 'point5';
        }
      }

      // 点6（線3）の線上判定
      if (draggableKeys.includes('point6')) {
        const pt6 = points.point6;
        const dx6 = cx - pt6.x, dy6 = cy - pt6.y;
        const along6 = dx6 * lx + dy6 * ly;
        const perp6 = Math.abs(dx6 * (-ly) + dy6 * lx);
        if (Math.abs(along6) <= lineHalfLen && perp6 < lineThreshold) {
          return 'point6';
        }
      }

      // 枠1（point1〜4）の各辺タップ判定
      // 辺に近い場合は、その辺の2端点のうちタップ位置に近い方のコーナー点を返す
      // 辺タップ閾値: 画面上30px相当
      const edgeThreshold = 30 / effectiveScale;
      const cornerKeys: [PointKey, PointKey, PointKey, PointKey] = ['point1', 'point2', 'point3', 'point4'];
      // 枠1の4辺: [点1-点2（上辺）, 点3-点4（下辺）, 点1-点3（左辺）, 点2-点4（右辺）]
      const frameSides: [PointKey, PointKey][] = [
        ['point1', 'point2'], // 上辺
        ['point3', 'point4'], // 下辺
        ['point1', 'point3'], // 左辺
        ['point2', 'point4'], // 右辺
      ];
      // ロックされていないコーナー点のみ対象
      const draggableCorners = cornerKeys.filter(k => draggableKeys.includes(k));
      if (draggableCorners.length > 0) {
        let bestEdgeDist = edgeThreshold;
        let bestEdgePoint: PointKey | null = null;
        for (const [kA, kB] of frameSides) {
          const ptA = points[kA], ptB = points[kB];
          if (!ptA || !ptB) continue;
          // 辺ABへの垂直距離を計算
          const edgeDx = ptB.x - ptA.x, edgeDy = ptB.y - ptA.y;
          const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
          if (edgeLen === 0) continue;
          const t = ((cx - ptA.x) * edgeDx + (cy - ptA.y) * edgeDy) / (edgeLen * edgeLen);
          // 辺の範囲内（端点付近を除く: t in [0.1, 0.9]）のみ判定
          // 端点付近は通常の点タップで処理するため除外
          if (t < 0.1 || t > 0.9) continue;
          const projX = ptA.x + t * edgeDx, projY = ptA.y + t * edgeDy;
          const perpDist = Math.sqrt((cx - projX) ** 2 + (cy - projY) ** 2);
          if (perpDist < bestEdgeDist) {
            // タップ位置に近い方のコーナー点を選ぶ
            const dA = Math.sqrt((cx - ptA.x) ** 2 + (cy - ptA.y) ** 2);
            const dB = Math.sqrt((cx - ptB.x) ** 2 + (cy - ptB.y) ** 2);
            const nearerCorner = dA <= dB ? kA : kB;
            // そのコーナー点がドラッグ可能な場合のみ採用
            if (draggableCorners.includes(nearerCorner)) {
              bestEdgeDist = perpDist;
              bestEdgePoint = nearerCorner;
            }
          }
        }
        if (bestEdgePoint) return bestEdgePoint;
      }

      // その他の点（最近値で判定）
      let nearest: PointKey | null = null;
      let minDist = Infinity;
      for (const key of draggableKeys) {
        if (key === 'point5' || key === 'point6') continue; // 上で判定済み
        const pt = points[key];
        if (!pt) continue;
        const d = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
        if (d < threshold && d < minDist) {
          minDist = d;
          nearest = key;
        }
      }

      // referenceモードではisLocked=trueでも屈折ユニット操作を有効化
      // standard/bunionモードはshowFlexAxis1/2がONかつロック解除時のみ有効
      if ((mode === 'reference' || (!isLocked && (mode === 'insole' || ((mode === 'standard' || mode === 'bunion') && (showFlexAxis1 || showFlexAxis2)))))) {
        // flexUnitHalfLen: 描画側と同じ計算式（Canvas座標系基準）
        const containerWForFlexHit = containerRef.current?.clientWidth ?? 400;
        const flexHalfLenCanvasHit = Math.max(40, Math.min(100, containerWForFlexHit * 0.08));
        const flexUnitHalfLen = flexHalfLenCanvasHit / scale; // 画像座標系に変換
        const p15 = points.point15 ?? { x: (points.point9.x + points.point10.x) * 0.4, y: (points.point9.y + points.point10.y) / 2 };
        const p16 = points.point16 ?? { x: (points.point9.x + points.point10.x) * 0.6, y: (points.point9.y + points.point10.y) / 2 };
        const fu1Active = true; // 常時アクティブ
        const fu2Active = true; // 常時アクティブ
        const fu1Angle = flexUnit1?.angle ?? 0;
        const fu2Angle = flexUnit2?.angle ?? 0;
        // 屈折基準線上の最近傍点との距離を計算（線分への垂直距離）
        const distToSegment = (
          px: number, py: number,
          ax: number, ay: number,
          bx: number, by: number
        ): number => {
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
        };
        const lineHitThreshold = threshold * 1.5;
        const fu1Left = { x: p15.x - Math.cos(fu1Angle) * flexUnitHalfLen, y: p15.y - Math.sin(fu1Angle) * flexUnitHalfLen };
        const fu1Right = { x: p15.x + Math.cos(fu1Angle) * flexUnitHalfLen, y: p15.y + Math.sin(fu1Angle) * flexUnitHalfLen };
        const fu2Left = { x: p16.x - Math.cos(fu2Angle) * flexUnitHalfLen, y: p16.y - Math.sin(fu2Angle) * flexUnitHalfLen };
        const fu2Right = { x: p16.x + Math.cos(fu2Angle) * flexUnitHalfLen, y: p16.y + Math.sin(fu2Angle) * flexUnitHalfLen };
        const d1 = distToSegment(cx, cy, fu1Left.x, fu1Left.y, fu1Right.x, fu1Right.y);
        const d2 = distToSegment(cx, cy, fu2Left.x, fu2Left.y, fu2Right.x, fu2Right.y);
        // point15/16（屈折点）のヒットテストより外側のみ基準線ドラッグを適用
        const distToCenter1 = Math.sqrt((cx - p15.x) ** 2 + (cy - p15.y) ** 2);
        const distToCenter2 = Math.sqrt((cx - p16.x) ** 2 + (cy - p16.y) ** 2);
        // 屈折基準線（flexLine1/2）のドラッグは無効化済み（flexOp5/6のみで操作）

        // 屈折操作点5/6（屈折軸先端）のヒットテスト
        const defaultAxisLen1 = flexUnitHalfLen * 0.8 * 2; // 描画側と同じ（1/3）
        const defaultAxisLen2 = flexUnitHalfLen * 0.8 * 2; // 描画側と同じ（1/3）
        const axisLen1 = (flexUnit1?.axisLength ?? defaultAxisLen1);
        const axisLen2 = (flexUnit2?.axisLength ?? defaultAxisLen2);
        const axisDir1 = getFlexAxisDirection(fu1Angle);
        const axisDir2 = getFlexAxisDirection(fu2Angle);
        const axisTop1 = { x: p15.x + axisDir1.x * axisLen1, y: p15.y + axisDir1.y * axisLen1 };
        const axisTop2 = { x: p16.x + axisDir2.x * axisLen2, y: p16.y + axisDir2.y * axisLen2 };
        const dOp5 = Math.sqrt((cx - axisTop1.x) ** 2 + (cy - axisTop1.y) ** 2);
        const dOp6 = Math.sqrt((cx - axisTop2.x) ** 2 + (cy - axisTop2.y) ** 2);
          // flexOp5/6のみヒット判定（ダイアゴナルモードON時のみ）
        const flexOpThreshold = threshold * 3; // より広いヒット判定
        if (fu1Active && showFlexAxis1 && dOp5 < flexOpThreshold) return 'flexOp5';
        if (fu2Active && showFlexAxis2 && dOp6 < flexOpThreshold && mode !== 'insole') return 'flexOp6';
        // point15/16（屈折点）のヒット判定は常時有効（insoleモードではpoint15のみ）
        const dP15 = Math.sqrt((cx - p15.x) ** 2 + (cy - p15.y) ** 2);
        const dP16 = Math.sqrt((cx - p16.x) ** 2 + (cy - p16.y) ** 2);
        if (dP15 < threshold) return 'point15';
        if (dP16 < threshold && mode !== 'insole') return 'point16';
      }
      return nearest;
    },
    [points, scale, pinchScale, mode, isLocked, flexUnit1, flexUnit2, showFlexAxis1, showFlexAxis2]
  );

  // 90/270度回転時は表示幅がimageHeight相当になるため、x座標のmax値をimageHeightに制限する
  // これにより点9・10が常に表示内に収まる
  const clampPoint = useCallback(
    (x: number, y: number) => {
      // 90/270度回転時はcanvasは(imageHeight*scale) x (imageWidth*scale)に入れ替わる
      // 点は元画像座標系のままなので、xは0～imageHeight、yは0～imageWidthにクランプ
      if (imageRotation === 90 || imageRotation === 270) {
        return {
          x: Math.max(0, Math.min(x, imageHeight)),
          y: Math.max(0, Math.min(y, imageWidth)),
        };
      }
      return {
        x: Math.max(0, Math.min(x, imageWidth)),
        y: Math.max(0, Math.min(y, imageHeight)),
      };
    },
    [imageWidth, imageHeight, imageRotation]
  );

  /**
   * 点7のドラッグ処理:
   *   - 縦（Y）方向のみ: かかとからの絶対距離で幅を制御
   *   - 点5（左つま先）は動かさない（線2を直接ドラッグして上下移動）
   */
  const dragPoint7 = useCallback(
    (rawX: number, rawY: number): { newPoint7: { x: number; y: number }; newPoint5: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const rawPt = { x: rawX, y: rawY };
      // 横方向: 点線1上への射影 → 点5（左つま先）の横位置を更新 → 線4全体が横移動
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point5);
      const footLen = Math.sqrt(
        (points.point5.x - oldHeel.x) ** 2 + (points.point5.y - oldHeel.y) ** 2
      );
      // 横方向の移動で点5を更新
      const newPoint5 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );
      // 縦方向: かかとからの距離で点7の上下位置を制御
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint5);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint5.x) ** 2 + (newHeel.y - newPoint5.y) ** 2
      );
      const projOnNewLine = projectOntoLine(newPoint5, newHeel, rawPt);
      let ratio = 0.5;
      if (newLineLen > 0) {
        const d = Math.sqrt(
          (projOnNewLine.x - newPoint5.x) ** 2 + (projOnNewLine.y - newPoint5.y) ** 2
        );
        ratio = Math.max(0.05, Math.min(0.95, d / newLineLen));
      }
      const newPoint7 = clampPoint(
        newPoint5.x + (newHeel.x - newPoint5.x) * ratio,
        newPoint5.y + (newHeel.y - newPoint5.y) * ratio
      );
      return { newPoint7, newPoint5 };
    },
    [points, clampPoint]
  );

  /**
   * 点8のドラッグ処理（点7と同様、右足）:
   *   - 縦（Y）方向のみ: かかとからの絶対距離で幅を制御
   *   - 点6（右つま先）は動かさない
   */
  const dragPoint8 = useCallback(
    (rawX: number, rawY: number): { newPoint8: { x: number; y: number }; newPoint6: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const rawPt = { x: rawX, y: rawY };
      // 横方向: 点線1上への射影 → 点6（右つま先）の横位置を更新 → 線5全体が横移動
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point6);
      const footLen = Math.sqrt(
        (points.point6.x - oldHeel.x) ** 2 + (points.point6.y - oldHeel.y) ** 2
      );
      // 横方向の移動で点6を更新
      const newPoint6 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );
      // 縦方向: かかとからの距離で点8の上下位置を制御
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint6);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint6.x) ** 2 + (newHeel.y - newPoint6.y) ** 2
      );
      const projOnNewLine = projectOntoLine(newPoint6, newHeel, rawPt);
      let ratio = 0.5;
      if (newLineLen > 0) {
        const d = Math.sqrt(
          (projOnNewLine.x - newPoint6.x) ** 2 + (projOnNewLine.y - newPoint6.y) ** 2
        );
        ratio = Math.max(0.05, Math.min(0.95, d / newLineLen));
      }
      const newPoint8 = clampPoint(
        newPoint6.x + (newHeel.x - newPoint6.x) * ratio,
        newPoint6.y + (newHeel.y - newPoint6.y) * ratio
      );
      return { newPoint8, newPoint6 };
    },
    [points, clampPoint]
  );

  /**
   * 点13のドラッグ処理（1stIP左横線の高さ制御）:
   *   - 横（X）方向: 点線1上を左右スライド → 点5（左つま先）の横位置を更新 → 線4全体が横移動
   *   - 縦（Y）方向: 縦線上での位置 → 1stIP横線の上下位置を制御
   */
  const dragPoint13 = useCallback(
    (rawX: number, rawY: number): { newPoint13: { x: number; y: number }; newPoint5: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const rawPt = { x: rawX, y: rawY };
      // 点線1上への射影（横方向の移動先）
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point5);
      const footLen = Math.sqrt(
        (points.point5.x - oldHeel.x) ** 2 + (points.point5.y - oldHeel.y) ** 2
      );
      // 横方向の移動で点5を更新（線4全体を横スライド）
      const newPoint5 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );
      // 縦方向の移動で点13の縦線上位置を更新（1stIP横線の高さ）
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint5);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint5.x) ** 2 + (newHeel.y - newPoint5.y) ** 2
      );
      // 縦線方向ベクトル（点5→かかと方向）
      const lineDir = newLineLen > 0
        ? { x: (newHeel.x - newPoint5.x) / newLineLen, y: (newHeel.y - newPoint5.y) / newLineLen }
        : { x: 0, y: 1 };
      // rawPtを縦線上に射影（符号付き距離で上方にも移動可能）
      const toCursor = { x: rawPt.x - newPoint5.x, y: rawPt.y - newPoint5.y };
      let signedD = toCursor.x * lineDir.x + toCursor.y * lineDir.y;
      let ratio = newLineLen > 0 ? signedD / newLineLen : 0.5;
      // 上方制限なし（負の値も許容）、下方はHtoBを超えない
      ratio = Math.min(0.95, ratio);
      // 1stIPの下限: point11（HtoBライン）の新縦線上位置より上方に制限（HtoBより下には移動できない）
      if (points.point11 && newLineLen > 0) {
        const toP11 = { x: points.point11.x - newPoint5.x, y: points.point11.y - newPoint5.y };
        const minRatio = (toP11.x * lineDir.x + toP11.y * lineDir.y) / newLineLen;
        ratio = Math.min(minRatio, ratio); // minRatio以下（上方）に制限
      }
      const newPoint13 = clampPoint(
        newPoint5.x + (newHeel.x - newPoint5.x) * ratio,
        newPoint5.y + (newHeel.y - newPoint5.y) * ratio
      );
      return { newPoint13, newPoint5 };
    },
    [points, clampPoint]
  );

  /**
   * 点14のドラッグ処理（1stIP右横線の高さ制御）:
   *   - 横（X）方向: 点線1上を左右スライド → 点6（右つま先）の横位置を更新 → 線5全体が横移動
   *   - 縦（Y）方向: 縦線上での位置 → 1stIP横線の上下位置を制御
   */
  const dragPoint14 = useCallback(
    (rawX: number, rawY: number): { newPoint14: { x: number; y: number }; newPoint6: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const rawPt = { x: rawX, y: rawY };
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point6);
      const footLen = Math.sqrt(
        (points.point6.x - oldHeel.x) ** 2 + (points.point6.y - oldHeel.y) ** 2
      );
      // 横方向の移動で点6を更新（線5全体を横スライド）
      const newPoint6 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );
      // 縦方向の移動で点14の縦線上位置を更新（1stIP横線の高さ）
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint6);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint6.x) ** 2 + (newHeel.y - newPoint6.y) ** 2
      );
      // 縦線方向ベクトル（点6→かかと方向）
      const lineDir = newLineLen > 0
        ? { x: (newHeel.x - newPoint6.x) / newLineLen, y: (newHeel.y - newPoint6.y) / newLineLen }
        : { x: 0, y: 1 };
      // rawPtを縦線上に射影（符号付き距離で上方にも移動可能）
      const toCursor = { x: rawPt.x - newPoint6.x, y: rawPt.y - newPoint6.y };
      let signedD = toCursor.x * lineDir.x + toCursor.y * lineDir.y;
      let ratio = newLineLen > 0 ? signedD / newLineLen : 0.5;
      // 上方制限なし（負の値も許容）、下方はHtoBを超えない
      ratio = Math.min(0.95, ratio);
      // 1stIPの下限: point12（HtoBライン）の新縦線上位置より上方に制限（HtoBより下には移動できない）
      if (points.point12 && newLineLen > 0) {
        const toP12 = { x: points.point12.x - newPoint6.x, y: points.point12.y - newPoint6.y };
        const minRatio = (toP12.x * lineDir.x + toP12.y * lineDir.y) / newLineLen;
        ratio = Math.min(minRatio, ratio); // minRatio以下（上方）に制限
      }
      const newPoint14 = clampPoint(
        newPoint6.x + (newHeel.x - newPoint6.x) * ratio,
        newPoint6.y + (newHeel.y - newPoint6.y) * ratio
      );
      return { newPoint14, newPoint6 };
    },
    [points, clampPoint]
  );

  /**
   * 点11のドラッグ処理:
   *   - 横（X）方向: 点線1上を左右スライド → 点5（左つま先）の横位置を更新 → 線4全体が横移動
   *   - 縦（Y）方向: 縦線上での位置 → 母艦丘横線の上下位置を制御
   */
  const dragPoint11 = useCallback(
    (rawX: number, rawY: number): { newPoint11: { x: number; y: number }; newPoint5: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      // 垂直方向（上方向）を山側（フット側）に山を向ける
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const rawPt = { x: rawX, y: rawY };

      // 横方向: rawPtを点線1に射影して点5を更新（縦線は垂直を保ったまま横スライド）
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point5);
      const footLen = Math.sqrt(
        (points.point5.x - oldHeel.x) ** 2 + (points.point5.y - oldHeel.y) ** 2
      );
      const newPoint5 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );

      // 縦方向: 新しい縦線（新point5→新かかと）上でrawPtを射影してHtoB位置を決定
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint5);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint5.x) ** 2 + (newHeel.y - newPoint5.y) ** 2
      );
      const projOnNewLine = projectOntoLine(newPoint5, newHeel, rawPt);
      let ratio = 0.5;
      if (newLineLen > 0) {
        const d = Math.sqrt(
          (projOnNewLine.x - newPoint5.x) ** 2 + (projOnNewLine.y - newPoint5.y) ** 2
        );
        // 符号付き距離（上方向に負、下方向に正）でratioを計算
        const signedD = d;
        ratio = Math.max(0.0, Math.min(0.95, signedD / newLineLen));
      }
      const newPoint11 = clampPoint(
        newPoint5.x + (newHeel.x - newPoint5.x) * ratio,
        newPoint5.y + (newHeel.y - newPoint5.y) * ratio
      );
      return { newPoint11, newPoint5 };
    },
    [points, clampPoint]
  );

  /**
   * 点12のドラッグ処理:
   *   - 横（X）方向: 点線1上を左右スライド → 点6（右つま先）の横位置を更新 → 線5全体が横移動
   *   - 縦（Y）方向: 縦線上での位置 → 母艦丘横線の上下位置を制御
   */
  const dragPoint12 = useCallback(
    (rawX: number, rawY: number): { newPoint12: { x: number; y: number }; newPoint6: { x: number; y: number } } => {
      const line1Dir = getLine1Direction(points.point9, points.point10);
      const perpCand = { x: -line1Dir.y, y: line1Dir.x };
      // 垂直方向（上方向）を山側（フット側）に山を向ける
      const perpDir = perpCand.y > 0 ? { x: -perpCand.x, y: -perpCand.y } : perpCand;
      const rawPt = { x: rawX, y: rawY };

      // 横方向: rawPtを点線1に射影して点6を更新（縦線は垂直を保ったまま横スライド）
      const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
      const oldHeel = getIntersectionOnLine1(points.point9, points.point10, points.point6);
      const footLen = Math.sqrt(
        (points.point6.x - oldHeel.x) ** 2 + (points.point6.y - oldHeel.y) ** 2
      );
      const newPoint6 = clampPoint(
        projOnLine1.x + perpDir.x * footLen,
        projOnLine1.y + perpDir.y * footLen
      );

      // 縦方向: 新しい縦線（新point6→新かかと）上でrawPtを射影してHtoB位置を決定
      const newHeel = getIntersectionOnLine1(points.point9, points.point10, newPoint6);
      const newLineLen = Math.sqrt(
        (newHeel.x - newPoint6.x) ** 2 + (newHeel.y - newPoint6.y) ** 2
      );
      const projOnNewLine = projectOntoLine(newPoint6, newHeel, rawPt);
      let ratio = 0.5;
      if (newLineLen > 0) {
        const d = Math.sqrt(
          (projOnNewLine.x - newPoint6.x) ** 2 + (projOnNewLine.y - newPoint6.y) ** 2
        );
        ratio = Math.max(0.0, Math.min(0.95, d / newLineLen));
      }
      const newPoint12 = clampPoint(
        newPoint6.x + (newHeel.x - newPoint6.x) * ratio,
        newPoint6.y + (newHeel.y - newPoint6.y) * ratio
      );
      return { newPoint12, newPoint6 };
    },
    [points, clampPoint]
  );

  /**
   * 点5（左つま先）が動いたとき、点7の「かかとからの絶対距離」を保って再拘束する。
   * 点5の上下移動（足長変更）にかかわらず、点7のかかとからの距離（足幅）は変わらない。
   */
  const reanchorPoint7 = useCallback(
    (newP5: { x: number; y: number }, currentPoints: MeasurementPoints): { x: number; y: number } => {
      // 旧かかとから点7の縦線上射影までの絶対距離を保存
      const oldHeel = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, currentPoints.point5);
      const oldProj = projectOntoLine(currentPoints.point5, oldHeel, currentPoints.point7);
      const absDistFromHeel = Math.sqrt(
        (oldProj.x - oldHeel.x) ** 2 + (oldProj.y - oldHeel.y) ** 2
      );
      // 新しいかかとから同じ絶対距離の位置に点7を配置
      const newHeel = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, newP5);
      const newLineLen = Math.sqrt((newP5.x - newHeel.x) ** 2 + (newP5.y - newHeel.y) ** 2);
      if (newLineLen === 0) return currentPoints.point7;
      const dir = { x: (newP5.x - newHeel.x) / newLineLen, y: (newP5.y - newHeel.y) / newLineLen };
      return {
        x: newHeel.x + dir.x * absDistFromHeel,
        y: newHeel.y + dir.y * absDistFromHeel,
      };
    },
    []
  );

  /**
   * 点6（右つま先）が動いたとき、点8の「かかとからの絶対距離」を保って再拘束する。
   * 点6の上下移動（足長変更）にかかわらず、点8のかかとからの距離（足幅）は変わらない。
   */
  const reanchorPoint8 = useCallback(
    (newP6: { x: number; y: number }, currentPoints: MeasurementPoints): { x: number; y: number } => {
      const oldHeel = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, currentPoints.point6);
      const oldProj = projectOntoLine(currentPoints.point6, oldHeel, currentPoints.point8);
      const absDistFromHeel = Math.sqrt(
        (oldProj.x - oldHeel.x) ** 2 + (oldProj.y - oldHeel.y) ** 2
      );
      const newHeel = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, newP6);
      const newLineLen = Math.sqrt((newP6.x - newHeel.x) ** 2 + (newP6.y - newHeel.y) ** 2);
      if (newLineLen === 0) return currentPoints.point8;
      const dir = { x: (newP6.x - newHeel.x) / newLineLen, y: (newP6.y - newHeel.y) / newLineLen };
      return {
        x: newHeel.x + dir.x * absDistFromHeel,
        y: newHeel.y + dir.y * absDistFromHeel,
      };
    },
    []
  );

  /**
   * 縦線上の制御点を新しいかかと（newHeel）に合わせて再配置する。
   * toePoint（つま先点）の位置は変えない。
   * 旧縦線上での相対比率（かかとからの符号付き距離 / 旧縦線長）を保って新縦線上に再配置する。
   */
  const reanchorControlsOnFlexChange = useCallback(
    (
      toePoint: { x: number; y: number },
      oldHeel: { x: number; y: number },
      newHeel: { x: number; y: number },
      controls: ({ x: number; y: number } | undefined | null)[]
    ): ({ x: number; y: number } | null)[] => {
      const oldLen = Math.sqrt(
        (toePoint.x - oldHeel.x) ** 2 + (toePoint.y - oldHeel.y) ** 2
      );
      const newLen = Math.sqrt(
        (toePoint.x - newHeel.x) ** 2 + (toePoint.y - newHeel.y) ** 2
      );
      if (oldLen === 0 || newLen === 0) return controls.map(c => c ? { ...c } : null);
      const oldDir = {
        x: (toePoint.x - oldHeel.x) / oldLen,
        y: (toePoint.y - oldHeel.y) / oldLen,
      };
      const newDir = {
        x: (toePoint.x - newHeel.x) / newLen,
        y: (toePoint.y - newHeel.y) / newLen,
      };
      return controls.map((ctrl) => {
        if (!ctrl) return null;
        const toCtrl = { x: ctrl.x - oldHeel.x, y: ctrl.y - oldHeel.y };
        const signedDist = toCtrl.x * oldDir.x + toCtrl.y * oldDir.y;
        const ratio = signedDist / oldLen;
        return {
          x: newHeel.x + newDir.x * newLen * ratio,
          y: newHeel.y + newDir.y * newLen * ratio,
        };
      });
    },
    []
  );

  /**
   * かかとライン（点9・点10）が動いたとき、点7・点8の「かかとからの絶対距離」を保って再拘束する。
   */
  const reanchorOnHeelChange = useCallback(
    (
      newP9: { x: number; y: number },
      newP10: { x: number; y: number },
      currentPoints: MeasurementPoints
    ): { point7: { x: number; y: number }; point8: { x: number; y: number } } => {
      // 左足：旧かかとから点7までの絶対距離を保存
      const oldHeelL = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, currentPoints.point5);
      const oldProjL = projectOntoLine(currentPoints.point5, oldHeelL, currentPoints.point7);
      const absDistL = Math.sqrt((oldProjL.x - oldHeelL.x) ** 2 + (oldProjL.y - oldHeelL.y) ** 2);
      const newHeelL = getIntersectionOnLine1(newP9, newP10, currentPoints.point5);
      const newLineLenL = Math.sqrt((currentPoints.point5.x - newHeelL.x) ** 2 + (currentPoints.point5.y - newHeelL.y) ** 2);
      const point7 = newLineLenL > 0 ? {
        x: newHeelL.x + (currentPoints.point5.x - newHeelL.x) / newLineLenL * absDistL,
        y: newHeelL.y + (currentPoints.point5.y - newHeelL.y) / newLineLenL * absDistL,
      } : currentPoints.point7;

      // 右足：旧かかとから点8までの絶対距離を保存
      const oldHeelR = getIntersectionOnLine1(currentPoints.point9, currentPoints.point10, currentPoints.point6);
      const oldProjR = projectOntoLine(currentPoints.point6, oldHeelR, currentPoints.point8);
      const absDistR = Math.sqrt((oldProjR.x - oldHeelR.x) ** 2 + (oldProjR.y - oldHeelR.y) ** 2);
      const newHeelR = getIntersectionOnLine1(newP9, newP10, currentPoints.point6);
      const newLineLenR = Math.sqrt((currentPoints.point6.x - newHeelR.x) ** 2 + (currentPoints.point6.y - newHeelR.y) ** 2);
      const point8 = newLineLenR > 0 ? {
        x: newHeelR.x + (currentPoints.point6.x - newHeelR.x) / newLineLenR * absDistR,
        y: newHeelR.y + (currentPoints.point6.y - newHeelR.y) / newLineLenR * absDistR,
      } : currentPoints.point8;

      return { point7, point8 };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      e.preventDefault();
      const { x, y } = getCanvasPoint(e.clientX, e.clientY);
      const key = findNearestPoint(x, y);

      // ダブルタップ/ダブルクリック検出（300ms以内に同じ操作点を再タップ）
      if (key) {
        const now = Date.now();
        const lastTap = lastTapRef.current;
        if (lastTap && lastTap.key === key && now - lastTap.time < 300) {
          // ダブルタップ検出！
          lastTapRef.current = null;
          // 屈折点1/2のダブルタップ → ダイアゴナルモードON/OFF切り替え
          if (key === 'point15') {
            const nextShow = !showFlexAxis1;
            setShowFlexAxis1(nextShow);
            // ONにした場合はaxisLengthをデフォルトの2倍で初期化
            if (nextShow) {
              const cw = containerRef.current?.clientWidth ?? 400;
              const halfLen = Math.max(40, Math.min(100, cw * 0.08));
              const defaultLen = (halfLen / scale) * 0.8 * 2;
              onFlexUnit1Change?.({ active: flexUnit1?.active ?? true, angle: flexUnit1?.angle ?? 0, axisLength: defaultLen * 2 });
            }
            return;
          }
          if (key === 'point16') {
            const nextShow = !showFlexAxis2;
            setShowFlexAxis2(nextShow);
            // ONにした場合はaxisLengthをデフォルトの2倍で初期化
            if (nextShow) {
              const cw = containerRef.current?.clientWidth ?? 400;
              const halfLen = Math.max(40, Math.min(100, cw * 0.08));
              const defaultLen = (halfLen / scale) * 0.8 * 2;
              onFlexUnit2Change?.({ active: flexUnit2?.active ?? true, angle: flexUnit2?.angle ?? 0, axisLength: defaultLen * 2 });
            }
            return;
          }
          if (zoomPointKey === key) {
            // 同じ操作点を再度ダブルタップ → 拡大モード解除
            setZoomPointKey(null);
            setPinchScale(1);
          } else {
            // 拡大モード開始: 操作点の周辺を自動ズーム
            setZoomPointKey(key);
            // 操作点の画像座標を取得
            let ptX = x, ptY = y;
            const pt = key in points ? points[key as keyof typeof points] : null;
            if (pt && typeof pt === 'object' && 'x' in pt) {
              ptX = (pt as { x: number; y: number }).x;
              ptY = (pt as { x: number; y: number }).y;
            }
            // ズームレベルを設定（3倍）
            const zoomLevel = 3;
            setPinchScale(zoomLevel);
            // 操作点の画面上の位置にスクロールを合わせる
            const container = containerRef.current;
            if (container) {
              // Canvasサイズは常に元画像サイズ固定（回転に関わらず）なので、
              // 操作点の画面上のX/Y位置は常に ptX * scale / ptY * scale
              // 回転変換は不要—画像のみ回転しているが、操作点は常に元画像座標系で描画される
              const scrollX = ptX * scale * zoomLevel - container.clientWidth / 2;
              const scrollY = ptY * scale * zoomLevel - container.clientHeight / 2;
              setTimeout(() => {
                container.scrollLeft = Math.max(0, scrollX);
                container.scrollTop = Math.max(0, scrollY);
              }, 50);
            }
          }
          return; // ダブルタップ時はドラッグ開始しない
        }
        // 最初のタップ時は即座にドラッグ開始（ダブルタップ待機なし）
        lastTapRef.current = { key, time: now };
      } else {
        // 操作点以外をタップ → 拡大モード解除
        if (zoomPointKey !== null) {
          setZoomPointKey(null);
          setPinchScale(1);
        }
        lastTapRef.current = null;
      }

      if (key) {
        setDragging(key);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        // ドラッグ開始時: クリック位置と対象点の差分を記録
        // これによりクリック位置を維持したままドラッグできる
        // 赤い操作点（コーナー外側に配置）をドラッグする場合も、
        // 操作点とコーナー点のオフセットを保ったまま移動するため、
        // クリック位置と対応コーナー点の差分を記録する
        // lengthProxy5/6 の場合は、対応する点5/点6に対するオフセットを記録
        // これにより、タップした瞬間に線が滑り込む現象を防ぐ
        if (key === 'lengthProxy5') {
          // lengthProxy5は足長調整（point5基準）
          dragOffsetRef.current = { x: x - points.point5.x, y: y - points.point5.y };
        } else if (key === 'firstipProxy5') {
          // firstipProxy5は1stIP横線調整（point13基準、フォールバックpoint5）
          const ip5 = points.point13 ?? points.point5;
          dragOffsetRef.current = { x: x - ip5.x, y: y - ip5.y };
        } else if (key === 'lengthProxy6') {
          // lengthProxy6は足長調整（point6基準）
          dragOffsetRef.current = { x: x - points.point6.x, y: y - points.point6.y };
        } else if (key === 'firstipProxy6') {
          // firstipProxy6は1stIP横線調整（point14基準、フォールバックpoint6）
          const ip6 = points.point14 ?? points.point6;
          dragOffsetRef.current = { x: x - ip6.x, y: y - ip6.y };
        } else if (key === 'widthProxy7') {
          // Width操作点（左）のオフセットは点7を基準
          dragOffsetRef.current = { x: x - points.point7.x, y: y - points.point7.y };
        } else if (key === 'widthProxy8') {
          // Width操作点（右）のオフセットは点8を基準
          dragOffsetRef.current = { x: x - points.point8.x, y: y - points.point8.y };
        } else if (key === 'htobProxy11') {
          // HtoB操作点（左）のオフセットは点11を基準
          // dragPoint11は点11と点5の両方を更新するが、操作点の表示位置は点11の射影位置なので点11基準
          if (points.point11) {
            dragOffsetRef.current = { x: x - points.point11.x, y: y - points.point11.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        } else if (key === 'htobProxy12') {
          // HtoB操作点（右）のオフセットは点12を基準
          if (points.point12) {
            dragOffsetRef.current = { x: x - points.point12.x, y: y - points.point12.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        } else if (key === 'point15') {
          // 屈折点1: 点線1上の射影位置を基準にオフセット設定（急激なジャンプを防ぐ）
          const p15 = points.point15;
          if (p15) {
            const proj15 = projectOntoLine(points.point9, points.point10, p15);
            dragOffsetRef.current = { x: x - proj15.x, y: y - proj15.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        } else if (key === 'point16') {
          // 屈折点2: 点線1上の射影位置を基準にオフセット設定（急激なジャンプを防ぐ）
          const p16 = points.point16;
          if (p16) {
            const proj16 = projectOntoLine(points.point9, points.point10, p16);
            dragOffsetRef.current = { x: x - proj16.x, y: y - proj16.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        } else if (key === 'flexOp5' || key === 'flexOp6') {
          // 屈折操作点5/6: ドラッグ開始時の角度・軸長・屈折点位置を記録
          dragOffsetRef.current = { x: 0, y: 0 };
          const isUnit1 = key === 'flexOp5';
          const center = isUnit1
            ? (points.point15 ?? { x: (points.point9.x + points.point10.x) * 0.4, y: (points.point9.y + points.point10.y) / 2 })
            : (points.point16 ?? { x: (points.point9.x + points.point10.x) * 0.6, y: (points.point9.y + points.point10.y) / 2 });
          const startAngle = isUnit1 ? (flexUnit1?.angle ?? 0) : (flexUnit2?.angle ?? 0);
          // defaultAxisLen: 描画側と同じ計算式（Canvas座標系基準）
          const containerWForFlexDown = containerRef.current?.clientWidth ?? 400;
          const flexHalfLenCanvasDown = Math.max(40, Math.min(100, containerWForFlexDown * 0.08));
          const flexUnitHalfLenDown = flexHalfLenCanvasDown / scale;
          const defaultAxisLen = flexUnitHalfLenDown * 0.8 * 2; // 描画・ヒットテストと統一
          const startAxisLength = isUnit1 ? (flexUnit1?.axisLength ?? defaultAxisLen) : (flexUnit2?.axisLength ?? defaultAxisLen);
          flexDragStartRef.current = {
            startX: x, startY: y,
            startAngle,
            startAxisLength,
            centerX: center.x, centerY: center.y,
          };
        } else if (key === 'flexCenter1' || key === 'flexCenter2') {
          // 屈折点1/2操作点: 点線1上の射影位置を基準にオフセット設定
          const isUnit1 = key === 'flexCenter1';
          const centerPt = isUnit1 ? points.point15 : points.point16;
          if (centerPt) {
            const proj = projectOntoLine(points.point9, points.point10, centerPt);
            dragOffsetRef.current = { x: x - proj.x, y: y - proj.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        } else {
          const targetPoint = points[key as keyof typeof points];
          if (targetPoint) {
            dragOffsetRef.current = { x: x - targetPoint.x, y: y - targetPoint.y };
          } else {
            dragOffsetRef.current = { x: 0, y: 0 };
          }
        }
        // 拡大モード中はドラッグ開始位置を記録（1/4縮小計算用）
        if (zoomPointKey !== null) {
          zoomDragStartRef.current = { x, y };
          // proxy handleの場合は実際のアンカー座標を記録
          let anchorPt: { x: number; y: number } | null = null;
          if (key === 'lengthProxy5') anchorPt = points.point5;
          else if (key === 'firstipProxy5') anchorPt = points.point13 ?? points.point5;
          else if (key === 'lengthProxy6') anchorPt = points.point6;
          else if (key === 'firstipProxy6') anchorPt = points.point14 ?? points.point6;
          else if (key === 'widthProxy7') anchorPt = points.point7;
          else if (key === 'widthProxy8') anchorPt = points.point8;
          else if (key === 'htobProxy11') anchorPt = points.point11 ?? null;
          else if (key === 'htobProxy12') anchorPt = points.point12 ?? null;
          else {
            const pt = key in points ? points[key as keyof typeof points] : null;
            if (pt && typeof pt === 'object' && 'x' in pt) anchorPt = pt as { x: number; y: number };
          }
          zoomDragPointStartRef.current = anchorPt ?? { x, y };
        } else {
          zoomDragStartRef.current = null;
          zoomDragPointStartRef.current = null;
        }
      }
    },
    [readOnly, getCanvasPoint, findNearestPoint, points, zoomPointKey, scale, imageRotation, flexUnit1, flexUnit2, imageWidth, imageHeight, showFlexAxis1, showFlexAxis2, onFlexUnit1Change, onFlexUnit2Change]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || readOnly) return;
      e.preventDefault();
      const rawPos = getCanvasPoint(e.clientX, e.clientY);

      // 拡大モード中はドラッグ量を1/4に縮小して反映（精密調整）
      // アンカー座標 + (現在位置 - 開始位置) * 0.25 を各ドラッグ関数に渡す座標として使用
      let x: number, y: number;
      if (zoomPointKey !== null && zoomDragStartRef.current && zoomDragPointStartRef.current) {
        const dx = rawPos.x - zoomDragStartRef.current.x;
        const dy = rawPos.y - zoomDragStartRef.current.y;
        // アンカー座標からドラッグ量を1/4に縮小した仮想位置
        x = zoomDragPointStartRef.current.x + dx * 0.25;
        y = zoomDragPointStartRef.current.y + dy * 0.25;
        // dragOffsetRefはアンカー座標と一致させる（オフセットをキャンセル）
        dragOffsetRef.current = { x: 0, y: 0 };
      } else {
        x = rawPos.x;
        y = rawPos.y;
      }

      let updatedPoints = { ...points };

      if (dragging === "point7") {
        const { newPoint7, newPoint5 } = dragPoint7(x, y);
        updatedPoints.point7 = newPoint7;
        updatedPoints.point5 = newPoint5;
      } else if (dragging === "point8") {
        const { newPoint8, newPoint6 } = dragPoint8(x, y);
        updatedPoints.point8 = newPoint8;
        updatedPoints.point6 = newPoint6;
      } else if (dragging === "point11") {
        const { newPoint11, newPoint5: newP5fromP11 } = dragPoint11(x, y);
        updatedPoints.point11 = newPoint11;
        updatedPoints.point5 = newP5fromP11;
        // point13（1stCPPライン）はH2Bと独立して動かせるので追従させない
        updatedPoints.point7 = reanchorPoint7(newP5fromP11, points);
      } else if (dragging === "point12") {
        const { newPoint12, newPoint6: newP6fromP12 } = dragPoint12(x, y);
        updatedPoints.point12 = newPoint12;
        updatedPoints.point6 = newP6fromP12;
        // point14（1stCPPライン）はH2Bと独立して動かせるので追従させない
        updatedPoints.point8 = reanchorPoint8(newP6fromP12, points);
      } else if (dragging === "point5") {
        // 線2ドラッグ: 2軸対応
        //   横方向 (点線1に平行) = 線4が点線1上を横移動
        //   縦方向 (点線1に垂直) = レングス調整（足長変更）
        // dragOffsetRef: クリック開始時のオフセットを引いて、クリック位置を維持したまま移動
        {
          const line1Dir5 = getLine1Direction(points.point9, points.point10);
          // オフセットを引いた実際の点5位置を計算（クリック位置を維持）
          const adjustedX5 = x - dragOffsetRef.current.x;
          const adjustedY5 = y - dragOffsetRef.current.y;
          // 横方向: 調整後位置を点線1上に射影 → 新しいかかと交点
          const newHeel5 = projectOntoLine(points.point9, points.point10, { x: adjustedX5, y: adjustedY5 });
          // 現在の足長（点5とかかと交点の距離）
          const oldHeel5 = getIntersectionOnLine1(points.point9, points.point10, points.point5);
          const oldFootLen5 = Math.sqrt(
            (points.point5.x - oldHeel5.x) ** 2 + (points.point5.y - oldHeel5.y) ** 2
          );
          // 垂直方向（点線1に垂直）の単位ベクトル（つま先方向）
          const perpCand5 = { x: -line1Dir5.y, y: line1Dir5.x };
          const perpDir5 = perpCand5.y > 0 ? { x: -perpCand5.x, y: -perpCand5.y } : perpCand5;
          // 調整後位置の垂直方向成分（足長）を計算
          const dxFromHeel5 = adjustedX5 - newHeel5.x, dyFromHeel5 = adjustedY5 - newHeel5.y;
          let newLen5 = dxFromHeel5 * perpDir5.x + dyFromHeel5 * perpDir5.y;
          // 縦方向の移動がほぼない場合（横移動）は現在の足長を維持
          if (Math.abs(newLen5) < 5) newLen5 = oldFootLen5;
          newLen5 = Math.max(20, newLen5);
          const constrainedP5 = clampPoint(
            newHeel5.x + perpDir5.x * newLen5,
            newHeel5.y + perpDir5.y * newLen5
          );
          updatedPoints.point5 = constrainedP5;
          updatedPoints.point7 = reanchorPoint7(constrainedP5, points);
        }
      } else if (dragging === "point6") {
        // 線3ドラッグ: 2軸対応
        //   横方向 (点線1に平行) = 線5が点線1上を横移動
        //   縦方向 (点線1に垂直) = レングス調整（足長変更）
        // dragOffsetRef: クリック開始時のオフセットを引いて、クリック位置を維持したまま移動
        {
          const line1Dir6 = getLine1Direction(points.point9, points.point10);
          // オフセットを引いた実際の点6位置を計算（クリック位置を維持）
          const adjustedX6 = x - dragOffsetRef.current.x;
          const adjustedY6 = y - dragOffsetRef.current.y;
          const newHeel6 = projectOntoLine(points.point9, points.point10, { x: adjustedX6, y: adjustedY6 });
          const oldHeel6 = getIntersectionOnLine1(points.point9, points.point10, points.point6);
          const oldFootLen6 = Math.sqrt(
            (points.point6.x - oldHeel6.x) ** 2 + (points.point6.y - oldHeel6.y) ** 2
          );
          const perpCand6 = { x: -line1Dir6.y, y: line1Dir6.x };
          const perpDir6 = perpCand6.y > 0 ? { x: -perpCand6.x, y: -perpCand6.y } : perpCand6;
          const dxFromHeel6 = adjustedX6 - newHeel6.x, dyFromHeel6 = adjustedY6 - newHeel6.y;
          let newLen6 = dxFromHeel6 * perpDir6.x + dyFromHeel6 * perpDir6.y;
          if (Math.abs(newLen6) < 5) newLen6 = oldFootLen6;
          newLen6 = Math.max(20, newLen6);
          const constrainedP6 = clampPoint(
            newHeel6.x + perpDir6.x * newLen6,
            newHeel6.y + perpDir6.y * newLen6
          );
          updatedPoints.point6 = constrainedP6;
          updatedPoints.point8 = reanchorPoint8(constrainedP6, points);
        }
      } else if (dragging === 'lengthProxy5') {
        // Length操作点（左）: point5と同じロジック（縦横両方向）だが、オフセットを保ったまま移動
        {
          const line1Dir5p = getLine1Direction(points.point9, points.point10);
          // オフセットを引いた実際の点5位置を計算（タップした瞬間に線が滑り込まない）
          const adjustedX5p = x - dragOffsetRef.current.x;
          const adjustedY5p = y - dragOffsetRef.current.y;
          // 調整後位置を点線1上に射影 → 新しいかかと交点
          const newHeel5p = projectOntoLine(points.point9, points.point10, { x: adjustedX5p, y: adjustedY5p });
          // 現在の足長
          const oldHeel5p = getIntersectionOnLine1(points.point9, points.point10, points.point5);
          const oldFootLen5p = Math.sqrt(
            (points.point5.x - oldHeel5p.x) ** 2 + (points.point5.y - oldHeel5p.y) ** 2
          );
          const perpCand5p = { x: -line1Dir5p.y, y: line1Dir5p.x };
          const perpDir5p = perpCand5p.y > 0 ? { x: -perpCand5p.x, y: -perpCand5p.y } : perpCand5p;
          const dxFromHeel5p = adjustedX5p - newHeel5p.x, dyFromHeel5p = adjustedY5p - newHeel5p.y;
          let newLen5p = dxFromHeel5p * perpDir5p.x + dyFromHeel5p * perpDir5p.y;
          // 縦方向の移動がほぼない場合（横移動）は現在の足長を維持
          if (Math.abs(newLen5p) < 5) newLen5p = oldFootLen5p;
          newLen5p = Math.max(20, newLen5p);
          const constrainedP5p = clampPoint(
            newHeel5p.x + perpDir5p.x * newLen5p,
            newHeel5p.y + perpDir5p.y * newLen5p
          );
          updatedPoints.point5 = constrainedP5p;
          updatedPoints.point7 = reanchorPoint7(constrainedP5p, points);
        }
      } else if (dragging === 'lengthProxy6') {
        // Length操作点（右）: point6と同じロジック（縦横両方向）だが、オフセットを保ったまま移動
        {
          const line1Dir6p = getLine1Direction(points.point9, points.point10);
          const adjustedX6p = x - dragOffsetRef.current.x;
          const adjustedY6p = y - dragOffsetRef.current.y;
          const newHeel6p = projectOntoLine(points.point9, points.point10, { x: adjustedX6p, y: adjustedY6p });
          const oldHeel6p = getIntersectionOnLine1(points.point9, points.point10, points.point6);
          const oldFootLen6p = Math.sqrt(
            (points.point6.x - oldHeel6p.x) ** 2 + (points.point6.y - oldHeel6p.y) ** 2
          );
          const perpCand6p = { x: -line1Dir6p.y, y: line1Dir6p.x };
          const perpDir6p = perpCand6p.y > 0 ? { x: -perpCand6p.x, y: -perpCand6p.y } : perpCand6p;
          const dxFromHeel6p = adjustedX6p - newHeel6p.x, dyFromHeel6p = adjustedY6p - newHeel6p.y;
          let newLen6p = dxFromHeel6p * perpDir6p.x + dyFromHeel6p * perpDir6p.y;
          if (Math.abs(newLen6p) < 5) newLen6p = oldFootLen6p;
          newLen6p = Math.max(20, newLen6p);
          const constrainedP6p = clampPoint(
            newHeel6p.x + perpDir6p.x * newLen6p,
            newHeel6p.y + perpDir6p.y * newLen6p
          );
          updatedPoints.point6 = constrainedP6p;
          updatedPoints.point8 = reanchorPoint8(constrainedP6p, points);
        }
      } else if (dragging === 'firstipProxy5') {
        // 1stIP操作点（左）: 横方向=線4が点線1上を横スライド、縦方向=1stIP横線が上下移動（point13の縦線上位置）
        {
          const adjustedX5ip = x - dragOffsetRef.current.x;
          const adjustedY5ip = y - dragOffsetRef.current.y;
          const { newPoint13, newPoint5 } = dragPoint13(adjustedX5ip, adjustedY5ip);
          updatedPoints.point13 = newPoint13;
          updatedPoints.point5 = newPoint5;
          updatedPoints.point7 = reanchorPoint7(newPoint5, points);
        }
      } else if (dragging === 'firstipProxy6') {
        // 1stIP操作点（右）: 横方向=線5が点線1上を横スライド、縦方向=1stIP横線が上下移動（point14の縦線上位置）
        {
          const adjustedX6ip = x - dragOffsetRef.current.x;
          const adjustedY6ip = y - dragOffsetRef.current.y;
          const { newPoint14, newPoint6 } = dragPoint14(adjustedX6ip, adjustedY6ip);
          updatedPoints.point14 = newPoint14;
          updatedPoints.point6 = newPoint6;
          updatedPoints.point8 = reanchorPoint8(newPoint6, points);
        }
      } else if (dragging === 'htobProxy11') {
        // HtoB操作点（左）: 縦横両方向対応
        //   横方向: 縦線（point5）が点線1上を横スライド（直角維持）
        //   縦方向: HtoB横線（point11）が上下移動（1stCPPまで）
        {
          // オフセットを適用（急激な位置ジャンプを防ぐ）
          const adjustedX11h = x - dragOffsetRef.current.x;
          const adjustedY11h = y - dragOffsetRef.current.y;
          const rawPt = { x: adjustedX11h, y: adjustedY11h };

          // 横方向: rawPtを点線1に射影してpoint5を更新（縦線は垂直を保ったまま横スライド）
          const line1Dir11 = getLine1Direction(points.point9, points.point10);
          const perpCand11 = { x: -line1Dir11.y, y: line1Dir11.x };
          const perpDir11 = perpCand11.y > 0 ? { x: -perpCand11.x, y: -perpCand11.y } : perpCand11;
          const projOnLine1_11 = projectOntoLine(points.point9, points.point10, rawPt);
          const oldHeel11 = getIntersectionOnLine1(points.point9, points.point10, points.point5);
          const footLen11 = Math.sqrt(
            (points.point5.x - oldHeel11.x) ** 2 + (points.point5.y - oldHeel11.y) ** 2
          );
          const newPoint5_11 = clampPoint(
            projOnLine1_11.x + perpDir11.x * footLen11,
            projOnLine1_11.y + perpDir11.y * footLen11
          );

          // 縦方向: 新しい縦線上でrawPtを射影してHtoB位置を決定
          const newHeel11 = getIntersectionOnLine1(points.point9, points.point10, newPoint5_11);
          const newLineLen11 = Math.sqrt(
            (newHeel11.x - newPoint5_11.x) ** 2 + (newHeel11.y - newPoint5_11.y) ** 2
          );
          let ratio11 = 0.5;
          if (newLineLen11 > 0) {
            const lineDir5_11 = {
              x: (newHeel11.x - newPoint5_11.x) / newLineLen11,
              y: (newHeel11.y - newPoint5_11.y) / newLineLen11
            };
            const toCursor5_11 = { x: rawPt.x - newPoint5_11.x, y: rawPt.y - newPoint5_11.y };
            const signedD11 = toCursor5_11.x * lineDir5_11.x + toCursor5_11.y * lineDir5_11.y;
            ratio11 = signedD11 / newLineLen11;
            // 上限: 1stCPP（point13）のratioまで（1stCPPに重なることができる）
            if (points.point13) {
              const toCPP = { x: points.point13.x - newPoint5_11.x, y: points.point13.y - newPoint5_11.y };
              const cppRatio = (toCPP.x * lineDir5_11.x + toCPP.y * lineDir5_11.y) / newLineLen11;
              ratio11 = Math.max(cppRatio, ratio11); // 1stCPPより上（つま先側）には行けない
            }
            ratio11 = Math.min(0.95, ratio11); // 下限（かかと側）
          }
          const newPoint11 = clampPoint(
            newPoint5_11.x + (newHeel11.x - newPoint5_11.x) * ratio11,
            newPoint5_11.y + (newHeel11.y - newPoint5_11.y) * ratio11
          );
          updatedPoints.point11 = newPoint11;
          updatedPoints.point5 = newPoint5_11;
          // 1stCPP（point13）も縦線上の相対位置を保ったまま横方向に追従（直角維持）
          if (points.point13) {
            const oldLineLen11 = Math.sqrt(
              (oldHeel11.x - points.point5.x) ** 2 + (oldHeel11.y - points.point5.y) ** 2
            );
            if (oldLineLen11 > 0) {
              const oldLineDir11 = {
                x: (oldHeel11.x - points.point5.x) / oldLineLen11,
                y: (oldHeel11.y - points.point5.y) / oldLineLen11
              };
              const toCPP13 = { x: points.point13.x - points.point5.x, y: points.point13.y - points.point5.y };
              const cppRatio13 = (toCPP13.x * oldLineDir11.x + toCPP13.y * oldLineDir11.y) / oldLineLen11;
              updatedPoints.point13 = clampPoint(
                newPoint5_11.x + (newHeel11.x - newPoint5_11.x) * cppRatio13,
                newPoint5_11.y + (newHeel11.y - newPoint5_11.y) * cppRatio13
              );
            }
          }
          updatedPoints.point7 = reanchorPoint7(newPoint5_11, points);
        }
      } else if (dragging === 'htobProxy12') {
        // HtoB操作点（右）: 縦横両方向対応
        //   横方向: 縦線（point6）が点線1上を横スライド（直角維持）
        //   縦方向: HtoB横線（point12）が上下移動（1stCPPまで）
        {
          // オフセットを適用（急激な位置ジャンプを防ぐ）
          const adjustedX12h = x - dragOffsetRef.current.x;
          const adjustedY12h = y - dragOffsetRef.current.y;
          const rawPt12 = { x: adjustedX12h, y: adjustedY12h };

          // 横方向: rawPtを点線1に射影してpoint6を更新（縦線は垂直を保ったまま横スライド）
          const line1Dir12 = getLine1Direction(points.point9, points.point10);
          const perpCand12 = { x: -line1Dir12.y, y: line1Dir12.x };
          const perpDir12 = perpCand12.y > 0 ? { x: -perpCand12.x, y: -perpCand12.y } : perpCand12;
          const projOnLine1_12 = projectOntoLine(points.point9, points.point10, rawPt12);
          const oldHeel12 = getIntersectionOnLine1(points.point9, points.point10, points.point6);
          const footLen12 = Math.sqrt(
            (points.point6.x - oldHeel12.x) ** 2 + (points.point6.y - oldHeel12.y) ** 2
          );
          const newPoint6_12 = clampPoint(
            projOnLine1_12.x + perpDir12.x * footLen12,
            projOnLine1_12.y + perpDir12.y * footLen12
          );

          // 縦方向: 新しい縦線上でrawPtを射影してHtoB位置を決定
          const newHeel12 = getIntersectionOnLine1(points.point9, points.point10, newPoint6_12);
          const newLineLen12 = Math.sqrt(
            (newHeel12.x - newPoint6_12.x) ** 2 + (newHeel12.y - newPoint6_12.y) ** 2
          );
          let ratio12 = 0.5;
          if (newLineLen12 > 0) {
            const lineDir6_12 = {
              x: (newHeel12.x - newPoint6_12.x) / newLineLen12,
              y: (newHeel12.y - newPoint6_12.y) / newLineLen12
            };
            const toCursor6_12 = { x: rawPt12.x - newPoint6_12.x, y: rawPt12.y - newPoint6_12.y };
            const signedD12 = toCursor6_12.x * lineDir6_12.x + toCursor6_12.y * lineDir6_12.y;
            ratio12 = signedD12 / newLineLen12;
            // 上限: 1stCPP（point14）のratioまで（1stCPPに重なることができる）
            if (points.point14) {
              const toCPP14 = { x: points.point14.x - newPoint6_12.x, y: points.point14.y - newPoint6_12.y };
              const cppRatio14 = (toCPP14.x * lineDir6_12.x + toCPP14.y * lineDir6_12.y) / newLineLen12;
              ratio12 = Math.max(cppRatio14, ratio12); // 1stCPPより上（つま先側）には行けない
            }
            ratio12 = Math.min(0.95, ratio12); // 下限（かかと側）
          }
          const newPoint12 = clampPoint(
            newPoint6_12.x + (newHeel12.x - newPoint6_12.x) * ratio12,
            newPoint6_12.y + (newHeel12.y - newPoint6_12.y) * ratio12
          );
          updatedPoints.point12 = newPoint12;
          updatedPoints.point6 = newPoint6_12;
          // 1stCPP（point14）も縦線上の相対位置を保ったまま横方向に追従（直角維持）
          if (points.point14) {
            const oldLineLen12 = Math.sqrt(
              (oldHeel12.x - points.point6.x) ** 2 + (oldHeel12.y - points.point6.y) ** 2
            );
            if (oldLineLen12 > 0) {
              const oldLineDir12 = {
                x: (oldHeel12.x - points.point6.x) / oldLineLen12,
                y: (oldHeel12.y - points.point6.y) / oldLineLen12
              };
              const toCPP14 = { x: points.point14.x - points.point6.x, y: points.point14.y - points.point6.y };
              const cppRatio14 = (toCPP14.x * oldLineDir12.x + toCPP14.y * oldLineDir12.y) / oldLineLen12;
              updatedPoints.point14 = clampPoint(
                newPoint6_12.x + (newHeel12.x - newPoint6_12.x) * cppRatio14,
                newPoint6_12.y + (newHeel12.y - newPoint6_12.y) * cppRatio14
              );
            }
          }
          updatedPoints.point8 = reanchorPoint8(newPoint6_12, points);
        }
      } else if (dragging === 'widthProxy7') {
        // Width操作点（左）: 横方向=線4が点線1上を横スライド、縦方向=足幅調整（点7の縦線上位置）、オフセット保持
        {
          const adjustedX7w = x - dragOffsetRef.current.x;
          const adjustedY7w = y - dragOffsetRef.current.y;
          const { newPoint7, newPoint5 } = dragPoint7(adjustedX7w, adjustedY7w);
          updatedPoints.point7 = newPoint7;
          updatedPoints.point5 = newPoint5;
        }
      } else if (dragging === 'widthProxy8') {
        // Width操作点（右）: 横方向=線5が点線1上を横スライド、縦方向=足幅調整（点8の縦線上位置）、オフセット保持
        {
          const adjustedX8w = x - dragOffsetRef.current.x;
          const adjustedY8w = y - dragOffsetRef.current.y;
          const { newPoint8, newPoint6 } = dragPoint8(adjustedX8w, adjustedY8w);
          updatedPoints.point8 = newPoint8;
          updatedPoints.point6 = newPoint6;
        }
      } else if (dragging === 'point15' || dragging === 'point16') {
        // 屈折点1・2: 点線1（p9-p10）上の射影位置のみ更新（横方向のみスライド）
        const rawPt = { x: x - dragOffsetRef.current.x, y: y - dragOffsetRef.current.y };
        const projOnLine1 = projectOntoLine(points.point9, points.point10, rawPt);
        // 屈折ユニット1とユニット2が完全に重ならないように制限（点線1の横方向のパラメータで比較）
        const p9 = points.point9;
        const p10 = points.point10;
        const lineVec = { x: p10.x - p9.x, y: p10.y - p9.y };
        const lineLen = Math.sqrt(lineVec.x * lineVec.x + lineVec.y * lineVec.y);
        // 最小分離（点線1の長さの2%相当）
        const minSep = lineLen * 0.02;
        if (dragging === 'point15') {
          // 屈折ユニット1: 右方向の最大値は屈折ユニット2の左側（minSep分離）
          const p16 = points.point16;
          let newP15 = projOnLine1;
          if (p16 && lineLen > 0) {
            // 点線1上のパラメータ（t）で比較
            const t15 = ((projOnLine1.x - p9.x) * lineVec.x + (projOnLine1.y - p9.y) * lineVec.y) / (lineLen * lineLen);
            const t16 = ((p16.x - p9.x) * lineVec.x + (p16.y - p9.y) * lineVec.y) / (lineLen * lineLen);
            const maxT15 = t16 - minSep / lineLen;
            const clampedT15 = Math.min(t15, maxT15);
            newP15 = {
              x: p9.x + lineVec.x * clampedT15,
              y: p9.y + lineVec.y * clampedT15,
            };
          }
          updatedPoints.point15 = newP15;
          // 屈折点1の移動に合わせて point7/11/13 を再配置
          if (flexUnit1) {
            const oldFlex1Center = points.point15 ?? p9;
            const oldHeel1 = getFlexHeelIntersection(oldFlex1Center, flexUnit1.angle, points.point5);
            const newHeel1 = getFlexHeelIntersection(newP15, flexUnit1.angle, points.point5);
            const ctrl1 = [updatedPoints.point7 ?? points.point7, updatedPoints.point11 ?? points.point11 ?? null, updatedPoints.point13 ?? points.point13 ?? null];
            const newCtrl1 = reanchorControlsOnFlexChange(points.point5, oldHeel1, newHeel1, ctrl1);
            if (newCtrl1[0]) updatedPoints.point7 = newCtrl1[0];
            if (newCtrl1[1]) updatedPoints.point11 = newCtrl1[1];
            if (newCtrl1[2]) updatedPoints.point13 = newCtrl1[2];
          }
        } else {
          // 屈折ユニット2: 左方向の最小値は屈折ユニット1の右側（minSep分離）
          const p15 = points.point15;
          let newP16 = projOnLine1;
          if (p15 && lineLen > 0) {
            const t16 = ((projOnLine1.x - p9.x) * lineVec.x + (projOnLine1.y - p9.y) * lineVec.y) / (lineLen * lineLen);
            const t15 = ((p15.x - p9.x) * lineVec.x + (p15.y - p9.y) * lineVec.y) / (lineLen * lineLen);
            const minT16 = t15 + minSep / lineLen;
            const clampedT16 = Math.max(t16, minT16);
            newP16 = {
              x: p9.x + lineVec.x * clampedT16,
              y: p9.y + lineVec.y * clampedT16,
            };
          }
          updatedPoints.point16 = newP16;
          // 屈折点2の移動に合わせて point8/12/14 を再配置
          if (flexUnit2) {
            const oldFlex2Center = points.point16 ?? p10;
            const oldHeel2 = getFlexHeelIntersection(oldFlex2Center, flexUnit2.angle, points.point6);
            const newHeel2 = getFlexHeelIntersection(newP16, flexUnit2.angle, points.point6);
            const ctrl2 = [updatedPoints.point8 ?? points.point8, updatedPoints.point12 ?? points.point12 ?? null, updatedPoints.point14 ?? points.point14 ?? null];
            const newCtrl2 = reanchorControlsOnFlexChange(points.point6, oldHeel2, newHeel2, ctrl2);
            if (newCtrl2[0]) updatedPoints.point8 = newCtrl2[0];
            if (newCtrl2[1]) updatedPoints.point12 = newCtrl2[1];
            if (newCtrl2[2]) updatedPoints.point14 = newCtrl2[2];
          }
        }
      } else if (dragging === 'flexOp5' || dragging === 'flexOp6') {
        // 屈折操作点5/6ドラッグ:
        //   左右方向（屈折基準線に平行） → 屈折ユニットの回転
        //   上下方向（屈折基準線に垂直） → 屈折軸の長さ変更
        if (flexDragStartRef.current) {
          const { centerX, centerY } = flexDragStartRef.current;
          const isUnit1 = dragging === 'flexOp5';
          const fu = isUnit1 ? flexUnit1 : flexUnit2;
          // 操作点5/6の現在位置から屈折点（center）への方向ベクトルを直接計算
          const vecX = x - centerX;
          const vecY = y - centerY;
          // 距離 = 新しい軸長
          const dist = Math.sqrt(vecX * vecX + vecY * vecY);
          // 最小軸長: Canvas上で20px相当
          const minAxisLen = 20 / scale;
          const newAxisLength = Math.max(minAxisLen, dist);
          // 方向 = 新しい角度（屈折軸の方向から逆算）
          // 屈折軸方向: (sin(angle), -cos(angle)) なので
          // vecX = sin(angle) * dist, vecY = -cos(angle) * dist
          // → angle = atan2(vecX, -vecY)
          const rawAngle = Math.atan2(vecX, -vecY);
          // 回転角度を-π/3〜π/3に制限
          const newAngle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, rawAngle));
          if (isUnit1) {
            onFlexUnit1Change?.({ active: fu?.active ?? true, angle: newAngle, axisLength: newAxisLength });
          } else {
            onFlexUnit2Change?.({ active: fu?.active ?? true, angle: newAngle, axisLength: newAxisLength });
          }
        }
      } else {
        // dragOffsetRefに記録されたオフセットを引いた位置に移動
        // 赤い操作点（コーナー外側）からドラッグした場合、操作点とコーナー点のオフセットを保ったまま移動
        const newPt = clampPoint(x - dragOffsetRef.current.x, y - dragOffsetRef.current.y);
        updatedPoints = { ...updatedPoints, [dragging]: newPt };

        if (dragging === "point9" || dragging === "point10") {
          const newP9 = dragging === "point9" ? newPt : points.point9;
          const newP10 = dragging === "point10" ? newPt : points.point10;
          const { point7, point8 } = reanchorOnHeelChange(newP9, newP10, points);
          updatedPoints.point7 = point7;
          updatedPoints.point8 = point8;
          // 屈折点1・2を新しい点線1上に追従させる
          if (points.point15) {
            updatedPoints.point15 = projectOntoLine(newP9, newP10, points.point15);
          }
          if (points.point16) {
            updatedPoints.point16 = projectOntoLine(newP9, newP10, points.point16);
          }
        }
      }

      onPointsChange(updatedPoints);
    },
    [dragging, readOnly, getCanvasPoint, clampPoint, dragPoint7, dragPoint8,
     dragPoint11, dragPoint12,
     reanchorPoint7, reanchorPoint8, reanchorOnHeelChange, reanchorControlsOnFlexChange,
     points, onPointsChange, zoomPointKey,
     flexUnit1, flexUnit2, onFlexUnit1Change, onFlexUnit2Change, imageWidth, imageHeight]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    flexDragStartRef.current = null; // ドラッグ終了時にリセット
  }, []);

  // ピンチズームのタッチハンドラ
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // 2本指タッチ開始 → ピンチズームおよびパン開始
        isPinchingRef.current = true;
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.sqrt(
          (t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2
        );
        pinchStartRef.current = { dist, scale: pinchScale };
        // ピンチ中心点をcanvas要素内の%座標で記録
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2;
          const midY = (t0.clientY + t1.clientY) / 2;
          const originX = ((midX - rect.left) / rect.width) * 100;
          const originY = ((midY - rect.top) / rect.height) * 100;
          setPinchOrigin({ x: originX, y: originY });
          // パン開始位置を記録（現在のスクロール位置を保存）
          const container = containerRef.current;
          panStartRef.current = {
            midX, midY,
            panX: container ? container.scrollLeft : 0,
            panY: container ? container.scrollTop : 0
          };
        }
        // ドラッグ中なら解除
        setDragging(null);
      } else {
        isPinchingRef.current = false;
        panStartRef.current = null;
      }
    },
    [pinchScale]
  );

  // rAFフラグ（ピンチズームの連続state更新を1フレームに1回に制限）
  const rafPendingRef = useRef(false);
  const pendingPinchScaleRef = useRef(1);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        e.preventDefault();
        isPinchingRef.current = true;
        const t0 = e.touches[0], t1 = e.touches[1];
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dist = Math.sqrt(
          (t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2
        );
        // ピンチズーム：rAFでstate更新をバッチ化してスムーズに
        const ratio = dist / pinchStartRef.current.dist;
        const newScale = Math.max(1, Math.min(5, pinchStartRef.current.scale * ratio));
        pendingPinchScaleRef.current = newScale;
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => {
            setPinchScale(pendingPinchScaleRef.current);
            rafPendingRef.current = false;
          });
        }

        // スクロールベースのパン：ピンチ中心点の画像座標を固定したままスクロール位置を調整
        const container = containerRef.current;
        if (container && panStartRef.current) {
          const containerRect = container.getBoundingClientRect();
          // ピンチ開始時のコンテナ内の中心点座標
          const originX = panStartRef.current.midX - containerRect.left;
          const originY = panStartRef.current.midY - containerRect.top;
          // ピンチ開始時のCSSCanvasサイズ（常に元画像サイズで計算）
          const startPinchScale = pinchStartRef.current.scale;
          const startCssW = imageWidth * scale * startPinchScale;
          const startCssH = imageHeight * scale * startPinchScale;
          const scrollXAtStart = panStartRef.current.panX;
          const scrollYAtStart = panStartRef.current.panY;
          // ピンチ開始時の画像上の相対座標（スクロール + コンテナ内中心点）を割合化
          const relX = (scrollXAtStart + originX) / startCssW;
          const relY = (scrollYAtStart + originY) / startCssH;
          // 新スケールで同じ割合が同じ画面上の位置に来るようスクロール位置を計算
          // パン方向修正：(panStartRef.current.midX - midX) で指の移動方向に合わせる
          const newCssW = imageWidth * scale * newScale;
          const newCssH = imageHeight * scale * newScale;
          const newScrollX = relX * newCssW - originX - (midX - panStartRef.current.midX);
          const newScrollY = relY * newCssH - originY - (midY - panStartRef.current.midY);
          container.scrollLeft = Math.max(0, newScrollX);
          container.scrollTop = Math.max(0, newScrollY);
        }
      }
    },
    [imageWidth, imageHeight, scale]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
        pinchStartRef.current = null;
        panStartRef.current = null;
      }
    },
    []
  );

  // ピンチ中はポインターダウンを無視する
  const handlePointerDownWithPinchGuard = useCallback(
    (e: React.PointerEvent) => {
      if (isPinchingRef.current) return;
      handlePointerDown(e);
    },
    [handlePointerDown]
  );

  // リセットボタン：ピンチズームとパンを初期状態に戻す
  const resetZoomPan = useCallback(() => {
    setPinchScale(1);
    setPinchOrigin({ x: 50, y: 50 });
    // スクロール位置もリセット
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, []);

  const hasZoomOrPan = pinchScale !== 1;

  // CSS transformを使わず、CanvasのCSSサイズを直接pinchScale倍にする
  // 90/270度回転時はcanvas内部サイズも入れ替わりなので、CSSサイズも入れ替える
  const isRot90css = imageRotation === 90 || imageRotation === 270;
  const cssW = isRot90css
    ? Math.round(imageHeight * scale * pinchScale)
    : Math.round(imageWidth * scale * pinchScale);
  const cssH = isRot90css
    ? Math.round(imageWidth * scale * pinchScale)
    : Math.round(imageHeight * scale * pinchScale);
  const canvasStyle: React.CSSProperties = {
    cursor: dragging ? "grabbing" : "crosshair",
    touchAction: "none",
    display: "block",
    // CSSサイズをpinchScale倍に設定（transformは使わない）
    width: cssW + "px",
    height: cssH + "px",
    // iPhone長押しによる画像選択・コピーメニューを無効化
    userSelect: "none",
    WebkitUserSelect: "none",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebkitTouchCallout: "none" as any,
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black overflow-auto flex items-start justify-start"
      style={{ minHeight: 300, userSelect: 'none', WebkitUserSelect: 'none', overscrollBehavior: 'none', touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        onPointerDown={handlePointerDownWithPinchGuard}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {!imageLoaded && (
        <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
          画像を読み込み中...
        </div>
      )}
      {/* ズーム/パンリセットボタン */}
      {hasZoomOrPan && (
        <button
          onClick={resetZoomPan}
          className="absolute top-2 right-2 z-10 bg-black/60 text-white text-xs px-2 py-1 rounded-full border border-white/30 active:bg-black/80"
          style={{ touchAction: 'manipulation' }}
        >
          リセット
        </button>
      )}
      {/* 拡大モードインジケーター */}
      {zoomPointKey !== null && (
        <div
          className="absolute top-2 left-2 z-10 bg-blue-600/80 text-white text-xs px-2 py-1 rounded-full border border-blue-400/50"
          style={{ touchAction: 'manipulation' }}
        >
          拡大モード (動き1/4)
        </div>
      )}
    </div>
  );
}

/**
 * デフォルトの計測点初期位置を生成
 */
export function getDefaultPoints(imageWidth: number, imageHeight: number): MeasurementPoints {
  const w = imageWidth;
  const h = imageHeight;

  // 画像2.pngの赤い矩形からピクセル分析で抽出した初期位置比率
  // P5/P6のy: 矩形上辺（つま先ライン）= 47.1%
  const p5 = { x: w * 0.438, y: h * 0.471 };
  const p6 = { x: w * 0.636, y: h * 0.471 };
  // 点9・10のx座標は点3・4と同じ幅に設定（リセット・デフォルト時に点3・4と同じ幅になる）
  // 点3: x = w * 0.345、点4: x = w * 0.708
  const p9 = { x: w * 0.345, y: h * 0.693 };
  const p10 = { x: w * 0.708, y: h * 0.693 };

  const leftHeel = getIntersectionOnLine1(p9, p10, p5);
  const rightHeel = getIntersectionOnLine1(p9, p10, p6);

  // 点7はP5と同じx座標（線4上）、点8はP6と同じx座標（線5上）
  // yは縦線の中央（50%）に配置 → 一般的な足幅で操作点が縦線の中央付近に来る
  const point7 = { x: p5.x, y: p5.y + (leftHeel.y - p5.y) * 0.5 };
  const point8 = { x: p6.x, y: p6.y + (rightHeel.y - p6.y) * 0.5 };

  // 縦線の40%の位置に点11・点12を配置（母子丘モード用）
  const point11 = {
    x: p5.x + (leftHeel.x - p5.x) * 0.4,
    y: p5.y + (leftHeel.y - p5.y) * 0.4,
  };
  const point12 = {
    x: p6.x + (rightHeel.x - p6.x) * 0.4,
    y: p6.y + (rightHeel.y - p6.y) * 0.4,
  };

  // 縦線の20%の位置に点13・点14を配置（1stIP横線高さ制御点、bunionモード用）
  // point5/6（つま先）より少し下（かかと側）に初期配置
  const point13 = {
    x: p5.x + (leftHeel.x - p5.x) * 0.2,
    y: p5.y + (leftHeel.y - p5.y) * 0.2,
  };
  const point14 = {
    x: p6.x + (rightHeel.x - p6.x) * 0.2,
    y: p6.y + (rightHeel.y - p6.y) * 0.2,
  };

  return {
    point1: { x: w * 0.345, y: h * 0.070 },
    point2: { x: w * 0.708, y: h * 0.070 },
    point3: { x: w * 0.345, y: h * 0.365 },
    point4: { x: w * 0.708, y: h * 0.365 },
    point5: p5,
    point6: p6,
    point7,
    point8,
    point9: p9,
    point10: p10,
    point11,
    point12,
    point13,
    point14,
    // 屈折点1・2: 点線1（p9-p10）上の初期位置（左1/3・右1/3の位置）
    point15: {
      x: p9.x + (p10.x - p9.x) * 0.35,
      y: p9.y + (p10.y - p9.y) * 0.35,
    },
    point16: {
      x: p9.x + (p10.x - p9.x) * 0.65,
      y: p9.y + (p10.y - p9.y) * 0.65,
    },
  };
}
