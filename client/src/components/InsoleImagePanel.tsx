import React, { useState, useRef, useCallback } from "react";

export type InsoleImageStatus = "unselected" | "available" | "unavailable";

interface Props {
  value: InsoleImageStatus;
  onChange: (v: InsoleImageStatus) => void;
}

export function InsoleImagePanel({ value, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  // ドラッグ状態
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === "button" || tag === "input") return;
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
    const panel = panelRef.current;
    if (panel) {
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      setPos({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    } else {
      setPos({ x: newX, y: newY });
    }
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  const isSelected = value !== "unselected";

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 200, touchAction: "none", width: "fit-content" }
    : { position: "absolute", top: "8%", right: "4px", zIndex: 200, touchAction: "none", width: "fit-content" };

  const headerBg = isSelected
    ? "bg-blue-900/70 border-blue-500/50 text-blue-100"
    : "bg-red-900/70 border-red-500/50 text-red-100";

  const contentBg = isSelected
    ? "bg-blue-950/65 border-blue-500/40"
    : "bg-red-950/65 border-red-500/40";

  return (
    <div
      ref={panelRef}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="select-none"
    >
      {/* ヘッダーバー */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 rounded-t border cursor-grab active:cursor-grabbing transition-colors ${headerBg} backdrop-blur-sm`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold tracking-wide">中敷き画像</span>
          {!isSelected && (
            <span className="text-[10px] bg-red-500/70 text-white px-1.5 py-0.5 rounded-full font-semibold">
              未選択
            </span>
          )}
          {isSelected && (
            <span className="text-[10px] bg-blue-500/70 text-white px-1.5 py-0.5 rounded-full font-semibold">
              {value === "available" ? "あり" : "なし"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-xs text-gray-300 hover:text-white ml-2 shrink-0 px-1 py-0.5"
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>

      {/* コンテンツ */}
      {!collapsed && (
        <div
          className={`border border-t-0 rounded-b px-2 py-2 backdrop-blur-sm ${contentBg}`}
        >
          {!isSelected && (
            <div className="text-[10px] text-red-300 mb-2 flex items-start gap-1">
              <span className="shrink-0">⚠</span>
              <span>中敷き画像の有無を選択してください。</span>
            </div>
          )}
          <div className="flex gap-4">
            {/* 中敷き画像あり */}
            <label
              className="flex items-center gap-2 cursor-pointer"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  value === "available"
                    ? "bg-blue-500 border-blue-400"
                    : "bg-transparent border-gray-400"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value === "available" ? "unselected" : "available");
                }}
              >
                {value === "available" && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-gray-200">中敷き画像あり</span>
            </label>

            {/* 中敷き画像なし */}
            <label
              className="flex items-center gap-2 cursor-pointer"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  value === "unavailable"
                    ? "bg-blue-500 border-blue-400"
                    : "bg-transparent border-gray-400"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value === "unavailable" ? "unselected" : "unavailable");
                }}
              >
                {value === "unavailable" && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-gray-200">中敷き画像なし</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
