import { ORGANIZER_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { avatar, titleChip, openPersonEditor, peopleApi, demoPeopleApi, profileOf, resultsApi, demoResultsApi, resultsHtml, batchesOf, SYSTEM_LABEL, DIVISION_LABEL } from './people.js';

const demo = new URLSearchParams(location.search).has('demo');
const SYSTEMS = { singles: '單打賽', doubles: '雙打賽', team: '團體賽' };
const DIVISIONS = { competitive: '競賽組', fun: '歡樂成長組' };

const state = {
  loaded: false,
  error: null,
  busy: false,
  user: null,
  people: {}, // { 姓名: { unit, title, photo_url } }
  results: {}, // { 姓名: [歷年成績] }
  joins: {}, // { 姓名: [{ sys, detail }] }：這個人在哪些比賽出現
  missingTable: false,
  query: '',
};

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');
let backend;

// ---------------------------------------------------------------- 小工具

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isOrganizer = () => !!state.user && (state.user.email || '').toLowerCase() === ORGANIZER_EMAIL.toLowerCase();

let toastTimer;
function toast(message, kind = 'info') {
  toastEl.textContent = message;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3200);
}

async function run(task, successMessage) {
  if (state.busy) return false;
  state.busy = true;
  try {
    await task();
    if (successMessage) toast(successMessage, 'ok');
    return true;
  } catch (err) {
    console.error(err);
    toast(err.message || '操作失敗，請再試一次', 'error');
    return false;
  } finally {
    state.busy = false;
    await reload();
  }
}

// ---------------------------------------------------------------- 資料來源

