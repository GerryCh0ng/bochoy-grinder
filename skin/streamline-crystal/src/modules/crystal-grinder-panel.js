// CRYSTAL grinder floating panel for the Streamline skin.
//
// A small draggable card: recipe name + pager, the three values, SET / START /
// STOP, and one Edit button. All editing happens in the dialog, matching the
// skin's own "tap to open a modal" flow. Decaid's grinder contract covers grind,
// rpm and start/stop; the bean-feed gate (XD_RPM 0-150) and the per-start mode
// go through the plugin's vendor endpoints.

// Same host rule as the skin's own api.js: the tablet may have a LAN address
// stored in `reaHostname`, and localhost is not always the reachable one.
const HOST = localStorage.getItem('reaHostname') || location.hostname;
const API = `${location.protocol}//${HOST}:8080`;
const PLUGIN = `${API}/api/v1/plugins/com.crystal.grinder`;
const SLOTS = 10;
const STORE_KEY = 'crystal-recipes-v1';
const POS_KEY = 'crystal-panel-pos-v2';

// Factory defaults for a fresh install: grind 500, bean feed 20, rpm 800.
const DEFAULTS = { grind: 500, rpm: 800, feed: 20, mode: 'auto', bindId: '', bindName: '', instant: false };

// The skin's own workflow helper, loaded lazily so a failure cannot take the panel down.
let skinUi = null;
import('./ui.js').then(module => { skinUi = module; }).catch(() => {});

// Keep the Grind tile on the selected recipe's value.
function syncTile(value) {
    const tile = document.getElementById('grind-value');
    if (tile) tile.textContent = String(value);
    try { skinUi?.updateGrindValue?.(value); } catch { /* non-fatal */ }
}

const els = {};
/* ---------- language ---------- */

const I18N = {
    en: {
        edit: 'Edit',
        idle: 'Idle',
        grinding: 'Grinding',
        offline: 'Offline',
        manual: 'Manual',
        timer: 'Timer',
        auto: 'Auto',
        grind: 'Grind',
        rpm: 'RPM',
        feed: 'Feed',
        bind: 'Bind',
        unbound: 'Not bound',
        recipe: 'Recipe',
        dialogTitle: 'Grinder recipe',
        name: 'Recipe name',
        startMode: 'Start mode',
        instant: 'Grind right after editing (No = press SET first, START locked)',
        yes: 'Yes',
        no: 'No',
        bindProfile: 'Bound espresso profile',
        namePh: 'Recipe name',
        instantShort: 'Instant grind',
        cancel: 'Cancel',
        save: 'Save',
        setDone: 'Values sent',
        setFail: 'SET failed: ',
        startFail: 'START failed: ',
        stopFail: 'STOP failed: ',
        started: 'Started',
        stopped: 'Stopped',
        switched: 'Switched to ',
        switchFail: 'Switch failed: ',
        pushFail: 'Send failed: ',
        notConnected: 'Grinder is not connected'
    },
    zh: {
        edit: '编辑',
        idle: '空闲',
        grinding: '研磨中',
        offline: '未连接',
        manual: '手动',
        timer: '定时',
        auto: '自动',
        grind: '研磨度',
        rpm: '转速',
        feed: '下豆',
        bind: '绑定',
        unbound: '未绑定',
        recipe: '配方',
        dialogTitle: '编辑磨豆机配方',
        name: '配方名',
        startMode: '启动方式',
        instant: '调参完成即时研磨（否 = 需先按 SET，START 才解锁）',
        yes: '是',
        no: '否',
        bindProfile: '绑定咖啡配方',
        namePh: '配方名',
        instantShort: '即时研磨',
        cancel: '取消',
        save: '保存',
        setDone: '参数已下发',
        setFail: 'SET 失败：',
        startFail: 'START 失败：',
        stopFail: 'STOP 失败：',
        started: '已启动',
        stopped: '已停止',
        switched: '已切到「',
        switchFail: '切换配方失败：',
        pushFail: '下发失败：',
        notConnected: '磨豆机未连接'
    }
};

let language = 'en';

function detectLanguage() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl) return fromUrl.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const stored = (localStorage.getItem('language') || '').toLowerCase();
    return stored.startsWith('zh') ? 'zh' : 'en';
}

function t(key) {
    return (I18N[language] && I18N[language][key]) || I18N.en[key] || key;
}

