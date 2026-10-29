# 選手資料庫（中龍鋼鐵）

單打賽、雙打賽、團體賽共用的選手資料庫：姓名、單位、頭銜與照片。只有主辦登入後才能瀏覽與編輯。

- 資料存在 Supabase 的 `people` 資料表（以姓名識別），照片放在 `people-photos` 儲存空間。
- 第一次使用前，請在 Supabase 的 SQL Editor 執行 `supabase/people.sql`。
- 三個比賽系統：`singles-tournament`、`DSC-table-tennis`、`team-lineup`。
