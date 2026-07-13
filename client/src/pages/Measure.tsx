/**
 * 新規計測ページ
 * 画像アップロード → 計測ウィジェット操作 → 結果算出・保存
 *
 * フッタータブで2つの計測モードを切り替え:
 *   - 足長・足幅計測（standard）
 *   - 1stIP＆母趾球最突出部（bunion）
 *
 * 基準点（点1〜4・点9・10）はモード間で共有・引き継ぎ。
 * 「基準固定」ロックボタンで誤操作を防止。
 *
 * 【統合計測結果】
 * どちらのタブで「計測する」を押しても、両タブの計測値を1つの結果画面に表示する。
 * - standardResult: 足長・足幅（standardモードのpoints使用）
 * - bunionResult:   1stIP・HtoB（bunionモードのpoints使用）
 * 片方しか計測していない場合は未計測の値を「—」で表示。
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useOfflineMode } from "@/contexts/OfflineModeContext";
import { FootConditionPanel, defaultFootCondition, isFootConditionComplete } from "@/components/FootConditionPanel";
import type { FootConditionState } from "@/components/FootConditionPanel";
import { InsoleImagePanel } from "@/components/InsoleImagePanel";
import type { InsoleImageStatus } from "@/components/InsoleImagePanel";

import MeasurementWidget, {
  getDefaultPoints,
  LOCKABLE_POINTS,
} from "@/components/MeasurementWidget";
import type { MeasurementMode, LockedPointKey } from "@/components/MeasurementWidget";
import { calculateMeasurements, analyzeDistortion } from "@/lib/measurementEngine";
import type { DistortionAnalysis } from "@/lib/measurementEngine";
import { applyRegression, DEFAULT_REGRESSION_COEFFICIENTS, PAPER_SIZES } from "../../../shared/measurementTypes";
import type { FlexUnitState } from "../../../shared/measurementTypes";
import { DEFAULT_FLEX_UNIT_STATE } from "../../../shared/measurementTypes";
import type { MeasurementPoints, MeasurementResult, PaperType } from "../../../shared/measurementTypes";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Wand2,
  Calculator,
  Save,
  ChevronLeft,
  Loader2,
  RotateCcw,
  RotateCw,
  Ruler,
  Footprints,
  Lock,
  Unlock,
  Download,
  WifiOff,
  Wifi,
} from "lucide-react";

type Step = "upload" | "measure" | "result";

/** 中敷きサイズ計測用の計測点（point5・point9・point10・point1〜4のみ使用） */
type InsolePoints = MeasurementPoints;

/**
 * 画像を90度時計回りに回転したとき、点の座標を変換して保持する関数
 * 元画像サイズ W×H の座標 (x, y) を
 * 回転後画像サイズ H×W の座標 (H - y, x) に変換する
 * 4回適用すると元の座標に戻る
 */
function rotatePoints90CW(pts: MeasurementPoints, imageWidth: number, imageHeight: number): MeasurementPoints {
  const transform = (p: { x: number; y: number }) => ({
    x: imageHeight - p.y,
    y: p.x,
  });
  return {
    point1: transform(pts.point1),
    point2: transform(pts.point2),
    point3: transform(pts.point3),
    point4: transform(pts.point4),
    point5: transform(pts.point5),
    point6: transform(pts.point6),
    point7: transform(pts.point7),
    point8: transform(pts.point8),
    point9: transform(pts.point9),
    point10: transform(pts.point10),
    ...(pts.point11 ? { point11: transform(pts.point11) } : {}),
    ...(pts.point12 ? { point12: transform(pts.point12) } : {}),
    ...(pts.point13 ? { point13: transform(pts.point13) } : {}),
    ...(pts.point14 ? { point14: transform(pts.point14) } : {}),
    ...(pts.point15 ? { point15: transform(pts.point15) } : {}),
    ...(pts.point16 ? { point16: transform(pts.point16) } : {}),
  };
}

/** 基準点キー（モード間で共有する点） */
const REFERENCE_KEYS = ['point1', 'point2', 'point3', 'point4', 'point9', 'point10'] as const;
type ReferenceKey = typeof REFERENCE_KEYS[number];

/** pointsオブジェクトから基準点だけを抽出 */
function extractReferencePoints(pts: MeasurementPoints): Pick<MeasurementPoints, ReferenceKey> {
  return {
    point1: pts.point1,
    point2: pts.point2,
    point3: pts.point3,
    point4: pts.point4,
    point9: pts.point9,
    point10: pts.point10,
  };
}

/** pointsオブジェクトに基準点を上書きマージ */
function mergeReferencePoints(
  target: MeasurementPoints,
  ref: Pick<MeasurementPoints, ReferenceKey>
): MeasurementPoints {
  return { ...target, ...ref };
}

/**
 * 両タブの計測結果を統合した表示用オブジェクト
 * - 足長・足幅: standardResult から取得
 * - 1stIP・HtoB: bunionResult から取得
 */
interface CombinedResult {
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

/**
 * LEB計算式: 0.906*HtoB - (10.8929*足幅/(足長-HtoB)) + 7.8321
 * 足長・足幅はstandardResult、HtoBはbunionResultから取得
 * いずれかが未計測の場合はnull
 */
function calcLEB(
  footLength: number | null,
  footWidth: number | null,
  htoB: number | null
): number | null {
  if (footLength == null || footWidth == null || htoB == null) return null;
  const denominator = footLength - htoB;
  if (denominator === 0) return null;
  return 0.906 * htoB - (10.8929 * footWidth / denominator) + 7.8321;
}

/**
 * アーチパッド選択ルール表（左右の小さい方のLEBを使用）
 * LEB範囲 → { arch: アーチサイズ, parts: パーツサイズ }
 */
const ARCH_PAD_TABLE: { min: number; max: number; arch: string; parts: string }[] = [
  { min: 171, max: 179, arch: "2L", parts: "2L" },
  { min: 162, max: 170, arch: "L",  parts: "L"  },
  { min: 155, max: 161, arch: "M",  parts: "L"  },
  { min: 148, max: 154, arch: "S",  parts: "M"  },
  { min: 141, max: 147, arch: "2S", parts: "M"  },
  { min: 131, max: 140, arch: "3S", parts: "S"  },
  { min: 122, max: 130, arch: "4S", parts: "S"  },
  { min: 113, max: 121, arch: "5S", parts: "2S" },
  { min: 106, max: 112, arch: "6S", parts: "2S" },
];

/**
 * ルームシューズ・ベースソール選択ルール表（左右の大きい方のLengthを使用）
 * rangeStart: そのレンジの開始値（5mm刻み）
 * shoeSize: ルームシューズ表記サイズ
 * baseSole: ベースソール表記サイズ
 */
const ROOM_SHOE_TABLE: { rangeStart: number; shoeSize: number; baseSole: string }[] = [
  { rangeStart: 211, shoeSize: 35, baseSole: "R220" },
  { rangeStart: 216, shoeSize: 36, baseSole: "R225" },
  { rangeStart: 221, shoeSize: 37, baseSole: "R230" },
  { rangeStart: 226, shoeSize: 37, baseSole: "R235" },
  { rangeStart: 231, shoeSize: 38, baseSole: "R240" },
  { rangeStart: 236, shoeSize: 39, baseSole: "R245" },
  { rangeStart: 241, shoeSize: 40, baseSole: "R250" },
  { rangeStart: 246, shoeSize: 41, baseSole: "R255" },
  { rangeStart: 251, shoeSize: 41, baseSole: "R260" },
  { rangeStart: 256, shoeSize: 42, baseSole: "R265" },
  { rangeStart: 261, shoeSize: 43, baseSole: "R270" },
  { rangeStart: 266, shoeSize: 44, baseSole: "R275" },
  { rangeStart: 271, shoeSize: 44, baseSole: "R280" },
  { rangeStart: 276, shoeSize: 45, baseSole: "R285" },
];

/**
 * 足幅Width記号テーブル
 * 足長（mm）を5mm刻みで丸め、足幅（mm）と照合してWidth記号を返す
 * 各行: footLen（5mm刻みの代表値）, thresholds（A-8〜G+3の上限値、その列の「〜XX」のXX）
 * thresholds[i] = その列の上限値（その値以下ならその列）
 * 列順: A-8, A-7, A-6, A-5, A-4, A-3, A-2, A-1, A, B, C, D, E, 2E, 3E, 4E, F, G, G+1, G+2, G+3
 */
const WIDTH_SYMBOLS = [
  "A-8", "A-7", "A-6", "A-5", "A-4", "A-3", "A-2", "A-1",
  "A", "B", "C", "D", "E", "2E", "3E", "4E", "F", "G", "G+1", "G+2", "G+3"
] as const;
type WidthSymbol = typeof WIDTH_SYMBOLS[number];

// 各足長行の足幅上限値（列順: A-8〜G+3）
// 値は「〜XX」のXX。最後の列G+3は上限なし（Infinity）
const WIDTH_TABLE: { footLen: number; thresholds: number[] }[] = [
  { footLen: 200, thresholds: [63,65,67,69,71,73,75,77,79,81,83,85,87,89,91,93,96,98,100,102,104] },
  { footLen: 205, thresholds: [64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,97,99,101,103,105] },
  { footLen: 210, thresholds: [66,68,70,72,74,76,78,80,82,84,86,88,90,92,93,96,99,101,103,105,107] },
  { footLen: 215, thresholds: [67,69,71,73,75,77,79,81,83,85,87,89,91,93,94,97,100,102,104,106,108] },
  { footLen: 220, thresholds: [68,70,72,74,76,78,80,82,84,86,88,90,92,94,95,98,101,103,105,107,109] },
  { footLen: 225, thresholds: [69,71,73,75,77,79,81,83,85,87,89,91,93,95,96,99,102,104,106,108,110] },
  { footLen: 230, thresholds: [71,73,75,77,79,81,83,85,87,89,91,93,95,97,97,101,104,106,108,110,112] },
  { footLen: 235, thresholds: [72,74,76,78,80,82,84,86,88,90,92,94,96,98,98,102,105,107,109,111,113] },
  { footLen: 240, thresholds: [73,75,77,79,81,83,85,87,89,91,93,95,97,99,99,103,106,108,110,112,114] },
  { footLen: 245, thresholds: [74,76,78,80,82,84,86,88,90,92,94,96,98,100,100,104,107,109,111,113,115] },
  { footLen: 250, thresholds: [76,78,80,82,84,86,88,90,92,94,96,98,100,102,104,106,109,111,113,115,117] },
  { footLen: 255, thresholds: [77,79,81,83,85,87,89,91,93,95,97,99,101,103,105,107,110,112,114,116,118] },
  { footLen: 260, thresholds: [78,80,82,84,86,88,90,92,94,96,98,100,102,104,106,108,111,113,115,117,119] },
  { footLen: 265, thresholds: [79,81,83,85,87,89,91,93,95,97,99,101,103,105,107,109,112,114,116,118,120] },
  { footLen: 270, thresholds: [81,83,85,87,89,91,93,95,97,99,101,103,105,107,109,111,114,116,118,120,122] },
  { footLen: 275, thresholds: [82,84,86,88,90,92,94,96,98,100,102,104,106,108,110,112,115,117,119,121,123] },
  { footLen: 280, thresholds: [83,85,87,89,91,93,95,97,99,101,103,105,107,109,111,113,116,118,120,122,124] },
  { footLen: 285, thresholds: [84,86,88,90,92,94,96,98,100,102,104,106,108,110,112,114,117,119,121,123,125] },
  { footLen: 290, thresholds: [86,88,90,92,94,96,98,100,102,104,106,108,110,112,114,116,119,121,123,125,127] },
  { footLen: 295, thresholds: [87,89,91,93,95,97,99,101,103,105,107,109,111,113,115,117,120,122,124,126,128] },
  { footLen: 300, thresholds: [88,90,92,94,96,98,100,102,104,106,108,110,112,114,116,118,121,123,125,127,129] },
];

/**
 * 足長・足幅から足幅Width記号を算出
 * - 足長は最も近い5mm刻みに丸める
 * - 足長200mm以下: Error(Small), 300mm超: Error(Large)
 * - 足幅がG+3より太い: Error(wide), 細い: Error(thin)
 */
function selectWidthSymbol(
  footLength: number | null,
  footWidth: number | null
): string | null {
  if (footLength == null || footWidth == null) return null;
  const len = Math.round(footLength);
  const wid = Math.round(footWidth);
  // 足長範囲外エラー（200mm以下、300mm以上）
  if (len <= 200) return "Error(Small)";
  if (len >= 300) return "Error(Large)";
  // 最も近い5mm刻みに丸める（201〜299の範囲）
  const roundedLen = Math.round(len / 5) * 5;
  const clampedLen = Math.max(205, Math.min(295, roundedLen));
  const row = WIDTH_TABLE.find(r => r.footLen === clampedLen);
  if (!row) return null;
  // 最細列（A-8）の下限未満は Error(thin)
  if (wid < (row.thresholds[0] - 1)) return "Error(thin)";
  // 各列の上限値と比較
  for (let i = 0; i < row.thresholds.length; i++) {
    if (wid <= row.thresholds[i]) return WIDTH_SYMBOLS[i];
  }
  // G+3より太い
  return "Error(wide)";
}

/**
 * 左右の大きい方のLengthからルームシューズサイズ・レンジ番号・ベースソールを決定
 * rangeNum: レンジ内の何番目か（1始まり）
 */
function selectRoomShoe(
  leftLength: number | null,
  rightLength: number | null
): { shoeSize: number; rangeNum: number; baseSole: string } | null {
  if (leftLength == null && rightLength == null) return null;
  const length = leftLength != null && rightLength != null
    ? Math.max(leftLength, rightLength)
    : (leftLength ?? rightLength)!;
  const rounded = Math.round(length);
  const row = ROOM_SHOE_TABLE.find(r => rounded >= r.rangeStart && rounded <= r.rangeStart + 4);
  if (!row) return null;
  const rangeNum = rounded - row.rangeStart + 1; // 1始まり
  return { shoeSize: row.shoeSize, rangeNum, baseSole: row.baseSole };
}

function selectArchPad(
  leftLEB: number | null,
  rightLEB: number | null
): { arch: string; parts: string } | null {
  // 左右どちらかが未計測の場合は表示しない
  if (leftLEB == null && rightLEB == null) return null;
  // 左右の小さい方を使用（片方のみの場合はその値を使用）
  const leb = leftLEB != null && rightLEB != null
    ? Math.min(leftLEB, rightLEB)
    : (leftLEB ?? rightLEB)!;
  const rounded = Math.round(leb);
  const row = ARCH_PAD_TABLE.find(r => rounded >= r.min && rounded <= r.max);
  return row ? { arch: row.arch, parts: row.parts } : null;
}

function buildCombinedResult(
  standardResult: MeasurementResult | null,
  bunionResult: MeasurementResult | null
): CombinedResult {
  const leftFootLength = standardResult?.leftFootLength ?? null;
  const rightFootLength = standardResult?.rightFootLength ?? null;
  const leftFootWidth = standardResult?.leftFootWidth ?? null;
  const rightFootWidth = standardResult?.rightFootWidth ?? null;
  const leftHeelToMp = bunionResult?.leftHeelToMp ?? null;
  const rightHeelToMp = bunionResult?.rightHeelToMp ?? null;
  return {
    leftFootLength,
    rightFootLength,
    leftFootWidth,
    rightFootWidth,
    leftFirstIP: bunionResult?.leftFirstIP ?? null,
    rightFirstIP: bunionResult?.rightFirstIP ?? null,
    leftHeelToMp,
    rightHeelToMp,
    leftLEB: calcLEB(leftFootLength, leftFootWidth, leftHeelToMp),
    rightLEB: calcLEB(rightFootLength, rightFootWidth, rightHeelToMp),
  };
}

export default function Measure() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { isOfflineMode } = useOfflineMode();

