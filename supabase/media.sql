-- 賽事照片：英雄榜每場賽事可以放照片（主辦上傳，所有人可瀏覽），每場可選一張當年度封面橫幅。
-- 在 Supabase 後台 → SQL Editor 貼上整段，按 Run。可以重複執行。
-- 需要先執行過 people.sql（會用到裡面的 people_is_organizer 函式）。

create table if not exists public.event_media (
  id          uuid primary key default gen_random_uuid(),
  year        int  not null check (year between 2000 and 2100),
  event       text not null default '' check (char_length(event) <= 30),
  path        text not null,            -- 大圖在儲存桶裡的路徑
  thumb_path  text not null,            -- 縮圖路徑
  caption     text not null default '' check (char_length(caption) <= 60),
  is_cover    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists event_media_event_idx on public.event_media (year, event);
-- 同一場賽事最多只有一張封面
create unique index if not exists event_media_cover_idx on public.event_media (year, event) where is_cover;

alter table public.event_media enable row level security;
drop policy if exists "media public read" on public.event_media;
create policy "media public read" on public.event_media for select using (true);
drop policy if exists "media organizer write" on public.event_media;
create policy "media organizer write" on public.event_media for all to authenticated
  using (public.people_is_organizer()) with check (public.people_is_organizer());

-- 照片儲存桶（公開讀取、主辦寫入）
insert into storage.buckets (id, name, public) values ('event-media', 'event-media', true)
on conflict (id) do nothing;

drop policy if exists "event media public read" on storage.objects;
create policy "event media public read" on storage.objects
  for select using (bucket_id = 'event-media');
drop policy if exists "event media organizer write" on storage.objects;
create policy "event media organizer write" on storage.objects
  for all to authenticated
  using (bucket_id = 'event-media' and public.people_is_organizer())
  with check (bucket_id = 'event-media' and public.people_is_organizer());
