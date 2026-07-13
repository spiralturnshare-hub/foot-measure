import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Ruler,
  Plus,
  ChevronRight,
  Loader2,
  Footprints,
  Wifi,
  WifiOff,
  CloudOff,
} from "lucide-react";
import { useOfflineMode } from "@/contexts/OfflineModeContext";
import { toast } from "sonner";

export default function Home() {
  const [, navigate] = useLocation();
  const { isOfflineMode, isNetworkOnline, toggleOfflineMode } = useOfflineMode();

  // オンラインモード: サーバーから計測一覧を取得
  const { data: onlineMeasurements, isLoading: onlineLoading } =
    trpc.measurements.list.useQuery(undefined, {
      enabled: !isOfflineMode,
      retry: false,
    });

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 bg-gray-900 border-b border-gray-800 md:pt-4 pt-safe">
        <div className="flex items-center gap-2 flex-1">
          <img
            src="/manus-storage/spiral-turn-logo_65a20439.webp"
            alt="SPIRAL TURN"
            className="h-5 md:h-8 w-auto object-contain"
          />
        </div>
        {/* オンライン/オフラインモード切り替えボタン */}
        <button
          onClick={() => {
            toggleOfflineMode();
            if (!isOfflineMode) {
              toast.info("オフラインモードに切り替えました。計測結果は保存されません。");
            } else {
              toast.info("オンラインモードに切り替えました。計測結果はサーバーに保存されます。");
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            isOfflineMode
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30"
              : "bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30"
          }`}
          title={isOfflineMode ? "オフラインモード（タップでオンラインに切り替え）" : "オンラインモード（タップでオフラインに切り替え）"}
        >
          {isOfflineMode ? (
            <>
              <WifiOff className="w-3.5 h-3.5" />
              <span>オフライン</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5" />
              <span>オンライン</span>
            </>
          )}
        </button>
      </header>

      {/* オフラインモード時のバナー */}
      {isOfflineMode && (
        <div className="bg-amber-900/30 border-b border-amber-700/40 px-4 py-2 flex items-center gap-2">
          <CloudOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs flex-1">
            オフラインモード：計測結果は保存されません（一時的な計測）
          </p>
        </div>
      )}

      {/* ネットワーク切断時の警告（オンラインモード中） */}
      {!isOfflineMode && !isNetworkOnline && (
        <div className="bg-red-900/30 border-b border-red-700/40 px-4 py-2 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-xs">
            ネットワーク未接続。オフラインモードに切り替えると計測できます。
          </p>
        </div>
      )}

      {/* Dashboard */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Quick action */}
        <button
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl p-4 flex items-center gap-3 transition-colors"
          onClick={() => navigate("/measure")}
        >
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <Plus className="w-6 h-6 text-white" />
          </div>
          <div className="text-left">
            <p className="font-bold text-white">新規計測を開始</p>
            <p className="text-blue-200 text-xs">
              {isOfflineMode
                ? "オフライン計測（結果は保存されません）"
                : "足とA4用紙の画像をアップロード"}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-white/60 ml-auto" />
        </button>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="総計測数"
            value={isOfflineMode ? 0 : (onlineMeasurements?.length ?? 0)}
            unit="件"
            loading={!isOfflineMode && onlineLoading}
          />
          <StatCard
            label="完了計測"
            value={isOfflineMode ? 0 : (onlineMeasurements?.filter((m) => m.status === "completed").length ?? 0)}
            unit="件"
            loading={!isOfflineMode && onlineLoading}
          />
        </div>

        {/* Recent measurements */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-400">
              {isOfflineMode ? "計測履歴" : "最近の計測"}
            </h2>
            {!isOfflineMode && (
              <button
                className="text-xs text-blue-400 hover:text-blue-300"
                onClick={() => navigate("/history")}
              >
                すべて見る
              </button>
            )}
          </div>

          {isOfflineMode ? (
            // オフラインモード: 一時的な計測のため履歴なし
            <div className="text-center py-8 bg-gray-900 rounded-xl border border-gray-800">
              <CloudOff className="w-8 h-8 text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">オフラインモードでは履歴は保存されません</p>
              <p className="text-gray-600 text-xs mt-1">計測結果は一時的な表示のみです</p>
            </div>
          ) : onlineLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : onlineMeasurements?.length === 0 ? (
            <div className="text-center py-8 bg-gray-900 rounded-xl border border-gray-800">
              <Ruler className="w-8 h-8 text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">まだ計測データがありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {onlineMeasurements?.slice(0, 5).map((m) => {
                const date = new Date(m.createdAt);
                return (
                  <button
                    key={m.id}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center gap-3 hover:bg-gray-800 transition-colors text-left"
                    onClick={() => navigate(`/history/${m.id}`)}
                  >
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <Footprints className="w-5 h-5 text-gray-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white text-sm truncate">
                        {m.customerName || "顧客名なし"}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {date.toLocaleDateString("ja-JP")}
                      </p>
                      {m.leftFootLength && (
                        <p className="text-yellow-400 text-xs">
                          L: {m.leftFootLength.toFixed(1)}mm / R: {m.rightFootLength?.toFixed(1)}mm
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* オフラインモード説明 */}
        {isOfflineMode && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CloudOff className="w-4 h-4 text-amber-500" />
              <p className="text-gray-400 text-xs font-medium">オフラインモードについて</p>
            </div>
            <p className="text-gray-500 text-xs leading-relaxed">
              オフラインモードでは計測結果の保存・同期は行われません。計測結果は一時的な表示のみです。データを保存するにはオンラインモードに切り替えてください。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  loading,
  highlight = false,
}: {
  label: string;
  value: number;
  unit: string;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        highlight
          ? "bg-amber-900/20 border border-amber-700/40"
          : "bg-gray-900 border border-gray-800"
      }`}
    >
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      {loading ? (
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      ) : (
        <p className={`text-2xl font-bold ${highlight ? "text-amber-400" : "text-white"}`}>
          {value}
          <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
        </p>
      )}
    </div>
  );
}
