/**
 * 計測履歴一覧ページ
 * オンラインモード: サーバーDBから取得
 * オフラインモード: 一時的な計測のため履歴なし
 */

import React, { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useOfflineMode } from "@/contexts/OfflineModeContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronLeft,
  Plus,
  Search,
  Ruler,
  Trash2,
  ChevronRight,
  Loader2,
  RotateCcw,
  WifiOff,
  CloudOff,
} from "lucide-react";

export default function History() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const { isOfflineMode } = useOfflineMode();

  // オンラインモード: サーバーDBから取得
  const { data: measurements, isLoading: isOnlineLoading, refetch } = trpc.measurements.list.useQuery(
    undefined,
    { enabled: !isOfflineMode }
  );

  const deleteMutation = trpc.measurements.delete.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: () => toast.error("削除に失敗しました"),
  });

  const filtered = (measurements ?? []).filter((m) => {
    if (!search) return true;
    return m.customerName?.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 md:pt-3 pt-safe">
        <Button
          variant="ghost"
          size="icon"
          className="text-gray-400 hover:text-white"
          onClick={() => navigate("/")}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold flex-1">計測履歴</h1>
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => navigate("/measure")}
        >
          <Plus className="w-4 h-4 mr-1" />
          新規計測
        </Button>
      </header>

      {/* オフラインモードバナー */}
      {isOfflineMode && (
        <div className="px-4 py-2 bg-amber-900/20 border-b border-amber-700/30 flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs">
            オフラインモード：計測結果は保存されません（一時的な計測）
          </p>
        </div>
      )}

      {/* Search */}
      {!isOfflineMode && (
        <div className="px-4 py-3 bg-gray-900 border-b border-gray-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="顧客名で検索..."
              className="pl-9 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isOfflineMode ? (
          // オフラインモード: 一時的な計測のため履歴なし
          <div className="text-center py-12">
            <CloudOff className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">オフラインモードでは履歴は保存されません</p>
            <p className="text-gray-600 text-sm mt-1">計測結果は一時的な表示のみです</p>
            <Button
              className="mt-4 bg-blue-600 hover:bg-blue-700"
              onClick={() => navigate("/measure")}
            >
              計測を開始する
            </Button>
          </div>
        ) : isOnlineLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Ruler className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">計測データがありません</p>
            <Button
              className="mt-4 bg-blue-600 hover:bg-blue-700"
              onClick={() => navigate("/measure")}
            >
              最初の計測を始める
            </Button>
          </div>
        ) : (
          filtered.map((m) => (
            <MeasurementCard
              key={m.id}
              measurement={m}
              onView={() => navigate(`/history/${m.id}`)}
              onReadjust={() => navigate(`/measure?readjust=${m.id}`)}
              onDelete={() => {
                if (confirm("この計測データを削除しますか？")) {
                  deleteMutation.mutate({ id: m.id });
                }
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MeasurementCard({
  measurement,
  onView,
  onReadjust,
  onDelete,
}: {
  measurement: any;
  onView: () => void;
  onReadjust: () => void;
  onDelete: () => void;
}) {
  const date = new Date(measurement.createdAt);
  const dateStr = date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-stretch">
        {/* Image thumbnail */}
        {measurement.imageUrl ? (
          <div className="w-20 flex-shrink-0">
            <img
              src={measurement.imageUrl}
              alt="計測画像"
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-20 flex-shrink-0 bg-gray-800 flex items-center justify-center">
            <Ruler className="w-6 h-6 text-gray-600" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {measurement.customerName ? (
                  <span className="font-medium text-white text-sm truncate">
                    {measurement.customerName}
                  </span>
                ) : (
                  <span className="text-gray-500 text-sm">顧客名なし</span>
                )}
                <Badge
                  variant={measurement.status === "completed" ? "default" : "secondary"}
                  className={`text-xs flex-shrink-0 ${
                    measurement.status === "completed"
                      ? "bg-green-900 text-green-300 border-green-800"
                      : "bg-gray-800 text-gray-400"
                  }`}
                >
                  {measurement.status === "completed" ? "完了" : "下書き"}
                </Badge>
              </div>
              <p className="text-gray-500 text-xs">{dateStr}</p>
              {measurement.leftFootLength && (
                <div className="flex gap-3 mt-1">
                  <span className="text-yellow-400 text-xs">
                    L: {measurement.leftFootLength?.toFixed(1)}mm
                  </span>
                  <span className="text-yellow-400 text-xs">
                    R: {measurement.rightFootLength?.toFixed(1)}mm
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col border-l border-gray-800">
          <button
            className="flex-1 px-3 flex items-center justify-center text-blue-400 hover:bg-gray-800 transition-colors"
            onClick={onView}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            className="flex-1 px-3 flex items-center justify-center text-green-500/70 hover:bg-gray-800 hover:text-green-400 transition-colors border-t border-gray-800"
            onClick={onReadjust}
            title="再調整"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            className="flex-1 px-3 flex items-center justify-center text-red-500/60 hover:bg-gray-800 hover:text-red-400 transition-colors border-t border-gray-800"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
