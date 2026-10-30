// 英雄榜：彙整各年度、各項比賽的冠軍、亞軍、季軍（資料來自「存入選手成績」寫進 results 資料表）。
// 任何人都可以瀏覽（results、people 資料表本來就是公開可讀），不需要登入；主辦登入後才會多出導覽列。
import { SUPABASE_URL, SUPABASE_ANON_KEY, ORGANIZER_EMAIL } from './config.js';
import { avatar, profileOf, peopleApi, demoPeopleApi, resultsApi, demoResultsApi, SYSTEM_LABEL, DIVISION_LABEL, PLACE_LABEL } from './people.js';

const demo = new URLSearchParams(location.search).has('demo');
const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ORDER = ['singles', 'doubles', 'team'];

const state = { loaded: false, error: null, rows: [], people: {}, year: 'all', system: 'all' };

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
    return;
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const [people, results] = await Promise.all([peopleApi(sb).load().catch(() => ({})), resultsApi(sb).load()]);
  state.people = people;
  state.rows = Object.values(results).flat();
  try {
    const { data } = await sb.auth.getSession();
    organizer((data.session?.user?.email || '').toLowerCase() === ORGANIZER_EMAIL.toLowerCase());
  } catch { /* 忽略 */ }
}

// 通知共用導覽列：只有主辦看得到
function organizer(isOrg) { document.dispatchEvent(new CustomEvent('site-organizer', { detail: isOrg })); }

// ---------------------------------------------------------------- 彙整

const visibleRows = () => state.rows.filter((r) => (state.year === 'all' || r.year === Number(state.year)) && (state.system === 'all' || r.system === state.system));

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
  return [...years].sort((a, b) => b[0] - a[0]);
}

function medalTable() {
  const tally = new Map();
  for (const r of visibleRows()) {
    const t = tally.get(r.name) || tally.set(r.name, { name: r.name, 1: 0, 2: 0, 3: 0 }).get(r.name);
    t[r.place]++;
  }
  return [...tally.values()].sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 10);
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

function blockHtml(block) {
  const label = `${SYSTEM_LABEL[block.system] || block.system}${block.division ? `・${DIVISION_LABEL[block.division] || block.division}` : ''}`;
  const items = [1, 2, 3].flatMap((p) => entriesOf(block.system, block.places[p]).map((e) => entryHtml(p, e)));
  return `<div class="hall-block"><h4>${esc(label)}</h4><ul class="hall-list">${items.join('')}</ul></div>`;
}

function render() {
  const all = state.rows;
  const years = [...new Set(all.map((r) => r.year))].sort((a, b) => b - a);
  const chip = (kind, value, label) => `<button type="button" class="${String(state[kind]) === String(value) ? 'on' : ''}" data-filter="${kind}" data-value="${value}">${esc(label)}</button>`;
  const grouped = buildYears();
  const medals = medalTable();
  app.innerHTML = `
    <header class="topbar">
      <div class="container topbar-inner">
        <div class="brand">
          <img class="brand-logo" src="img/logo-glow-96.png" srcset="img/logo-glow-96.png 1x, img/logo-glow-192.png 2x" width="46" height="46" alt="中龍鋼鐵">
          <div><h1>中龍鋼鐵 英雄榜</h1><p class="live">歷年各項比賽前三名</p></div>
        </div>
      </div>
    </header>
    <main class="container">
      ${demo ? '<div class="banner demo">🧪 示範模式：這是範例資料，不是真正的成績。</div>' : ''}
      ${!state.loaded ? '<div class="center-card"><div class="spinner" aria-hidden="true"></div><p>載入中…</p></div>'
        : state.error ? `<div class="center-card"><h2>無法讀取資料</h2><p>${esc(state.error)}</p><button class="btn primary" data-action="retry">重新載入</button></div>`
        : !all.length ? '<div class="empty"><span aria-hidden="true">🏆</span><p>還沒有成績紀錄。比賽結束後，由主辦按「存入選手成績」，這裡就會出現。</p></div>'
        : `
      <section class="card">
        <div class="hall-filters">
          <div class="hub-filter" aria-label="年度">${chip('year', 'all', '全部年度')}${years.map((y) => chip('year', y, `${y} 年`)).join('')}</div>
          <div class="hub-filter" aria-label="項目">${chip('system', 'all', '全部項目')}${Object.entries(SYSTEM_LABEL).map(([k, l]) => chip('system', k, l)).join('')}</div>
        </div>
      </section>
      ${!grouped.length ? '<div class="empty"><span aria-hidden="true">🏆</span><p>這個條件下沒有成績紀錄。</p></div>' : `
      <section class="card hall-medals">
        <h3>🏅 累計獎牌榜 <small>前 ${medals.length} 名</small></h3>
        <ol class="hall-medal-list">${medals.map((m, i) => `
          <li><span class="no">${i + 1}</span>${avatar(person(m.name), 'sm')}
            <span class="hall-who"><b>${esc(m.name)}</b>${person(m.name).unit ? `<small>${esc(person(m.name).unit)}</small>` : ''}</span>
            <span class="hall-count"><span>🥇 ${m[1]}</span><span>🥈 ${m[2]}</span><span>🥉 ${m[3]}</span></span></li>`).join('')}</ol>
      </section>
      ${grouped.map(([year, events]) => `
        <section class="hall-year">
          <h2>${year} 年</h2>
          ${[...events].map(([event, blocks]) => `
            <article class="card hall-event">
              <h3>${esc(event)}</h3>
              <div class="hall-blocks">${[...blocks.values()].sort((a, b) => ORDER.indexOf(a.system) - ORDER.indexOf(b.system) || (a.division === 'competitive' ? 0 : 1) - (b.division === 'competitive' ? 0 : 1)).map(blockHtml).join('')}</div>
            </article>`).join('')}
        </section>`).join('')}`}`}
    </main>`;
}

app.addEventListener('click', (e) => {
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