  // ---- すべてはhooksを早期返りより前に定義 -----
  const [step, setStep] = useState<Step>("upload");
  const [measurementId, setMeasurementId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  // 画像回転角度（0/90/180/270）
  const [imageRotation, setImageRotation] = useState<0 | 90 | 180 | 270>(0);
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  // 顧客・注文情報（スパベースから自動入力、手動入力も可）
  const [insoleSize, setInsoleSize] = useState("");
  const [shoeSize, setShoeSize] = useState("");
  const [shoeBrand, setShoeBrand] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [roomShoeColor, setRoomShoeColor] = useState("");
  const [spaShoeColor, setSpaShoeColor] = useState("");
  // 計測日（再調整時は元の計測日を使用、新規計測時は当日）
  const [measureDate, setMeasureDate] = useState<Date>(() => new Date());

  // 各モードの計測結果を独立して保持
  const [standardResult, setStandardResult] = useState<MeasurementResult | null>(null);
  const [bunionResult, setBunionResult] = useState<MeasurementResult | null>(null);

  // 中敷きサイズ計測用state
  const [insoleImageUrl, setInsoleImageUrl] = useState<string | null>(null);
  const [insoleImageWidth, setInsoleImageWidth] = useState(0);
  const [insoleImageHeight, setInsoleImageHeight] = useState(0);
  const [insoleImageRotation, setInsoleImageRotation] = useState<0 | 90 | 180 | 270>(0);
  const [insolePoints, setInsolePoints] = useState<InsolePoints | null>(null);
  const [insoleLength, setInsoleLength] = useState<number | null>(null);
  const insoleFileInputRef = useRef<HTMLInputElement>(null);
  const insoleCameraInputRef = useRef<HTMLInputElement>(null);

  const [regressionResult, setRegressionResult] = useState<Record<string, unknown> | null>(null);
  const [measureMode, setMeasureMode] = useState<MeasurementMode>('reference');

  // 各モードの計測点を独立して管理
  const [standardPoints, setStandardPoints] = useState<MeasurementPoints | null>(null);
  const [bunionPoints, setBunionPoints] = useState<MeasurementPoints | null>(null);

  // 足の状態評価（人間による目視チェック）
  const [footCondition, setFootCondition] = useState<FootConditionState>(defaultFootCondition);
  // 足の状態チェック欄の折りたたみ状態（タブ切り替えでリセットしない）
  // 全項目が-1（デフォルト）の場合は展開、それ以外は折りたたみで初期化
  const [footConditionCollapsed, setFootConditionCollapsed] = useState(false); // 初回計測開始時は展開
  // 足の状態チェック欄のドラッグ位置（タブ切り替えでリセットしない）
  const [footConditionPos, setFootConditionPos] = useState<{ x: number; y: number } | null>(null);

  // 中敷き画像あり／なし選択状態
  const [insoleImageStatus, setInsoleImageStatus] = useState<InsoleImageStatus>("unselected");

  // 基準固定ロック状態（足画像用とinsole画像用で独立）
  const [isLocked, setIsLocked] = useState(false);
  // 屈折ユニット1（左足用）・2（右足用）の状態
  const [flexUnit1, setFlexUnit1] = useState<FlexUnitState>(DEFAULT_FLEX_UNIT_STATE);
  const [flexUnit2, setFlexUnit2] = useState<FlexUnitState>(DEFAULT_FLEX_UNIT_STATE);
  // ダイアゴナルモードのON/OFF（基準設定タブで変更し、他タブにも共有）
  const [showFlexAxis1, setShowFlexAxis1] = useState(false);
  const [showFlexAxis2, setShowFlexAxis2] = useState(false);
  // 中敷タブ専用の屈折ユニット（1のみ、他タブとは独立）
  const [insoleFlexUnit1, setInsoleFlexUnit1] = useState<FlexUnitState>(DEFAULT_FLEX_UNIT_STATE);
  const [insoleShowFlexAxis1, setInsoleShowFlexAxis1] = useState(false);
  const [isInsoleLocked, setIsInsoleLocked] = useState(false);
  // 用紙の向き（portrait=縦置き/点1〜2が短辺, landscape=横置き/点1〜2が長辺）
  const [a4Orientation, setA4Orientation] = useState<'portrait' | 'landscape'>('landscape');
  // 中敷きサイズタブ専用の向き設定（他タブとは独立）
  const [insoleA4Orientation, setInsoleA4Orientation] = useState<'portrait' | 'landscape'>('landscape');
  // 用紙種類（足画像用）
  const [paperType, setPaperType] = useState<PaperType>('A4');
  // 用紙種類（中敷きサイズタブ専用）
  const [insolePaperType, setInsolePaperType] = useState<PaperType>('A4');
  // 用紙変更確認ダイアログ
  const [paperChangeDialog, setPaperChangeDialog] = useState<{ open: boolean; targetPaper: PaperType | null }>({ open: false, targetPaper: null });
  // 戻る確認ダイアログ
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const lockedPointsSet: Set<LockedPointKey> | undefined = isLocked
    ? new Set<LockedPointKey>(LOCKABLE_POINTS)
    : undefined;
  const insoleLockedPointsSet: Set<LockedPointKey> | undefined = isInsoleLocked
    ? new Set<LockedPointKey>(LOCKABLE_POINTS)
    : undefined;

  // 現在のモードの計測点を返す
  const currentPoints = measureMode === 'insole' ? insolePoints
    : measureMode === 'bunion' ? bunionPoints
    : standardPoints; // reference/standard どちらも standardPoints を使用

  // 台形補正歪み分析（リアルタイム）
  const currentOrientation = measureMode === 'insole' ? insoleA4Orientation : a4Orientation;
  const distortionAnalysis = useMemo<DistortionAnalysis | null>(() => {
    const pts = currentPoints;
    if (!pts?.point1 || !pts?.point2 || !pts?.point3 || !pts?.point4) return null;
    return analyzeDistortion(pts.point1, pts.point2, pts.point3, pts.point4, currentOrientation, paperType);
  }, [currentPoints, currentOrientation]);

  // 現在のモードの計測点を更新（基準点は他方のモードにも反映）
  const handlePointsChange = useCallback(
    (newPoints: MeasurementPoints) => {
      const ref = extractReferencePoints(newPoints);
      if (measureMode === 'reference') {
        // referenceモード: 基準点（点1〜4・点9・10）と屈折点（点15・16）を全モードに引き継ぐ
        const flexUpdate = {
          ...(newPoints.point15 !== undefined ? { point15: newPoints.point15 } : {}),
          ...(newPoints.point16 !== undefined ? { point16: newPoints.point16 } : {}),
        };
        setStandardPoints(prev => prev ? { ...mergeReferencePoints(prev, ref), ...flexUpdate } : { ...newPoints });
        setBunionPoints(prev => prev ? { ...mergeReferencePoints(prev, ref), ...flexUpdate } : { ...newPoints });
      } else if (measureMode === 'standard') {
        setStandardPoints(newPoints);
        // 基準点と屈折点（point15/16）をbunionモードにも引き継ぐ
        const flexUpdate15_16_std = {
          ...(newPoints.point15 !== undefined ? { point15: newPoints.point15 } : {}),
          ...(newPoints.point16 !== undefined ? { point16: newPoints.point16 } : {}),
        };
        setBunionPoints(prev => prev ? { ...mergeReferencePoints(prev, ref), ...flexUpdate15_16_std } : null);
      } else if (measureMode === 'bunion') {
        setBunionPoints(newPoints);
        // 基準点と屈折点（point15/16）をstandardモードにも引き継ぐ
        const flexUpdate15_16_bun = {
          ...(newPoints.point15 !== undefined ? { point15: newPoints.point15 } : {}),
          ...(newPoints.point16 !== undefined ? { point16: newPoints.point16 } : {}),
        };
        setStandardPoints(prev => prev ? { ...mergeReferencePoints(prev, ref), ...flexUpdate15_16_bun } : { ...newPoints });
      } else {
        // insoleモード: 独立して管理（他モードへの引き継ぎなし）
        setInsolePoints(newPoints);
      }
    },
    [measureMode]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // tRPC mutations
  const createMutation = trpc.measurements.create.useMutation();
  const uploadMutation = trpc.measurements.uploadImage.useMutation();
  const calculateMutation = trpc.measurements.calculate.useMutation();
  const savePointsMutation = trpc.measurements.saveBothPoints.useMutation();
  const uploadInsoleMutation = trpc.measurements.uploadInsoleImage.useMutation();
  const saveInsoleResultMutation = trpc.measurements.saveInsoleResult.useMutation();

  // 再調整機能: URLクエリパラメータ ?readjust=<id> から履歴を復元
  const readjustId = (() => {
    const params = new URLSearchParams(search);
    const v = params.get('readjust');
    return v ? parseInt(v, 10) : null;
  })();
  const { data: readjustData } = trpc.measurements.getById.useQuery(
    { id: readjustId ?? 0 },
    { enabled: readjustId != null && readjustId > 0 }
  );

  // 再調整データが取得できたら状態を復元する
  useEffect(() => {
    if (!readjustData) return;
    const m = readjustData;
    if (!m.imageUrl || !m.imageWidth || !m.imageHeight) return;

    setMeasurementId(m.id);
    setImageUrl(m.imageUrl);
    setImageWidth(m.imageWidth);
    setImageHeight(m.imageHeight);
    setCustomerName(m.customerName ?? '');
    setNotes(m.notes ?? '');
    setInsoleSize(m.insoleSize ?? '');
    setShoeSize(m.shoeSize ?? '');
    setShoeBrand(m.shoeBrand ?? '');
    setShippingAddress(m.shippingAddress ?? '');
    setRoomShoeColor(m.roomShoeColor ?? '');
    setSpaShoeColor(m.spaShoeColor ?? '');
    // 元の計測日を設定（createdAtがあればそれを使用）
    if (m.createdAt) setMeasureDate(new Date(m.createdAt));
    setStandardResult(null);
    setBunionResult(null);
    setRegressionResult(null);

    // pointsJsonから座標データを復元
    const pj = m.pointsJson as { standard?: MeasurementPoints; bunion?: MeasurementPoints } | MeasurementPoints | null;
    const defaults = getDefaultPoints(m.imageWidth, m.imageHeight);
    if (pj && 'standard' in pj && pj.standard) {
      setStandardPoints(pj.standard as MeasurementPoints);
    } else if (pj && 'point1' in pj) {
      // 旧形式（単一の点セット）の場合はそのまま使用
      setStandardPoints(pj as MeasurementPoints);
    } else {
      setStandardPoints(defaults);
    }
    if (pj && 'bunion' in pj && pj.bunion) {
      setBunionPoints(pj.bunion as MeasurementPoints);
    } else {
      setBunionPoints({ ...defaults });
    }

    // 中敷き画像・座標データを復元
    if (m.insoleImageUrl && m.insoleImageWidth && m.insoleImageHeight) {
      setInsoleImageUrl(m.insoleImageUrl);
      setInsoleImageWidth(m.insoleImageWidth);
      setInsoleImageHeight(m.insoleImageHeight);
      setInsoleImageRotation(0);
      // insolePointsJsonから座標を復元
      if (m.insolePointsJson) {
        setInsolePoints(m.insolePointsJson as MeasurementPoints);
      } else {
        setInsolePoints(getDefaultPoints(m.insoleImageWidth, m.insoleImageHeight));
      }
      if (m.insoleLength != null) setInsoleLength(m.insoleLength);
    } else {
      // 中敷き画像がない場合はリセット
      setInsoleImageUrl(null);
      setInsoleImageWidth(0);
      setInsoleImageHeight(0);
      setInsolePoints(null);
      setInsoleLength(null);
    }

    // 足の状態評価を復元
    if (
      m.halluxValgusLeft != null ||
      m.halluxValgusRight != null ||
      m.quintusToeLeft != null ||
      m.quintusToeRight != null ||
      m.clawToeLeft != null ||
      m.clawToeRight != null
    ) {
      setFootCondition({
        halluxValgusLeft: m.halluxValgusLeft ?? -1,
        halluxValgusRight: m.halluxValgusRight ?? -1,
        quintusToeLeft: m.quintusToeLeft ?? -1,
        quintusToeRight: m.quintusToeRight ?? -1,
        clawToeLeft: m.clawToeLeft ?? -1,
        clawToeRight: m.clawToeRight ?? -1,
      });
    } else {
      setFootCondition(defaultFootCondition);
    }

    setStep('measure');
    // toast.success('履歴から座標データを復元しました'); // 非表示
  }, [readjustData]);

  // 計測画面中のブラウザ戻るナビゲーションをインターセプト
  useEffect(() => {
    if (step !== 'measure') return;
    // 履歴にダミーエントリを追加して戻る操作をインターセプト
    window.history.pushState({ measurePage: true }, '');
    const handlePopState = (e: PopStateEvent) => {
      // ブラウザの戻るボタン・スワイプをインターセプト
      e.preventDefault();
      // ダミーエントリを再追加して戻る操作を無効化
      window.history.pushState({ measurePage: true }, '');
      setShowBackConfirm(true);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [step]);

  // スワイプ戻り動作の完全無効化（水平スワイプで画面が流れる動作を防止）
  useEffect(() => {
    if (step !== 'measure') return;
    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      // 水平方向の移動が垂直方向より大きい場合にブラウザのスワイプ戻りを防止
      if (Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
    };
  }, [step]);

  // ---- 画像選択処理 ----
  const handleFileSelect = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = async () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;

          // まず元画像で計測画面を即座に表示（速度改善）
          setImageWidth(w);
          setImageHeight(h);
          setImageUrl(dataUrl);
          setImageRotation(0); // 新しい画像は回転リセット

          // 両モードの初期点を生成（基準点は共通）
          const defaults = getDefaultPoints(w, h);
          setStandardPoints(defaults);
          setBunionPoints({ ...defaults }); // 同じ基準点でコピー

          // 計測結果をリセット
          setStandardResult(null);
          setBunionResult(null);
          setRegressionResult(null);

          // 計測画面に即座に移行
          setStep("measure");

          // オフラインモード: 一時的な計測のため、データ保存・同期は行わない
          if (isOfflineMode) {
            return;
          }

          // オンラインモード: バックグラウンドでアップロードを実行（UIをブロックしない）
          const runUpload = async () => {
            try {
              const { id } = await createMutation.mutateAsync({
                customerName: customerName || undefined,
                notes: notes || undefined,
                insoleSize: insoleSize || undefined,
                shoeSize: shoeSize || undefined,
                shoeBrand: shoeBrand || undefined,
                shippingAddress: shippingAddress || undefined,
                roomShoeColor: roomShoeColor || undefined,
                spaShoeColor: spaShoeColor || undefined,
              });
              setMeasurementId(id);

              // 元画像をそのままアップロード（低解像度補正は行わない）
              const base64 = dataUrl.split(",")[1];
              await uploadMutation.mutateAsync({
                id,
                imageBase64: base64,
                mimeType: file.type || 'image/jpeg',
                imageWidth: w,
                imageHeight: h,
              });

            } catch (err) {
              console.error(err);
              toast.error("アップロードに失敗しました");
            }
          };
          // requestIdleCallbackでアイドル時に実行（ブラウザが対応していない場合はsetTimeoutで代替）
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => { void runUpload(); });
          } else {
            setTimeout(() => { void runUpload(); }, 0);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [createMutation, uploadMutation, customerName, notes, insoleSize, shoeSize, shoeBrand, shippingAddress, roomShoeColor, spaShoeColor]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // ---- 中敷き画像選択処理 ----
  const handleInsoleFileSelect = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = async () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          setInsoleImageWidth(w);
          setInsoleImageHeight(h);
          setInsoleImageUrl(dataUrl);
          // 中敷き画像用の初期点を生成
          const defaults = getDefaultPoints(w, h);
          setInsolePoints(defaults);
          setInsoleLength(null);

          // バックグラウンドでアップロード
          if (measurementId) {
            try {
              const base64 = dataUrl.split(",")[1];
              await uploadInsoleMutation.mutateAsync({
                id: measurementId,
                imageBase64: base64,
                mimeType: file.type || 'image/jpeg',
                imageWidth: w,
                imageHeight: h,
              });
            } catch (err) {
              console.error(err);
              toast.error("中敷き画像のアップロードに失敗しました");
            }
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [measurementId, uploadInsoleMutation]
  );


  // ---- 計測算出・保存 ----
  // 「計測する」ボタンを押した時に、両タブ（standard / bunion）の計測点から同時に計算し、
  // 8項目すべてを統合した結果画面を表示する。
  const handleCalculate = useCallback(async () => {
    // オフラインモードではmeasurementIdは不要（IndexedDBに保存するため）
    if (!isOfflineMode && !measurementId) return;

    // 両タブの計測点から同時に計算
    // ダイアゴナルモードON時は屈折基準線を基準に計測値を算出
    const newStandardResult = standardPoints
      ? calculateMeasurements(standardPoints, imageWidth, imageHeight, a4Orientation, paperType, showFlexAxis1, showFlexAxis2, flexUnit1, flexUnit2)
      : null;
    const newBunionResult = bunionPoints
      ? calculateMeasurements(bunionPoints, imageWidth, imageHeight, a4Orientation, paperType, showFlexAxis1, showFlexAxis2, flexUnit1, flexUnit2)
      : null;

    // 中敷きサイズ計測（insoleモードの画像がある場合のみ）
    let newInsoleLength: number | null = null;
    if (insolePoints && insoleImageWidth && insoleImageHeight) {
      const insoleResult = calculateMeasurements(insolePoints, insoleImageWidth, insoleImageHeight, insoleA4Orientation, insolePaperType, insoleShowFlexAxis1, false, insoleFlexUnit1, undefined);
      // 中敷きはpoint5（左足のみ）の足長を中敷きサイズとして使用
      newInsoleLength = insoleResult.leftFootLength;
    }
    setInsoleLength(newInsoleLength);

    setStandardResult(newStandardResult);
    setBunionResult(newBunionResult);

    // 両タブの結果を統合
    const combined = buildCombinedResult(newStandardResult, newBunionResult);

    // 回帰推定（足長・足幅ベース）
    if (newStandardResult) {
      const reg = applyRegression(newStandardResult, DEFAULT_REGRESSION_COEFFICIENTS);
      setRegressionResult(reg);
    }

    // DB保存（両モードの計測点と統合結果を保存）
    // pointsJsonに { standard: ..., bunion: ... } 形式で保存（再調整時に復元可能）
    const pointsForSave = standardPoints ?? bunionPoints;
    // 統合結果をMeasurementResult形式に変換して保存
    const resultForSave: MeasurementResult = {
      leftFootLength: combined.leftFootLength,
      rightFootLength: combined.rightFootLength,
      leftFootWidth: combined.leftFootWidth,
      rightFootWidth: combined.rightFootWidth,
      leftHeelToMp: combined.leftHeelToMp,
      rightHeelToMp: combined.rightHeelToMp,
      leftFirstIP: combined.leftFirstIP,
      rightFirstIP: combined.rightFirstIP,
    };

    // オフラインモード: 一時的な計測のため、データ保存・同期は行わない
    if (isOfflineMode) {
      setStep("result");
      return;
    }

    // オンラインモード: サーバーに保存
    try {
      // calculateMutationに両モードの点を渡す（一回の保存で { standard, bunion } 形式に統一）
      await calculateMutation.mutateAsync({
        id: measurementId!,
        result: resultForSave,
        standardPoints: standardPoints ?? undefined,
        bunionPoints: bunionPoints ?? undefined,
        footCondition: footCondition,
        paperType: paperType,
      });
      // 中敏き計測結果を保存（中敏き画像がある場合のみ）
      if (insolePoints && insoleImageWidth > 0) {
        await saveInsoleResultMutation.mutateAsync({
          id: measurementId!,
          insolePoints: insolePoints,
          insoleLength: newInsoleLength,
          insolePaperType: insolePaperType,
        });
      }
      setStep("result");
      // toast.success("計測が完了しました"); // 非表示
    } catch {
      toast.error("保存に失敗しました");
    }
  }, [measurementId,
    isOfflineMode,
    customerName,
    notes,
    imageUrl,
    imageWidth,
    imageHeight,
    measureMode,
    standardPoints,
    bunionPoints,
    insolePoints,
    insoleImageWidth,
    insoleImageHeight,
    insoleA4Orientation,
    imageWidth,
    imageHeight,
    calculateMutation,
    saveInsoleResultMutation,
  ]);

  // ---- リセット（現在のモードのみ、ただし基準点は他方にも反映） ----
  const handleReset = useCallback(() => {
    if (measureMode === 'insole') {
      // insoleモード: 中敷き画像用の初期点を再生成
      if (!insoleImageWidth || !insoleImageHeight) return;
      const defaults = getDefaultPoints(insoleImageWidth, insoleImageHeight);
      setInsolePoints(defaults);
      setInsoleLength(null);
      return;
    }
    if (!imageWidth || !imageHeight) return;
    const defaults = getDefaultPoints(imageWidth, imageHeight);
    const ref = extractReferencePoints(defaults);
    if (measureMode === 'reference') {
      // referenceモード: 全モードの基準点をリセット
      setStandardPoints(prev => prev ? mergeReferencePoints(prev, ref) : { ...defaults });
      setBunionPoints(prev => prev ? mergeReferencePoints(prev, ref) : { ...defaults });
    } else if (measureMode === 'standard') {
      setStandardPoints(defaults);
      setStandardResult(null);
      setBunionPoints(prev => prev ? mergeReferencePoints(prev, ref) : { ...defaults });
    } else {
      setBunionPoints(defaults);
      setBunionResult(null);
      setStandardPoints(prev => prev ? mergeReferencePoints(prev, ref) : { ...defaults });
    }
  }, [imageWidth, imageHeight, insoleImageWidth, insoleImageHeight, measureMode]);

  // ---- ロックトグル ----
  const handleLockToggle = useCallback(() => {
    if (measureMode === 'insole') {
      setIsInsoleLocked(prev => !prev);
    } else {
      setIsLocked(prev => !prev);
    }
  }, [measureMode]);

  const isLoading =
    createMutation.isPending ||
    uploadMutation.isPending ||
    calculateMutation.isPending;

  // 計測前確認ダイアログの表示制御
  const [showMeasureConfirm, setShowMeasureConfirm] = useState(false);

  // 「計測する」ボタン押下時: 未入力があれば確認ダイアログを表示
  const handleCalculateClick = useCallback(() => {
    const footComplete = isFootConditionComplete(footCondition);
    const insoleSelected = insoleImageStatus !== "unselected";
    if (!footComplete || !insoleSelected) {
      setShowMeasureConfirm(true);
    } else {
      void handleCalculate();
    }
  }, [footCondition, insoleImageStatus, handleCalculate]);

  // 統合結果（結果画面表示用）
  const combinedResult = buildCombinedResult(standardResult, bunionResult);

  // ---- 足の図リアルタイム表示 + ダウンロード ----
  const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
  const diagramCanvasRef = useRef<HTMLCanvasElement>(null);
  // テンプレート画像をキャッシュ（再ロード不要）
  const templateImgRef = useRef<HTMLImageElement | null>(null);

  // 足の図を指定のCanvasに描画する共通関数
  const drawFootDiagram = useCallback((canvas: HTMLCanvasElement, img: HTMLImageElement) => {
    canvas.width = img.naturalWidth;   // 1475
    canvas.height = img.naturalHeight; // 1751
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    // 画像内座標（Python解析実測値 — 新PNG 1475×1751）:
    //   アーチパッド図形（黄色多角形）重心: x=734, y=272 (x:637-875, y:66-435)
    //   黒い三角形重心: x=1255, y=287 (x:1029-1325, y:108-582)
    //   左足赤点線 x=438, 右足赤点線 x=1129
    //   1stIP・LEBボックス: 赤点線より中央寄り
    //     左足: 点線右側（中央寄り）→ boxX = 438 + 10
    //     右足: 点線左側（中央寄り）→ boxX = 1129 - 10 - boxW

    const archResult = selectArchPad(combinedResult.leftLEB, combinedResult.rightLEB);

    // アーチパッドサイズ: 黄色多角形の中心に重なる位置（x≈877, y≈379）
    // 付加パーツサイズ: 黒い三角形の重心に重なる位置（x≈1439, y≈282）
    if (archResult) {
      ctx.font = 'bold 80px sans-serif';
      ctx.fillStyle = '#1a6fd4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${archResult.arch}アーチ`, 734, 272);

      ctx.font = 'bold 80px sans-serif';
      ctx.fillStyle = '#16a34a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${archResult.parts}パーツ`, 1255, 287);
      ctx.textBaseline = 'alphabetic';
    }

    // 1stIP・LEB の四角ボックス描画関数
    const drawBox = (x: number, y: number, w: number, h: number, text: string) => {
      ctx.strokeStyle = '#1e3a6e';
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = '#1e3a6e';
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2);
      ctx.textBaseline = 'alphabetic';
    };

    // ボックス配置: 赤点線より中央寄り（正解例に合わせる）
    // 左足: 点線右側（中央寄り）→ boxX = leftDashX + 10
    // 右足: 点線左側（中央寄り）→ boxX = rightDashX - 10 - boxW
    const boxW = 280;
    const boxH = 80;
    const leftDashX = 438;   // 左足赤点線 x（Python実測）
    const rightDashX = 1129; // 右足赤点線 x（Python実測）
    const leftBoxX = leftDashX + 10;          // 左足は点線右側（中央寄り）
    const rightBoxX = rightDashX - 10 - boxW; // 右足は点線左側（中央寄り）
    const ip1BoxY = 720;    // 1stIP の Y 座標
    const lebBoxY = 960;    // LEB の Y 座標

    if (combinedResult.leftFirstIP != null) {
      drawBox(leftBoxX, ip1BoxY, boxW, boxH, `${Math.round(combinedResult.leftFirstIP)}mm`);
    }
    if (combinedResult.rightFirstIP != null) {
      drawBox(rightBoxX, ip1BoxY, boxW, boxH, `${Math.round(combinedResult.rightFirstIP)}mm`);
    }
    if (combinedResult.leftLEB != null) {
      drawBox(leftBoxX, lebBoxY, boxW, boxH, `${Math.round(combinedResult.leftLEB)}mm`);
    }
    if (combinedResult.rightLEB != null) {
      drawBox(rightBoxX, lebBoxY, boxW, boxH, `${Math.round(combinedResult.rightLEB)}mm`);
    }

    // 顧客情報テキスト（足と足の中間 — 値のみ、項目名なし、点（・）なし）
    ctx.font = '52px sans-serif';
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    const infoX = (leftDashX + rightDashX) / 2; // 足と足の中間
    let infoY = 1180;
    const lineH = 64;

    // 顧客名（なしの場合は「なし」と表示）
    const nameStr = customerName ? customerName : 'なし';
    ctx.fillText(nameStr, infoX, infoY);
    infoY += lineH;

    // 計測日
    const today = measureDate;
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    ctx.fillText(dateStr, infoX, infoY);
    infoY += lineH;

    // 足長（左/右それぞれ）
    const leftLen = combinedResult.leftFootLength;
    const rightLen = combinedResult.rightFootLength;
    const lenL = leftLen != null ? Math.round(leftLen).toString() : '—';
    const lenR = rightLen != null ? Math.round(rightLen).toString() : '—';
    ctx.fillText(`${lenL}/${lenR}`, infoX, infoY);
    infoY += lineH;

    // 足幅（左/右それぞれ）
    const leftWid = combinedResult.leftFootWidth;
    const rightWid = combinedResult.rightFootWidth;
    const widL = leftWid != null ? Math.round(leftWid).toString() : '—';
    const widR = rightWid != null ? Math.round(rightWid).toString() : '—';
    ctx.fillText(`${widL}/${widR}`, infoX, infoY);
    infoY += lineH;

    // 足幅Width記号（左/右それぞれ）
    const leftSym = selectWidthSymbol(combinedResult.leftFootLength, combinedResult.leftFootWidth);
    const rightSym = selectWidthSymbol(combinedResult.rightFootLength, combinedResult.rightFootWidth);
    const symL = leftSym ?? '—';
    const symR = rightSym ?? '—';
    ctx.fillText(`${symL}/${symR}`, infoX, infoY);
    infoY += lineH;

    // 中敷きサイズ（左右足幅Width記号の下に記載）
    const insoleSizeStr = insoleLength != null ? `${Math.round(insoleLength)}mm` : 'なし';
    ctx.fillText(`中敷サイズ: ${insoleSizeStr}`, infoX, infoY);
  }, [combinedResult, customerName, measureDate, insoleLength]);

  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // テンプレート画像をロードしてCanvasに描画（結果画面表示時に自動実行）
  useEffect(() => {
    if (step !== 'result') return;
    const canvas = diagramCanvasRef.current;
    if (!canvas) return;

    const loadAndDraw = async () => {
      setDiagramLoading(true);
      setDiagramError(null);
      try {
        let img = templateImgRef.current;
        if (!img) {
          const templateUrl = '/manus-storage/foot-template-v3_131fc459.png';
          const fetchResp = await fetch(templateUrl);
          if (!fetchResp.ok) throw new Error('テンプレート画像の取得に失敗');
          const blob = await fetchResp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const newImg = new Image();
          await new Promise<void>((resolve, reject) => {
            newImg.onload = () => resolve();
            newImg.onerror = () => reject(new Error('画像読み込み失敗'));
            newImg.src = blobUrl;
          });
          URL.revokeObjectURL(blobUrl);
          templateImgRef.current = newImg;
          img = newImg;
        }
        drawFootDiagram(canvas, img);
      } catch (err) {
        console.error('足の図描画失敗:', err);
        setDiagramError('足の図の読み込みに失敗しました');
      } finally {
        setDiagramLoading(false);
      }
    };
    loadAndDraw();
  }, [step, drawFootDiagram]);

  const handleDownloadDiagram = useCallback(async () => {
    setIsGeneratingDiagram(true);
    try {
      let img = templateImgRef.current;
      if (!img) {
        const templateUrl = '/manus-storage/foot-template-v3_131fc459.png';
        const fetchResp = await fetch(templateUrl);
        if (!fetchResp.ok) throw new Error('テンプレート画像の取得に失敗しました');
        const blob = await fetchResp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const newImg = new Image();
        await new Promise<void>((resolve, reject) => {
          newImg.onload = () => resolve();
          newImg.onerror = () => reject(new Error('画像読み込み失敗'));
          newImg.src = blobUrl;
        });
        URL.revokeObjectURL(blobUrl);
        templateImgRef.current = newImg;
        img = newImg;
      }

      // ダウンロード用に別Canvasを作成（画面表示用Canvasはそのまま）
      const dlCanvas = document.createElement('canvas');
      drawFootDiagram(dlCanvas, img);

      dlCanvas.toBlob((blob) => {
        if (!blob) {
          toast.error('図の生成に失敗しました');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const name = customerName ? `足の図_${customerName}.png` : '足の図.png';
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (err) {
      console.error(err);
      toast.error('図のダウンロードに失敗しました');
    } finally {
      setIsGeneratingDiagram(false);
    }
  }, [drawFootDiagram, customerName]);

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 md:pt-0 pt-safe">
        {/* Row 1: nav */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 hover:text-white"
            onClick={() => {
              if (step === 'measure' || step === 'result') {
                setShowBackConfirm(true);
              } else {
                navigate('/');
              }
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <img
            src="/manus-storage/spiral-turn-logo_65a20439.webp"
            alt="SPIRAL TURN"
            className="h-5 md:h-8 w-auto object-contain flex-shrink-0"
          />
          {/* オフラインモードバッジ */}
          {isOfflineMode && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded-full flex-shrink-0">
              <WifiOff className="w-3 h-3" />
              <span className="hidden sm:inline">オフライン</span>
            </span>
          )}
          {/* 用紙サイズ選択ボタン（measureステップ・スマホのみ表示・右寄せ） */}
          {step === 'measure' && (
            <div className="md:hidden flex items-center gap-1.5 ml-auto">
              {/* 縦紙/横紙切り替えボタン（用紙サイズの左横） */}
              <button
                className={`text-xs px-2 h-7 rounded border transition-colors whitespace-nowrap ${
                  currentOrientation === 'landscape'
                    ? 'border-orange-500 bg-orange-950/60 text-orange-400'
                    : 'border-blue-500 bg-blue-950/60 text-blue-400'
                }`}
                onClick={() => {
                  if (measureMode === 'insole') {
                    setInsoleA4Orientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');
                  } else {
                    setA4Orientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');
                  }
                }}
                title={currentOrientation === 'landscape' ? '現在: 横置き → クリックで縦置きに切替' : '現在: 縦置き → クリックで横置きに切替'}
              >
                {currentOrientation === 'landscape' ? '横紙' : '縦紙'}
              </button>
              {/* 用紙サイズボタン群 */}
              <div className="flex items-center gap-0.5 border border-gray-700 rounded-md overflow-hidden">
              {(['A4', 'B5', 'Letter'] as PaperType[]).map(p => {
                const currentPaper = measureMode === 'insole' ? insolePaperType : paperType;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (currentPaper === p) return;
                      setPaperChangeDialog({ open: true, targetPaper: p });
                    }}
                    className={`text-xs px-2.5 h-7 transition-colors ${
                      currentPaper === p
                        ? 'bg-purple-700 text-white font-bold'
                        : 'bg-transparent text-gray-400 hover:bg-gray-800'
                    }`}
                    title={p === 'A4' ? 'A4用紙 (210×297mm)' : p === 'B5' ? 'B5用紙 (182×257mm)' : 'US Letter (216×279mm)'}
                  >
                    {p}
                  </button>
                );
              })}
              </div>
            </div>
          )}
          {/* PC用凡例・誤差警告・「別の画像を挿入」（measureステップのみ・タイトル行右側） */}
          {step === 'measure' && (
            <div className="hidden md:flex items-center gap-2 ml-4 flex-1 min-w-0 overflow-hidden">
              {/* 凡例 */}
              {measureMode === 'reference' ? (
                <>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />点1ー4: A4の4角</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />点9・10: かかとライン</span>
                  <span className="text-xs text-green-400 whitespace-nowrap">基準点を設定後、次のタブへ</span>
                </>
              ) : measureMode === 'standard' ? (
                <>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />LR length</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-white inline-block" />L/R Width</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-4 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />かかとライン（{isLocked ? '固定中' : '通常'}）</span>
                </>
              ) : measureMode === 'bunion' ? (
                <>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />L/R 1stCPP</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />HtoB</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-4 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />かかとライン（{isLocked ? '固定中' : '通常'}）</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />中敷き Length</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap"><span className="w-4 h-px border-t-2 inline-block" style={{borderColor: isInsoleLocked ? '#FF69B4' : '#39FF6A'}} />A4框・かかとライン（{isInsoleLocked ? 'ピンク=固定中' : '緑=通常'}）</span>
                </>
              )}
              {/* 誤差警告（基準固定中のみ） */}
              {distortionAnalysis && (measureMode === 'insole' ? isInsoleLocked : isLocked) && (
                <>
                  {distortionAnalysis.orientationCheck === 'mismatch' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-900/70 text-orange-300 border border-orange-500 animate-pulse whitespace-nowrap">
                      ⚠ {currentOrientation === 'landscape' ? '紙の上辺を長辺に' : '紙の上辺を短辺に'}
                    </span>
                  )}
                  {distortionAnalysis.level === 'minimal' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-900/60 text-green-300 border border-green-600 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />誤差: 極小
                    </span>
                  )}
                  {distortionAnalysis.level === 'low' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-lime-900/60 text-lime-300 border border-lime-600 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-lime-400 inline-block" />誤差: 低
                    </span>
                  )}
                  {distortionAnalysis.level === 'medium' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-900/60 text-yellow-300 border border-yellow-600 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />誤差: 中
                    </span>
                  )}
                  {distortionAnalysis.level === 'high' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-900/60 text-red-300 border border-red-600 animate-pulse whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />誤差: 高（危険）
                    </span>
                  )}
                </>
              )}
              {/* 別の画像を挿入ボタン */}
              <div className="ml-auto shrink-0 flex items-center gap-1">
                {measureMode === 'insole' ? (
                  <Button
                    variant="outline" size="sm"
                    className="border-teal-700 text-teal-300 text-xs h-7 px-2"
                    onClick={() => insoleFileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    別の画像を挿入
                  </Button>
                ) : (
                  <Button
                    variant="outline" size="sm"
                    className="border-gray-700 text-gray-300 text-xs h-7 px-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    別の画像を挿入
                  </Button>
                )}
              </div>
            </div>
          )}
          {/* 右寄せスペース（measureステップ以外のみ） */}
          {step !== 'measure' && <div className="flex-1" />}

        </div>

        {/* Row 2: measure controls — only shown on measure step */}
        {step === "measure" && (
          <div className="md:hidden">
            {/* Mode tabs — mobile only */}
            <div className="flex border-t border-gray-800">
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  measureMode === 'reference'
                    ? 'text-white border-b-2 border-pink-500 bg-pink-900/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                onClick={() => { setMeasureMode('reference'); setIsLocked(false); }}
              >
                <Wand2 className="w-3.5 h-3.5" />
                基準設定
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  measureMode === 'standard'
                    ? 'border-b-2 bg-pink-900/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                style={measureMode === 'standard' ? { color: '#FF1493', borderBottomColor: '#FF69B4' } : {}}
                onClick={() => { setMeasureMode('standard'); setIsLocked(true); }}
              >
                <Ruler className="w-3.5 h-3.5" />
                Length・Width
                {standardResult && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" title="計測済み" />
                )}
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  measureMode === 'bunion'
                    ? 'text-[#FF1493] border-b-2 border-[#FF69B4] bg-pink-900/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                onClick={() => { setMeasureMode('bunion'); setIsLocked(true); }}
              >
                <Footprints className="w-3.5 h-3.5" />
                1stCPP・HtoB
                {bunionResult && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" title="計測済み" />
                )}
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  measureMode === 'insole'
                    ? 'text-pink-300 border-b-2 border-pink-400 bg-pink-900/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                onClick={() => { setMeasureMode('insole'); setIsLocked(true); }}
              >
                <Ruler className="w-3.5 h-3.5" />
                中敷サイズ
                {insoleLength != null && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} title="計測済み" />
                )}
              </button>
            </div>

            {/* Action buttons row */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-800">
              {/* 画像回転ボタン（insoleモードと通常モードで独立） */}
              <Button
                variant="outline"
                size="sm"
                className="border-gray-700 text-gray-300 text-xs h-9 px-3"
                onClick={() => {
                  if (measureMode === 'insole') {
                    // 中敷き画像のみ回転（点はそのまま保持）
                    const next = ((insoleImageRotation + 90) % 360) as 0 | 90 | 180 | 270;
                    setInsoleImageRotation(next);
                  } else {
                    // 足画像のみ回転（点はそのまま保持）
                    const next = ((imageRotation + 90) % 360) as 0 | 90 | 180 | 270;
                    setImageRotation(next);
                  }
                }}
                title="画像を時計回りに90度回転（画像のみ回転、点はそのまま）"
              >
                <RotateCw className="w-3.5 h-3.5 mr-1" />
                回転
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 text-gray-300 text-xs h-9 px-3"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    リセット
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-gray-900 border-gray-700">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">リセットしますか？</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      現在のモードの計測点の位置が初期値に戻ります。この操作は元に戻せません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800">キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={handleReset}
                    >
                      リセットする
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {(() => {
                const locked = measureMode === 'insole' ? isInsoleLocked : isLocked;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className={`text-xs h-9 px-3 transition-colors ${
                      locked
                        ? 'border-pink-600 bg-pink-950/60 text-pink-400 hover:bg-pink-900/60'
                        : 'border-gray-600 text-gray-400 hover:border-pink-600 hover:text-pink-400'
                    }`}
                    onClick={handleLockToggle}
                    title={locked ? "基準固定を解除" : "基準を固定（点1～4・点9・10）"}
                  >
                    {locked ? (
                      <Lock className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <Unlock className="w-3.5 h-3.5 mr-1" />
                    )}
                    基準固定
                  </Button>
                );
              })()}

              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-xs h-9 px-3"
                onClick={handleCalculateClick}
                disabled={calculateMutation.isPending}
              >
                {calculateMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Calculator className="w-3.5 h-3.5 mr-1" />
                )}
                計測する
              </Button>

              {/* 未入力確認ダイアログ（AlertDialogTriggerなし・制御型） */}
              <AlertDialog open={showMeasureConfirm} onOpenChange={setShowMeasureConfirm}>
                <AlertDialogContent className="bg-gray-900 border-yellow-600">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-400">⚠ Caution</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-300">
                      足の状態チェック、中敷きサイズの全てが選択されていませんが、計測を継続しますか？
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800"
                      onClick={() => setShowMeasureConfirm(false)}
                    >
                      いいえ（中断）
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => { setShowMeasureConfirm(false); void handleCalculate(); }}
                    >
                      はい（計測する）
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {/* Legend row + 別の画像を挿入ボタン */}
            <div className="flex items-start gap-2 px-3 pb-2 border-t border-gray-800/50">
              <div className="flex-1 min-w-0">
              {measureMode === 'reference' ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 pt-1.5">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />
                    点1。4: A4の4角
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />
                    点9・10: かかとライン
                  </span>
                  <span className="text-green-400">基準点を設定後、次のタブへ進んでください</span>
                </div>
              ) : measureMode === 'standard' ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 pt-1.5">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />
                    LR length
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-white inline-block" />
                    L/R Width
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />
                    A4かかとライン（{isLocked ? '固定中' : '通常'}）
                  </span>
                </div>
              ) : measureMode === 'bunion' ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 pt-1.5">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />
                    L/R 1stCPP
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />
                    HtoB(母趣球最突出部)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />
                    A4かかとライン（{isLocked ? '固定中' : '通常'}）
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 pt-1.5">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />
                    中敏き Length
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isInsoleLocked ? '#FF69B4' : '#39FF6A'}} />
                    A4樠・かかとライン（{isInsoleLocked ? 'ピンク=固定中' : '緑=通常'}）
                  </span>
                </div>
              )}
              </div>
              {/* 別の画像を挿入ボタン（説明文の右隣） */}
              <div className="shrink-0 pt-1">
                {measureMode === 'insole' ? (
                  <Button
                    variant="outline" size="sm"
                    className="border-teal-700 text-teal-300 text-xs h-7 px-2"
                    onClick={() => insoleFileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    別画像
                  </Button>
                ) : (
                  <Button
                    variant="outline" size="sm"
                    className="border-gray-700 text-gray-300 text-xs h-7 px-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    別画像
                  </Button>
                )}
              </div>
            </div>

            {/* 誤差レベルバッジ + 向き不一致警告: 基準固定中のみ表示 */}
            {distortionAnalysis && (measureMode === 'insole' ? isInsoleLocked : isLocked) && (
              <div className="px-3 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 向き不一致警告バッジ: mismatchのときのみ表示 */}
                  {distortionAnalysis.orientationCheck === 'mismatch' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-900/70 text-orange-300 border border-orange-500 animate-pulse">
                      <span className="text-orange-300">⚠</span>
                      {currentOrientation === 'landscape'
                        ? '紙の上辺を長辺にしてください'
                        : '紙の上辺を短辺にしてください'}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">計測誤差レベル:</span>
                  {distortionAnalysis.level === 'minimal' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-900/60 text-green-300 border border-green-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                      極小（Minimal）
                    </span>
                  )}
                  {distortionAnalysis.level === 'low' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-lime-900/60 text-lime-300 border border-lime-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-lime-400 inline-block" />
                      低（Low）
                    </span>
                  )}
                  {distortionAnalysis.level === 'medium' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-900/60 text-yellow-300 border border-yellow-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                      中（Medium）
                    </span>
                  )}
                  {distortionAnalysis.level === 'high' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-900/60 text-red-300 border border-red-600 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                      高（危険）
                    </span>
                  )}
                  <span className="text-xs text-gray-600">Score: {distortionAnalysis.score.toFixed(3)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="flex-1 flex flex-col gap-4 p-4 max-w-lg mx-auto w-full overflow-y-auto">
          <div className="space-y-3">
            <div>
              <Label className="text-gray-300 text-sm">顧客名（任意）</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="例: 山田 太郎"
                className="mt-1 bg-gray-900 border-gray-700 text-white"
              />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">メモ（任意）</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="計測に関するメモを入力..."
                className="mt-1 bg-gray-900 border-gray-700 text-white resize-none"
                rows={2}
              />
            </div>
            {/* 注文情報（スパベースから自動入力、手動入力も可） */}
            <div className="pt-1 border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-2">注文情報（スパベースから自動入力・手動入力可）</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-gray-400 text-xs">中底サイズ</Label>
                  <Input
                    value={insoleSize}
                    onChange={(e) => setInsoleSize(e.target.value)}
                    placeholder="例: 25.5"
                    className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">靴の表記サイズ</Label>
                  <Input
                    value={shoeSize}
                    onChange={(e) => setShoeSize(e.target.value)}
                    placeholder="例: 26.0"
                    className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm h-8"
                  />
                </div>
              </div>
              <div className="mt-2">
                <Label className="text-gray-400 text-xs">靴のブランド</Label>
                <Input
                  value={shoeBrand}
                  onChange={(e) => setShoeBrand(e.target.value)}
                  placeholder="例: ASICS, Nike..."
                  className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm h-8"
                />
              </div>
              <div className="mt-2">
                <Label className="text-gray-400 text-xs">郵送先住所</Label>
                <Textarea
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="例: 東京都渋谷区..."
                  className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm resize-none"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <Label className="text-gray-400 text-xs">ルームシューズの色</Label>
                  <Input
                    value={roomShoeColor}
                    onChange={(e) => setRoomShoeColor(e.target.value)}
                    placeholder="例: ベージュ"
                    className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">スパトレシューズの色</Label>
                  <Input
                    value={spaShoeColor}
                    onChange={(e) => setSpaShoeColor(e.target.value)}
                    placeholder="例: ホワイト"
                    className="mt-0.5 bg-gray-900 border-gray-700 text-white text-sm h-8"
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            className="flex-1 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center gap-4 p-8 cursor-pointer hover:border-blue-500 transition-colors min-h-64"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {isLoading ? (
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            ) : (
              <>
                <Upload className="w-12 h-12 text-gray-600" />
                <div className="text-center">
                  <p className="text-gray-300 font-medium">画像をアップロード</p>
                  <p className="text-gray-500 text-sm mt-1">
                    足とA4用紙を一緒に撮影した画像を選択してください
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 text-gray-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="w-4 h-4 mr-1" />
                    写真ライブラリ
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 text-gray-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      cameraInputRef.current?.click();
                    }}
                  >
                    <Wand2 className="w-4 h-4 mr-1" />
                    カメラで撮影
                  </Button>
                </div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </div>
      )}

      {/* Step: Measure — Canvas fills all remaining space */}
      {step === "measure" && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* 常時存在する隠しinput（スマホ版「別の画像を挿入」ボタン用） */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { handleFileSelect(file); e.target.value = ''; }
            }}
          />

          {/* ===== PC LEFT SIDEBAR (hidden on mobile) ===== */}
          <aside className="hidden md:flex flex-col w-60 bg-gray-900 border-r border-gray-800 flex-shrink-0 overflow-y-scroll min-h-0">

            {/* Mode tabs — vertical */}
            <div className="flex flex-col border-b border-gray-800">
              {[
                { mode: 'reference' as MeasurementMode, label: '基準設定', icon: <Wand2 className="w-4 h-4" />, dot: false, onClick: () => { setMeasureMode('reference'); setIsLocked(false); } },
                { mode: 'standard' as MeasurementMode, label: 'Length・Width', icon: <Ruler className="w-4 h-4" />, dot: !!standardResult, onClick: () => { setMeasureMode('standard'); setIsLocked(true); } },
                { mode: 'bunion' as MeasurementMode, label: '1stCPP・HtoB', icon: <Footprints className="w-4 h-4" />, dot: !!bunionResult, onClick: () => { setMeasureMode('bunion'); setIsLocked(true); } },
                { mode: 'insole' as MeasurementMode, label: '中敷サイズ', icon: <Ruler className="w-4 h-4" />, dot: insoleLength != null, onClick: () => { setMeasureMode('insole'); setIsLocked(true); } },
              ].map(({ mode, label, icon, dot, onClick }) => (
                <button
                  key={mode}
                  className={`flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-colors justify-center border-l-4 ${
                    measureMode === mode
                      ? 'bg-pink-900/40 text-pink-300 border-pink-400'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800 border-transparent'
                  }`}
                  onClick={onClick}
                >
                  {icon}
                  <span className="flex-1">{label}</span>
                  {dot && <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />}
                </button>
              ))}
            </div>

            {/* 計測するボタン（タブ直下・最優先） */}
            <div className="px-3 py-4 border-b border-gray-800">
              <Button
                size="sm"
                className="w-full justify-center bg-blue-600 hover:bg-blue-700 text-sm h-10 px-3 font-semibold"
                onClick={handleCalculateClick}
                disabled={calculateMutation.isPending}
              >
                {calculateMutation.isPending
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Calculator className="w-4 h-4 mr-2" />}
                計測する
              </Button>
            </div>

            {/* 補助ボタン群 */}
            <div className="flex flex-col gap-1 px-3 py-2 border-b border-gray-800">
              {/* 回転ボタン */}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center border-gray-700 text-gray-300 text-xs h-7 px-2"
                onClick={() => {
                  if (measureMode === 'insole') {
                    // 中敏き画像のみ回転（点はそのまま保持）
                    const next = ((insoleImageRotation + 90) % 360) as 0 | 90 | 180 | 270;
                    setInsoleImageRotation(next);
                  } else {
                    // 足画像のみ回転（点はそのまま保持）
                    const next = ((imageRotation + 90) % 360) as 0 | 90 | 180 | 270;
                    setImageRotation(next);
                  }
                }}
                title="画像を時計回りに90度回転（画像のみ回転、点はそのまま）"
              >
                <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                回転
              </Button>

              {/* リセットボタン */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-center border-gray-700 text-gray-300 text-xs h-7 px-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    リセット
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-gray-900 border-gray-700">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">リセットしますか？</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      現在のモードの計測点の位置が初期値に戻ります。この操作は元に戻せません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800">キャンセル</AlertDialogCancel>
                    <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={handleReset}>
                      リセットする
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* 基準固定ボタン */}
              <Button
                variant="outline"
                size="sm"
                className={`w-full justify-center text-xs h-7 px-2 transition-colors ${
                  (measureMode === 'insole' ? isInsoleLocked : isLocked)
                    ? 'border-pink-600 bg-pink-950/60 text-pink-400 hover:bg-pink-900/60'
                    : 'border-gray-600 text-gray-400 hover:border-pink-600 hover:text-pink-400'
                }`}
                onClick={handleLockToggle}
                title={(measureMode === 'insole' ? isInsoleLocked : isLocked) ? '基準固定を解除' : '基準を固定（点1～4・点9・10）'}
              >
                {(measureMode === 'insole' ? isInsoleLocked : isLocked)
                  ? <Lock className="w-3.5 h-3.5 mr-1.5" />
                  : <Unlock className="w-3.5 h-3.5 mr-1.5" />}
                基準固定
              </Button>

            </div>

            {/* Legend（スマホのみ表示） */}
            <div className="md:hidden px-3 py-2 border-b border-gray-800/50">
              {measureMode === 'reference' ? (
                <div className="flex flex-col gap-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />点1〜4: A4の4角</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />点9・10: かかとライン</span>
                  <span className="text-green-400 text-xs mt-0.5">基準点を設定後、次のタブへ進んでください</span>
                </div>
              ) : measureMode === 'standard' ? (
                <div className="flex flex-col gap-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />LR length</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-white inline-block" />L/R Width</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />A4かかとライン（{isLocked ? '固定中' : '通常'}）</span>
                </div>
              ) : measureMode === 'bunion' ? (
                <div className="flex flex-col gap-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />L/R 1stCPP</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />HtoB(母趾球最突出部)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isLocked ? '#3B82F6' : '#39FF6A'}} />A4かかとライン（{isLocked ? '固定中' : '通常'}）</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{backgroundColor: '#FF1493'}} />中敷き Length</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-px border-t-2 inline-block" style={{borderColor: isInsoleLocked ? '#FF69B4' : '#39FF6A'}} />A4枠・かかとライン（{isInsoleLocked ? 'ピンク=固定中' : '緑=通常'}）</span>
                </div>
              )}
            </div>

            {/* 計測するボタン（タブ直下に移動済み・ここは削除） */}

            {/* 足の状態チェック → 右サイドバーに移動済み */}

            {/* 中敷き画像選択（PCサイドバー内・中敷サイズタブのみ） */}
            {measureMode === 'insole' && (
              <div className="px-3 py-3 border-b border-gray-800">
                <p className="text-xs text-gray-500 mb-2">中敷き画像</p>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        insoleImageStatus === 'available'
                          ? 'bg-blue-500 border-blue-400'
                          : 'bg-transparent border-gray-400'
                      }`}
                      onClick={() => setInsoleImageStatus(insoleImageStatus === 'available' ? 'unselected' : 'available')}
                    >
                      {insoleImageStatus === 'available' && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs text-gray-200">あり</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        insoleImageStatus === 'unavailable'
                          ? 'bg-blue-500 border-blue-400'
                          : 'bg-transparent border-gray-400'
                      }`}
                      onClick={() => setInsoleImageStatus(insoleImageStatus === 'unavailable' ? 'unselected' : 'unavailable')}
                    >
                      {insoleImageStatus === 'unavailable' && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs text-gray-200">なし</span>
                  </label>
                </div>
                {insoleImageStatus === 'unselected' && (
                  <p className="text-[9px] text-red-300 mt-1">✖ 未選択</p>
                )}
              </div>
            )}

            {/* 用紙サイズ → 右サイドバーに移動済み */}
          </aside>
          {/* ===== END PC LEFT SIDEBAR ===== */}

          {/* キャンバスエリア: PC=flex-1で残り全幅, スマホ=従来通りflex-col */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          {/* 中敷サイズタブ: InsoleImagePanel + アップロードUI + 計測ウィジェット */}
          {measureMode === 'insole' && (
            <div className="relative flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
              {/* 常時存在する隐しinput（凡例バーの「別の画像を挿入」ボタン用） */}
              <input ref={insoleFileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleInsoleFileSelect(f); e.target.value = ''; } }}
              />
              {/* 「なし」選択時のみオーバーレイ表示 */}
              {insoleImageStatus === 'unavailable' && (
                <div
                  className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
                  style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
                >
                  <span className="text-white text-2xl font-bold tracking-wide drop-shadow-lg" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                    中敷き画像なし
                  </span>
                </div>
              )}

              {/* InsoleImagePanel（ドラッグ可能・z-index高め・スマホのみ） */}
              <div className="md:hidden">
                <InsoleImagePanel
                  value={insoleImageStatus}
                  onChange={setInsoleImageStatus}
                />
              </div>

              {/* 中敷き画像アップロードUI（画像未選択時）*/}
              {!insoleImageUrl && (
                <div className="flex-1 flex flex-col gap-4 p-4 max-w-lg mx-auto w-full overflow-y-auto">
                  <div className="text-center text-gray-400 text-sm py-2">
                    中敷きの画像をアップロードしてください（任意）
                  </div>
                  <div
                    className="flex-1 border-2 border-dashed border-teal-700 rounded-xl flex flex-col items-center justify-center gap-4 p-8 cursor-pointer hover:border-teal-500 transition-colors min-h-64"
                    onClick={() => insoleFileInputRef.current?.click()}
                  >
                    <Upload className="w-12 h-12 text-teal-600" />
                    <div className="text-center">
                      <p className="text-gray-300 font-medium">中敷き画像をアップロード</p>
                      <p className="text-gray-500 text-sm mt-1">
                        中敷きとA4用紙を一緒に撮影した画像を選択してください
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-teal-700 text-teal-300"
                        onClick={(e) => { e.stopPropagation(); insoleFileInputRef.current?.click(); }}
                      >
                        <Upload className="w-4 h-4 mr-1" />
                        写真ライブラリ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-teal-700 text-teal-300"
                        onClick={(e) => { e.stopPropagation(); insoleCameraInputRef.current?.click(); }}
                      >
                        <Wand2 className="w-4 h-4 mr-1" />
                        カメラで撮影
                      </Button>
                    </div>
                  </div>
                  {/* insoleFileInputRefは親コンテナの常時存在inputを使用 */}
                  <input ref={insoleCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleInsoleFileSelect(f); }}
                  />
                  <p className="text-xs text-gray-500 text-center">
                    中敷きサイズの計測は任意です。
                  </p>
                </div>
              )}

              {/* 中敷き計測ウィジェット（画像あり時） */}
              {insoleImageUrl && insolePoints && (
                <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>
                  {/* 「中敷き画像あり」未選択時は操作不可オーバーレイ */}
                  {insoleImageStatus !== 'available' && (
                    <div
                      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3"
                      style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
                    >
                      <span className="text-gray-300 text-sm font-medium text-center px-6 leading-relaxed" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                        中敷きの計測が必要な場合は、上のパネルで
                        <span className="text-blue-400 font-bold">「中敷き画像あり」</span>
                        を選択してください
                      </span>
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                    <MeasurementWidget
                      imageUrl={insoleImageUrl}
                      imageWidth={insoleImageWidth}
                      imageHeight={insoleImageHeight}
                      imageRotation={insoleImageRotation}
                      points={insolePoints}
                      onPointsChange={handlePointsChange}
                      mode="insole"
                      lockedPoints={insoleLockedPointsSet}
                      isLocked={isInsoleLocked}
                      a4Orientation={insoleA4Orientation}
                      paperType={insolePaperType}
                      flexUnit1={insoleFlexUnit1}
                      onFlexUnit1Change={setInsoleFlexUnit1}
                      showFlexAxis1Prop={insoleShowFlexAxis1}
                      onShowFlexAxis1Change={setInsoleShowFlexAxis1}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* standard / bunionモード: 元画像で計測 */}
          {measureMode !== 'insole' && imageUrl && currentPoints && (
            <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
              <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
              <MeasurementWidget
                imageUrl={imageUrl}
                imageWidth={imageWidth}
                imageHeight={imageHeight}
                imageRotation={imageRotation}
                points={currentPoints}
                onPointsChange={handlePointsChange}
                mode={measureMode}
                lockedPoints={lockedPointsSet}
                isLocked={isLocked}
                a4Orientation={a4Orientation}
                paperType={paperType}
                flexUnit1={flexUnit1}
                flexUnit2={flexUnit2}
                onFlexUnit1Change={setFlexUnit1}
                onFlexUnit2Change={setFlexUnit2}
                showFlexAxis1Prop={measureMode === 'reference' ? undefined : showFlexAxis1}
                showFlexAxis2Prop={measureMode === 'reference' ? undefined : showFlexAxis2}
                onShowFlexAxis1Change={setShowFlexAxis1}
                onShowFlexAxis2Change={setShowFlexAxis2}
              />
              {/* 足の状態チェックパネル（全計測タブで表示・スマホのみ） */}
              <div className="md:hidden">
                <FootConditionPanel
                  value={footCondition}
                  onChange={setFootCondition}
                  collapsed={footConditionCollapsed}
                  onCollapsedChange={setFootConditionCollapsed}
                  pos={footConditionPos}
                  onPosChange={setFootConditionPos}
                />
              </div>
              </div>
            </div>
          )}
          </div>

          {/* ===== PC RIGHT SIDEBAR (hidden on mobile) ===== */}
          <aside className="hidden md:flex flex-col w-48 bg-gray-900 border-l border-gray-800 flex-shrink-0 overflow-y-auto min-h-0">

            {/* 足の状態チェック（全タブ共通） */}
            <div className="px-3 py-3 border-b border-gray-800">
              <p className="text-xs text-gray-500 mb-2">足の状態チェック</p>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-1.5 gap-y-1 items-center">
                <div className="text-[9px] text-transparent">-</div>
                <div className="text-[9px] font-bold text-gray-300 text-center">左</div>
                <div className="text-[9px] font-bold text-gray-300 text-center">右</div>
                {/* 外反母趣 */}
                <div className="text-[9px] font-bold text-blue-300 whitespace-nowrap">外反母趣</div>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.halluxValgusLeft === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.halluxValgusLeft}
                  onChange={(e) => setFootCondition({ ...footCondition, halluxValgusLeft: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">外反母趣あり</option>
                  <option value={2} className="bg-gray-900 text-gray-100">重度外反母趣</option>
                </select>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.halluxValgusRight === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.halluxValgusRight}
                  onChange={(e) => setFootCondition({ ...footCondition, halluxValgusRight: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">外反母趣あり</option>
                  <option value={2} className="bg-gray-900 text-gray-100">重度外反母趣</option>
                </select>
                {/* 内反小趣 */}
                <div className="text-[9px] font-bold text-blue-300 whitespace-nowrap">内反小趣</div>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.quintusToeLeft === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.quintusToeLeft}
                  onChange={(e) => setFootCondition({ ...footCondition, quintusToeLeft: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">内反小趣あり</option>
                </select>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.quintusToeRight === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.quintusToeRight}
                  onChange={(e) => setFootCondition({ ...footCondition, quintusToeRight: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">内反小趣あり</option>
                </select>
                {/* ハンマー/クロウ */}
                <div className="text-[9px] font-bold text-blue-300 whitespace-nowrap">ハンマー/クロウ</div>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.clawToeLeft === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.clawToeLeft}
                  onChange={(e) => setFootCondition({ ...footCondition, clawToeLeft: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">クロウorハンマー</option>
                </select>
                <select
                  className={`text-[10px] rounded px-1 py-0.5 w-full cursor-pointer border transition-colors leading-tight ${
                    footCondition.clawToeRight === -1
                      ? 'bg-red-900/60 border-red-500/60 text-red-200'
                      : 'bg-blue-900/50 border-blue-500/50 text-blue-100'
                  }`}
                  value={footCondition.clawToeRight}
                  onChange={(e) => setFootCondition({ ...footCondition, clawToeRight: Number(e.target.value) })}
                >
                  <option value={-1} className="bg-gray-900 text-gray-100">未分析</option>
                  <option value={0} className="bg-gray-900 text-gray-100">なし</option>
                  <option value={1} className="bg-gray-900 text-gray-100">クロウorハンマー</option>
                </select>
              </div>
            </div>

            {/* 用紙サイズ選択 */}
            <div className="px-3 py-2 mt-auto border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-1">用紙サイズ</p>
              {/* 縦紙/横紙切り替えボタン */}
              <button
                className={`w-full text-xs px-2 h-6 rounded mb-1 transition-colors text-center border ${
                  currentOrientation === 'landscape'
                    ? 'border-orange-500 bg-orange-950/60 text-orange-400 hover:bg-orange-900/60'
                    : 'border-blue-500 bg-blue-950/60 text-blue-400 hover:bg-blue-900/60'
                }`}
                onClick={() => {
                  if (measureMode === 'insole') {
                    setInsoleA4Orientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');
                  } else {
                    setA4Orientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');
                  }
                }}
                title={currentOrientation === 'landscape' ? '現在: 横置き → クリックで縦置きに切替' : '現在: 縦置き → クリックで横置きに切替'}
              >
                {currentOrientation === 'landscape' ? '横紙' : '縦紙'}
              </button>
              <div className="flex flex-col gap-0.5">
                {(['A4', 'B5', 'Letter'] as PaperType[]).map(p => {
                  const currentPaper = measureMode === 'insole' ? insolePaperType : paperType;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        if (currentPaper === p) return;
                        setPaperChangeDialog({ open: true, targetPaper: p });
                      }}
                      className={`text-xs px-2 h-6 rounded transition-colors text-center w-full ${
                        currentPaper === p
                          ? 'bg-purple-700 text-white font-bold'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {p === 'A4' ? 'A4 (210×297mm)' : p === 'B5' ? 'B5 (182×257mm)' : 'Letter (216×279mm)'}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
          {/* ===== END PC RIGHT SIDEBAR ===== */}

        </div>
      )}

      {/* Step: Result */}
      {step === "result" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg mx-auto w-full">
          {/* オフラインモード時のバナー */}
          {isOfflineMode && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-3 flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-amber-300 text-xs font-medium">一時的な計測です。保存されません。</p>
                <p className="text-amber-500 text-xs">データを保存するにはオンラインモードで計測してください</p>
              </div>
            </div>
          )}
          {/* ボタンを一番上に配置 */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-gray-700 text-gray-300"
              onClick={() => {
                setStep("measure");
              }}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              再調整
            </Button>
            {isOfflineMode ? (
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-700"
                onClick={() => navigate("/")}
              >
                <Save className="w-4 h-4 mr-1" />
                ホームに戻る
              </Button>
            ) : (
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={() => navigate("/history")}
              >
                <Save className="w-4 h-4 mr-1" />
                履歴を見る
              </Button>
            )}
          </div>

          {/* 注文情報カード */}
          {(insoleSize || shoeSize || shoeBrand || shippingAddress || roomShoeColor || spaShoeColor) && (
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-0.5 pt-2 px-3">
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <span>注文情報</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-2 pt-1">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {insoleSize && (
                    <div className="flex flex-col">
                      <span className="text-gray-500">中底サイズ</span>
                      <span className="text-gray-200 font-medium">{insoleSize}</span>
                    </div>
                  )}
                  {shoeSize && (
                    <div className="flex flex-col">
                      <span className="text-gray-500">靴の表記サイズ</span>
                      <span className="text-gray-200 font-medium">{shoeSize}</span>
                    </div>
                  )}
                  {shoeBrand && (
                    <div className="flex flex-col">
                      <span className="text-gray-500">靴のブランド</span>
                      <span className="text-gray-200 font-medium">{shoeBrand}</span>
                    </div>
                  )}
                  {roomShoeColor && (
                    <div className="flex flex-col">
                      <span className="text-gray-500">ルームシューズの色</span>
                      <span className="text-gray-200 font-medium">{roomShoeColor}</span>
                    </div>
                  )}
                  {spaShoeColor && (
                    <div className="flex flex-col">
                      <span className="text-gray-500">スパトレシューズの色</span>
                      <span className="text-gray-200 font-medium">{spaShoeColor}</span>
                    </div>
                  )}
                  {shippingAddress && (
                    <div className="flex flex-col col-span-2">
                      <span className="text-gray-500">郵送先住所</span>
                      <span className="text-gray-200 font-medium whitespace-pre-wrap">{shippingAddress}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-0.5 pt-2 px-3">
              <CardTitle className="text-white text-sm flex items-center gap-2 flex-wrap">
                <Calculator className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="shrink-0">計測結果</span>
                {(customerName || notes) && (
                  <span className="text-xs font-normal text-gray-400 truncate max-w-[60%]">
                    {customerName && <span className="text-gray-200">{customerName}</span>}
                    {customerName && notes && <span className="mx-1 text-gray-600">|</span>}
                    {notes && <span className="text-gray-400">{notes}</span>}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-2 pt-1">
              {/* Lt / Rt 列ヘッダー */}
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1 items-center">
                {/* ヘッダー行 */}
                <div />
                <div className="text-center text-sm font-bold text-gray-300 pb-1 border-b border-gray-700">Lt</div>
                <div className="text-center text-sm font-bold text-gray-300 pb-1 border-b border-gray-700">Rt</div>

                {/* Length */}
                <span className="text-xs text-gray-400 font-medium pr-1">Length</span>
                <MeasureCell value={combinedResult.leftFootLength} color="yellow" note={!standardResult ? "—" : undefined} />
                <MeasureCell value={combinedResult.rightFootLength} color="yellow" note={!standardResult ? "—" : undefined} />

                {/* Width */}
                <span className="text-xs text-gray-400 font-medium pr-1">Width</span>
                <MeasureCell value={combinedResult.leftFootWidth} color="red" />
                <MeasureCell value={combinedResult.rightFootWidth} color="red" />

                {/* H2B */}
                <span className="text-xs text-gray-400 font-medium pr-1">HtoB</span>
                <MeasureCell value={combinedResult.leftHeelToMp} color="gray" note={!bunionResult ? "—" : undefined} />
                <MeasureCell value={combinedResult.rightHeelToMp} color="gray" note={!bunionResult ? "—" : undefined} />

                {/* First IP */}
                <span className="text-xs text-gray-400 font-medium pr-1">1stCPP</span>
                <MeasureCell value={combinedResult.leftFirstIP} color="green" />
                <MeasureCell value={combinedResult.rightFirstIP} color="green" />

                {/* LEB */}
                <span className="text-xs text-gray-400 font-medium pr-1">LEB</span>
                <MeasureCell value={combinedResult.leftLEB} color="blue" />
                 <MeasureCell value={combinedResult.rightLEB} color="blue" />
              </div>

              {/* アーチパッド選択結果 */}
              {(() => {
                const archResult = selectArchPad(combinedResult.leftLEB, combinedResult.rightLEB);
                if (!archResult) return null;
                const usedLEB = combinedResult.leftLEB != null && combinedResult.rightLEB != null
                  ? Math.min(combinedResult.leftLEB, combinedResult.rightLEB)
                  : (combinedResult.leftLEB ?? combinedResult.rightLEB)!;
                return (
                  <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Footprints className="w-3 h-3" />
                      LEB {Math.round(usedLEB)}mm 基準
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">3軸アーチパッド</p>
                        <span className="text-base font-bold text-orange-400">{archResult.arch}</span>
                      </div>
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">付加パーツ</p>
                        <span className="text-base font-bold text-cyan-400">{archResult.parts}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 中敷きサイズ */}
              <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Ruler className="w-3 h-3" />
                  中敷サイズ
                </p>
                {insoleLength != null ? (
                  <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                    <p className="text-gray-400 text-xs">中敷き Length</p>
                    <span className="text-base font-bold" style={{color: '#FF1493'}}>{Math.round(insoleLength)} mm</span>
                  </div>
                ) : (
                  <div className="bg-gray-800 rounded px-2 py-1">
                    <p className="text-gray-500 text-xs">なし</p>
                  </div>
                )}
              </div>

              {/* ルームシューズ・ベースソール選択結果 */}
              {(() => {
                const shoeResult = selectRoomShoe(combinedResult.leftFootLength, combinedResult.rightFootLength);
                if (!shoeResult) return null;
                const usedLength = combinedResult.leftFootLength != null && combinedResult.rightFootLength != null
                  ? Math.max(combinedResult.leftFootLength, combinedResult.rightFootLength)
                  : (combinedResult.leftFootLength ?? combinedResult.rightFootLength)!;
                return (
                  <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      Length {Math.round(usedLength)}mm 基準
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">ルームシューズ</p>
                        <div className="text-right">
                          <span className="text-base font-bold text-pink-400">{shoeResult.shoeSize}</span>
                          <span className="text-xs text-pink-300 ml-1">（{shoeResult.rangeNum}）</span>
                        </div>
                      </div>
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">ベースソール</p>
                        <span className="text-base font-bold text-violet-400">{shoeResult.baseSole}</span>
                      </div>
                    </div>
                    {/* スパートレシューズ欄（開発中） */}
                    <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                        <span className="text-yellow-400 font-bold text-[10px] border border-yellow-600 rounded px-1">開発中</span>
                        スパートレシューズ
                      </p>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="bg-gray-800/60 rounded px-2 py-1 flex items-center justify-between border border-yellow-900/40">
                          <p className="text-gray-400 text-xs">サイズ</p>
                          <span className="text-xs text-yellow-600 italic">開発中</span>
                        </div>
                        <div className="bg-gray-800/60 rounded px-2 py-1 flex items-center justify-between border border-yellow-900/40">
                          <p className="text-gray-400 text-xs">ベースソール</p>
                          <span className="text-xs text-yellow-600 italic">開発中</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 足幅Width記号セクション */}
              {(() => {
                const leftSymbol = selectWidthSymbol(combinedResult.leftFootLength, combinedResult.leftFootWidth);
                const rightSymbol = selectWidthSymbol(combinedResult.rightFootLength, combinedResult.rightFootWidth);
                if (leftSymbol == null && rightSymbol == null) return null;
                const isError = (s: string | null) => s != null && s.startsWith("Error");
                return (
                  <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Footprints className="w-3 h-3" />
                      足幅 Width 記号
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">Lt</p>
                        <span className={`text-base font-bold ${isError(leftSymbol) ? 'text-red-400' : 'text-emerald-400'}`}>
                          {leftSymbol ?? '—'}
                        </span>
                      </div>
                      <div className="bg-gray-800 rounded px-2 py-1 flex items-center justify-between">
                        <p className="text-gray-400 text-xs">Rt</p>
                        <span className={`text-base font-bold ${isError(rightSymbol) ? 'text-red-400' : 'text-emerald-400'}`}>
                          {rightSymbol ?? '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* 足の状態評価セクション */}
              <div className="mt-1.5 border-t border-gray-700 pt-1.5">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Footprints className="w-3 h-3" />
                  足の状態評価（目視チェック）
                </p>
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1 items-center">
                  <div />
                  <div className="text-center text-xs font-bold text-gray-400 pb-0.5 border-b border-gray-700">Lt</div>
                  <div className="text-center text-xs font-bold text-gray-400 pb-0.5 border-b border-gray-700">Rt</div>

                  <span className="text-xs text-gray-400 font-medium pr-1">外反母趾</span>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.halluxValgusLeft === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.halluxValgusLeft === 0 ? <span className="text-gray-500">なし</span>
                      : footCondition.halluxValgusLeft === 1 ? <span className="text-yellow-400">重度ではない外反母趾</span>
                      : <span className="text-red-400">重度外反母趾</span>}
                  </div>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.halluxValgusRight === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.halluxValgusRight === 0 ? <span className="text-gray-500">なし</span>
                      : footCondition.halluxValgusRight === 1 ? <span className="text-yellow-400">重度ではない外反母趾</span>
                      : <span className="text-red-400">重度外反母趾</span>}
                  </div>

                  <span className="text-xs text-gray-400 font-medium pr-1">内反小趾</span>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.quintusToeLeft === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.quintusToeLeft === 0 ? <span className="text-gray-500">なし</span>
                      : <span className="text-yellow-400">明らかな内反小趾</span>}
                  </div>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.quintusToeRight === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.quintusToeRight === 0 ? <span className="text-gray-500">なし</span>
                      : <span className="text-yellow-400">明らかな内反小趾</span>}
                  </div>

                  <span className="text-xs text-gray-400 font-medium pr-1">ハンマー&クロウ</span>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.clawToeLeft === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.clawToeLeft === 0 ? <span className="text-gray-500">なし</span>
                      : <span className="text-yellow-400">明らかなクロウorハンマー</span>}
                  </div>
                  <div className="text-center text-xs font-semibold">
                    {footCondition.clawToeRight === -1 ? <span className="text-gray-400 italic">未分析</span>
                      : footCondition.clawToeRight === 0 ? <span className="text-gray-500">なし</span>
                      : <span className="text-yellow-400">明らかなクロウorハンマー</span>}
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* 足の図 リアルタイムプレビュー */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Footprints className="w-4 h-4 text-teal-400" />
                足の図
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {diagramLoading && (
                <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />図を読み込んでいます...
                </div>
              )}
              {diagramError && (
                <div className="text-red-400 text-sm text-center py-4">{diagramError}</div>
              )}
              <canvas
                ref={diagramCanvasRef}
                className="w-full h-auto rounded border border-gray-700"
                style={{ display: diagramLoading || diagramError ? 'none' : 'block' }}
              />
            </CardContent>
          </Card>

          {/* 足の図ダウンロードボタン */}
          <Button
            className="w-full bg-teal-700 hover:bg-teal-600 text-white"
            onClick={handleDownloadDiagram}
            disabled={isGeneratingDiagram}
          >
            {isGeneratingDiagram ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中...</>
            ) : (
              <><Download className="w-4 h-4 mr-2" />足の図をダウンロード</>
            )}
          </Button>



          {/* Image preview with points */}
          {imageUrl && currentPoints && (
            <div className="rounded-lg overflow-hidden border border-gray-800" style={{ height: 300 }}>
              <MeasurementWidget
                imageUrl={imageUrl}
                imageWidth={imageWidth}
                imageHeight={imageHeight}
                points={currentPoints}
                onPointsChange={() => {}}
                readOnly
                mode={measureMode}
                a4Orientation={a4Orientation}
                paperType={paperType}
              />
            </div>
          )}
        </div>
      )}

      {/* 用紙変更確認ダイアログ */}
      <AlertDialog
        open={paperChangeDialog.open}
        onOpenChange={(open) => {
          // openがfalseになるとき（ダイアログが閉じるとき）はtargetPaperをnullにしない
          // （ActionクリックでonOpenChange(false)が先に呼ばれるため）
          if (!open) {
            setPaperChangeDialog(prev => ({ ...prev, open: false }));
          }
        }}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">用紙サイズを変更しますか？</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {paperChangeDialog.targetPaper === 'A4'
                ? 'A4用紙 (210×297mm)'
                : paperChangeDialog.targetPaper === 'B5'
                ? 'B5用紙 (182×257mm)'
                : 'US Letter (216×279mm)'}
              に変更します。計測中の場合は再計測が必要になることがあります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800"
              onClick={() => setPaperChangeDialog({ open: false, targetPaper: null })}
            >
              いいえ（キャンセル）
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => {
                // onOpenChange(false)より先にtargetPaperを取得して適用
                const target = paperChangeDialog.targetPaper;
                if (target) {
                  if (measureMode === 'insole') {
                    setInsolePaperType(target);
                  } else {
                    setPaperType(target);
                  }
                }
                // ダイアログを閉じてtargetPaperをクリア
                setTimeout(() => setPaperChangeDialog({ open: false, targetPaper: null }), 0);
              }}
            >
              はい（変更する）
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 戻る確認ダイアログ */}
      <AlertDialog open={showBackConfirm} onOpenChange={setShowBackConfirm}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">計測を終了しますか？</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              計測を終了し、初期画面に戻りますがよろしいですか？現在の計測状態（点の位置等）は失われます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800"
              onClick={() => setShowBackConfirm(false)}
            >
              キャンセル（計測を続ける）
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                setShowBackConfirm(false);
                navigate('/');
              }}
            >
              終了して戻る
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 計測結果グリッドの各セル（値表示用） */
function MeasureCell({
  value,
  color,
  note,
}: {
  value: number | null | undefined;
  color?: "yellow" | "red" | "green" | "blue" | "gray";
  note?: string;
}) {
  const colorClass =
    color === "yellow" ? "text-yellow-400"
    : color === "red" ? "text-red-400"
    : color === "green" ? "text-green-400"
    : color === "blue" ? "text-blue-400"
    : "text-gray-300";

  return (
    <div className="bg-gray-800 rounded-md px-2 py-1.5 text-center">
      <span className={`text-base font-bold ${colorClass}`}>
        {value != null ? Math.round(value).toString() : "—"}
      </span>
      <span className="text-xs text-gray-400 ml-0.5">mm</span>
      {note && <p className="text-xs text-gray-500 leading-tight mt-0.5">{note}</p>}
    </div>
  );
}

function ResultItem({
  label,
  value,
  unit,
  color,
  note,
  decimals = 0,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  color?: "yellow" | "red" | "green" | "purple" | "blue";
  note?: string;
  decimals?: number;
}) {
  const colorClass =
    color === "yellow"
      ? "text-yellow-400"
      : color === "red"
      ? "text-red-400"
      : color === "green"
      ? "text-green-400"
      : color === "purple"
      ? "text-purple-400"
      : "text-blue-400";

  const displayValue = value != null
    ? decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()
    : "—";

  return (
    <div className="bg-gray-800 rounded-md px-2.5 py-1.5 flex items-center justify-between">
      <p className="text-gray-400 text-xs">{label}</p>
      <div className="text-right">
        <span className={`text-base font-bold ${colorClass}`}>{displayValue}</span>
        <span className="text-xs font-normal text-gray-400 ml-0.5">{unit}</span>
        {note && <p className="text-xs text-gray-500 leading-tight">{note}</p>}
      </div>
    </div>
  );
}