function applyLabels(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(node => {
        node.textContent = t(node.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(node => {
        node.placeholder = t(node.dataset.i18nPh);
    });
}

function displayName(recipe) {
    const match = /^配方(\d+)$/.exec(recipe.name || '');
    if (match && language !== 'zh') return `${I18N.en.recipe} ${match[1]}`;
    return recipe.name;
}

const state = {
    index: 0,
    recipes: Array.from({ length: SLOTS }, (_, i) => ({ name: `配方${i + 1}`, ...DEFAULTS })),
    connected: false,
    grinderState: 'unknown',
    applied: false,
    profiles: []
};

const recipe = () => state.recipes[state.index];

/* ---------- storage ---------- */

function loadRecipes() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved || !Array.isArray(saved.recipes)) return;
        state.index = Number.isInteger(saved.index) ? Math.min(SLOTS - 1, Math.max(0, saved.index)) : 0;
        saved.recipes.slice(0, SLOTS).forEach((item, i) => {
            state.recipes[i] = { ...state.recipes[i], ...item };
        });
        // Upgrade recipes that were never touched from the old zero defaults.
        state.recipes.forEach((item, i) => {
            const autoName = `配方${i + 1}`;
            if (item.name === autoName && item.grind === 0 && item.rpm === 0 && item.feed === 0) {
                item.grind = DEFAULTS.grind;
                item.rpm = DEFAULTS.rpm;
                item.feed = DEFAULTS.feed;
            }
        });
    } catch (error) {
        console.warn('[crystal] could not read recipes', error);
    }
}

function saveRecipes() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ index: state.index, recipes: state.recipes }));
    } catch (error) {
        console.warn('[crystal] could not save recipes', error);
    }
}

function loadPosition() {
    try {
        const raw = localStorage.getItem(POS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function savePosition(left, top) {
    try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
    } catch { /* non-fatal */ }
}

/* ---------- api ---------- */

async function jsonFetch(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!response.ok) {
        const error = new Error((data && (data.error || data.code)) || response.statusText || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return data;
}

const putJson = (url, body) => jsonFetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
});

const postJson = (url, body) => jsonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
});

async function refreshStatus() {
    try {
        const status = await jsonFetch(`${PLUGIN}/status`);
        const connected = Boolean(status && status.connected);
        setConnected(connected);
        if (connected) {
            // Polling keeps the state dot honest even if the snapshot socket is down.
            setGrinderState(status.state === 'grinding' ? 'grinding' : 'idle');
            els.feed.textContent = status.feed ?? 0;
        }
    } catch {
        setConnected(false);
    }
}

/* ---------- rendering ---------- */

function setConnected(connected) {
    const changed = state.connected !== connected;
    state.connected = connected;
    updateButtons();
    if (!connected) {
        els.panel.dataset.offline = '1';
        setGrinderState('unknown');
    } else {
        delete els.panel.dataset.offline;
    }
    if (changed) render();
}

const STATE_KEYS = { idle: 'idle', grinding: 'grinding', unknown: 'offline' };

function setGrinderState(grinderState) {
    state.grinderState = grinderState;
    els.dot.className = 'cg-dot ' + (grinderState === 'grinding' ? 'grinding' : grinderState === 'idle' ? 'idle' : 'offline');
    if (els.state) els.state.textContent = t(STATE_KEYS[grinderState] || 'offline');
}

const MODE_KEYS = { manual: 'manual', timer: 'timer', auto: 'auto' };

function updateButtons() {
    const r = recipe();
    // "调参完成即时研磨" = 是: SET is meaningless, so it is hidden and START is live.
    // = 否: SET must be pressed after any edit before START unlocks.
    els.set.hidden = r.instant;
    const startLocked = !state.connected || (!r.instant && !state.applied);
    els.start.disabled = startLocked;
    els.stop.disabled = !state.connected;
    els.set.disabled = !state.connected;
}

function render() {
    const r = recipe();
    els.name.textContent = displayName(r);
    els.mode.textContent = t(MODE_KEYS[r.mode] || 'auto');
    els.index.textContent = `${state.index + 1}/${SLOTS}`;
    els.grind.textContent = r.grind;
    els.rpm.textContent = r.rpm;
    els.feed.textContent = r.feed;
    els.bind.textContent = r.bindName || t('unbound');
    updateButtons();
}

function flash(message) {
    els.hint.textContent = message;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { els.hint.textContent = ''; }, 2600);
}

/* ---------- commands ---------- */