async function createSupabaseBackend() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const people = peopleApi(sb);
  const results = resultsApi(sb);
  // 某個系統的資料表不存在或讀不到時，當作沒有資料，其他照常顯示
  const rows = async (query) => { const { data, error } = await query; return error ? [] : data; };
  return {
    isDemo: false,
    async load() {
      const [sg, teams, tlPlayers, tlTeams, ppl, probe, resultsMap] = await Promise.all([
        rows(sb.from('sg_players').select('name, division')),
        rows(sb.from('teams').select('player_a, player_b, division')),
        rows(sb.from('tl_players').select('name, team_id')),
        rows(sb.from('tl_teams').select('id, name')),
        people.load(),
        sb.from('people').select('name').limit(1),
        results.load(),
      ]);
      const teamName = Object.fromEntries(tlTeams.map((t) => [t.id, t.name]));
      return {
        people: ppl,
        results: resultsMap,
        missingTable: !!probe.error,
        joins: buildJoins({
          singles: sg.map((p) => [p.name, DIVISIONS[p.division] || '']),
          doubles: teams.flatMap((t) => [[t.player_a, DIVISIONS[t.division] || ''], [t.player_b, DIVISIONS[t.division] || '']]),
          team: tlPlayers.map((p) => [p.name, teamName[p.team_id] || '']),
        }),
      };
    },
    savePerson: (name, patch) => people.save(name, patch),
    removePerson: (name) => people.remove(name),
    removeResult: (id) => results.remove(id),
    removeBatch: (s, d, y, e) => results.removeBatch(s, d, y, e),
    uploadPhoto: (blob) => people.upload(blob),
    subscribe(onChange) {
      const channel = sb.channel('people-hub').on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, onChange).subscribe();
      return () => sb.removeChannel(channel);
    },
    async getUser() { const { data } = await sb.auth.getSession(); return data.session?.user ?? null; },
    onAuthChange(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session?.user ?? null)); },
    async signIn(password) {
      const { error } = await sb.auth.signInWithPassword({ email: ORGANIZER_EMAIL, password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? '密碼錯誤' : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
  };
}

function createDemoBackend() {
  const DEMO_PASSWORD = 'demo1234';
  const demoNames = {
    singles: [['陳志明', '競賽組'], ['林建宏', '競賽組'], ['黃俊傑', '競賽組'], ['許家銘', '歡樂成長組']],
    doubles: [['王小明', '競賽組'], ['李大華', '競賽組'], ['陳志強', '競賽組'], ['林建宏', '競賽組']],
    team: [['陳志明', '東區鐵人'], ['蔡明哲', '西區旋風'], ['周子豪', '南港飛龍'], ['楊博文', '北城猛虎']],
  };
  const seed = {};
  Object.values(demoNames).flat().forEach(([n], i) => { seed[n] = { name: n, unit: ['台北市桌球協會', '新北市桌球隊', '台中市體育會'][i % 3], title: i % 4 === 0 ? '隊長' : '選手', photo_url: null }; });
  const people = demoPeopleApi(seed);
  const results = demoResultsApi([
    { name: '陳志明', year: 2025, system: 'singles', division: 'competitive', place: 1, detail: null, event: '2025 秋季盃' },
    { name: '陳志明', year: 2025, system: 'team', division: '', place: 2, detail: '東區鐵人', event: '2025 團體賽' },
    { name: '林建宏', year: 2025, system: 'singles', division: 'competitive', place: 3, detail: null, event: '2025 秋季盃' },
    { name: '王小明', year: 2025, system: 'doubles', division: 'competitive', place: 1, detail: '與 李大華 搭檔', event: '2025 秋季盃' },
  ]);
  let user = (() => { try { return sessionStorage.getItem('demo_organizer') ? { email: ORGANIZER_EMAIL } : null; } catch { return null; } })(); // 示範模式：同一個分頁切換系統時保留主辦登入
  const listeners = new Set();
  return {
    isDemo: true,
    demoPassword: DEMO_PASSWORD,
    async load() { return { people: await people.load(), results: await results.load(), missingTable: false, joins: buildJoins(demoNames) }; },
    async removeResult(id) { if (!user) throw new Error('沒有寫入權限，請重新登入主辦帳號'); await results.remove(id); },
    async removeBatch(s, d, y, e) { if (!user) throw new Error('沒有寫入權限，請重新登入主辦帳號'); await results.removeBatch(s, d, y, e); },
    async removePerson(name) { if (!user) throw new Error('沒有寫入權限，請重新登入主辦帳號'); await people.remove(name); },
    async savePerson(name, patch) { if (!user) throw new Error('沒有寫入權限，請重新登入主辦帳號'); await people.save(name, patch); },
    uploadPhoto: (blob) => people.upload(blob),
    subscribe() { return () => {}; },
    async getUser() { return user; },
    onAuthChange(cb) { listeners.add(cb); },
    async signIn(password) { if (password !== DEMO_PASSWORD) throw new Error('密碼錯誤'); user = { email: ORGANIZER_EMAIL }; try { sessionStorage.setItem('demo_organizer', '1'); } catch { /* 忽略 */ } listeners.forEach((f) => f(user)); },
    async signOut() { user = null; try { sessionStorage.removeItem('demo_organizer'); } catch { /* 忽略 */ } listeners.forEach((f) => f(null)); },
  };
}

// 把三個系統的選手名單合併：{ 姓名: [{ sys, detail }] }
function buildJoins(sources) {
  const out = {};
  for (const [sys, list] of Object.entries(sources)) {
    for (const [name, detail] of list) {
      if (!name) continue;
      const arr = (out[name] ||= []);
      if (!arr.some((j) => j.sys === sys && j.detail === detail)) arr.push({ sys, detail });
    }
  }
  return out;
}

async function reload() {
  if (!isOrganizer()) { Object.assign(state, { loaded: true, error: null, people: {}, joins: {}, missingTable: false }); render(); return; }
  try {
    Object.assign(state, await backend.load(), { loaded: true, error: null });
  } catch (err) {
    console.error(err);
    state.error = err.message || '資料讀取失敗';
  }
  render();
}

// ---------------------------------------------------------------- 畫面

// 所有姓名：三個系統出現過的人，加上資料庫裡有資料的人
const allNames = () => [...new Set([...Object.keys(state.joins), ...Object.keys(state.people)])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

function visibleNames() {
  const q = state.query.trim().toLowerCase();
  return allNames().filter((name) => {
    const prof = profileOf(state.people, name);
    if (!q) return true;
    return [name, prof.unit, prof.title].some((s) => String(s || '').toLowerCase().includes(q));
  });
}

function renderHeader() {
  return `
    <header class="topbar">
      <div class="container topbar-inner">
        <div class="brand">
          <img class="brand-logo" src="img/logo-glow-96.png" srcset="img/logo-glow-96.png 1x, img/logo-glow-192.png 2x" width="46" height="46" alt="中龍鋼鐵">
          <div>
            <h1>中龍鋼鐵 選手資料庫</h1>
            <p class="live">單打、雙打、團體賽共用</p>
          </div>
        </div>
        ${isOrganizer()
          ? `<div class="who"><span class="chip ok">主辦模式</span><button class="btn small" data-action="logout">登出</button></div>`
          : `<button class="btn small" data-action="login">主辦登入</button>`}
      </div>
    </header>`;
}

function gridHtml() {
  const names = visibleNames();
  if (!names.length) return `<div class="empty"><span aria-hidden="true">🏓</span><p>${state.query ? '找不到符合的選手。' : '還沒有選手資料。'}</p></div>`;
  return `<p class="hub-count">${names.length} 位選手</p>
    <div class="player-grid">${names.map((name) => {
      const prof = profileOf(state.people, name);
      return `<button type="button" class="pcard" data-action="profile" data-name="${esc(name)}">
        <span class="pcard-photo">${avatar(prof, 'cover')}</span>
        <span class="pcard-tx"><b>${esc(name)}</b><small>${esc(prof.unit || '（未填單位）')}</small>${titleChip(prof.title)}</span>
      </button>`;
    }).join('')}</div>`;
}

function render() {
  document.dispatchEvent(new CustomEvent('site-organizer', { detail: isOrganizer() })); // 只有主辦看得到共用導覽列
  if (!state.loaded) {
    app.innerHTML = state.error
      ? `<div class="center-card"><h2>無法讀取資料</h2><p>${esc(state.error)}</p><button class="btn primary" data-action="retry">重新載入</button></div>`
      : `<div class="center-card"><div class="spinner" aria-hidden="true"></div><p>載入中…</p></div>`;
    return;
  }
  // 選手資料庫只給主辦瀏覽：沒登入時只顯示登入畫面，也不去讀取名單
  if (!isOrganizer()) {
    app.innerHTML = `
      ${renderHeader()}
      <main class="container">
        ${demo ? `<div class="banner demo">🧪 示範模式：資料只存在這個分頁，重新整理就會還原。主辦登入密碼：<b>${esc(backend.demoPassword)}</b></div>` : ''}
        <section class="card narrow">
          <h2>僅限主辦人員瀏覽</h2>
          <p class="note">選手資料庫收集三個比賽的選手資料，需要主辦登入後才能查看與編輯。比賽選手請回到各自的比賽網頁查看賽事資訊。</p>
          <button class="btn primary" data-action="login">主辦登入</button>
        </section>
      </main>`;
    return;
  }
  const keepSearch = document.getElementById('hub-search');
  const focused = keepSearch && document.activeElement === keepSearch;
  app.innerHTML = `
    ${renderHeader()}
    <main class="container">
      ${demo ? `<div class="banner demo">🧪 示範模式：資料只存在這個分頁，重新整理就會還原。主辦登入密碼：<b>${esc(backend.demoPassword)}</b></div>` : ''}
      ${state.missingTable ? `<div class="banner warn hub-missing">選手資料庫還沒建立，目前只能瀏覽名單。請主辦在 Supabase 的 SQL Editor 執行 <code>supabase/people.sql</code>。</div>` : ''}
      <section class="card">
        ${isOrganizer() ? `<div class="section-head"><h3>選手名單</h3><span class="row-actions"><button class="btn small" data-action="batches">🏅 成績紀錄</button><button class="btn primary small" data-action="add-person">＋ 新增選手</button></span></div>` : ''}
        <div class="hub-tools">
          <input id="hub-search" class="hub-search" type="search" placeholder="搜尋姓名、單位或頭銜" value="${esc(state.query)}" aria-label="搜尋選手" autocomplete="off">
        </div>
        <div id="hub-grid">${gridHtml()}</div>
      </section>
    </main>`;
  if (focused) { const el = document.getElementById('hub-search'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// ---------------------------------------------------------------- 對話框

function openModal(html, onReady) {
  const previousFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = modalRoot.querySelector('.backdrop');
  const close = () => {
    modalRoot.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    if (previousFocus?.focus) previousFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  onReady(modalRoot.querySelector('.modal'), close);
  if (!modalRoot.contains(document.activeElement)) modalRoot.querySelector('input, button:not([data-close])')?.focus();
}

function openLoginModal() {
  openModal(`
    <h2>主辦登入</h2>
    <form>
      <label>帳號<input value="${esc(ORGANIZER_EMAIL)}" disabled></label>
      <label>密碼<input name="password" type="password" required autocomplete="current-password"></label>
      ${demo ? `<p class="note">示範模式主辦密碼：<b>${esc(backend.demoPassword)}</b></p>` : ''}
      <p class="error" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">登入</button></div>
    </form>`,
  (modal, close) => {
    const form = modal.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await backend.signIn(form.password.value); close(); toast('已登入主辦模式', 'ok'); }
      catch (err) { const el = form.querySelector('.error'); el.textContent = err.message; el.hidden = false; }
    });
  });
}

function openProfile(name) {
  const prof = profileOf(state.people, name);
  openModal(`
    <div class="profile">
      <button type="button" class="profile-x" data-close aria-label="關閉">✕</button>
      <div class="profile-hero">${avatar(prof, 'big')}</div>
      <h2>${esc(name)}</h2>
      <p class="profile-unit">${esc(prof.unit || '（未填單位）')}</p>
      <p>${titleChip(prof.title)}</p>
      ${resultsHtml(state.results[name], { removable: isOrganizer() })}
      ${isOrganizer() ? `<div class="modal-actions"><button type="button" class="btn danger" data-delete>從資料庫刪除</button><button type="button" class="btn" data-edit>✎ 編輯資料</button></div>` : ''}
    </div>`,
  (modal, close) => {
    modal.querySelector('[data-edit]')?.addEventListener('click', () => { close(); openEdit(name); });
    modal.querySelector('[data-delete]')?.addEventListener('click', () => { close(); removePerson(name); });
    modal.querySelectorAll('[data-del-result]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('確定刪除這筆成績？')) return;
      close();
      run(() => backend.removeResult(b.dataset.delResult), '已刪除這筆成績');
    }));
  });
}

function openEdit(name) {
  const prof = profileOf(state.people, name);
  openPersonEditor({
    openModal,
    person: prof,
    onSave: ({ unit, title, blob, removed }) => run(async () => {
      let photo_url = prof.photo_url || null;
      if (blob) photo_url = await backend.uploadPhoto(blob);
      else if (removed) photo_url = null;
      await backend.savePerson(name, { unit, title, photo_url });
    }, '選手資料已儲存'),
  });
}


// 新增一位選手到資料庫（姓名、單位、頭銜、照片）
function openCreate() {
  openPersonEditor({
    openModal,
    person: { name: '', unit: null, title: null, photo_url: null },
    onSave: async ({ name, unit, title, blob }) => {
      if (!name) return false;
      if (state.people[name] || state.joins[name]) { toast('資料庫已經有同名的選手，請直接編輯那一位', 'error'); return false; }
      return run(async () => {
        const photo_url = blob ? await backend.uploadPhoto(blob) : null;
        await backend.savePerson(name, { unit, title, photo_url });
      }, `已新增 ${name}`);
    },
  });
}

// 成績紀錄：列出每一批存入的成績，存錯或測試誤存時可以整批撤銷
function openBatches() {
  const list = batchesOf(state.results);
  openModal(`
    <h2>成績紀錄</h2>
    <p class="note">每按一次「存入選手成績」就是一批。存錯或測試誤存的，可以整批撤銷。</p>
    ${list.length ? `<ul class="batch-list">${list.map((b, i) => `
      <li><span class="batch-tx"><b>${b.year} 年 ${esc(b.event || '（未命名賽事）')}</b>
        <small>${SYSTEM_LABEL[b.system] || b.system}${b.division ? `・${DIVISION_LABEL[b.division] || b.division}` : ''}・${b.count} 筆</small></span>
        <button type="button" class="btn small danger" data-undo="${i}">撤銷</button></li>`).join('')}</ul>` : '<p class="note">還沒有存入任何成績。</p>'}
    <div class="modal-actions"><button type="button" class="btn" data-close>關閉</button></div>`,
  (modal, close) => {
    modal.querySelectorAll('[data-undo]').forEach((btn) => btn.addEventListener('click', () => {
      const b = list[Number(btn.dataset.undo)];
      if (!confirm(`確定撤銷「${b.year} 年 ${b.event || '（未命名賽事）'}」${SYSTEM_LABEL[b.system] || ''}${b.division ? DIVISION_LABEL[b.division] || '' : ''}的 ${b.count} 筆成績？`)) return;
      close();
      run(() => backend.removeBatch(b.system, b.division, b.year, b.event), '已撤銷這一批成績');
    }));
  });
}

function removePerson(name) {
  const joined = (state.joins[name] || []).length;
  const warn = joined ? `\n\n注意：${name} 已加入 ${joined} 項比賽。這只會刪除他的單位、頭銜與照片，不會從比賽名單移除。` : '';
  if (!confirm(`確定從選手資料庫刪除「${name}」？${warn}`)) return;
  run(() => backend.removePerson(name), '已從資料庫刪除');
}
// ---------------------------------------------------------------- 操作

const actions = {
  retry: () => { state.error = null; render(); reload(); },
  login: openLoginModal,
  logout: async () => { await backend.signOut(); toast('已登出'); },
  profile: ({ name }) => openProfile(name),
  'add-person': openCreate,
  batches: openBatches,
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el.dataset, el);
});

// 搜尋時只更新名單，不重畫整頁（不然輸入框會失去焦點）
app.addEventListener('input', (e) => {
  if (e.target.id !== 'hub-search') return;
  state.query = e.target.value;
  document.getElementById('hub-grid').innerHTML = gridHtml();
});

async function init() {
  render();
  try {
    backend = demo ? createDemoBackend() : await createSupabaseBackend();
  } catch (err) {
    console.error(err);
    state.error = '無法載入資料庫模組，請檢查網路連線後重新整理。';
    render();
    return;
  }
  state.user = await backend.getUser();
  backend.onAuthChange((user) => { state.user = user; reload(); });
  await reload();
  backend.subscribe(() => reload());
  setInterval(() => { if (!document.hidden) reload(); }, 60000);
}

init();
