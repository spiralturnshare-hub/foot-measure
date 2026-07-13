import React, { useState, useRef, useCallback, useEffect } from "react";

export interface FootConditionState {
  halluxValgusLeft: number;   // -1=未分析, 0=なし, 1=重度ではない外反母趾, 2=重度外反母趾
  halluxValgusRight: number;
  quintusToeLeft: number;     // -1=未分析, 0=なし, 1=明らかな内反小趾
  quintusToeRight: number;
  clawToeLeft: number;        // -1=未分析, 0=なし, 1=明らかなクロウorハンマー
  clawToeRight: number;
}

export const defaultFootCondition = (): FootConditionState => ({
  halluxValgusLeft: -1,
  halluxValgusRight: -1,
  quintusToeLeft: -1,
  quintusToeRight: -1,
  clawToeLeft: -1,
  clawToeRight: -1,
});

export function isFootConditionComplete(v: FootConditionState): boolean {
  return (
    v.halluxValgusLeft !== -1 &&
    v.halluxValgusRight !== -1 &&
    v.quintusToeLeft !== -1 &&
    v.quintusToeRight !== -1 &&
    v.clawToeLeft !== -1 &&
    v.clawToeRight !== -1
  );
}

interface Props {
  value: FootConditionState;
  onChange: (v: FootConditionState) => void;
  collapsed: boolean;           // 折りたたみ状態（親コンポーネントが管理）
  onCollapsedChange: (v: boolean) => void; // 折りたたみ状態変更のコールバック
  pos: { x: number; y: number } | null;   // ドラッグ位置（親コンポーネントが管理）
  onPosChange: (v: { x: number; y: number } | null) => void; // 位置変更のコールバック
}

const halluxOptions = [
  { label: "未分析", value: -1 },
  { label: "なし", value: 0 },
  { label: "外反母趾あり", value: 1 },
  { label: "重度外反母趾", value: 2 },
];
const quintusOptions = [
  { label: "未分析", value: -1 },
  { label: "なし", value: 0 },
  { label: "内反小趾あり", value: 1 },
];
const clawOptions = [
  { label: "未分析", value: -1 },
  { label: "なし", value: 0 },
  { label: "クロウorハンマー", value: 1 },
];

function SelectField({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
}) {
  const isUnanalyzed = value === -1;
  return (
    <select
      className={`text-xs rounded px-1.5 py-1 w-full cursor-pointer border transition-colors leading-tight ${
        isUnanalyzed
          ? "bg-red-900/60 border-red-500/60 text-red-200"
          : "bg-blue-900/50 border-blue-500/50 text-blue-100"
      }`}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-gray-900 text-gray-100">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function FootConditionPanel({ value, onChange, collapsed, onCollapsedChange, pos, onPosChange }: Props) {
  const complete = isFootConditionComplete(value);

  // 全項目入力完了時に自動折りたたみ
  const prevCompleteRef = React.useRef(complete);
  React.useEffect(() => {
    if (complete && !prevCompleteRef.current) {
      // 未完了→完了に変わった瞬間に折りたたみ
      onCollapsedChange(true);
    }
    prevCompleteRef.current = complete;
  }, [complete, onCollapsedChange]);

  // ドラッグ状態
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // selectやoptionの操作はドラッグしない
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === "select" || tag === "option" || tag === "button") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = panelRef.current?.getBoundingClientRect();
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect?.left ?? 0,
      origY: rect?.top ?? 0,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const newX = dragState.current.origX + dx;
    const newY = dragState.current.origY + dy;
    // 画面外に出ないようにクランプ
    const panel = panelRef.current;
    if (panel) {
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      onPosChange({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    } else {
      onPosChange({ x: newX, y: newY });
    }
  }, [onPosChange]);

  const onPointerUp = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  // 初期位置：画像エリアの下部（親要素の下から20%付近）
  // posがnullの間はCSSで bottom: 12% に配置
  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 200, touchAction: "none" }
    : { position: "absolute", bottom: "8%", left: "4px", zIndex: 200, touchAction: "none" };

  return (
    <div
      ref={panelRef}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="select-none"
    >
      {/* ヘッダーバー（ドラッグハンドル兼折りたたみ） */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 rounded-t border cursor-grab active:cursor-grabbing transition-colors ${
          complete
            ? "bg-blue-900/70 border-blue-500/50 text-blue-100"
            : "bg-red-900/70 border-red-500/50 text-red-100"
        } backdrop-blur-sm`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold tracking-wide">足の状態チェック</span>
          {!complete && (
            <span className="text-[10px] bg-red-500/70 text-white px-1.5 py-0.5 rounded-full font-semibold">
              未入力
            </span>
          )}
          {complete && (
            <span className="text-[10px] bg-blue-500/70 text-white px-1.5 py-0.5 rounded-full font-semibold">
              完了
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCollapsedChange(!collapsed); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-xs text-gray-300 hover:text-white ml-2 shrink-0 px-1 py-0.5"
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>

      {/* コンテンツ */}
      {!collapsed && (
        <div
          className={`border border-t-0 rounded-b px-2 py-2 backdrop-blur-sm ${
            complete
              ? "bg-blue-950/65 border-blue-500/40"
              : "bg-red-950/65 border-red-500/40"
          }`}
        >
          {!complete && (
            <div className="text-[10px] text-red-300 mb-2 flex items-start gap-1">
              <span className="shrink-0">⚠</span>
              <span>未分析の項目があります。計測は続行できます。</span>
            </div>
          )}
          {/* ヘッダー行: 左・右ラベル */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1.5 items-center">
            <div className="text-xs text-transparent">-</div>
            <div className="text-xs font-bold text-gray-300 text-center">左</div>
            <div className="text-xs font-bold text-gray-300 text-center">右</div>

            {/* 外反母趾 */}
            <div className="text-xs font-bold text-blue-300 whitespace-nowrap">外反母趾</div>
            <SelectField
              options={halluxOptions}
              value={value.halluxValgusLeft}
              onChange={(v) => onChange({ ...value, halluxValgusLeft: v })}
            />
            <SelectField
              options={halluxOptions}
              value={value.halluxValgusRight}
              onChange={(v) => onChange({ ...value, halluxValgusRight: v })}
            />

            {/* 内反小趾 */}
            <div className="text-xs font-bold text-blue-300 whitespace-nowrap">内反小趾</div>
            <SelectField
              options={quintusOptions}
              value={value.quintusToeLeft}
              onChange={(v) => onChange({ ...value, quintusToeLeft: v })}
            />
            <SelectField
              options={quintusOptions}
              value={value.quintusToeRight}
              onChange={(v) => onChange({ ...value, quintusToeRight: v })}
            />

            {/* ハンマーorクロウ */}
            <div className="text-xs font-bold text-blue-300 whitespace-nowrap">ハンマー/クロウ</div>
            <SelectField
              options={clawOptions}
              value={value.clawToeLeft}
              onChange={(v) => onChange({ ...value, clawToeLeft: v })}
            />
            <SelectField
              options={clawOptions}
              value={value.clawToeRight}
              onChange={(v) => onChange({ ...value, clawToeRight: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