async function pushAll() {
    const r = recipe();
    if (!state.connected) throw new Error(t('notConnected'));
    await putJson(`${API}/api/v1/grinder/setting`, { setting: String(r.grind) });
    await putJson(`${API}/api/v1/grinder/rpm`, { rpm: r.rpm });
    await postJson(`${PLUGIN}/feed`, { feed: r.feed });
}

async function onSet() {
    try {
        await pushAll();
        state.applied = true;
        updateButtons();
        syncTile(recipe().grind);
        flash(t('setDone'));
    } catch (error) {
        flash(t('setFail') + error.message);
    }
}

async function onStart() {
    try {
        await postJson(`${PLUGIN}/start`, { mode: recipe().mode });
        flash(t('started'));
    } catch (error) {
        flash(t('startFail') + error.message);
    }
}

async function onStop() {
    try {
        await putJson(`${API}/api/v1/grinder/state/idle`);
        flash(t('stopped'));
    } catch (error) {
        flash(t('stopFail') + error.message);
    }
}

/* ---------- follow the active espresso profile ---------- */

let activeProfileTitle = null;

// The workflow carries the active profile's title (no id), so the id comes from
// the profile list and the recipe is chosen by its bound profile id.
async function syncFromWorkflow(workflow) {
    const title = workflow && workflow.profile ? workflow.profile.title : null;
    if (!title || title === activeProfileTitle) return;
    activeProfileTitle = title;

    if (!state.profiles.length) await loadProfiles();
    const profile = state.profiles.find(item => item.title === title);
    if (!profile) return;

    const index = state.recipes.findIndex(item => item.bindId === profile.id);
    if (index < 0 || index === state.index) return;

    state.index = index;
    state.applied = false;
    saveRecipes();
    render();
    syncTile(recipe().grind);
    flash(t('switched') + displayName(recipe()) + (language === 'zh' ? '」' : ''));

    if (state.connected) {
        try {
            await pushAll();
            state.applied = true;
            updateButtons();
        } catch (error) {
            flash(t('switchFail') + error.message);
        }
    }
}

/* ---------- grinder socket ---------- */

function connectSocket() {
    let socket;
    try {
        socket = new WebSocket(`${API.replace('http', 'ws')}/ws/v1/grinder/snapshot`);
    } catch {
        setTimeout(connectSocket, 3000);
        return;
    }
    socket.onopen = () => setConnected(true);
    socket.onmessage = event => {
        try {
            setGrinderState(JSON.parse(event.data).state);
            setConnected(true);
        } catch { /* ignore */ }
    };
    socket.onclose = () => {
        setConnected(false);
        setTimeout(connectSocket, 4000);
    };
}

/* ---------- profiles ---------- */

async function loadProfiles() {
    try {
        const profiles = await jsonFetch(`${API}/api/v1/profiles`);
        const list = Array.isArray(profiles) ? profiles : (profiles?.items ?? []);
        state.profiles = list.map(item => ({
            id: item.id,
            title: (item.profile && item.profile.title) || item.title || item.name || item.id
        }));
    } catch {
        state.profiles = [];
    }
    fillBindOptions(els.dialogFields?.bind);
}

// Bound by profile id, labelled with the profile's title, both straight from Decaid.
function fillBindOptions(select) {
    if (!select) return;
    const current = recipe().bindId;
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('unbound');
    select.appendChild(none);
    for (const profile of state.profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.title;
        select.appendChild(option);
    }
    select.value = current || '';
}

/* ---------- edit dialog (touch: big nudges, hold to repeat, step chips) ---------- */

const EDIT_STEPS = {
    grind: [1, 5, 10, 50],
    feed: [1, 2, 5, 10],
    rpm: [10, 50, 100, 250]
};
const EDIT_LIMITS = {
    grind: [0, 1500],
    feed: [0, 150],
    rpm: [0, 1500]
};

const draft = { grind: 0, feed: 0, rpm: 0, step: { grind: 1, feed: 1, rpm: 50 } };

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function nudge(field, direction) {
    const [min, max] = EDIT_LIMITS[field];
    draft[field] = clampInt(draft[field] + direction * draft.step[field], min, max, draft[field]);
    if (els.draftOutputs && els.draftOutputs[field]) {
        els.draftOutputs[field].textContent = draft[field];
    }
}

