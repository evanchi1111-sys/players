// 英雄榜：彙整各年度、各項比賽的冠軍、亞軍、季軍（資料來自「存入選手成績」寫進 results 資料表）。
// 任何人都可以瀏覽（results、people 資料表本來就是公開可讀），不需要登入；主辦登入後才會多出導覽列。
import { SUPABASE_URL, SUPABASE_ANON_KEY, ORGANIZER_EMAIL } from './config.js';
import { mediaApi, demoMediaApi, demoPhoto, resizeImage, MAX_PER_EVENT } from './media.js?v=20261102b';
import { avatar, profileOf, peopleApi, demoPeopleApi, resultsApi, demoResultsApi, archiveApi, demoArchiveApi, SYSTEM_LABEL, DIVISION_LABEL, PLACE_LABEL } from './people.js?v=20261030i';

const demo = new URLSearchParams(location.search).has('demo');
const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ORDER = ['singles', 'doubles', 'team'];
// 從比賽網頁點進來時顯示「返回比賽」（直接開網址就不顯示）
const cameFromSite = (() => { try { return !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch { return false; } })();
const archiveKey = (system, division, year, event) => [system, division, year, event || ''].join('|');

const state = { loaded: false, error: null, rows: [], people: {}, archives: new Map(), open: new Set(), year: 'all', system: 'all', division: 'all', media: [], openMedia: new Set(), org: false, uploading: '', lb: null };
let api = { media: null, signIn: async () => {}, signOut: async () => {} }; // 照片與登入（依示範／正式模式在 load() 裡設定）
const mediaKey = (year, event) => `${year}|${event === '（未命名賽事）' ? '' : event}`;
const splitKey = (key) => { const i = key.indexOf('|'); return [Number(key.slice(0, i)), key.slice(i + 1)]; };
const mediaOf = (key) => state.media.filter((m) => mediaKey(m.year, m.event) === key);

// ---------------------------------------------------------------- 資料

async function load() {
  if (demo) {
    const seedPeople = {};
    ['陳志明', '林建宏', '黃俊傑', '許家銘', '郭建志', '王小明', '李大華', '陳志強', '蔡明哲', '周子豪', '楊博文', '張美玲', '黃淑芬'].forEach((n, i) => {
      seedPeople[n] = { name: n, unit: ['台北市桌球協會', '新北市桌球隊', '台中市體育會'][i % 3], title: i % 4 === 0 ? '隊長' : '選手', photo_url: null };
    });
    const seed = [
      ...[['陳志明', 1], ['林建宏', 2], ['黃俊傑', 3]].map(([name, place]) => ({ name, year: 2026, system: 'singles', division: 'competitive', place, detail: null, event: '2026 春季盃' })),
      ...[['許家銘', 1], ['郭建志', 2], ['周子豪', 3]].map(([name, place]) => ({ name, year: 2026, system: 'singles', division: 'fun', place, detail: null, event: '2026 春季盃' })),
      ...[['王小明', 1, '李大華'], ['李大華', 1, '王小明'], ['陳志強', 2, '林建宏'], ['林建宏', 2, '陳志強'], ['張美玲', 3, '黃淑芬'], ['黃淑芬', 3, '張美玲']]
        .map(([name, place, mate]) => ({ name, year: 2026, system: 'doubles', division: 'competitive', place, detail: `與 ${mate} 搭檔`, event: '2026 春季盃' })),
      ...[['陳志明', 1, '東區鐵人'], ['蔡明哲', 1, '東區鐵人'], ['楊博文', 2, '西區旋風'], ['周子豪', 2, '西區旋風'], ['黃俊傑', 3, '南港飛龍']]
        .map(([name, place, team]) => ({ name, year: 2025, system: 'team', division: '', place, detail: team, event: '2025 團體賽' })),
      ...[['林建宏', 1], ['陳志明', 2], ['黃俊傑', 3]].map(([name, place]) => ({ name, year: 2025, system: 'singles', division: 'competitive', place, detail: null, event: '2025 秋季盃' })),
      ...[['陳志明', 1], ['許家銘', 2], ['林建宏', 3]].map(([name, place]) => ({ name, year: 2024, system: 'singles', division: 'competitive', place, detail: null, event: '2024 秋季盃' })),
    ];
    state.people = await demoPeopleApi(seedPeople).load();
    state.rows = Object.values(await demoResultsApi(seed).load()).flat();
    const demoSnap = {
      formatLabel: '單淘汰賽・三局兩勝',
      placings: [{ place: 1, name: '陳志明' }, { place: 2, name: '林建宏' }, { place: 3, name: '黃俊傑' }],
      tables: [],
      matches: [
        { stage: '單淘汰賽', round: '準決賽', p1: '陳志明', p2: '黃俊傑', score: '2 : 0', games: '11:6、11:8', winner: '陳志明' },
        { stage: '單淘汰賽', round: '準決賽', p1: '林建宏', p2: '周子豪', score: '2 : 1', games: '9:11、11:7、11:5', winner: '林建宏' },
        { stage: '單淘汰賽', round: '決賽', p1: '陳志明', p2: '林建宏', score: '2 : 1', games: '11:9、8:11、11:6', winner: '陳志明' },
        { stage: '單淘汰賽', round: '季軍賽', p1: '黃俊傑', p2: '周子豪', score: '2 : 0', games: '11:4、11:9', winner: '黃俊傑' },
      ],
    };
    const demoSnap2 = {
      formatLabel: '單循環賽・三局兩勝',
      placings: [{ place: 1, name: '許家銘' }, { place: 2, name: '郭建志' }, { place: 3, name: '周子豪' }],
      tables: [{ title: '循環賽排名', head: ['名次', '選手', '勝', '敗', '局數', '得失分', '判定依據'], rows: [[1, '許家銘', 2, 0, '4:0', '44:26', '勝場數'], [2, '郭建志', 1, 1, '2:2', '36:34', '勝場數'], [3, '周子豪', 0, 2, '0:4', '24:44', '勝場數']] }],
      matches: [
        { stage: '循環賽', round: '第 1 輪', p1: '許家銘', p2: '郭建志', score: '2 : 0', games: '11:6、11:8', winner: '許家銘' },
        { stage: '循環賽', round: '第 2 輪', p1: '許家銘', p2: '周子豪', score: '2 : 0', games: '11:5、11:7', winner: '許家銘' },
        { stage: '循環賽', round: '第 3 輪', p1: '郭建志', p2: '周子豪', score: '2 : 0', games: '11:9、11:8', winner: '郭建志' },
      ],
    };
    const archives = await demoArchiveApi([
      { system: 'singles', division: 'competitive', year: 2026, event: '2026 春季盃', snapshot: demoSnap },
      { system: 'singles', division: 'fun', year: 2026, event: '2026 春季盃', snapshot: demoSnap2 },
    ]).load();
    state.archives = new Map(archives.map((a) => [archiveKey(a.system, a.division, a.year, a.event), a.snapshot]));
    const shots = [['2026 春季盃', 2026, ['開幕式', '決賽現場', '頒獎', '大合照', '熱身', '雙打對決', '觀眾加油', '裁判長'], 210, 3], ['2025 秋季盃', 2025, ['決賽', '頒獎', '合影', '賽前', '精彩一球'], 20, 1], ['2025 團體賽', 2025, ['隊伍合照', '決賽', '頒獎'], 120, -1]];
    const seedMedia = [];
    for (const [event, year, caps, hue, cover] of shots) {
      for (let i = 0; i < caps.length; i++) {
        const url = demoPhoto(`${event} ${caps[i]}`, (hue + i * 17) % 360, i % 3 === 1 ? 600 : 900, i % 3 === 1 ? 750 : 600);
        seedMedia.push({ year, event, url, thumb: url, caption: caps[i], is_cover: i === cover });
      }
    }
    const demoMedia = demoMediaApi(seedMedia);
    state.media = await demoMedia.load();
    state.org = (() => { try { return !!sessionStorage.getItem('demo_organizer'); } catch { return false; } })();
    api = {
      media: demoMedia,
      signIn: async (pw) => { if (pw !== 'demo1234') throw new Error('密碼錯誤'); try { sessionStorage.setItem('demo_organizer', '1'); } catch { /* 忽略 */ } },
      signOut: async () => { try { sessionStorage.removeItem('demo_organizer'); } catch { /* 忽略 */ } },
      demoPassword: 'demo1234',
    };
    return;
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const media = mediaApi(sb);
  api = {
    media,
    signIn: async (pw) => { const { error } = await sb.auth.signInWithPassword({ email: ORGANIZER_EMAIL, password: pw }); if (error) throw new Error(/invalid login/i.test(error.message) ? '密碼錯誤' : error.message); },
    signOut: async () => { await sb.auth.signOut(); },
  };
  const [people, results, archives, mediaList] = await Promise.all([peopleApi(sb).load().catch(() => ({})), resultsApi(sb).load(), archiveApi(sb).load().catch(() => []), media.load().catch(() => [])]);
  state.people = people;
  state.media = mediaList;
  state.rows = Object.values(results).flat();
  state.archives = new Map(archives.map((a) => [archiveKey(a.system, a.division, a.year, a.event), a.snapshot]));
  try {
    const { data } = await sb.auth.getSession();
    state.org = (data.session?.user?.email || '').toLowerCase() === ORGANIZER_EMAIL.toLowerCase();
    organizer(state.org);
  } catch { /* 忽略 */ }
}

// 通知共用導覽列：只有主辦看得到
function organizer(isOrg) { document.dispatchEvent(new CustomEvent('site-organizer', { detail: isOrg })); }

// ---------------------------------------------------------------- 彙整

const visibleRows = () => state.rows.filter((r) => (state.year === 'all' || r.year === Number(state.year)) && (state.system === 'all' || r.system === state.system) && (state.division === 'all' || r.division === state.division));

// 一個名次底下的「得獎者」：單打每人一筆、雙打兩人一組、團體賽以隊名為一組
function entriesOf(system, rows) {
  if (system === 'team') {
    const byTeam = new Map();
    for (const r of rows) byTeam.set(r.detail || '（未填隊名）', [...(byTeam.get(r.detail || '（未填隊名）') || []), r.name]);
    return [...byTeam].map(([team, names]) => ({ title: team, names, team: true }));
  }
  if (system === 'doubles') {
    const seen = new Map();
    for (const r of rows) {
      const mate = (r.detail || '').match(/與\s*(.+?)\s*搭檔/)?.[1];
      const key = [r.name, mate].filter(Boolean).sort().join('\u0000');
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(r.name);
      if (mate) seen.get(key).add(mate);
    }
    return [...seen.values()].map((set) => ({ title: [...set].join(' & '), names: [...set] }));
  }
  return rows.map((r) => ({ title: r.name, names: [r.name] }));
}

function buildYears() {
  const years = new Map();
  for (const r of visibleRows()) {
    const events = years.get(r.year) || years.set(r.year, new Map()).get(r.year);
    const key = r.event || '（未命名賽事）';
    const blocks = events.get(key) || events.set(key, new Map()).get(key);
    const bkey = `${r.system}|${r.division}`;
    const block = blocks.get(bkey) || blocks.set(bkey, { system: r.system, division: r.division, places: { 1: [], 2: [], 3: [] } }).get(bkey);
    block.places[r.place]?.push(r);
  }
  // 只有照片、還沒存入成績的賽事也要出現（只在沒篩選項目時）
  if (state.system === 'all' && state.division === 'all') {
    for (const m of state.media) {
      if (state.year !== 'all' && m.year !== Number(state.year)) continue;
      const events = years.get(m.year) || years.set(m.year, new Map()).get(m.year);
      const key = m.event || '（未命名賽事）';
      if (!events.has(key)) events.set(key, new Map());
    }
  }
  return [...years].sort((a, b) => b[0] - a[0]);
}

// 獎牌榜依組別分開計算：競賽組、歡樂成長組、團體賽（沒有組別）各一份，避免不同組別的選手混在同一份名次
function medalTables() {
  const groups = new Map();
  for (const r of visibleRows()) {
    const g = groups.get(r.division || '') || groups.set(r.division || '', new Map()).get(r.division || '');
    const t = g.get(r.name) || g.set(r.name, { name: r.name, 1: 0, 2: 0, 3: 0 }).get(r.name);
    t[r.place]++;
  }
  const order = ['competitive', 'fun', ''];
  return [...groups].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99).map(([division, tally]) => ({
    division,
    label: division ? (DIVISION_LABEL[division] || division) : '團體賽',
    list: [...tally.values()].sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 10),
  }));
}

