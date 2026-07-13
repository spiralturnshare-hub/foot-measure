import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  createMeasurement,
  getMeasurementsByUserId,
  getMeasurementById,
  updateMeasurement,
  deleteMeasurement,
} from "./db";
import { storagePut } from "./storage";

import { applyRegression, DEFAULT_REGRESSION_COEFFICIENTS } from "../shared/measurementTypes";


// ---- Zod schemas ----

const PointSchema = z.object({ x: z.number(), y: z.number() });

const MeasurementPointsSchema = z.object({
  point1: PointSchema,
  point2: PointSchema,
  point3: PointSchema,
  point4: PointSchema,
  point5: PointSchema,
  point6: PointSchema,
  point7: PointSchema,
  point8: PointSchema,
  point9: PointSchema,
  point10: PointSchema,
  point11: PointSchema.nullable().optional(),
  point12: PointSchema.nullable().optional(),
  point13: PointSchema.nullable().optional(),
  point14: PointSchema.nullable().optional(),
  point15: PointSchema.nullable().optional(),
  point16: PointSchema.nullable().optional(),
  flexUnit1: z.object({ active: z.boolean(), angle: z.number(), axisLength: z.number().optional() }).optional(),
  flexUnit2: z.object({ active: z.boolean(), angle: z.number(), axisLength: z.number().optional() }).optional(),
});

const MeasurementResultSchema = z.object({
  leftFootLength: z.number().nullable(),
  rightFootLength: z.number().nullable(),
  leftFootWidth: z.number().nullable(),
  rightFootWidth: z.number().nullable(),
  leftHeelToMp: z.number().nullable(),
  rightHeelToMp: z.number().nullable(),
  leftFirstIP: z.number().nullable().default(null),
  rightFirstIP: z.number().nullable().default(null),
});

// ---- Measurements router ----

