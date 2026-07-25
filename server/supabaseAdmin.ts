// ============================================================
// SPIRAL TURN - Supabase サーバーサイドクライアント
// service_role キーを使用（RLSをバイパス）
// このファイルはサーバーサイドのみで使用すること
// フロントエンドには絶対に含めないこと
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { ENV } from "./_core/env";

// service_role キーで初期化 — RLSをバイパスしてフルアクセス
export const supabaseAdmin = createClient(
  ENV.supabaseUrl,
  ENV.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ---- foot_measurements テーブル操作 ----

export interface FootMeasurementInsert {
  customer_id?: string | null;
  organization_id?: string | null;
  order_id?: string | null;
  upload_id?: string | null;
  customer_name?: string | null;
  notes?: string | null;
  image_key?: string | null;
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_rotation?: number | null;
  paper_type?: string | null;
  a4_orientation?: string | null;
  points_json?: unknown | null;
  flex_unit1_json?: unknown | null;
  flex_unit2_json?: unknown | null;
  left_foot_length?: number | null;
  right_foot_length?: number | null;
  left_foot_width?: number | null;
  right_foot_width?: number | null;
  left_heel_to_mp?: number | null;
  right_heel_to_mp?: number | null;
  left_first_ip?: number | null;
  right_first_ip?: number | null;
  left_leb?: number | null;
  right_leb?: number | null;
  regression_result_json?: unknown | null;
  insole_image_key?: string | null;
  insole_image_url?: string | null;
  insole_image_width?: number | null;
  insole_image_height?: number | null;
  insole_points_json?: unknown | null;
  insole_paper_type?: string | null;
  insole_length?: number | null;
  hallux_valgus_left?: number | null;
  hallux_valgus_right?: number | null;
  quintus_toe_left?: number | null;
  quintus_toe_right?: number | null;
  claw_toe_left?: number | null;
  claw_toe_right?: number | null;
  insole_size?: string | null;
  shoe_size?: string | null;
  shoe_brand?: string | null;
  shipping_address?: string | null;
  room_shoe_color?: string | null;
  spa_shoe_color?: string | null;
  status?: string | null;
}

export async function sbCreateMeasurement(data: FootMeasurementInsert): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from("foot_measurements")
    .insert({ ...data, status: data.status ?? "draft" })
    .select("id")
    .single();
  if (error) throw new Error(`Supabase insert error: ${error.message}`);
  return row.id as string;
}

export async function sbGetMeasurementsByCustomerId(customerId: string) {
  const { data, error } = await supabaseAdmin
    .from("foot_measurements")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase select error: ${error.message}`);
  return data ?? [];
}

export async function sbGetMeasurementById(id: string) {
  const { data, error } = await supabaseAdmin
    .from("foot_measurements")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function sbUpdateMeasurement(id: string, data: Partial<FootMeasurementInsert>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("foot_measurements")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Supabase update error: ${error.message}`);
}

export async function sbDeleteMeasurement(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("foot_measurements")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`Supabase delete error: ${error.message}`);
}

export async function sbListMeasurements(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from("foot_measurements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase select error: ${error.message}`);
  return data ?? [];
}

