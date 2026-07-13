import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, json } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 計測セッションテーブル
 * 1回の撮影・計測に対応するレコード
 */
export const measurements = mysqlTable("measurements", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** 顧客名（任意） */
  customerName: varchar("customerName", { length: 255 }),
  /** メモ */
  notes: text("notes"),
  /** アップロードされた画像のストレージキー */
  imageKey: text("imageKey"),
  /** 画像のURL */
  imageUrl: text("imageUrl"),
  /** 画像の幅（px） */
  imageWidth: int("imageWidth"),
  /** 画像の高さ（px） */
  imageHeight: int("imageHeight"),

  // --- 計測点の座標（Canvas上のピクセル座標、JSON） ---
  /** 点1〜10 および各ラインの座標 JSON */
  pointsJson: json("pointsJson"),

  // --- 算出された実寸値（mm） ---
  /** 左足長 (mm) */
  leftFootLength: float("leftFootLength"),
  /** 右足長 (mm) */
  rightFootLength: float("rightFootLength"),
  /** 左足幅 (mm) */
  leftFootWidth: float("leftFootWidth"),
  /** 右足幅 (mm) */
  rightFootWidth: float("rightFootWidth"),
  /** 左かかと〜MP関節 (mm) */
  leftHeelToMp: float("leftHeelToMp"),
  /** 右かかと〜MP関節 (mm) */
  rightHeelToMp: float("rightHeelToMp"),

  // --- 中敷き計測（任意） ---
  /** 中敷き画像のストレージキー（任意） */
  insoleImageKey: text("insoleImageKey"),
  /** 中敷き画像のURL（任意） */
  insoleImageUrl: text("insoleImageUrl"),
  /** 中敷き画像の幅（px） */
  insoleImageWidth: int("insoleImageWidth"),
  /** 中敷き画像の高さ（px） */
  insoleImageHeight: int("insoleImageHeight"),
  /** 中敷き計測点の座標 JSON */
  insolePointsJson: json("insolePointsJson"),
  /** 中敷きサイズ (mm) */
  insoleLength: float("insoleLength"),

  // --- 足の状態評価（人間による目視チェック） ---
  /** 外反母趾(左): 0=確認できない, 1=明らかな外反母趾, 2=重度の外反母趾 */
  halluxValgusLeft: int("halluxValgusLeft"),
  /** 外反母趾(右): 0=確認できない, 1=明らかな外反母趾, 2=重度の外反母趾 */
  halluxValgusRight: int("halluxValgusRight"),
  /** 内反小趾(左): 0=確認できない, 1=明らかな内反小趾 */
  quintusToeLeft: int("quintusToeLeft"),
  /** 内反小趾(右): 0=確認できない, 1=明らかな内反小趾 */
  quintusToeRight: int("quintusToeRight"),
  /** ハンマー&クロウトウ(左): 0=確認できない, 1=明らかなクロウトウ */
  clawToeLeft: int("clawToeLeft"),
  /** ハンマー&クロウトウ(右): 0=確認できない, 1=明らかなクロウトウ */
  clawToeRight: int("clawToeRight"),

  // --- 用紙サイズ ---
  /** 足画像の用紙サイズ: 'A4' | 'B5' | 'Letter' */
  paperType: varchar("paperType", { length: 16 }).default('A4'),
  /** 中敷き画像の用紙サイズ: 'A4' | 'B5' | 'Letter' */
  insolePaperType: varchar("insolePaperType", { length: 16 }).default('A4'),

  // --- 顧客・注文情報（スパベースから自動入力、手動入力も可） ---
  /** 中底サイズ（例: "25.5cm"） */
  insoleSize: varchar("insoleSize", { length: 64 }),
  /** 靴の表記サイズ（例: "26.0cm"） */
  shoeSize: varchar("shoeSize", { length: 64 }),
  /** 靴のブランド */
  shoeBrand: varchar("shoeBrand", { length: 255 }),
  /** 郵送先住所 */
  shippingAddress: text("shippingAddress"),
  /** ルームシューズの色 */
  roomShoeColor: varchar("roomShoeColor", { length: 128 }),
  /** スパトレシューズの色 */
  spaShoeColor: varchar("spaShoeColor", { length: 128 }),

  // --- 重回帰推定値 ---
  /** 推定値JSON（係数差し替え可能） */
  regressionResultJson: json("regressionResultJson"),

  /** 計測ステータス */
  status: mysqlEnum("status", ["draft", "completed"]).default("draft").notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Measurement = typeof measurements.$inferSelect;
export type InsertMeasurement = typeof measurements.$inferInsert;