function buildField(field, key, rangeText) {
    const steps = EDIT_STEPS[field].map(step =>
        `<button type="button" data-step="${step}"${step === draft.step[field] ? ' class="on"' : ''}>${step}</button>`
    ).join('');
    return `
      <div class="cg-field" title="${rangeText}">
        <span class="cg-field-label" data-i18n="${key}">${t(key)}</span>
        <button type="button" class="cg-nudge" data-dir="-1">−</button>
        <output class="cg-out" data-out="${field}">0</output>
        <button type="button" class="cg-nudge" data-dir="1">+</button>
        <div class="cg-steps" data-steps="${field}">${steps}</div>
      </div>`;
}

function buildDialog() {
    const modal = document.createElement('div');
    modal.className = 'cg-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="cg-dialog" role="dialog" aria-modal="true">
        <h3 data-i18n="dialogTitle">${t('dialogTitle')}</h3>

        <div class="cg-topline">
          <input type="text" id="cg-f-name" maxlength="24" data-i18n-ph="namePh" placeholder="${t('namePh')}">
          <select id="cg-f-bind" aria-label="${t('bindProfile')}"></select>
        </div>

        ${buildField('grind', 'grind', '0–1500')}
        ${buildField('feed', 'feed', '0–150')}
        ${buildField('rpm', 'rpm', '0–1500')}

        <div class="cg-two">
          <div class="cg-mini-col">
            <small data-i18n="startMode">${t('startMode')}</small>
            <div class="cg-seg" id="cg-f-mode">
              <button type="button" data-mode="manual" data-i18n="manual">${t('manual')}</button>
              <button type="button" data-mode="timer" data-i18n="timer">${t('timer')}</button>
              <button type="button" data-mode="auto" data-i18n="auto">${t('auto')}</button>
            </div>
          </div>
          <div class="cg-mini-col">
            <small data-i18n="instantShort">${t('instantShort')}</small>
            <div class="cg-seg" id="cg-f-instant">
              <button type="button" data-instant="yes" data-i18n="yes">${t('yes')}</button>
              <button type="button" data-instant="no" data-i18n="no">${t('no')}</button>
            </div>
          </div>
        </div>

        <div class="cg-actions">
          <button type="button" class="cancel" data-i18n="cancel">${t('cancel')}</button>
          <button type="button" class="save" data-i18n="save">${t('save')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    applyLabels(modal);

    const f = {
        name: modal.querySelector('#cg-f-name'),
        bind: modal.querySelector('#cg-f-bind'),
        mode: modal.querySelector('#cg-f-mode'),
        instant: modal.querySelector('#cg-f-instant')
    };
    els.draftOutputs = {};
    modal.querySelectorAll('[data-out]').forEach(node => {
        els.draftOutputs[node.dataset.out] = node;
    });

    // Tap once = one step; hold = repeat after a short delay (thumb-friendly).
    modal.querySelectorAll('.cg-nudge').forEach(button => {
        const field = button.parentElement.querySelector('[data-out]').dataset.out;
        let timer = null;
        let repeat = null;
        const start = event => {
            event.preventDefault();
            clearTimeout(timer);
            clearInterval(repeat);
            timer = setTimeout(() => {
                repeat = setInterval(() => nudge(field, Number(button.dataset.dir)), 110);
            }, 350);
        };
        const end = () => {
            clearTimeout(timer);
            clearInterval(repeat);
            timer = repeat = null;
        };
        button.addEventListener('pointerdown', start);
        button.addEventListener('pointerup', end);
        button.addEventListener('pointerleave', end);
        button.addEventListener('pointercancel', end);
        button.addEventListener('click', () => nudge(field, Number(button.dataset.dir)));
    });

    modal.querySelectorAll('[data-steps]').forEach(group => {
        const field = group.dataset.steps;
        group.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            draft.step[field] = Number(button.dataset.step);
            group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === button));
        });
    });

    f.mode.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button) f.mode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === button));
    });
    f.instant.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button) f.instant.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === button));
    });

    modal.querySelector('.cancel').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });

    modal.querySelector('.save').addEventListener('click', () => {
        const r = recipe();
        const typed = f.name.value.trim();
        const autoName = new RegExp('^(?:' + I18N.en.recipe + '|配方)\\s*' + (state.index + 1) + '$');
        r.name = typed && !autoName.test(typed) ? typed : `配方${state.index + 1}`;
        r.grind = draft.grind;
        r.feed = draft.feed;
        r.rpm = draft.rpm;
        r.mode = f.mode.querySelector('button.on')?.dataset.mode || 'auto';
        r.instant = f.instant.querySelector('button.on')?.dataset.instant === 'yes';
        const bound = state.profiles.find(p => p.id === f.bind.value);
        r.bindId = bound ? bound.id : '';
        r.bindName = bound ? bound.title : '';
        saveRecipes();
        // Instant mode writes on save, so START is immediately usable and SET stays hidden.
        // Explicit mode leaves the values pending until the user presses SET.
        if (r.instant) {
            state.applied = true;
            pushAll().then(
                () => { flash(t('setDone')); updateButtons(); },
                error => { state.applied = false; updateButtons(); flash(t('pushFail') + error.message); }
            );
        } else {
            state.applied = false;
        }
        render();
        syncTile(r.grind);
        modal.hidden = true;
    });

    els.dialog = modal;
    els.dialogFields = f;
}