const measurementsRouter = router({
  /** 計測一覧取得 */
  list: publicProcedure.query(async () => {
    return getMeasurementsByUserId(1);
  }),

  /** 計測詳細取得 */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      return m;
    }),

  /** 新規計測ドラフト作成 */
  create: publicProcedure
    .input(
      z.object({
        customerName: z.string().optional(),
        notes: z.string().optional(),
        insoleSize: z.string().optional(),
        shoeSize: z.string().optional(),
        shoeBrand: z.string().optional(),
        shippingAddress: z.string().optional(),
        roomShoeColor: z.string().optional(),
        spaShoeColor: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await createMeasurement({
        userId: 1,
        customerName: input.customerName ?? null,
        notes: input.notes ?? null,
        insoleSize: input.insoleSize ?? null,
        shoeSize: input.shoeSize ?? null,
        shoeBrand: input.shoeBrand ?? null,
        shippingAddress: input.shippingAddress ?? null,
        roomShoeColor: input.roomShoeColor ?? null,
        spaShoeColor: input.spaShoeColor ?? null,
        status: "draft",
      });
      return { id };
    }),

  /** 画像アップロード */
  uploadImage: publicProcedure
    .input(
      z.object({
        id: z.number(),
        /** base64エンコードされた画像データ */
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        imageWidth: z.number(),
        imageHeight: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");

      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      const key = `measurements/shared/${input.id}/photo.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      await updateMeasurement(input.id, {
        imageKey: key,
        imageUrl: url,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
      });

      return { imageUrl: url };
    }),

  /** 計測点の保存 */
  savePoints: publicProcedure
    .input(
      z.object({
        id: z.number(),
        points: MeasurementPointsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await updateMeasurement(input.id, { pointsJson: input.points });
      return { success: true };
    }),

  /** 計測結果の算出・保存 */
  calculate: publicProcedure
    .input(
      z.object({
        id: z.number(),
        result: MeasurementResultSchema,
        // 両モードの点を { standard, bunion } 形式で保存（再調整時に復元可能）
        standardPoints: MeasurementPointsSchema.optional(),
        bunionPoints: MeasurementPointsSchema.optional(),
        // 用紙サイズ
        paperType: z.enum(['A4', 'B5', 'Letter']).optional(),
        // 足の状態評価（目視チェック）
        footCondition: z.object({
          halluxValgusLeft: z.number().int().min(-1).max(2),
          halluxValgusRight: z.number().int().min(-1).max(2),
          quintusToeLeft: z.number().int().min(-1).max(1),
          quintusToeRight: z.number().int().min(-1).max(1),
          clawToeLeft: z.number().int().min(-1).max(1),
          clawToeRight: z.number().int().min(-1).max(1),
        }).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");

      const regressionResult = applyRegression(input.result, DEFAULT_REGRESSION_COEFFICIENTS);

      // 既存のpointsJsonを読み込んでマージ（insoleデータを上書きしないよう）
      const existingPoints = (m.pointsJson as Record<string, unknown> | null) ?? {};
      const newPointsJson = {
        ...existingPoints,
        ...(input.standardPoints ? { standard: input.standardPoints } : {}),
        ...(input.bunionPoints ? { bunion: input.bunionPoints } : {}),
      };

      await updateMeasurement(input.id, {
        pointsJson: newPointsJson,
        leftFootLength: input.result.leftFootLength ?? undefined,
        rightFootLength: input.result.rightFootLength ?? undefined,
        leftFootWidth: input.result.leftFootWidth ?? undefined,
        rightFootWidth: input.result.rightFootWidth ?? undefined,
        leftHeelToMp: input.result.leftHeelToMp ?? undefined,
        rightHeelToMp: input.result.rightHeelToMp ?? undefined,
        regressionResultJson: regressionResult,
        status: "completed",
        ...(input.paperType ? { paperType: input.paperType } : {}),
        // 足の状態評価
        ...(input.footCondition ? {
          halluxValgusLeft: input.footCondition.halluxValgusLeft,
          halluxValgusRight: input.footCondition.halluxValgusRight,
          quintusToeLeft: input.footCondition.quintusToeLeft,
          quintusToeRight: input.footCondition.quintusToeRight,
          clawToeLeft: input.footCondition.clawToeLeft,
          clawToeRight: input.footCondition.clawToeRight,
        } : {}),
      });

      return { success: true, regressionResult };
    }),


  /** 両モードの計測点を保存（再調整機能用） */
  saveBothPoints: publicProcedure
    .input(
      z.object({
        id: z.number(),
        standardPoints: MeasurementPointsSchema.optional(),
        bunionPoints: MeasurementPointsSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      // 両モードの点を { standard: ..., bunion: ... } 形式でpointsJsonに保存
      const existingPoints = (m.pointsJson as { standard?: unknown; bunion?: unknown } | null) ?? {};
      const newPointsJson = {
        ...existingPoints,
        ...(input.standardPoints ? { standard: input.standardPoints } : {}),
        ...(input.bunionPoints ? { bunion: input.bunionPoints } : {}),
      };
      await updateMeasurement(input.id, { pointsJson: newPointsJson });
      return { success: true };
    }),

  /** 中敷き画像アップロード */
  uploadInsoleImage: publicProcedure
    .input(
      z.object({
        id: z.number(),
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        imageWidth: z.number(),
        imageHeight: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");

      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      const key = `measurements/shared/${input.id}/insole.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      await updateMeasurement(input.id, {
        insoleImageKey: key,
        insoleImageUrl: url,
        insoleImageWidth: input.imageWidth,
        insoleImageHeight: input.imageHeight,
      });

      return { insoleImageUrl: url };
    }),

  /** 中敷き計測結果の保存 */
  saveInsoleResult: publicProcedure
    .input(
      z.object({
        id: z.number(),
        insolePoints: MeasurementPointsSchema,
        insoleLength: z.number().nullable(),
        insolePaperType: z.enum(['A4', 'B5', 'Letter']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await updateMeasurement(input.id, {
        insolePointsJson: input.insolePoints,
        insoleLength: input.insoleLength ?? undefined,
        ...(input.insolePaperType ? { insolePaperType: input.insolePaperType } : {}),
      });
      return { success: true };
    }),

  /**
   * オフラインデータの一括同期
   * IndexedDBに保存された未同期データをサーバーに一括登録する
   */
  syncOffline: publicProcedure
    .input(
      z.object({
        records: z.array(
          z.object({
            localId: z.string(),
            customerName: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
            measureDate: z.number(),
            imageBase64: z.string().nullable().optional(),
            imageMimeType: z.string().optional(),
            imageWidth: z.number().optional(),
            imageHeight: z.number().optional(),
            pointsJson: z.unknown().optional(),
            result: z.object({
              leftFootLength: z.number().nullable(),
              rightFootLength: z.number().nullable(),
              leftFootWidth: z.number().nullable(),
              rightFootWidth: z.number().nullable(),
              leftHeelToMp: z.number().nullable(),
              rightHeelToMp: z.number().nullable(),
              leftFirstIP: z.number().nullable(),
              rightFirstIP: z.number().nullable(),
            }).nullable().optional(),
            footCondition: z.object({
              halluxValgusLeft: z.number().int().min(-1).max(2),
              halluxValgusRight: z.number().int().min(-1).max(2),
              quintusToeLeft: z.number().int().min(-1).max(1),
              quintusToeRight: z.number().int().min(-1).max(1),
              clawToeLeft: z.number().int().min(-1).max(1),
              clawToeRight: z.number().int().min(-1).max(1),
            }).nullable().optional(),
            paperType: z.enum(['A4', 'B5', 'Letter']).optional(),
            insoleImageBase64: z.string().nullable().optional(),
            insoleImageMimeType: z.string().optional(),
            insolePointsJson: z.unknown().optional(),
            insoleLength: z.number().nullable().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const results: { localId: string; serverId: number; success: boolean }[] = [];

      for (const record of input.records) {
        try {
          // 1. ドラフト作成
          const serverId = await createMeasurement({
            userId: 1,
            customerName: record.customerName ?? null,
            notes: record.notes ?? null,
            status: "draft",
          });

          // 2. 画像アップロード（ある場合）
          let imageUrl: string | undefined;
          if (record.imageBase64 && record.imageWidth && record.imageHeight) {
            const mimeType = record.imageMimeType ?? "image/jpeg";
            const buffer = Buffer.from(record.imageBase64, "base64");
            const ext = mimeType.split("/")[1] || "jpg";
            const key = `measurements/shared/${serverId}/photo.${ext}`;
            const { url } = await storagePut(key, buffer, mimeType);
            imageUrl = url;
            await updateMeasurement(serverId, {
              imageKey: key,
              imageUrl: url,
              imageWidth: record.imageWidth,
              imageHeight: record.imageHeight,
            });
          }

          // 3. 中敷き画像アップロード（ある場合）
          if (record.insoleImageBase64) {
            const mimeType = record.insoleImageMimeType ?? "image/jpeg";
            const buffer = Buffer.from(record.insoleImageBase64, "base64");
            const ext = mimeType.split("/")[1] || "jpg";
            const key = `measurements/shared/${serverId}/insole.${ext}`;
            const { url } = await storagePut(key, buffer, mimeType);
            await updateMeasurement(serverId, {
              insoleImageKey: key,
              insoleImageUrl: url,
            });
          }

          // 4. 計測結果・計測点・足の状態を保存
          const regressionResult = record.result
            ? applyRegression(record.result, DEFAULT_REGRESSION_COEFFICIENTS)
            : null;

          await updateMeasurement(serverId, {
            pointsJson: record.pointsJson ?? null,
            leftFootLength: record.result?.leftFootLength ?? undefined,
            rightFootLength: record.result?.rightFootLength ?? undefined,
            leftFootWidth: record.result?.leftFootWidth ?? undefined,
            rightFootWidth: record.result?.rightFootWidth ?? undefined,
            leftHeelToMp: record.result?.leftHeelToMp ?? undefined,
            rightHeelToMp: record.result?.rightHeelToMp ?? undefined,
            regressionResultJson: regressionResult ?? undefined,
            status: record.result ? "completed" : "draft",
            ...(record.paperType ? { paperType: record.paperType } : {}),
            ...(record.footCondition ? {
              halluxValgusLeft: record.footCondition.halluxValgusLeft,
              halluxValgusRight: record.footCondition.halluxValgusRight,
              quintusToeLeft: record.footCondition.quintusToeLeft,
              quintusToeRight: record.footCondition.quintusToeRight,
              clawToeLeft: record.footCondition.clawToeLeft,
              clawToeRight: record.footCondition.clawToeRight,
            } : {}),
            ...(record.insolePointsJson ? { insolePointsJson: record.insolePointsJson } : {}),
            ...(record.insoleLength != null ? { insoleLength: record.insoleLength } : {}),
          });

          results.push({ localId: record.localId, serverId, success: true });
        } catch (err) {
          console.error(`[syncOffline] Failed to sync localId=${record.localId}:`, err);
          results.push({ localId: record.localId, serverId: -1, success: false });
        }
      }

      return { results };
    }),

  /** 計測削除 */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await deleteMeasurement(input.id);
      return { success: true };
    }),

  /** 計測メタ情報更新 */
  updateMeta: publicProcedure
    .input(
      z.object({
        id: z.number(),
        customerName: z.string().optional(),
        notes: z.string().optional(),
        insoleSize: z.string().optional(),
        shoeSize: z.string().optional(),
        shoeBrand: z.string().optional(),
        shippingAddress: z.string().optional(),
        roomShoeColor: z.string().optional(),
        spaShoeColor: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await getMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await updateMeasurement(input.id, {
        customerName: input.customerName,
        notes: input.notes,
        insoleSize: input.insoleSize,
        shoeSize: input.shoeSize,
        shoeBrand: input.shoeBrand,
        shippingAddress: input.shippingAddress,
        roomShoeColor: input.roomShoeColor,
        spaShoeColor: input.spaShoeColor,
      });
      return { success: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  measurements: measurementsRouter,
});

export type AppRouter = typeof appRouter;
