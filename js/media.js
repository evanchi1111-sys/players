// 賽事照片（英雄榜專用）：資料表 event_media ＋ 儲存桶 event-media。
// 每張照片存兩份：大圖（長邊 1600px，點開看）與縮圖（長邊 480px，列表用），省流量。
export const MEDIA_BUCKET = 'event-media';
export const MAX_PER_EVENT = 30;

// 縮到長邊 maxEdge（不放大），轉成 JPEG
export async function resizeImage(source, maxEdge, quality = 0.82) {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('照片處理失敗'))), 'image/jpeg', quality));
}

const friendly = (error) => {
  const msg = String(error?.message || error || '');
  if (/relation .*event_media.* does not exist|could not find the table|schema cache/i.test(msg)) return new Error('賽事照片尚未建立，請先在 Supabase 執行 media.sql');
  if (/bucket not found/i.test(msg)) return new Error('照片儲存空間尚未建立，請先在 Supabase 執行 media.sql');
  if (/row-level security|permission denied|42501/i.test(msg) || error?.code === '42501') return new Error('沒有寫入權限，請重新登入主辦帳號');
  return new Error(msg || '發生未知錯誤');
};

// 連到 Supabase 的版本。列表項目：{ id, year, event, url, thumb, caption, is_cover, created_at }
export function mediaApi(sb) {
  const pub = (path) => sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const same = (q, year, event) => q.eq('year', year).eq('event', event);
  return {
    async load() {
      const { data, error } = await sb.from('event_media').select('*').order('created_at');
      if (error) return [];
      return data.map((r) => ({ id: r.id, year: r.year, event: r.event, url: pub(r.path), thumb: pub(r.thumb_path), path: r.path, thumb_path: r.thumb_path, caption: r.caption, is_cover: r.is_cover, created_at: r.created_at }));
    },
    async add(year, event, full, thumb) {
      const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      const path = `${year}/${id}.jpg`;
      const thumb_path = `${year}/${id}_t.jpg`;
      const opts = { contentType: 'image/jpeg', cacheControl: '31536000' };
      const a = await sb.storage.from(MEDIA_BUCKET).upload(path, full, opts);
      if (a.error) throw friendly(a.error);
      const b = await sb.storage.from(MEDIA_BUCKET).upload(thumb_path, thumb, opts);
      if (b.error) { await sb.storage.from(MEDIA_BUCKET).remove([path]); throw friendly(b.error); }
      const { error } = await sb.from('event_media').insert({ year, event, path, thumb_path });
      if (error) { await sb.storage.from(MEDIA_BUCKET).remove([path, thumb_path]); throw friendly(error); }
    },
    async remove(item) {
      const { data, error } = await sb.from('event_media').delete().eq('id', item.id).select();
      if (error) throw friendly(error);
      if (!data?.length) throw new Error('沒有刪除到任何資料，請重新登入主辦帳號');
      await sb.storage.from(MEDIA_BUCKET).remove([item.path, item.thumb_path]);
    },
    // 設為封面（已經是封面就取消）。同一場只能有一張，所以先清掉再設
    async setCover(item, on) {
      const clear = await same(sb.from('event_media').update({ is_cover: false }), item.year, item.event);
      if (clear.error) throw friendly(clear.error);
      if (!on) return;
      const { error } = await sb.from('event_media').update({ is_cover: true }).eq('id', item.id);
      if (error) throw friendly(error);
    },
    async setCaption(item, caption) {
      const { error } = await sb.from('event_media').update({ caption }).eq('id', item.id);
      if (error) throw friendly(error);
    },
  };
}

// 示範模式：資料只存在記憶體，照片用暫時網址
export function demoMediaApi(seed = []) {
  let rows = seed.map((r, i) => ({ id: `dm-${i}`, caption: '', is_cover: false, created_at: new Date(2026, 0, 1, 0, i).toISOString(), ...r }));
  return {
    async load() { return rows.map((r) => ({ ...r })); },
    async add(year, event, full, thumb) {
      rows.push({ id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, year, event, url: URL.createObjectURL(full), thumb: URL.createObjectURL(thumb), caption: '', is_cover: false, created_at: new Date().toISOString() });
    },
    async remove(item) { rows = rows.filter((r) => r.id !== item.id); },
    async setCover(item, on) {
      rows.forEach((r) => { if (r.year === item.year && r.event === item.event) r.is_cover = on && r.id === item.id; });
    },
    async setCaption(item, caption) { const r = rows.find((x) => x.id === item.id); if (r) r.caption = caption; },
  };
}

// 示範用的假照片：漸層底色加文字，免得預覽時要找真照片
export function demoPhoto(text, hue, w = 900, h = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 60% 55%)`);
  g.addColorStop(1, `hsl(${(hue + 50) % 360} 65% 30%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.3, h * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h / 9)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h * 0.58);
  return canvas.toDataURL('image/jpeg', 0.75);
}
