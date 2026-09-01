# デプロイ・チェックポイント記録(foot-measure)

customer-mgmt-console/upload-centerと同じ運用。UIやデータ層に変更を加える前に必ずこの記録の一番下に新しいチェックポイントを追記してから作業する。壊れた場合はここに書かれたコミット/URLに戻せる。

## 戻し方

```
git log --oneline          # コミット履歴確認
git reset --hard <コミットhash>   # 作業ツリーを指定コミットまで戻す(要事前確認・複数回許可)
git push --force-with-lease       # リモートも戻す(要事前確認・複数回許可)
```
または Vercelダッシュボード → Deployments → 戻したいデプロイの「...」→「Promote to Production」でコード変更なしに即座に切り戻し可能(こちらの方が安全・簡単)。

---

## チェックポイント一覧

### CP0 (2026-08-26 Supabase直叩き構成への全面移行 着手前)
- コミット: `284b65b`
- Vercel Production: https://foot-measure.vercel.app
- 内容: tRPC+Express+Drizzle+Manus Forge Storageというフルスタック構成のまま、`vercel.json`だけが静的サイト用(`framework: vite`)になっていたため、本番では`/api/trpc/*`が全てindex.htmlにフォールバックし、計測データの保存が一切動作していなかった状態。加えて`measurementsRouter`が全プロシージャpublicProcedure(未認証で読み書き・削除可能)だった。このコミットまでは実測確認済みの不具合を抱えたまま。

