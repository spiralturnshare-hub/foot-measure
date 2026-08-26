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
- **未解決・要フォローアップ(本人確認が必要)**:
  - `Home.tsx`/`Measure.tsx`が参照している`/manus-storage/spiral-turn-logo_...webp`と`/manus-storage/foot-template-v3_...png`(足の図テンプレート画像)は、旧`server/_core/storageProxy.ts`(Manus Forge S3への307リダイレクト)経由でのみ配信されていた。このExpressルートも本番のVercel設定では元々機能しておらず(CP0時点で既に静的サイト化されていたため)、これらの画像は**移行前から本番で404していた可能性が高い**。今回のserver/削除でこの导线も完全になくなるため、正常表示させるには、この2枚の画像ファイルをSupabase Storageまたは`client/public/`に配置し直し、参照URLを更新する追加作業が別途必要(画像の実体データを保有していないため今回のタスク範囲では対応不可)。
