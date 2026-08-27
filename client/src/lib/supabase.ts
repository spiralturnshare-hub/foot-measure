// ============================================================
// SPIRAL TURN - Supabase クライアント設定（foot-measure）
// Green Supabase: fhamrkmsxidxayaoexso
// tRPC/Express/Manus依存を排除し、customer-mgmt-console/upload-centerと
// 同じ「フロントエンドから直接Supabaseを呼ぶ」構成に統一。
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { applyRegression, DEFAULT_REGRESSION_COEFFICIENTS } from '../../../shared/measurementTypes';
import type {
  MeasurementPoints,
  MeasurementResult,
  PaperType,
  FlexUnitState,
} from '../../../shared/measurementTypes';

/**
 * MeasurementPointsに屈折ユニット状態を付加した型。
 * 旧server/routers.tsのMeasurementPointsSchemaもflexUnit1/flexUnit2を
 * オプショナルフィールドとして受け付けていた（実際にはMeasure.tsxからは
 * 付加されず常にundefinedだったが、同じ振る舞いを踏襲する）。
 */
type MeasurementPointsWithFlex = MeasurementPoints & {
  flexUnit1?: FlexUnitState;
  flexUnit2?: FlexUnitState;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://fhamrkmsxidxayaoexso.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoYW1ya21zeGlkeGF5YW9leHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTcwMTMsImV4cCI6MjEwMDI3MzAxM30.7GRn0m2SO3BzNQLQAb8dbREpoC8ewSIMLU2gWMIHp5I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ============================================================
// 認証 - Magic Link
// ============================================================
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ============================================================
// foot_measurements テーブル操作
// 実テーブルの列（snake_case）をそのまま型・関数の形にする。
// ============================================================
export interface FootMeasurementRow {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  organization_id: string | null;
  upload_id: string | null;
  order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  notes: string | null;
  image_key: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  image_rotation: number | null;
  paper_type: string;
  a4_orientation: string;
  points_json: Record<string, unknown> | null;
  flex_unit1_json: Record<string, unknown> | null;
  flex_unit2_json: Record<string, unknown> | null;
  left_foot_length: number | null;
  right_foot_length: number | null;
  left_foot_width: number | null;
  right_foot_width: number | null;
  left_heel_to_mp: number | null;
  right_heel_to_mp: number | null;
  left_first_ip: number | null;
  right_first_ip: number | null;
  left_leb: number | null;
  right_leb: number | null;
  regression_result_json: Record<string, unknown> | null;
  insole_image_key: string | null;
  insole_image_url: string | null;
  insole_image_width: number | null;
  insole_image_height: number | null;
  insole_points_json: Record<string, unknown> | null;
  insole_paper_type: string;
  insole_length: number | null;
  hallux_valgus_left: number | null;
  hallux_valgus_right: number | null;
  quintus_toe_left: number | null;
  quintus_toe_right: number | null;
  claw_toe_left: number | null;
  claw_toe_right: number | null;
  insole_size: string | null;
  shoe_size: string | null;
  shoe_brand: string | null;
  shipping_address: string | null;
  room_shoe_color: string | null;
  spa_shoe_color: string | null;
  status: string;
  is_favorited: boolean;
  hide_contents: boolean;
  operator_member_id: string | null;
  measured_at: string | null;
}

/** 計測一覧取得（customerIdを指定すればその顧客のみ、なければ新しい順200件） */
export async function fetchMeasurements(customerId?: string): Promise<FootMeasurementRow[]> {
  let query = supabase
    .from('foot_measurements')
    .select('*')
    .order('created_at', { ascending: false });
  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else {
    query = query.limit(200);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FootMeasurementRow[];
}

/** 計測詳細取得（見つからない場合はnull） */
export async function fetchMeasurementById(id: string): Promise<FootMeasurementRow | null> {
  const { data, error } = await supabase
    .from('foot_measurements')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as FootMeasurementRow;
}

/** upload_idに紐づく計測を取得（無ければnull。upload-center/customer-mgmt-consoleからの連携用） */
export async function fetchMeasurementByUploadId(uploadId: string): Promise<FootMeasurementRow | null> {
  const { data, error } = await supabase
    .from('foot_measurements')
    .select('*')
    .eq('upload_id', uploadId)
    .maybeSingle();
  if (error) throw error;
  return data as FootMeasurementRow | null;
}

export interface CreateMeasurementInput {
  customerId?: string;
  organizationId?: string;
  uploadId?: string;
  orderId?: string;
  customerName?: string;
  notes?: string;
  insoleSize?: string;
  shoeSize?: string;
  shoeBrand?: string;
  shippingAddress?: string;
  roomShoeColor?: string;
  spaShoeColor?: string;
}

/** 新規計測ドラフト作成 */
export async function createMeasurement(input: CreateMeasurementInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('foot_measurements')
    .insert({
      customer_id: input.customerId ?? null,
      organization_id: input.organizationId ?? null,
      upload_id: input.uploadId ?? null,
      order_id: input.orderId ?? null,
      customer_name: input.customerName ?? null,
      notes: input.notes ?? null,
      insole_size: input.insoleSize ?? null,
      shoe_size: input.shoeSize ?? null,
      shoe_brand: input.shoeBrand ?? null,
      shipping_address: input.shippingAddress ?? null,
      room_shoe_color: input.roomShoeColor ?? null,
      spa_shoe_color: input.spaShoeColor ?? null,
      status: 'draft',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

/**
 * 画像アップロード（Supabase Storage の upsys バケットへ直接アップロード）
 * kind: 'photo'（足の計測画像）| 'insole'（中敷き画像）
 * パス規則: measurements/{measurementId}/{kind}/{fileId}/{filename}
 */
async function uploadToStorage(
  measurementId: string,
  kind: 'photo' | 'insole',
  file: File
): Promise<{ key: string; url: string }> {
  const fileId = crypto.randomUUID();
  const ext = file.name.split('.').pop();
  const filename = ext ? `${fileId}.${ext}` : fileId;
  const storagePath = `measurements/${measurementId}/${kind}/${fileId}/${filename}`;

  const { error } = await supabase.storage.from('upsys').upload(storagePath, file, { upsert: false });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from('upsys').getPublicUrl(storagePath);
  return { key: storagePath, url: urlData.publicUrl };
}

/** 足の計測画像アップロード */
export async function uploadMeasurementImage(
  id: string,
  file: File,
  imageWidth: number,
  imageHeight: number
): Promise<{ imageUrl: string }> {
  const { key, url } = await uploadToStorage(id, 'photo', file);
  const { error } = await supabase
    .from('foot_measurements')
    .update({
      image_key: key,
      image_url: url,
      image_width: imageWidth,
      image_height: imageHeight,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  return { imageUrl: url };
}

/** 中敷き画像アップロード */
export async function uploadInsoleImage(
  id: string,
  file: File,
  imageWidth: number,
  imageHeight: number
): Promise<{ insoleImageUrl: string }> {
  const { key, url } = await uploadToStorage(id, 'insole', file);
  const { error } = await supabase
    .from('foot_measurements')
    .update({
      insole_image_key: key,
      insole_image_url: url,
      insole_image_width: imageWidth,
      insole_image_height: imageHeight,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  return { insoleImageUrl: url };
}

export interface FootConditionInput {
  halluxValgusLeft: number;
  halluxValgusRight: number;
  quintusToeLeft: number;
  quintusToeRight: number;
  clawToeLeft: number;
  clawToeRight: number;
}

export interface CalculateMeasurementInput {
  id: string;
  result: MeasurementResult;
  standardPoints?: MeasurementPointsWithFlex;
  bunionPoints?: MeasurementPointsWithFlex;
  paperType?: PaperType;
  footCondition?: FootConditionInput;
  /** upload_idが渡された場合のみ production_workflows と連携する */
  uploadId?: string | null;
  orderId?: string | null;
  /** ログイン中の担当者（auth.users.id）。production_workflows.measure_byの解決に使用 */
  operatorAuthUserId?: string | null;
}

/**
 * applyRegressionは呼び出し側（Measure.tsx）で計算済みの結果を渡さず、
 * サーバー版routers.tsのcalculateプロシージャと同じタイミング（保存直前）で
 * このファイル内で算出する。
 *
 * 保存経路: 顧客データ改訂ポリシー（上書き禁止・追記型）に合わせ、直接updateではなく
 * RPC update_foot_measurement_with_history 経由で保存する（呼び出し前の行を
 * foot_measurement_revisionsへスナップショットしてから更新する設計）。
 * 新規下書き（まだ一度もcalculateされていない真っさらな行）に対する初回保存でも、
 * このRPCはそのまま使える（スナップショットが空の初期状態になるだけで問題ない）。
 */
export async function calculateAndSaveMeasurement(
  input: CalculateMeasurementInput
): Promise<{ regressionResult: Record<string, unknown> }> {
  const existing = await fetchMeasurementById(input.id);
  if (!existing) throw new Error('Not found');

  const regressionResult = applyRegression(input.result, DEFAULT_REGRESSION_COEFFICIENTS) as Record<string, unknown>;
  const existingPoints = (existing.points_json as Record<string, unknown> | null) ?? {};
  const newPointsJson = {
    ...existingPoints,
    ...(input.standardPoints ? { standard: input.standardPoints } : {}),
    ...(input.bunionPoints ? { bunion: input.bunionPoints } : {}),
  };
  const flexUnit1 = (input.standardPoints?.flexUnit1 ?? input.bunionPoints?.flexUnit1) ?? null;
  const flexUnit2 = (input.standardPoints?.flexUnit2 ?? input.bunionPoints?.flexUnit2) ?? null;

  const patch: Record<string, unknown> = {
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
    status: 'completed',
  };
  if (input.paperType) patch.paper_type = input.paperType;
  if (input.footCondition) {
    patch.hallux_valgus_left = input.footCondition.halluxValgusLeft;
    patch.hallux_valgus_right = input.footCondition.halluxValgusRight;
    patch.quintus_toe_left = input.footCondition.quintusToeLeft;
    patch.quintus_toe_right = input.footCondition.quintusToeRight;
    patch.claw_toe_left = input.footCondition.clawToeLeft;
    patch.claw_toe_right = input.footCondition.clawToeRight;
  }

  // p_changed_by_id: markProductionWorkflowMeasureDoneと同じfetchCurrentMember経由の解決。
  // operatorAuthUserIdが渡されている場合のみ解決し、無ければnullのまま（匿名/顧客操作など）。
  let memberId: string | null = null;
  if (input.operatorAuthUserId) {
    const member = await fetchCurrentMember(input.operatorAuthUserId);
    memberId = member?.id ?? null;
  }

  const { error } = await supabase.rpc('update_foot_measurement_with_history', {
    p_measurement_id: input.id,
    p_patch: patch,
    p_changed_by_type: 'staff',
    p_changed_by_id: memberId,
    p_change_reason: '計測結果の保存(測り直し含む)',
  });
  if (error) throw error;

  // upload_idが渡されている場合のみ production_workflows と連携する
  // （単体計測=customer_idのみの計測では対象のproduction_workflows行が存在しないためスキップ）
  if (input.uploadId) {
    await markProductionWorkflowMeasureDone(input.uploadId, input.orderId ?? null, memberId, input.id);
  }

  return { regressionResult };
}

/** 中敷き計測結果の保存 */
export async function saveInsoleResult(input: {
  id: string;
  insolePoints: MeasurementPoints;
  insoleLength: number | null;
  insolePaperType?: PaperType;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    insole_points_json: input.insolePoints,
    insole_length: input.insoleLength ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.insolePaperType) patch.insole_paper_type = input.insolePaperType;
  const { error } = await supabase.from('foot_measurements').update(patch).eq('id', input.id);
  if (error) throw error;
}

/** 計測削除 */
export async function deleteMeasurement(id: string): Promise<void> {
  const { error } = await supabase.from('foot_measurements').delete().eq('id', id);
  if (error) throw error;
}

export interface UpdateMeasurementMetaInput {
  customerId?: string;
  organizationId?: string;
  customerName?: string;
  notes?: string;
  insoleSize?: string;
  shoeSize?: string;
  shoeBrand?: string;
  shippingAddress?: string;
  roomShoeColor?: string;
  spaShoeColor?: string;
}

/** 計測メタ情報更新 */
export async function updateMeasurementMeta(id: string, input: UpdateMeasurementMetaInput): Promise<void> {
  const { error } = await supabase
    .from('foot_measurements')
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// system_members - ログイン中の担当者情報
// customer-mgmt-console/client/src/lib/supabase.ts の fetchCurrentMember と同一パターン
// ============================================================
export async function fetchCurrentMember(authUserId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from('system_members')
    .select('id, name')
    .eq('auth_user_id', authUserId)
    .single();
  if (error || !data) return null;
  return data as { id: string; name: string };
}

// ============================================================
// production_workflows - 工程進捗（計測完了時にmeasureステップを更新）
// customer-mgmt-console/client/src/lib/supabase.ts の
// fetchWorkflowByUploadId/ensureProductionWorkflow/toggleWorkflowStep と同一パターン
// ============================================================
export interface ProductionWorkflowRow {
  id: string;
  order_id: string | null;
  upload_id: string | null;
  measurement_id: string | null;
  measure_done: boolean | null;
  measure_at: string | null;
  measure_by: string | null;
}

/** upload_idに紐づくproduction_workflowを取得（無ければnull） */
export async function fetchWorkflowByUploadId(uploadId: string): Promise<ProductionWorkflowRow | null> {
  const { data, error } = await supabase
    .from('production_workflows')
    .select('*')
    .eq('upload_id', uploadId)
    .maybeSingle();
  if (error) throw error;
  return data as ProductionWorkflowRow | null;
}

/**
 * 計測完了を production_workflows に反映する。
 * レコードが無ければ upload_id/order_id を起点に新規作成する（ensureProductionWorkflowと同じ考え方）。
 */
export async function markProductionWorkflowMeasureDone(
  uploadId: string,
  orderId: string | null,
  memberId: string | null,
  measurementId: string
): Promise<void> {
  const patch = {
    measure_done: true,
    measure_at: new Date().toISOString(),
    measure_by: memberId,
    measurement_id: measurementId,
    updated_at: new Date().toISOString(),
  };

  const existing = await fetchWorkflowByUploadId(uploadId);
  if (existing) {
    const { error } = await supabase.from('production_workflows').update(patch).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('production_workflows')
    .insert({ upload_id: uploadId, order_id: orderId, ...patch });
  if (error) throw error;
}