// ---------------------------------------------------------------- 畫面

const person = (name) => profileOf(state.people, name);
const unitsOf = (names) => [...new Set(names.map((n) => person(n).unit).filter(Boolean))].join('、');

function entryHtml(place, e) {
  const sub = e.team ? e.names.join('、') : unitsOf(e.names);
  return `
    <li class="hall-win place-${place}">
      <span class="hall-medal" aria-label="${PLACE_LABEL[place]}">${MEDAL[place]}</span>
      <span class="pair">${e.names.slice(0, 4).map((n) => avatar(person(n), 'sm')).join('')}</span>
      <span class="hall-who"><b>${esc(e.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    </li>`;
}

// 賽事封存的完整結果：排名表 ＋ 每場比分
function archiveHtml(snap) {
  const tables = (snap.tables || []).filter((t) => t.rows?.length).map((t) => `
    <h5>${esc(t.title)}</h5>
    <div class="table-wrap"><table class="rank-table"><thead><tr>${t.head.map((h, i) => `<th class="${i === 1 ? 'left' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 1 ? 'left' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  const stages = new Map();
  for (const m of snap.matches || []) {
    const list = stages.get(m.stage) || stages.set(m.stage, []).get(m.stage);
    list.push(m);
  }
  const matches = [...stages].map(([stage, list]) => `
    <h5>${esc(stage)}</h5>
    <ul class="hall-matches">${list.map((m) => `
      <li><span class="hm-round">${esc(m.round)}</span>
        <span class="hm-vs"><b class="${m.winner === m.p1 ? 'w' : ''}">${esc(m.p1)}</b><span class="hm-score">${esc(m.score)}</span><b class="${m.winner === m.p2 ? 'w' : ''}">${esc(m.p2)}</b></span>
        ${m.games ? `<small>${esc(m.games)}</small>` : ''}
        ${(m.lines || []).map((l) => `<small>${esc(l)}</small>`).join('')}</li>`).join('')}</ul>`).join('');
  return `<div class="hall-archive">${snap.formatLabel ? `<p class="note">${esc(snap.formatLabel)}</p>` : ''}${tables}${matches}</div>`;
}

function blockHtml(block, year, event) {
  const label = `${SYSTEM_LABEL[block.system] || block.system}${block.division ? `・${DIVISION_LABEL[block.division] || block.division}` : ''}`;
  const items = [1, 2, 3].flatMap((p) => entriesOf(block.system, block.places[p]).map((e) => entryHtml(p, e)));
  const key = archiveKey(block.system, block.division, year, event === '（未命名賽事）' ? '' : event);
  const snap = state.archives.get(key);
  const open = state.open.has(key);
  return `<div class="hall-block"><h4>${esc(label)}</h4><ul class="hall-list">${items.join('')}</ul>
    ${snap ? `<button type="button" class="btn small hall-toggle" data-toggle="${esc(key)}" aria-expanded="${open}">${open ? '收合完整結果 ▲' : '查看完整結果 ▼'}</button>${open ? archiveHtml(snap) : ''}` : ''}</div>`;
}

// 年度封面橫幅：這一年各場賽事選的封面，多張時可左右滑動
function bannerHtml(year, events) {
  const covers = [...events.keys()].map((event) => ({ event, item: mediaOf(mediaKey(year, event)).find((m) => m.is_cover) })).filter((c) => c.item);
  if (!covers.length) return '';
  return `<div class="hall-banner" aria-label="${year} 年封面">${covers.map(({ event, item }) => `
    <button type="button" class="hb-slide" data-lb="${esc(mediaKey(year, event))}" data-id="${esc(item.id)}" aria-label="查看 ${esc(event)} 的照片">
      <img src="${esc(item.url)}" alt="${esc(item.caption || event)}" loading="lazy">
      <span class="hb-cap"><b>${esc(event)}</b>${item.caption ? `<small>${esc(item.caption)}</small>` : ''}</span>
    </button>`).join('')}</div>`;
}

// 賽事照片：縮圖格（展開才載入）；主辦多出新增、設封面、說明、刪除
function mediaHtml(year, event) {
  const key = mediaKey(year, event);
  const items = mediaOf(key);
  if (!items.length && !state.org) return '';
  const open = state.openMedia.has(key);
  const busy = state.uploading === key;
  return `<div class="hall-media">
    <div class="hm-bar">
      ${items.length ? `<button type="button" class="btn small hall-toggle" data-media-toggle="${esc(key)}" aria-expanded="${open}">📷 賽事照片 ${items.length} ${open ? '▲' : '▼'}</button>` : ''}
      ${state.org ? `<label class="btn small primary hm-add ${busy ? 'is-busy' : ''}">${busy ? '上傳中…' : '➕ 新增照片'}<input type="file" accept="image/*" multiple hidden data-upload="${esc(key)}" ${busy ? 'disabled' : ''}></label><small class="hm-quota">${items.length} / ${MAX_PER_EVENT} 張</small>` : ''}
    </div>
    ${open && items.length ? `<ul class="hm-grid">${items.map((m, i) => `
      <li>
        <button type="button" class="hm-thumb" data-lb="${esc(key)}" data-i="${i}" aria-label="放大第 ${i + 1} 張照片"><img src="${esc(m.thumb)}" alt="${esc(m.caption || '')}" loading="lazy">${m.is_cover ? '<span class="hm-star">★ 封面</span>' : ''}${m.caption ? `<span class="hm-cap">${esc(m.caption)}</span>` : ''}</button>
        ${state.org ? `<div class="hm-tools"><button type="button" data-cover="${esc(m.id)}" title="${m.is_cover ? '取消封面' : '設為年度封面'}" aria-label="${m.is_cover ? '取消封面' : '設為年度封面'}">${m.is_cover ? '★' : '☆'}</button><button type="button" data-caption="${esc(m.id)}" title="修改說明" aria-label="修改說明">✎</button><button type="button" data-del-media="${esc(m.id)}" title="刪除" aria-label="刪除這張照片">✕</button></div>` : ''}
      </li>`).join('')}</ul>` : ''}
  </div>`;
}

// 主辦：還沒存入成績的賽事也可以先建相簿
function albumBtn() {
  return state.org ? '<div class="hall-album-bar"><button type="button" class="btn primary" data-action="new-album">➕ 新增賽事相簿</button><small>賽事還沒存入成績，也可以先放照片。</small></div>' : '';
}

function render() {
  const all = state.rows;
  const years = [...new Set([...all.map((r) => r.year), ...state.media.map((m) => m.year)])].sort((a, b) => b - a);
  const chip = (kind, value, label) => `<button type="button" class="${String(state[kind]) === String(value) ? 'on' : ''}" data-filter="${kind}" data-value="${value}">${esc(label)}</button>`;
  const grouped = buildYears();
  const medalSets = medalTables();
  app.innerHTML = `
    <header class="topbar">
      <div class="container topbar-inner">
        <div class="brand">
          <img class="brand-logo" src="img/logo-glow-96.png" srcset="img/logo-glow-96.png 1x, img/logo-glow-192.png 2x" width="46" height="46" alt="中龍鋼鐵">
          <div><h1>中龍鋼鐵桌球社 英雄榜</h1><p class="live">歷年各項比賽前三名</p></div>
        </div>
        <div class="hall-head-actions">
          ${cameFromSite ? '<button type="button" class="btn small" data-back>← 返回比賽</button>' : ''}
          ${state.loaded && !state.error ? (state.org ? '<button type="button" class="btn small" data-action="logout">登出主辦</button>' : '<button type="button" class="btn small" data-action="login">主辦登入</button>') : ''}
        </div>
      </div>
    </header>
    <main class="container">
      ${demo ? '<div class="banner demo">🧪 示範模式：這是範例資料，不是真正的成績。</div>' : ''}
      ${!state.loaded ? '<div class="center-card"><div class="spinner" aria-hidden="true"></div><p>載入中…</p></div>'
        : state.error ? `<div class="center-card"><h2>無法讀取資料</h2><p>${esc(state.error)}</p><button class="btn primary" data-action="retry">重新載入</button></div>`
        : !all.length && !state.media.length ? `${albumBtn()}<div class="empty"><span aria-hidden="true">🏆</span><p>還沒有成績紀錄。比賽結束後，由主辦按「存入選手成績」，這裡就會出現。</p></div>`
        : `
      ${albumBtn()}
      <section class="card">
        <div class="hall-filters">
          <div class="hub-filter" aria-label="年度">${chip('year', 'all', '全部年度')}${years.map((y) => chip('year', y, `${y} 年`)).join('')}</div>
          <div class="hub-filter" aria-label="項目">${chip('system', 'all', '全部項目')}${Object.entries(SYSTEM_LABEL).map(([k, l]) => chip('system', k, l)).join('')}</div>
          <div class="hub-filter" aria-label="組別">${chip('division', 'all', '全部組別')}${Object.entries(DIVISION_LABEL).map(([k, l]) => chip('division', k, l)).join('')}</div>
        </div>
      </section>
      ${!grouped.length ? '<div class="empty"><span aria-hidden="true">🏆</span><p>這個條件下沒有成績紀錄。</p></div>' : `
      ${medalSets.map((set) => `<section class="card hall-medals">
        <h3>🏅 ${esc(set.label)} 獎牌榜 <small>前 ${set.list.length} 名</small></h3>
        <ol class="hall-medal-list">${set.list.map((m, i) => `
          <li><span class="no">${i + 1}</span>${avatar(person(m.name), 'sm')}
            <span class="hall-who"><b>${esc(m.name)}</b>${person(m.name).unit ? `<small>${esc(person(m.name).unit)}</small>` : ''}</span>
            <span class="hall-count"><span>🥇 ${m[1]}</span><span>🥈 ${m[2]}</span><span>🥉 ${m[3]}</span></span></li>`).join('')}</ol>
      </section>`).join('')}
      ${grouped.map(([year, events]) => `
        <section class="hall-year">
          <h2>${year} 年</h2>
          ${bannerHtml(year, events)}
          ${[...events].map(([event, blocks]) => `
            <article class="card hall-event">
              <h3>${esc(event)}</h3>
              ${blocks.size ? '' : '<p class="note">這場賽事的成績還沒存入，目前只有照片。</p>'}
              <div class="hall-blocks">${[...blocks.values()].sort((a, b) => ORDER.indexOf(a.system) - ORDER.indexOf(b.system) || (a.division === 'competitive' ? 0 : 1) - (b.division === 'competitive' ? 0 : 1)).map((b) => blockHtml(b, year, event)).join('')}</div>
              ${mediaHtml(year, event)}
            </article>`).join('')}
        </section>`).join('')}`}`}
    </main>`;
}

// ---------------------------------------------------------------- 提示、對話框、大圖檢視

const toastEl = document.getElementById('toast');
let toastTimer;
function toast(message, kind = 'info') {
  toastEl.textContent = message;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3200);
}

