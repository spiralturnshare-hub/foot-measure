/**
 * 計測詳細ページ
 */

import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { fetchMeasurementById, type FootMeasurementRow } from "@/lib/supabase";
import MeasurementWidget, { type MeasurementMode } from "@/components/MeasurementWidget";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  Loader2,
  Calculator,
  Wand2,
  Calendar,
  User,
  FileText,
  RotateCcw,
} from "lucide-react";
import type { MeasurementPoints } from "../../../shared/measurementTypes";

export default function HistoryDetail() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";

  const [measurement, setMeasurement] = useState<FootMeasurementRow | null | undefined>(undefined);
  const isLoading = measurement === undefined;

  useEffect(() => {
    if (!id) {
      setMeasurement(null);
      return;
    }
    let cancelled = false;
    setMeasurement(undefined);
    fetchMeasurementById(id)
      .then((data) => {
        if (!cancelled) setMeasurement(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setMeasurement(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!measurement) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">計測データが見つかりません</p>
        <Button onClick={() => navigate("/history")} variant="outline" className="border-gray-700">
          履歴に戻る
        </Button>
      </div>
    );
  }

  // points_jsonは旧形式（MeasurementPoints直接）または新形式（{standard, bunion}）のどちらかを取りうる
  const rawPj = measurement.points_json as { standard?: MeasurementPoints; bunion?: MeasurementPoints } | MeasurementPoints | null;
  const points: MeasurementPoints | null = rawPj
    ? ('standard' in rawPj && rawPj.standard
        ? rawPj.standard as MeasurementPoints
        : ('point1' in rawPj ? rawPj as MeasurementPoints : null))
    : null;
  const regression = measurement.regression_result_json as Record<string, unknown> | null;
  const date = new Date(measurement.created_at);
  const dateStr = date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 md:pt-3 pt-safe">
        <Button
          variant="ghost"
          size="icon"
          className="text-gray-400 hover:text-white"
          onClick={() => navigate("/history")}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold flex-1">
          {measurement.customer_name || "計測詳細"}
        </h1>
        <Badge
          className={
            measurement.status === "completed"
              ? "bg-green-900 text-green-300 border-green-800"
              : "bg-gray-800 text-gray-400"
          }
        >
          {measurement.status === "completed" ? "完了" : "下書き"}
        </Badge>
        {measurement.image_url && (
          <Button
            size="sm"
            variant="outline"
            className="border-gray-700 text-gray-300 hover:text-white"
            onClick={() => navigate(`/measure?readjust=${measurement.id}`)}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            再調整
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Meta info */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Calendar className="w-4 h-4" />
              <span>{dateStr}</span>
            </div>
            {measurement.customer_name && (
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <User className="w-4 h-4 text-gray-500" />
                <span>{measurement.customer_name}</span>
              </div>
            )}
            {measurement.notes && (
              <div className="flex items-start gap-2 text-sm text-gray-400">
                <FileText className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
                <span>{measurement.notes}</span>
              </div>
            )}
            {/* 用紙サイズ */}
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="text-gray-500">用紙:</span>
              <span className="text-purple-400 font-medium">
                {measurement.paper_type ?? 'A4'}
              </span>
              {measurement.insole_paper_type && (
                <span className="text-gray-500 text-xs">
                  (中敷き: {measurement.insole_paper_type})
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Measurement results */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-400" />
              計測結果
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <ResultItem label="左足長" value={measurement.left_foot_length} unit="mm" color="yellow" />
              <ResultItem label="右足長" value={measurement.right_foot_length} unit="mm" color="yellow" />
              <ResultItem label="左足幅" value={measurement.left_foot_width} unit="mm" color="red" />
              <ResultItem label="右足幅" value={measurement.right_foot_width} unit="mm" color="red" />
              <ResultItem label="左かかと〜MP" value={measurement.left_heel_to_mp} unit="mm" />
              <ResultItem label="右かかと〜MP" value={measurement.right_heel_to_mp} unit="mm" />
            </div>
          </CardContent>
        </Card>

        {/* 中敷きサイズ */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-teal-400" />
              中敷サイズ
            </CardTitle>
          </CardHeader>
          <CardContent>
            {measurement.insole_length != null ? (
              <ResultItem label="中敷き Length" value={measurement.insole_length} unit="mm" color="teal" />
            ) : (
              <p className="text-gray-500 text-sm">なし</p>
            )}
          </CardContent>
        </Card>

        {/* Regression results */}
        {regression && Object.keys(regression).length > 0 && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-purple-400" />
                推定値（重回帰分析）
                <Badge variant="outline" className="text-xs border-purple-700 text-purple-400">
                  β版
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {regression.leftShoeSize != null && (
                  <ResultItem
                    label="左推定シューズ"
                    value={regression.leftShoeSize as number}
                    unit="cm"
                    color="purple"
                  />
                )}
                {regression.rightShoeSize != null && (
                  <ResultItem
                    label="右推定シューズ"
                    value={regression.rightShoeSize as number}
                    unit="cm"
                    color="purple"
                  />
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">※ 重回帰係数は後日更新されます</p>
            </CardContent>
          </Card>
        )}

        {/* Image with measurement overlay */}
        {measurement.image_url && points && measurement.image_width && measurement.image_height && (
          <Card className="bg-gray-900 border-gray-800 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">計測画像</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <MeasurementWidget
                imageUrl={measurement.image_url}
                imageWidth={measurement.image_width}
                imageHeight={measurement.image_height}
                points={points}
                onPointsChange={() => {}}
                readOnly
              />
            </CardContent>
          </Card>
        )}

        {/* 中敷き画像 */}
        {measurement.insole_image_url && (
          <Card className="bg-gray-900 border-gray-800 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">中敷き画像</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {measurement.insole_image_url && measurement.insole_points_json && measurement.insole_image_width && measurement.insole_image_height ? (
                <MeasurementWidget
                  imageUrl={measurement.insole_image_url}
                  imageWidth={measurement.insole_image_width}
                  imageHeight={measurement.insole_image_height}
                  points={measurement.insole_points_json as unknown as MeasurementPoints}
                  onPointsChange={() => {}}
                  readOnly
                  mode={"insole" as MeasurementMode}
                />
              ) : (
                <img
                  src={measurement.insole_image_url}
                  alt="中敷き画像"
                  className="w-full object-contain"
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Image only (no points) */}
        {measurement.image_url && !points && (
          <Card className="bg-gray-900 border-gray-800 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">計測画像</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <img
                src={measurement.image_url}
                alt="計測画像"
                className="w-full object-contain"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ResultItem({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  color?: "yellow" | "red" | "purple" | "teal";
}) {
  const colorClass =
    color === "yellow"
      ? "text-yellow-400"
      : color === "red"
      ? "text-red-400"
      : color === "purple"
      ? "text-purple-400"
      : color === "teal"
      ? "text-teal-400"
      : "text-blue-400";

  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${colorClass}`}>
        {value != null ? value.toFixed(1) : "—"}
        <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
      </p>
    </div>
  );
}