### CP1 (2026-08-26 tRPC/Express/Manus依存を排除し、Supabase直叩き構成へ全面移行)
- コミット: `e7ba2d0`
- Vercel Production: 未デプロイ(本人レビュー後にpush/デプロイ判断のため、このチェックポイント時点ではVercelへの反映なし)
- 内容:
  - `server/`ディレクトリ全体(routers.ts, supabaseAdmin.ts, storage.ts, storageProxy.ts, oauth.ts, db.ts, _core/*, テスト含む)を削除。tRPC/Express/Manus Forge Storage依存を完全に排除。
  - 同時に完全に無関係だったMySQL用Drizzle成果物(`drizzle/`, `drizzle.config.ts`, `run-migration.mjs`)、サーバー専用テストのみを対象にしていた`vitest.config.ts`、到達不能な旧OAuthコード(`client/src/const.ts`の`getLoginUrl`、`client/src/_core/hooks/useAuth.ts`、`client/src/components/DashboardLayout.tsx`、`ComponentShowcase.tsx`、`AIChatBox.tsx`、`ManusDialog.tsx`)、参照先の壊れた`shared/types.ts`/`shared/_core/errors.ts`を削除。
  - `client/src/lib/supabase.ts`を全面実装(customer-mgmt-console/upload-centerと同じ「フロントエンドから直接Supabaseクライアント(anon key)を叩く」構成)。旧`server/routers.ts`の各プロシージャ(list/getById/create/uploadImage/calculate/uploadInsoleImage/saveInsoleResult/delete/updateMeta)と同じ振る舞いをする関数を実装。画像アップロードはManus Forgeの代わりにSupabase Storageの`upsys`バケットへ`File`を直接アップロードする方式に変更(base64変換を廃止)。
  - 新規: `create`相当の関数が`uploadId`/`orderId`を受け取り`foot_measurements.upload_id`/`order_id`にセットするようにした。`fetchMeasurementByUploadId`を新設。
  - 新規: 計測完了(`calculate`相当、status='completed'になる瞬間)に`production_workflows.measure_done`/`measure_at`/`measure_by`/`measurement_id`を更新する連携を追加(uploadIdが渡されている場合のみ。担当者IDは`system_members`を`auth_user_id`で引く`fetchCurrentMember`をcustomer-mgmt-consoleから移植)。`Measure.tsx`はURLクエリの`uploadId`/`orderId`を`customerId`/`organizationId`と同じパターンで読み取り、`calculateAndSaveMeasurement`に渡すよう変更。
  - `client/src/pages/Home.tsx`, `History.tsx`, `HistoryDetail.tsx`, `Measure.tsx`のtRPC呼び出し(`.useQuery`/`.useMutation`)を`useEffect`+`useState`+`try/catch`のplain asyncパターンに置き換え。あわせてDB列(snake_case)とズレていた旧camelCaseフィールドアクセス(例: `m.imageUrl`)をすべて実列名(`m.image_url`等)に修正。
  - `HistoryDetail.tsx`で発覚したバグを合わせて修正: `params.id`を`parseInt()`で数値化していたが、実テーブルの主キーはUUID文字列であり、この変換により再調整・詳細表示が機能しない状態だった。文字列のまま扱うよう修正。
  - `client/src/main.tsx`から`trpc.Provider`/`QueryClientProvider`/`httpBatchLink`を削除し、`<App />`を直接レンダーするだけに簡素化(PWA Service Worker登録は維持)。
  - `package.json`のscriptsを姉妹アプリと同じ形(`dev`/`build`/`start`/`preview`/`check`/`format`)に統一し、`test`/`db:push`を削除。使われなくなった依存関係(`express`, `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`, `drizzle-orm`, `drizzle-kit`, `mysql2`, `dotenv`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@types/express`, `tsx`)を削除。
  - `npm run check`(tsc --noEmit)・`npm run build`(vite build)ともに成功を確認済み。既存の自動テストはすべて`server/**`配下(削除対象そのもの)にのみ存在しており、対象コード(`MeasurementWidget.tsx`/`measurementEngine.ts`)側の既存テストは元々無かったため、`npm run test`に相当するテストは今回の変更後は存在しない。
- **画像アセット未解決(2026-08-26 CP2で暫定対応済み、下記参照)**:
  - `Home.tsx`/`Measure.tsx`が参照していた`/manus-storage/spiral-turn-logo_...webp`と`/manus-storage/foot-template-v3_...png`(足の図テンプレート画像)は、旧`server/_core/storageProxy.ts`(Manus Forge S3への307リダイレクト)経由でのみ配信されていた。このExpressルートも本番のVercel設定では元々機能しておらず(CP0時点で既に静的サイト化されていたため)、これらの画像は**移行前から本番で404していた可能性が高い**。今回のserver/削除でこの導線も完全になくなるため、画像の実体データ(本人が別途提供予定)が届き次第、`client/public/`の該当ファイルを差し替えること。

### CP2 (2026-08-26 画像アセットの暫定プレースホルダー対応)
- コミット: `4ae8cb9`
- 内容: CP1で404のまま残っていた2つの画像参照を、`/manus-storage/...`から`client/public/`配下の自前SVGプレースホルダーに差し替え、フェッチ失敗が起きない状態にした。
  - `client/public/spiral-turn-logo.svg`(ヘッダーロゴ、ブランドピンク`#D62598`でテキスト表示のみ)
  - `client/public/foot-template.svg`(計測結果画面の「足の図」背景テンプレート。`drawFootDiagram`関数が座標をハードコードで前提にしている元PNGサイズ1475×1751に合わせてSVGのwidth/heightを設定し、「テンプレート画像 準備中」と表示)
  - 本人から実画像(ロゴ・足の図テンプレート)を受け取り次第、同じファイルパスの中身を差し替えるだけで反映される(コード変更不要)。

### CP3 (2026-08-27 計測結果保存を改訂履歴RPC経由に変更 着手前)
- コミット: `4d2a84c`(CP2記録時点と同じ、今回の作業着手前のベースライン)
- 内容: 本日、customer-mgmt-consoleの`upload_revisions`と同じ「上書き禁止・追記型」改訂履歴パターンを`foot_measurements`/`foot_analyses`にも適用するマイグレーション(`customer-mgmt-console/supabase_migrations/004_measurement_and_analysis_revision_history.sql`、本人が別途Supabaseで手動実行予定)に合わせて、`calculateAndSaveMeasurement`をRPC呼び出しに変更する作業に着手。

### CP4 (2026-08-27 calculateAndSaveMeasurementをRPC update_foot_measurement_with_history経由に変更)
- コミット: `35c5dae`
- 内容: `client/src/lib/supabase.ts`の`calculateAndSaveMeasurement`を、`foot_measurements`への直接updateから、新設RPC`update_foot_measurement_with_history`(呼び出し前の行をfoot_measurement_revisionsへスナップショットしてから更新)の呼び出しに変更。渡すpatchの内容(points_json/flex_unit1_json/flex_unit2_json/left・right_foot_length/left・right_foot_width/left・right_heel_to_mp/regression_result_json/status/paper_type/footConditionの各列)は変更なし。`p_changed_by_type='staff'`固定、`p_changed_by_id`は`operatorAuthUserId`が渡された場合のみ`fetchCurrentMember`で解決(`markProductionWorkflowMeasureDone`と同じロジックを流用、無ければnull)、`p_change_reason`は固定文言。新規下書きの初回保存でもこのRPCで問題なく動作する(スナップショットが空の初期状態になるだけ)ため特別分岐は追加していない。
  - `npm run check`(tsc --noEmit)・`npm run build`(vite build)ともに成功を確認済み。
  - **範囲外(本人指定)**: customer-mgmt-console側(`saveDetectedSigns`/`completeFootAnalysis`のRPC化、顧客詳細画面への計測結果サマリー・測り直しボタン・変更履歴UI追加)は、このエージェントが`foot-measure`リポジトリ専用のworktreeに隔離されているため、この場では実施できず別途対応が必要(詳細はタスク完了報告を参照)。

### CP5 (2026-08-28 認証をコード直接入力方式へ統一 / S2 の3本目)
- コミット(着手前): `1d04a86`("docs: CP4にコミットハッシュを記録")
- Vercel Production(着手前): `foot-measure-16028lw1y`(公開URL `https://foot-measure.vercel.app`)
- 背景: dealer-insole-order(CP3)・dealer-mgmt-console(CP4)と同じ。メール内マジックリンクがモバイルで機能しない問題(アプリ内ブラウザにセッション隔離 / Gmail の URL 先読みでトークン消費)を、認証を持つ全アプリへ横展開する S2 の3本目。dealer-insole-order で実機ログイン確認済み。
- 変更内容:
  - `client/src/lib/supabase.ts`: `verifyOtpCode(email, token)` を新設(`supabase.auth.verifyOtp({ type: 'email' })`)。既存 `sendMagicLink` に `shouldCreateUser: false` を追加(**これまで未指定=true だった**。foot-measure は社内の足計測担当のみが使うため、事前登録済みメールに限定する)。`emailRedirectTo` は保険で残置。2026-08-28 失敗史の注釈を追加。
  - `client/src/contexts/AuthContext.tsx`: `verifyOtpCode` を context に追加(`lib/supabase.ts` の関数を薄くラップ。既存 `sendMagicLink` と同じスタイルで throw する)。
  - `client/src/pages/Login.tsx`: 「送信 → 完了画面」から「送信 → 確認コード入力 → verifyOtp」の2ステップへ。コード欄は数字のみ・桁数寛容(4〜10、Email OTP Length 設定に追従)。案内文を「メール記載のコードを入力。リンクは使わない」に変更。ダークテーマ・Ruler アイコンは踏襲。
- DB/RLS への影響: なし(`verifyOtp` は RLS を通らない。migration 不要)。
- ビルド: `npx vite build` 成功。`npx tsc --noEmit` = **エラー0件**(変更3ファイル含め全体クリーン)。
- 戻し方: Vercel → foot-measure → Deployments で `16028lw1y`(着手前の本番)を Promote to Production。またはコミット `1d04a86` へ `git reset --hard`(要・複数回許可)。

### CP6 (2026-08-28 ホーム画面にサインアウトボタンを追加)
- コミット(着手前): CP5 の push 済みコミット `d7bc9a0`
- 背景: これまで foot-measure にはサインアウト手段が UI 上に無かった(`AuthContext.signOut` は実装済みだが未接続)。冨永社長の依頼で追加。
- 変更内容: `client/src/pages/Home.tsx` のヘッダー(オンライン/オフライン切替ボタンの隣)に「サインアウト」ボタンを追加。`useAuth().signOut()` を呼ぶだけ。セッション破棄 → `onAuthStateChange` 発火 → `App.tsx` の `AuthGuard` が自動的に `<Login />` を表示するため、画面遷移コードは持たない。処理中は spinner 表示、`title` にログイン中メールを出す。狭幅では文字ラベルを隠しアイコンのみ(`sm:inline`)。
- DB/RLS への影響: なし。
- ビルド: `npx vite build` 成功 / `tsc --noEmit` Home.tsx エラーなし。
- 戻し方: この機能のみ戻すなら該当コミットを `git revert`。全体は CP5 と同じく `16028lw1y` を Promote。

### CP7 (2026-09-01 サインインの確認コード送信にクールダウンを追加)
- コミット(着手前): `6e5d399`("feat: ホーム画面にサインアウトボタンを追加")
- Vercel Production(着手前): `foot-measure-feod5cx1a`(公開URL `https://foot-measure.vercel.app`)
- 背景: Supabase Auth は同一メール宛の確認コード再送を約10秒間ブロックする(ホスティング版の固定値・ダッシュボードで変更不可)。従来はこのとき英語のレート制限メッセージを toast でそのまま表示していたため、「別 Google アカウントで誤ログイン → すぐ正しいアカウントで送り直す」等の正当な操作でサインインできず混乱する。冨永社長の依頼で全アプリのサインイン画面に横展開(customer-mgmt-console CP17 と同一内容)。
- 変更内容(`client/src/pages/Login.tsx` のみ):
  - `cooldown`(残り秒数)state と 1秒ごとの減算 `useEffect` を追加。定数 `RESEND_COOLDOWN_SEC = 12`。
  - `handleSendCode`: 送信成功時に `cooldown` を 12 にセット。`cooldown > 0` の間は送信せず「確認コードを送信しました。もう一度送信する場合は10秒ほどお待ちください。」を通常 toast で案内。
  - 送信エラーを `isSendRateLimitError`(HTTP 429 か "after N seconds" 文言)で仕分け。レート制限なら英語を出さず上記の日本語案内 + `cooldown` セット。それ以外は従来どおり実エラー表示。
  - メール入力ステップのボタン: `cooldown > 0` の間は無効化しラベルを「送信しました」に。ボタン下に同じ案内文を表示。数字カウントダウンは出さない(冨永社長の指定)。
- DB/RLS への影響: なし(フロントの状態管理のみ)。
- ビルド: `npx tsc --noEmit` = エラー0件 / `npx vite build` = 成功(2026-09-01 実行、PWA 再生成含む)。
- 戻し方: Vercel → foot-measure → Deployments で `feod5cx1a`(着手前の本番)を Promote to Production。またはコミット `6e5d399` へ戻す(要・複数回許可)。