const modalRoot = document.getElementById('modal-root');
function openModal(html, onReady) {
  const previousFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = modalRoot.querySelector('.backdrop');
  const close = () => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey); previousFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  onReady(modalRoot.querySelector('.modal'), close);
  modalRoot.querySelector('input, button:not([data-close])')?.focus();
}

function openLogin() {
  openModal(`
    <h2>主辦登入</h2>
    <form>
      <label>帳號<input value="${esc(ORGANIZER_EMAIL)}" disabled></label>
      <label>密碼<input name="password" type="password" required autocomplete="current-password"></label>
      ${demo ? `<p class="note">示範模式主辦密碼：<b>${esc(api.demoPassword)}</b></p>` : ''}
      <p class="error" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">登入</button></div>
    </form>`,
  (modal, close) => {
    const form = modal.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.signIn(form.password.value); state.org = true; organizer(true); close(); render(); toast('已登入主辦模式，賽事卡片可以新增照片', 'ok'); }
      catch (err) { const el = form.querySelector('.error'); el.textContent = err.message; el.hidden = false; }
    });
  });
}

// 大圖檢視：左右切換（按鈕、方向鍵、手機滑動），Esc 或點空白處關閉
const lbRoot = (() => { const el = document.createElement('div'); el.id = 'lightbox'; document.body.appendChild(el); return el; })();
function renderLightbox() {
  const lb = state.lb;
  document.body.classList.toggle('lb-open', !!lb);
  if (!lb) { lbRoot.innerHTML = ''; return; }
  const m = lb.items[lb.i];
  const many = lb.items.length > 1;
  lbRoot.innerHTML = `
    <div class="lb" role="dialog" aria-modal="true" aria-label="賽事照片">
      <button type="button" class="lb-x" data-lb-close aria-label="關閉">✕</button>
      ${many ? '<button type="button" class="lb-nav lb-prev" data-lb-nav="-1" aria-label="上一張">‹</button><button type="button" class="lb-nav lb-next" data-lb-nav="1" aria-label="下一張">›</button>' : ''}
      <figure class="lb-fig"><img src="${esc(m.url)}" alt="${esc(m.caption || '')}">
        <figcaption><b>${esc(lb.title)}</b>${m.caption ? `<span>${esc(m.caption)}</span>` : ''}<small>${lb.i + 1} / ${lb.items.length}</small></figcaption></figure>
    </div>`;
}
function openLightbox(key, i) {
  const items = mediaOf(key);
  if (!items.length) return;
  state.lb = { items, i: Math.min(Math.max(i, 0), items.length - 1), title: splitKey(key)[1] || '（未命名賽事）' };
  renderLightbox();
}
const lbMove = (d) => { const lb = state.lb; if (!lb) return; lb.i = (lb.i + d + lb.items.length) % lb.items.length; renderLightbox(); };
const lbClose = () => { state.lb = null; renderLightbox(); };
lbRoot.addEventListener('click', (e) => {
  if (e.target.closest('[data-lb-nav]')) { lbMove(Number(e.target.closest('[data-lb-nav]').dataset.lbNav)); return; }
  if (e.target.closest('[data-lb-close]') || e.target.classList.contains('lb') || e.target.classList.contains('lb-fig')) lbClose();
});
document.addEventListener('keydown', (e) => {
  if (!state.lb) return;
  if (e.key === 'Escape') lbClose();
  else if (e.key === 'ArrowLeft') lbMove(-1);
  else if (e.key === 'ArrowRight') lbMove(1);
});
let touchX = null;
lbRoot.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
lbRoot.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) lbMove(dx < 0 ? 1 : -1);
});

