// ============================================================
// SPIRAL TURN - Supabase クライアント設定（foot-measure）
// Green Supabase: fhamrkmsxidxayaoexso
// ============================================================
import { createClient } from '@supabase/supabase-js';

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
// ⚠️ 注意: 以下の関数群はデッドコード（未使用）です。
// 実際のデータアクセスはすべてtRPC経由（server/supabaseAdmin.ts）で行われています。
// Green Supabaseの実テーブル名は 'foot_measurements' です（'measurements'は存在しません）。
// measurement_logsテーブルも存在しません。
// これらの関数を使用する場合は、テーブル名を 'foot_measurements' に変更してください。
// ============================================================
// [DEAD CODE] measurements テーブル操作（実テーブル名: foot_measurements）
// ============================================================
export interface MeasurementRow {
  id: string;
  customer_id: string | null;
  organization_id: string | null;
  order_id: string | null;
  measured_by: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  insole_image_url: string | null;
  insole_image_width: number | null;
  insole_image_height: number | null;
  paper_type: string | null;
  insole_paper_type: string | null;
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
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function fetchMeasurements(organizationId?: string): Promise<MeasurementRow[]> {
  let query = supabase
    .from('measurements')
    .select('*')
    .order('created_at', { ascending: false });
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchMeasurementById(id: string): Promise<MeasurementRow | null> {
  const { data, error } = await supabase
    .from('measurements')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createMeasurementSupabase(
  payload: Partial<MeasurementRow>
): Promise<MeasurementRow> {
  const { data, error } = await supabase
    .from('measurements')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMeasurementSupabase(
  id: string,
  updates: Partial<MeasurementRow>
): Promise<MeasurementRow> {
  const { data, error } = await supabase
    .from('measurements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMeasurementSupabase(id: string): Promise<void> {
  const { error } = await supabase
    .from('measurements')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// measurement_logs テーブル操作
// ============================================================
export interface MeasurementLogRow {
  id: string;
  measurement_id: string;
  tab_mode: string | null;
  points_json: Record<string, unknown> | null;
  insole_points_json: Record<string, unknown> | null;
  regression_result_json: Record<string, unknown> | null;
  saved_at: string;
}

export async function saveMeasurementLog(
  measurementId: string,
  tabMode: string,
  pointsJson: Record<string, unknown>,
  insolePointsJson?: Record<string, unknown> | null,
  regressionResultJson?: Record<string, unknown> | null
): Promise<MeasurementLogRow> {
  const { data, error } = await supabase
    .from('measurement_logs')
    .insert({
      measurement_id: measurementId,
      tab_mode: tabMode,
      points_json: pointsJson,
      insole_points_json: insolePointsJson ?? null,
      regression_result_json: regressionResultJson ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchMeasurementLogs(measurementId: string): Promise<MeasurementLogRow[]> {
  const { data, error } = await supabase
    .from('measurement_logs')
    .select('*')
    .eq('measurement_id', measurementId)
    .order('saved_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// customers テーブル操作
// ============================================================
export interface CustomerRow {
  id: string;
  organization_id: string | null;
  last_name: string | null;
  first_name: string | null;
  last_name_kana: string | null;
  first_name_kana: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  adult_type: string | null;
  no_email: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchCustomerById(customerId: string): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();
  if (error) throw error;
  return data;
}