function openDialog() {
    if (!els.dialog) buildDialog();
    const r = recipe();
    const f = els.dialogFields;
    f.name.value = displayName(r);
    draft.grind = r.grind;
    draft.feed = r.feed;
    draft.rpm = r.rpm;
    for (const field of ['grind', 'feed', 'rpm']) {
        if (els.draftOutputs[field]) els.draftOutputs[field].textContent = draft[field];
        const group = els.dialog.querySelector(`[data-steps="${field}"]`);
        if (group) {
            group.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.step) === draft.step[field]));
        }
    }
    f.mode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === r.mode));
    f.instant.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.instant === (r.instant ? 'yes' : 'no')));
    fillBindOptions(f.bind);
    els.dialog.hidden = false;
}

/* ---------- floating panel ---------- */

function buildPanel() {
    const panel = document.createElement('section');
    panel.id = 'crystal-panel';
    panel.setAttribute('aria-label', 'CRYSTAL grinder');
    panel.innerHTML = `
      <div class="cg-head" id="cg-drag">
        <span class="cg-grip" aria-hidden="true">⋮⋮</span>
        <span class="cg-recipe" id="cg-name">配方1</span>
        <span class="cg-index" id="cg-index">1/10</span>
      </div>

      <div class="cg-nav">
        <button type="button" class="cg-arrow" data-nav="-1" aria-label="上一个配方">‹</button>
        <button type="button" class="cg-arrow" data-nav="1" aria-label="下一个配方">›</button>
      </div>

      <div class="cg-sub">
        <span class="cg-dot" id="cg-dot"></span>
        <span class="cg-state" id="cg-state">未连接</span>
        <span class="cg-sep">·</span>
        <span class="cg-mode" id="cg-mode">自动</span>
      </div>

      <div class="cg-main">
        <button type="button" class="cg-grind" id="cg-edit" aria-label="Edit grinder recipe">
          <b id="cg-grind">0</b>
          <span data-i18n="grind">研磨度</span>
        </button>
        <div class="cg-side">
          <div class="cg-mini"><span data-i18n="rpm">转速</span><b id="cg-rpm">0</b></div>
          <div class="cg-mini"><span data-i18n="feed">下豆</span><b id="cg-feed">0</b></div>
        </div>
      </div>

      <div class="cg-buttons">
        <button type="button" class="cg-btn set" id="cg-set">SET</button>
        <button type="button" class="cg-btn start" id="cg-start">START</button>
        <button type="button" class="cg-btn stop" id="cg-stop">STOP</button>
      </div>

      <div class="cg-foot">
        <span class="cg-bind-label" data-i18n="bind">绑定</span>
        <span class="cg-bind" id="cg-bind">未绑定</span>
        <span class="cg-hint" id="cg-hint"></span>
      </div>`;

    els.panel = panel;
    els.name = panel.querySelector('#cg-name');
    els.mode = panel.querySelector('#cg-mode');
    els.dot = panel.querySelector('#cg-dot');
    els.state = panel.querySelector('#cg-state');
    els.index = panel.querySelector('#cg-index');
    els.grind = panel.querySelector('#cg-grind');
    els.rpm = panel.querySelector('#cg-rpm');
    els.feed = panel.querySelector('#cg-feed');
    els.bind = panel.querySelector('#cg-bind');
    els.set = panel.querySelector('#cg-set');
    els.start = panel.querySelector('#cg-start');
    els.stop = panel.querySelector('#cg-stop');
    els.hint = panel.querySelector('#cg-hint');

    panel.addEventListener('click', event => {
        const nav = event.target.closest('[data-nav]');
        if (nav) stepRecipe(Number(nav.dataset.nav));
    });

    panel.querySelector('#cg-edit').addEventListener('click', openDialog);
    makeSwipe(panel);
    els.set.addEventListener('click', onSet);
    els.start.addEventListener('click', onStart);
    els.stop.addEventListener('click', onStop);

    applyLabels(panel);
    makeDraggable(panel, panel.querySelector('#cg-drag'));
    return panel;
}