// ---------------------------------------------------------------- 主辦：上傳、封面、說明、刪除

async function reloadMedia() { state.media = await api.media.load(); render(); }

async function uploadFiles(key, files) {
  const [year, event] = splitKey(key);
  const room = MAX_PER_EVENT - mediaOf(key).length;
  const images = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (!images.length) { toast('請選擇照片檔', 'error'); return; }
  if (room <= 0) { toast(`每場賽事最多 ${MAX_PER_EVENT} 張，請先刪除舊的照片`, 'error'); return; }
  const list = images.slice(0, room);
  state.uploading = key;
  render();
  let ok = 0;
  let lastError = '';
  for (let i = 0; i < list.length; i++) {
    toast(`上傳中 ${i + 1} / ${list.length}…`);
    try {
      const full = await resizeImage(list[i], 1600, 0.82);
      const thumb = await resizeImage(list[i], 480, 0.78);
      await api.media.add(year, event, full, thumb);
      ok++;
    } catch (err) { lastError = err.message || '照片處理失敗'; }
  }
  state.uploading = '';
  state.openMedia.add(key);
  await reloadMedia();
  const skipped = images.length - list.length;
  if (ok === list.length) toast(`已新增 ${ok} 張照片${skipped ? `（超過上限，略過 ${skipped} 張）` : ''}`, 'ok');
  else toast(`成功 ${ok} 張，失敗 ${list.length - ok} 張：${lastError}`, 'error');
}

