import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { applyRegression, DEFAULT_REGRESSION_COEFFICIENTS } from "../shared/measurementTypes";
import {
  sbCreateMeasurement,
  sbGetMeasurementsByCustomerId,
  sbGetMeasurementById,
  sbUpdateMeasurement,
  sbDeleteMeasurement,
  sbListMeasurements,
} from "./supabaseAdmin";

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
  list: publicProcedure
    .input(z.object({ customerId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.customerId) {
        return sbGetMeasurementsByCustomerId(input.customerId);
      }
      return sbListMeasurements(200);
    }),

  /** 計測詳細取得 */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      return m;
    }),

  /** 新規計測ドラフト作成 */
  create: publicProcedure
    .input(
      z.object({
        customerId: z.string().uuid().optional(),
        organizationId: z.string().uuid().optional(),
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
      const id = await sbCreateMeasurement({
        customer_id: input.customerId ?? null,
        organization_id: input.organizationId ?? null,
        customer_name: input.customerName ?? null,
        notes: input.notes ?? null,
        insole_size: input.insoleSize ?? null,
        shoe_size: input.shoeSize ?? null,
        shoe_brand: input.shoeBrand ?? null,
        shipping_address: input.shippingAddress ?? null,
        room_shoe_color: input.roomShoeColor ?? null,
        spa_shoe_color: input.spaShoeColor ?? null,
        status: "draft",
      });
      return { id };
    }),

  /** 画像アップロード */
  uploadImage: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        imageWidth: z.number(),
        imageHeight: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      const key = `measurements/${input.id}/photo.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await sbUpdateMeasurement(input.id, {
        image_key: key,
        image_url: url,
        image_width: input.imageWidth,
        image_height: input.imageHeight,
      });
      return { imageUrl: url };
    }),

  /** 計測点の保存 */
  savePoints: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        points: MeasurementPointsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await sbUpdateMeasurement(input.id, { points_json: input.points });
      return { success: true };
    }),

  /** 計測結果の算出・保存 */
  calculate: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        result: MeasurementResultSchema,
        standardPoints: MeasurementPointsSchema.optional(),
        bunionPoints: MeasurementPointsSchema.optional(),
        paperType: z.enum(["A4", "B5", "Letter"]).optional(),
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
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      const regressionResult = applyRegression(input.result, DEFAULT_REGRESSION_COEFFICIENTS);
      const existingPoints = (m.points_json as Record<string, unknown> | null) ?? {};
      const newPointsJson = {
        ...existingPoints,
        ...(input.standardPoints ? { standard: input.standardPoints } : {}),
        ...(input.bunionPoints ? { bunion: input.bunionPoints } : {}),
      };
      const flexUnit1 = (input.standardPoints?.flexUnit1 ?? input.bunionPoints?.flexUnit1) ?? null;
      const flexUnit2 = (input.standardPoints?.flexUnit2 ?? input.bunionPoints?.flexUnit2) ?? null;
      await sbUpdateMeasurement(input.id, {
        points_json: newPointsJson,
        flex_unit1_json: flexUnit1,
        flex_unit2_json: flexUnit2,
        left_foot_length: input.result.leftFootLength ?? null,
        right_foot_length: input.result.rightFootLength ?? null,
        left_foot_width: input.result.leftFootWidth ?? null,
        right_foot_width: input.result.rightFootWidth ?? null,
        left_heel_to_mp: input.result.leftHeelToMp ?? null,
        right_heel_to_mp: input.result.rightHeelToMp ?? null,
        regression_result_json: regressionResult,
        status: "completed",
        ...(input.paperType ? { paper_type: input.paperType } : {}),
        ...(input.footCondition ? {
          hallux_valgus_left: input.footCondition.halluxValgusLeft,
          hallux_valgus_right: input.footCondition.halluxValgusRight,
          quintus_toe_left: input.footCondition.quintusToeLeft,
          quintus_toe_right: input.footCondition.quintusToeRight,
          claw_toe_left: input.footCondition.clawToeLeft,
          claw_toe_right: input.footCondition.clawToeRight,
        } : {}),
      });
      return { success: true, regressionResult };
    }),

  /** 両モードの計測点を保存（再調整機能用） */
  saveBothPoints: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        standardPoints: MeasurementPointsSchema.optional(),
        bunionPoints: MeasurementPointsSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      const existingPoints = (m.points_json as { standard?: unknown; bunion?: unknown } | null) ?? {};
      const newPointsJson = {
        ...existingPoints,
        ...(input.standardPoints ? { standard: input.standardPoints } : {}),
        ...(input.bunionPoints ? { bunion: input.bunionPoints } : {}),
      };
      await sbUpdateMeasurement(input.id, { points_json: newPointsJson });
      return { success: true };
    }),

  /** 中敷き画像アップロード */
  uploadInsoleImage: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        imageWidth: z.number(),
        imageHeight: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      const key = `measurements/${input.id}/insole.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await sbUpdateMeasurement(input.id, {
        insole_image_key: key,
        insole_image_url: url,
        insole_image_width: input.imageWidth,
        insole_image_height: input.imageHeight,
      });
      return { insoleImageUrl: url };
    }),

  /** 中敷き計測結果の保存 */
  saveInsoleResult: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        insolePoints: MeasurementPointsSchema,
        insoleLength: z.number().nullable(),
        insolePaperType: z.enum(["A4", "B5", "Letter"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await sbUpdateMeasurement(input.id, {
        insole_points_json: input.insolePoints,
        insole_length: input.insoleLength ?? null,
        ...(input.insolePaperType ? { insole_paper_type: input.insolePaperType } : {}),
      });
      return { success: true };
    }),

  /** オフラインデータの一括同期 */
  syncOffline: publicProcedure
    .input(
      z.object({
        records: z.array(
          z.object({
            localId: z.string(),
            customerId: z.string().uuid().optional(),
            organizationId: z.string().uuid().optional(),
            customerName: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
            imageBase64: z.string().nullable().optional(),
            imageMimeType: z.string().optional(),
            imageWidth: z.number().nullable().optional(),
            imageHeight: z.number().nullable().optional(),
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
            paperType: z.enum(["A4", "B5", "Letter"]).optional(),
            insoleImageBase64: z.string().nullable().optional(),
            insoleImageMimeType: z.string().optional(),
            insolePointsJson: z.unknown().optional(),
            insoleLength: z.number().nullable().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const results: { localId: string; serverId: string; success: boolean }[] = [];
      for (const record of input.records) {
        try {
          const serverId = await sbCreateMeasurement({
            customer_id: record.customerId ?? null,
            organization_id: record.organizationId ?? null,
            customer_name: record.customerName ?? null,
            notes: record.notes ?? null,
            status: "draft",
          });
          if (record.imageBase64 && record.imageWidth && record.imageHeight) {
            const mimeType = record.imageMimeType ?? "image/jpeg";
            const buffer = Buffer.from(record.imageBase64, "base64");
            const ext = mimeType.split("/")[1] || "jpg";
            const key = `measurements/${serverId}/photo.${ext}`;
            const { url } = await storagePut(key, buffer, mimeType);
            await sbUpdateMeasurement(serverId, {
              image_key: key,
              image_url: url,
              image_width: record.imageWidth,
              image_height: record.imageHeight,
            });
          }
          if (record.insoleImageBase64) {
            const mimeType = record.insoleImageMimeType ?? "image/jpeg";
            const buffer = Buffer.from(record.insoleImageBase64, "base64");
            const ext = mimeType.split("/")[1] || "jpg";
            const key = `measurements/${serverId}/insole.${ext}`;
            const { url } = await storagePut(key, buffer, mimeType);
            await sbUpdateMeasurement(serverId, {
              insole_image_key: key,
              insole_image_url: url,
            });
          }
          const regressionResult = record.result
            ? applyRegression(record.result, DEFAULT_REGRESSION_COEFFICIENTS)
            : null;
          await sbUpdateMeasurement(serverId, {
            points_json: record.pointsJson ?? null,
            left_foot_length: record.result?.leftFootLength ?? null,
            right_foot_length: record.result?.rightFootLength ?? null,
            left_foot_width: record.result?.leftFootWidth ?? null,
            right_foot_width: record.result?.rightFootWidth ?? null,
            left_heel_to_mp: record.result?.leftHeelToMp ?? null,
            right_heel_to_mp: record.result?.rightHeelToMp ?? null,
            regression_result_json: regressionResult ?? null,
            status: record.result ? "completed" : "draft",
            ...(record.paperType ? { paper_type: record.paperType } : {}),
            ...(record.footCondition ? {
              hallux_valgus_left: record.footCondition.halluxValgusLeft,
              hallux_valgus_right: record.footCondition.halluxValgusRight,
              quintus_toe_left: record.footCondition.quintusToeLeft,
              quintus_toe_right: record.footCondition.quintusToeRight,
              claw_toe_left: record.footCondition.clawToeLeft,
              claw_toe_right: record.footCondition.clawToeRight,
            } : {}),
            ...(record.insolePointsJson ? { insole_points_json: record.insolePointsJson } : {}),
            ...(record.insoleLength != null ? { insole_length: record.insoleLength } : {}),
          });
          results.push({ localId: record.localId, serverId, success: true });
        } catch (err) {
          console.error(`[syncOffline] Failed to sync localId=${record.localId}:`, err);
          results.push({ localId: record.localId, serverId: "", success: false });
        }
      }
      return { results };
    }),

  /** 計測削除 */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await sbDeleteMeasurement(input.id);
      return { success: true };
    }),

  /** 計測メタ情報更新 */
  updateMeta: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        customerId: z.string().uuid().optional(),
        organizationId: z.string().uuid().optional(),
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
      const m = await sbGetMeasurementById(input.id);
      if (!m) throw new Error("Not found");
      await sbUpdateMeasurement(input.id, {
        customer_id: input.customerId,
        organization_id: input.organizationId,
        customer_name: input.customerName,
        notes: input.notes,
        insole_size: input.insoleSize,
        shoe_size: input.shoeSize,
        shoe_brand: input.shoeBrand,
        shipping_address: input.shippingAddress,
        room_shoe_color: input.roomShoeColor,
        spa_shoe_color: input.spaShoeColor,
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