function stepRecipe(direction) {
    state.index = (state.index + direction + SLOTS) % SLOTS;
    state.applied = false;
    saveRecipes();
    render();
    syncTile(recipe().grind);
}

// Horizontal swipe anywhere on the card body pages through the recipes.
function makeSwipe(panel) {
    let start = null;
    panel.addEventListener('pointerdown', event => {
        if (event.target.closest('button, select, input, #cg-drag')) return;
        start = { x: event.clientX, y: event.clientY };
    });
    panel.addEventListener('pointerup', event => {
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
        stepRecipe(dx < 0 ? 1 : -1);
    });
    panel.addEventListener('pointercancel', () => { start = null; });
}

function makeDraggable(panel, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        const rect = panel.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        handle.setPointerCapture(event.pointerId);
        panel.classList.add('dragging');
        event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
        if (!drag) return;
        const maxLeft = window.innerWidth - panel.offsetWidth - 8;
        const maxTop = window.innerHeight - panel.offsetHeight - 8;
        const left = Math.min(maxLeft, Math.max(8, event.clientX - drag.dx));
        const top = Math.min(maxTop, Math.max(8, event.clientY - drag.dy));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });
    const stop = () => {
        if (!drag) return;
        drag = null;
        panel.classList.remove('dragging');
        const rect = panel.getBoundingClientRect();
        savePosition(Math.round(rect.left), Math.round(rect.top));
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
}

// The WebView reports a layout viewport taller than the visible window on some
// DPI settings, so clamp against the visual viewport when it exists.
function viewportSize() {
    const vv = window.visualViewport;
    return {
        width: Math.round(vv && vv.width ? vv.width : window.innerWidth),
        height: Math.round(vv && vv.height ? vv.height : window.innerHeight)
    };
}

function placePanel(panel) {
    const saved = loadPosition();
    const clamp = () => {
        const view = viewportSize();
        const width = panel.offsetWidth || 300;
        const height = panel.offsetHeight || 260;
        const maxLeft = Math.max(8, view.width - width - 8);
        const maxTop = Math.max(8, view.height - height - 8);
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            panel.style.left = `${Math.min(maxLeft, Math.max(8, saved.left))}px`;
            panel.style.top = `${Math.min(maxTop, Math.max(8, saved.top))}px`;
            panel.style.right = 'auto';
        } else {
            panel.style.right = '22px';
            panel.style.top = '90px';
        }
    };
    clamp();
    // The first pass runs before the browser has laid the card out.
    requestAnimationFrame(clamp);
}

function init() {
    language = detectLanguage();
    const panel = buildPanel();
    document.body.appendChild(panel);
    placePanel(panel);

    loadRecipes();
    render();

    // Test hook: open the editor straight away (?crystal-dialog=1).
    if (new URLSearchParams(location.search).get('crystal-dialog') === '1') {
        setTimeout(openDialog, 500);
    }
    loadProfiles();
    refreshStatus();
    setInterval(refreshStatus, 5000);
    connectSocket();

    // Follow the espresso profile the machine is switched to.
    jsonFetch(`${API}/api/v1/workflow`).then(syncFromWorkflow).catch(() => {});
    import('./api.js')
        .then(module => module.onWorkflowUpdated?.(workflow => { syncFromWorkflow(workflow); }))
        .catch(() => {});

    // Follow the skin's own language switcher.
    document.addEventListener('streamline:languagechange', event => {
        const next = String(event.detail && event.detail.language ? event.detail.language : '').toLowerCase();
        language = next.startsWith('zh') ? 'zh' : 'en';
        applyLabels(els.panel);
        if (els.dialog) {
            applyLabels(els.dialog);
            if (els.dialogFields) fillBindOptions(els.dialogFields.bind);
        }
        render();
    });

    window.addEventListener('resize', () => {
        const rect = panel.getBoundingClientRect();
        const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
        panel.style.left = `${Math.min(maxLeft, Math.max(8, rect.left))}px`;
        panel.style.top = `${Math.min(maxTop, Math.max(8, rect.top))}px`;
        panel.style.right = 'auto';
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