async function mediaAction(task, okMessage) {
  try { await task(); await reloadMedia(); if (okMessage) toast(okMessage, 'ok'); }
  catch (err) { toast(err.message || '操作失敗', 'error'); }
}

app.addEventListener('change', (e) => {
  const input = e.target.closest('[data-upload]');
  if (!input) return;
  const files = [...input.files];
  input.value = '';
  if (files.length) uploadFiles(input.dataset.upload, files);
});

function openAlbum() {
  openModal(`
    <h2>新增賽事相簿</h2>
    <form>
      <label>賽事名稱（必填，例：2026 春季盃）<input name="event" maxlength="30" required autocomplete="off"></label>
      <label>年度<input name="year" type="number" min="2000" max="2100" required value="${new Date().getFullYear()}"></label>
      <label>照片（可多選）<input name="files" type="file" accept="image/*" multiple required></label>
      <p class="note">名稱與年度要和之後「存入選手成績」填的一樣，照片才會歸在同一場賽事。</p>
      <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">上傳</button></div>
    </form>`,
  (modal, close) => {
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const files = [...f.files.files];
      const event = f.event.value.trim();
      if (!event || !files.length) return;
      close();
      uploadFiles(mediaKey(Number(f.year.value), event), files);
    });
  });
}

function editCaption(item) {
  openModal(`
    <h2>照片說明</h2>
    <form>
      <label>說明（最多 60 字，可留白）<input name="caption" maxlength="60" value="${esc(item.caption)}" autocomplete="off" placeholder="例：決賽 陳志明 vs 吳宗憲"></label>
      <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">儲存</button></div>
    </form>`,
  (modal, close) => {
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const caption = e.target.caption.value.trim();
      close();
      mediaAction(() => api.media.setCaption(item, caption), '已更新說明');
    });
  });
}

function removeMedia(item) {
  openModal(`
    <h2>刪除這張照片？</h2>
    <p class="note">${esc(item.event || '（未命名賽事）')}${item.caption ? `・${esc(item.caption)}` : ''}。刪除後無法復原。</p>
    <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button type="button" class="btn primary" data-ok>刪除</button></div>`,
  (modal, close) => {
    modal.querySelector('[data-ok]').addEventListener('click', () => { close(); mediaAction(() => api.media.remove(item), '已刪除照片'); });
  });
}

app.addEventListener('click', (e) => {
  const byId = (attr) => { const el = e.target.closest(`[${attr}]`); return el && state.media.find((m) => m.id === el.getAttribute(attr)); };
  const lbBtn = e.target.closest('[data-lb]');
  if (lbBtn) {
    const key = lbBtn.dataset.lb;
    const i = lbBtn.dataset.id ? mediaOf(key).findIndex((m) => m.id === lbBtn.dataset.id) : Number(lbBtn.dataset.i);
    openLightbox(key, i);
    return;
  }
  const mt = e.target.closest('[data-media-toggle]');
  if (mt) { const k = mt.dataset.mediaToggle; if (state.openMedia.has(k)) state.openMedia.delete(k); else state.openMedia.add(k); render(); return; }
  const cov = byId('data-cover');
  if (cov) { mediaAction(() => api.media.setCover(cov, !cov.is_cover), cov.is_cover ? '已取消封面' : '已設為年度封面'); return; }
  const cap = byId('data-caption');
  if (cap) { editCaption(cap); return; }
  const del = byId('data-del-media');
  if (del) { removeMedia(del); return; }
  if (e.target.closest('[data-action="new-album"]')) { openAlbum(); return; }
  if (e.target.closest('[data-action="login"]')) { openLogin(); return; }
  if (e.target.closest('[data-action="logout"]')) {
    api.signOut().finally(() => { state.org = false; organizer(false); render(); toast('已登出主辦'); });
  }
});

app.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) { history.back(); return; }
  const t = e.target.closest('[data-toggle]');
  if (t) { const k = t.dataset.toggle; if (state.open.has(k)) state.open.delete(k); else state.open.add(k); render(); return; }
  const f = e.target.closest('[data-filter]');
  if (f) { state[f.dataset.filter] = f.dataset.value; render(); return; }
  if (e.target.closest('[data-action="retry"]')) init();
});

async function init() {
  Object.assign(state, { loaded: false, error: null });
  render();
  try {
    await load();
    if (demo) { try { organizer(!!sessionStorage.getItem('demo_organizer')); } catch { /* 忽略 */ } }
    state.loaded = true;
  } catch (err) {
    console.error(err);
    state.error = err.message || '資料讀取失敗';
  }
  render();
}

init();
