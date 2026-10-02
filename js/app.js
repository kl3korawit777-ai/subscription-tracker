import { calendarHTML, shiftMonth, categoryBadge, CATEGORIES, esc, fmtPrice } from './calendar.js';
import { upcomingPayments, trialAlerts, paymentsInRange, addDays, monthSchedule } from './recurrence.js';
import { buildICS, downloadICS, downloadText } from './ics.js';
import { runMigration, buildBackup, backupFilename } from './migrate.js';
import { isFirebaseConfigured } from './firebase-config.js';
import { onUser, signInWithGoogle, signOutUser, authErrorMessage, watchSync } from './firebase.js';
import { computeSyncState, SYNC_LABELS } from './syncstate.js';
import { settingsHTML, loginHTML } from './settings.js';
import { dashboardHTML, toThb, monthTotalThb, RATE_DEFAULTS } from './dashboard.js';
import { resolvePeriod } from './analytics.js';
import { dayWord } from './summaryText.js';
import { trashHTML, splitTrash, addToTrash } from './trash.js';
import { mergeCategories, normalizeItem, categoryName, DEFAULT_CATEGORY_ID } from './categories.js';
import { itemBadge, categoryMeta, iconBadgeHTML, normalizeIcon, LUCIDE, LUCIDE_KEYS, EMOJI_CHOICES } from './icons.js';
import { fileToIconDataUrl } from './iconImage.js';
import { guessCategory, applyGuess, chooseCategory, initialSource, suggestCategories } from './categoryGuess.js';
import {
  balance, parseAmount, fmtSatang, rankCategories, filterTransactions, groupByDay, sortTransactions,
  paymentToTransaction,
} from './ledger.js';
import {
  getAllSubscriptions, saveSubscription, deleteSubscription, restoreSubscription, restoreTransaction, purgeSubscription, purgeTransaction, emptyTrash,
  getAllPayments, recordPayment, undoPayment, getAllTransactions, saveTransaction, deleteTransaction, getMeta, setMeta, newId,
  getActivityLog, backendName, useFirestore, useLocal, onWriteError, getCloudAdapter, getLocalCounts, readAllLocal, clearLocalData, DB_VERSION,
} from './storage.js';

const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY'];
const CYCLES = { weekly: 'รายสัปดาห์', monthly: 'รายเดือน', yearly: 'รายปี', once: 'ครั้งเดียว' };
// รอบจ่ายที่แสดงในแถว: "รายเดือน" เป็นรอบปกติจึงไม่แสดง (แสดงเฉพาะรอบที่ต่างออกไป)
const cycleText = (i) => (i.cycle === 'monthly' ? '' : CYCLES[i.cycle]);
const catDot = (i) => `<span class="cdot" style="--c:${categoryMeta(i).color}" aria-hidden="true"></span>`;
const STATUSES = { active: 'ใช้งานอยู่', trial: 'ทดลองใช้', paused: 'พักไว้', cancelled: 'ยกเลิกแล้ว' };
const POPULAR = [
  { name: 'Netflix', categoryId: 'entertainment', icon: { type: 'lucide', value: 'film' } },
  { name: 'Spotify', categoryId: 'entertainment', icon: { type: 'lucide', value: 'music' } },
  { name: 'YouTube Premium', categoryId: 'entertainment', icon: { type: 'lucide', value: 'play' } },
  { name: 'iCloud', categoryId: 'cloud', icon: { type: 'lucide', value: 'cloud' } },
];

const SAMPLES = [
  { name: 'Netflix', category: 'บันเทิง', price: 419, currency: 'THB', cycle: 'monthly', startDate: '2025-01-31', trialEnd: '', payment: 'บัตรลงท้าย 1234', status: 'active', note: 'แพ็กเกจ Premium' },
  { name: 'Spotify', category: 'บันเทิง', price: 129, currency: 'THB', cycle: 'monthly', startDate: '2025-03-15', trialEnd: '', payment: 'บัตรลงท้าย 1234', status: 'active', note: '' },
  { name: 'ChatGPT Plus', category: 'AI', price: 20, currency: 'USD', cycle: 'monthly', startDate: '2025-09-01', trialEnd: '2025-09-15', payment: 'บัตรลงท้าย 5678', status: 'trial', note: 'ลองใช้ก่อนตัดสินใจ' },
];

const $ = (sel) => document.querySelector(sel);
const now = new Date();
const state = {
  items: [], payments: [], paid: {}, rates: { ...RATE_DEFAULTS },
  period: 'thisMonth', tables: {}, view: 'calendar', year: now.getFullYear(), month: now.getMonth() + 1, selected: null,
  filter: '', sortKey: 'name', sheet: null, stamped: null,
  fb: { status: 'off', user: null, loginError: '', busy: false, error: '' }, skipLogin: false, loading: false, localCounts: null, sync: null, syncRaw: { pending: false, fromCache: true, error: null },
  trash: { subscriptions: [], transactions: [] },
  categories: mergeCategories(), skippedSuggest: new Set(), // รายการหมวด (เก็บใน settings) / id ที่กด "ถามทีหลัง" ในรอบนี้
  transactions: [], lq: '', ftype: '', fcat: '', ffrom: '', fto: '', ledgerLimit: 50,
};

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const asDate = (s) => new Date(`${s}T00:00:00`);
// ช่องว่างไม่ตัดบรรทัด (NBSP) ระหว่างวันกับเดือน กัน "15" กับ "ก.ค." แยกคนละบรรทัด
const fmtDay = (s) => asDate(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }).replace(' ', ' ');
const money = (i) => (i.currency === 'THB' ? `${i.price.toLocaleString('th-TH')} บาท` : fmtPrice(i.price, i.currency));
const payKey = (i, date) => `${i.id}|${date}`;
const nextPayment = (i) => paymentsInRange(i, todayStr(), addDays(todayStr(), 400))[0] ?? null;

// ห้ามเก็บเลขบัตรเต็ม: ปฏิเสธถ้ามีตัวเลขรวม ≥ 13 หลัก (ไม่นับช่องว่าง/ขีด)
export const looksLikeFullCard = (s) => /\d{13,}/.test(s.replace(/[\s-]/g, ''));

// undo = ฟังก์ชันเลิกทำ (ถ้ามี จะแสดงปุ่ม "เลิกทำ" และอยู่นานขึ้น)
function toast(msg, undo) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('actionable', !!undo);
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-undo', textContent: 'เลิกทำ' });
    b.addEventListener('click', async () => { t.classList.remove('show'); await undo(); });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 2200);
}

// ---------- load ----------
async function loadData() {
  // ข้อมูลตัวอย่างใส่เฉพาะโหมดในเครื่อง (บัญชีใหม่บนคลาวด์เริ่มจากว่าง)
  if (backendName() === 'idb' && !(await getMeta('seeded'))) {
    for (const s of SAMPLES) await saveSubscription({ id: newId(), ...s });
    await setMeta('seeded', true);
  }
  // อ่านครั้งเดียวรวมรายการในถังขยะ แล้วแยกในเครื่อง (ไม่อ่านซ้ำจากคลาวด์)
  state.categories = mergeCategories(await getMeta('categories'));
  const subs = splitTrash(await getAllSubscriptions({ includeDeleted: true }));
  // ย้ายข้อมูลเดิมครั้งเดียว: เติม categoryId (ชื่อหมวดรุ่นเก่า → id) โดยไม่เปลี่ยนหมวดที่ผู้ใช้ตั้งไว้ และไม่ตั้ง categorySource
  // (การ์ด "แนะนำหมวดใหม่" จะถามเฉพาะรายการที่ยังเป็น "อื่น ๆ") ; รวมรายการในถังขยะด้วย เพื่อให้กู้คืนแล้วหมวดไม่หาย
  if (!(await getMeta('categories-v3'))) {
    for (const i of [...subs.live, ...subs.deleted]) {
      const n = normalizeItem(i, state.categories);
      if (n.categoryId !== i.categoryId || n.category !== i.category) await saveSubscription(n);
    }
    await setMeta('categories', state.categories.map(({ id, name, color }) => ({ id, name, color })));
    await setMeta('categories-v3', true);
  }
  state.items = subs.live.map((i) => normalizeItem(i, state.categories));
  state.trash.subscriptions = subs.deleted.map((i) => normalizeItem(i, state.categories));
  state.payments = await getAllPayments();
  const txs = splitTrash(await getAllTransactions({ includeDeleted: true }));
  state.transactions = txs.live;
  state.trash.transactions = txs.deleted;
  state.paid = Object.fromEntries(state.payments.map((p) => [p.id, true]));
  state.rates = { ...RATE_DEFAULTS, ...(await getMeta('rates')) };
  render();
}

// ---------- views ----------
function emptyHTML() {
  return `<div class="empty">
    <p class="lead">ยังไม่มีรายการ</p>
    <p class="sub">เพิ่มค่าบริการแรกเพื่อดูว่าเดือนนี้ต้องจ่ายวันไหน</p>
    <button class="btn primary" data-add>เพิ่มค่าบริการ</button>
  </div>`;
}

function trialBandHTML() {
  return trialAlerts(state.items, todayStr()).map((t) => `
    <button class="band" data-edit="${t.item.id}">
      <strong>Free trial ${esc(t.item.name)}</strong> หมด${dayWord(t.daysLeft)} — ยกเลิกก่อนโดนตัดเงิน ${esc(money(t.item))}
    </button>`).join('');
}

function nextUpHTML() {
  const due = upcomingPayments(state.items, todayStr()).filter((e) => !state.paid[payKey(e.item, e.date)]);
  if (!due.length) return '<div class="nextup"><p class="lead">7 วันนี้ยังไม่มีรายการตัดเงิน</p><p class="sub">ยังไม่ต้องจ่ายอะไร</p></div>';
  const [first, ...rest] = due;
  return `<button class="nextup" data-open-day="${first.date}">
    <span class="lead">${dayWord(first.daysLeft)}ตัดเงิน ${esc(first.item.name)} ${esc(money(first.item))}</span>
    <span class="sub">${rest.length ? `อีก ${rest.length} รายการใน 7 วันนี้` : 'ไม่มีรายการอื่นใน 7 วันนี้'}</span>
  </button>`;
}

function calendarView() {
  if (!state.items.length) return emptyHTML();
  const total = monthTotalThb(monthSchedule(state.items, state.year, state.month), state.rates);
  return trialBandHTML() + nextUpHTML() + suggestCardHTML() + calendarHTML({ ...state, totalThb: total });
}

// การ์ด "แนะนำหมวดใหม่": ยืนยันทีละรายการ (ข้อมูลเดิมที่ยัง "อื่น ๆ" แต่ชื่อเดาหมวดได้)
function suggestCardHTML() {
  const list = suggestCategories(state.items, state.skippedSuggest);
  if (!list.length) return '';
  const { item, categoryId } = list[0];
  const to = categoryName(state.categories, categoryId);
  return `<section class="suggest" aria-labelledby="sg-title">
    <h3 id="sg-title">แนะนำหมวดใหม่ <small>1 จาก ${list.length}</small></h3>
    <p class="suggest-line"><strong>${esc(item.name)}</strong> น่าจะอยู่หมวด ${categoryBadge(to, 'sm')}<strong>${esc(to)}</strong> <span class="sub">(ตอนนี้: ${esc(item.category)})</span></p>
    <div class="suggest-actions">
      <button type="button" class="btn primary" data-sugg-accept="${esc(item.id)}">ใช้หมวดนี้</button>
      <button type="button" class="btn" data-sugg-keep="${esc(item.id)}">คงเป็น ${esc(item.category)}</button>
      <button type="button" class="btn" data-sugg-later="${esc(item.id)}">ถามทีหลัง</button>
    </div>
  </section>`;
}

function listView() {
  if (!state.items.length) return emptyHTML();
  const key = state.sortKey;
  const sorted = state.items
    .filter((i) => !state.filter || i.category === state.filter)
    .sort((a, b) => {
      if (key === 'price') return toThb(b.price, b.currency, state.rates) - toThb(a.price, a.currency, state.rates);
      if (key === 'next') return (nextPayment(a) ?? '9999').localeCompare(nextPayment(b) ?? '9999');
      return a.name.localeCompare(b.name, 'th');
    });
  const row = (i) => {
    const next = nextPayment(i);
    return `<li><button class="row" data-edit="${i.id}">
      ${itemBadge(i)}
      <span class="grow"><strong>${esc(i.name)}</strong>
        <span class="sub">${catDot(i)}${[esc(i.category), cycleText(i), next ? `ตัดถัดไป ${fmtDay(next)}` : i.cycle === 'once' ? 'ผ่านแล้ว' : STATUSES[i.status]].filter(Boolean).join(' · ')}</span></span>
      <span class="right"><span class="money">${esc(fmtPrice(i.price, i.currency))}</span>${i.status === 'trial' || i.status === 'paused' ? `<span class="chip">${STATUSES[i.status]}</span>` : ''}</span>
    </button></li>`;
  };
  const active = sorted.filter((i) => i.status !== 'cancelled');
  const cancelled = sorted.filter((i) => i.status === 'cancelled');
  const group = (title, list) => (list.length ? `<h3>${title} <small>${list.length}</small></h3><ul class="rows">${list.map(row).join('')}</ul>` : '');
  return `<div class="page-head"><h2>รายการสมัครบริการ</h2><button class="btn primary" data-add>เพิ่มบริการ</button></div>
    ${trialBandHTML()}${suggestCardHTML()}
    <div class="controls">
      <label>เรียงตาม<select id="sort" data-sort>
        <option value="name" ${key === 'name' ? 'selected' : ''}>ชื่อ</option>
        <option value="price" ${key === 'price' ? 'selected' : ''}>ราคา (มาก→น้อย)</option>
        <option value="next" ${key === 'next' ? 'selected' : ''}>วันตัดเงินถัดไป</option>
      </select></label>
      <label>หมวด<select id="filter" data-filter>
        <option value="">ทั้งหมด</option>
        ${CATEGORIES.map((c) => `<option ${c === state.filter ? 'selected' : ''}>${c}</option>`).join('')}
      </select></label>
    </div>
    ${group('ใช้อยู่', active)}${group('ยกเลิกแล้ว', cancelled)}
    ${sorted.length ? '' : '<p class="empty-line">ไม่มีรายการในหมวดนี้</p>'}`;
}

let refocus = null;
function render(refocusSel = null) {
  if (refocusSel) refocus = refocusSel;
  const v = state.view;
  if (state.loading) { $('#app').innerHTML = '<p class="loading" role="status">กำลังโหลดข้อมูล…</p>'; return; }
  const gated = state.fb.status === 'signedOut' && !state.skipLogin;
  document.body.classList.toggle('gated', gated);
  document.body.classList.toggle('wide-page', v === 'summary' && !gated); // หน้าสรุปบนจอกว้างใช้ 2 คอลัมน์
  if (gated) { $('#app').innerHTML = loginHTML(state.fb); return; }
  $('#app').innerHTML = v === 'trash' ? trashHTML(state.trash) : v === 'settings' ? settingsHTML(state) : v === 'calendar' ? calendarView() : v === 'list' ? listView() : v === 'ledger' ? ledgerView() : dashboardHTML(state);
  if (v === 'ledger') updateLedger();
  const navView = v === 'trash' ? 'settings' : v; // ถังขยะเป็นหน้าย่อยของตั้งค่า
  document.querySelectorAll('#nav [data-view], .topbar [data-view]').forEach((b) => (b.getAttribute('data-view') === navView ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (refocus) { $(refocus)?.focus(); refocus = null; }
}

// ---------- bottom sheet ----------
let lastFocusSel = null;
const focusSelFor = (el) => {
  const h = el?.closest?.('[data-day],[data-edit],[data-add],[data-open-day],[data-quick],[data-tx]');
  if (!h) return null;
  const a = ['data-day', 'data-edit', 'data-open-day', 'data-tx'].find((n) => h.hasAttribute(n));
  if (a) return `[${a}="${h.getAttribute(a)}"]`;
  return h.hasAttribute('data-quick') ? '[data-quick]' : '[data-add]';
};

const desktopMQ = window.matchMedia('(min-width: 1024px)');
const isDesktop = () => desktopMQ.matches;
desktopMQ.addEventListener('change', () => { if (state.sheet) renderSheet(); });

function renderSheet(fresh = false) {
  const root = $('#sheet');
  const s = state.sheet;
  const desk = isDesktop();
  const modal = !!s && !desk; // มือถือ: modal บล็อกหน้าหลัง / เดสก์ท็อป: แผงขวาที่เปิดค้างไว้ ใช้หน้าหลักต่อได้
  document.body.classList.toggle('lock', modal);
  document.body.classList.toggle('panel-open', !!s && desk);
  $('#app').inert = modal;
  $('#nav').inert = modal;
  $('.topbar').inert = modal;
  if (!s) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  root.innerHTML = `${desk ? '' : '<div class="backdrop" data-close></div>'}
    <div class="sheet${fresh ? ' enter' : ''}" role="dialog" aria-modal="${!desk}" aria-labelledby="sheet-title" tabindex="-1">
      <div class="grab" aria-hidden="true"></div>
      <button class="panel-close" data-close aria-label="ปิดแผง" title="ปิดแผง (Esc)">×</button>
      <div class="sheet-body">${s.type === 'day' ? dayHTML(s.date) : s.type === 'quick' ? quickHTML(s.tx) : s.type === 'txview' ? txViewHTML(s.tx) : s.type === 'migrate' ? migrateHTML(s.m) : formHTML(s.item)}</div>
    </div>`;
  // บันทึกด่วน: โฟกัสช่องจำนวนเงินทันที (ยังอยู่ใน gesture ของการกด จึงเปิดคีย์บอร์ดมือถือได้)
  // เดสก์ท็อป: ฟอร์มเพิ่มบริการโฟกัสช่องชื่อ ส่วนแผงรายละเอียดวันไม่แย่งโฟกัส (กดวันอื่นต่อได้)
  const first = fresh && (root.querySelector('[data-autofocus]') || (desk && root.querySelector('#f-name')));
  if (first) first.focus({ preventScroll: true });
  else if (fresh && !(desk && s.type === 'day')) root.querySelector('.sheet').focus();
}

function closeSheet() {
  if (state.sheet?.type === 'migrate' && state.sheet.m.phase === 'running') return; // ห้ามปิดระหว่างย้ายข้อมูล
  state.sheet = null;
  state.selected = null;
  renderSheet();
  render(lastFocusSel);
}

function stampHTML(p, anim) {
  const when = new Date(p.paidAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  return `<div class="stamp${anim ? ' anim' : ''}" role="img" aria-label="จ่ายแล้ว เมื่อ ${when}"><b>จ่ายแล้ว</b><small>${when}</small></div>`;
}

function dayHTML(date) {
  const entries = state.items.filter((i) => paymentsInRange(i, date, date).length);
  const heading = asDate(date).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cards = entries.map((i) => {
    const key = payKey(i, date);
    const p = state.payments.find((x) => x.id === key);
    return `<article class="entry">
      <div class="entry-top">${itemBadge(i)}
        <div class="grow"><strong>${esc(i.name)}</strong><div class="sub">${catDot(i)}${[esc(i.category), cycleText(i), STATUSES[i.status]].filter(Boolean).join(' · ')}</div></div>
        <span class="money price">${esc(fmtPrice(i.price, i.currency))}</span></div>
      <div class="sub">ช่องทางจ่าย: ${esc(i.payment || '—')}</div>
      ${i.note ? `<div class="sub">โน้ต: ${esc(i.note)}</div>` : ''}
      <div class="slot">
        <div class="slot-actions">
          ${p ? `<button class="btn" data-unpay="${key}">ยกเลิกตรา</button>` : `<button class="btn primary" data-pay="${key}">จ่ายแล้ว</button>`}
          <button class="btn" data-edit="${i.id}">แก้ไข</button>
        </div>
        ${p ? stampHTML(p, state.stamped === key) : ''}
      </div>
    </article>`;
  }).join('');
  return `<h2 id="sheet-title">${heading}</h2>
    ${cards || '<p class="empty-line">วันนี้ไม่มีรายการตัดเงิน</p>'}
    <div class="sheet-actions"><button class="btn" data-close>ปิด</button></div>`;
}

// ---------- form ----------
const optionsHTML = (list, sel) => (Array.isArray(list) ? list.map((v) => [v, v]) : Object.entries(list))
  .map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');

function formHTML(item) {
  const editing = !!item.id;
  const cycle = item.cycle ?? 'monthly';
  const moreOpen = editing && (item.trialEnd || item.payment || item.note || item.status !== 'active');
  const catId = item.categoryId ?? DEFAULT_CATEGORY_ID;
  const catSource = initialSource(item);
  const stored = item.icon && normalizeIcon(item.icon, item.name).type === item.icon.type ? normalizeIcon(item.icon, item.name) : null; // เก็บเฉพาะไอคอนที่ผู้ใช้เลือก (ค่าเริ่มต้นตามชื่อ ไม่เก็บ)
  const catMeta = state.categories.find((c) => c.id === catId) ?? state.categories.at(-1);
  return `<h2 id="sheet-title">${editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h2>
    ${editing ? '' : `<div class="quick" role="group" aria-label="บริการยอดนิยม"><span class="sub">บริการยอดนิยม</span>
      ${POPULAR.map((p) => `<button type="button" class="chip-btn" data-chip="${p.name}">${categoryBadge(categoryName(state.categories, p.categoryId), 'sm')}${p.name}</button>`).join('')}</div>`}
    <form id="form" novalidate data-cat-source="${catSource}" data-icon-source="${stored ? 'user' : 'default'}">
      <div class="field"><label for="f-name">ชื่อ</label>
        <div class="name-row">
          <button type="button" class="icon-pick" id="icon-btn" data-icon-open aria-label="เลือกไอคอน" aria-expanded="false" aria-controls="icon-picker">${iconBadgeHTML(normalizeIcon(stored, item.name ?? ''), catMeta)}</button>
          <input id="f-name" name="name" autocomplete="off" value="${esc(item.name ?? '')}" aria-describedby="e-name">
        </div>
        <input type="hidden" name="icon" value="${stored ? esc(JSON.stringify(stored)) : ''}">
        <p class="err" id="e-name"></p>
        <div id="icon-picker" class="icon-picker" hidden></div></div>
      <fieldset class="chips cat-field"><legend>หมวด</legend>
        <div class="chip-row cat-scroll" role="radiogroup" aria-label="หมวด">
          ${state.categories.map((c) => `<label class="chip-opt"><input type="radio" name="categoryId" value="${esc(c.id)}" ${c.id === catId ? 'checked' : ''}><span>${categoryBadge(c.name, 'sm')}${esc(c.name)}</span></label>`).join('')}
        </div>
        <p class="hint" id="h-cat" aria-live="polite">${catSource === 'guess' ? 'เดาจากชื่อ เปลี่ยนได้' : ''}</p>
      </fieldset>
      <div class="field"><label for="f-price">ราคา</label>
        <div class="inline"><input id="f-price" name="price" inputmode="decimal" autocomplete="off" placeholder="เช่น 149" value="${item.price ?? ''}" aria-describedby="e-price">
        <select name="currency" aria-label="สกุลเงิน">${optionsHTML(CURRENCIES, item.currency ?? 'THB')}</select></div><p class="err" id="e-price"></p></div>
      <fieldset class="seg four"><legend>รอบการจ่าย</legend>
        ${Object.entries(CYCLES).map(([v, l]) => `<label><input type="radio" name="cycle" value="${v}" ${v === cycle ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </fieldset>
      <div class="field"><label for="f-date">วันตัดเงิน</label>
        <input id="f-date" name="startDate" type="date" value="${item.startDate ?? todayStr()}" aria-describedby="h-date e-date">
        <p class="hint" id="h-date">วันที่ตัดเงินครั้งไหนก็ได้ ระบบนับรอบถัดไปให้เอง</p><p class="err" id="e-date"></p></div>
      <details class="more" ${moreOpen ? 'open' : ''}><summary>รายละเอียดเพิ่มเติม</summary>
        <div class="field"><label for="f-trial">วันหมด Free trial</label><input id="f-trial" name="trialEnd" type="date" value="${item.trialEnd ?? ''}" aria-describedby="e-trial"><p class="err" id="e-trial"></p></div>
        <div class="field"><label for="f-pay">ช่องทางจ่าย</label><input id="f-pay" name="payment" autocomplete="off" placeholder="เช่น บัตรลงท้าย 1234" value="${esc(item.payment ?? '')}" aria-describedby="e-pay"><p class="err" id="e-pay"></p></div>
        <div class="field"><label for="f-status">สถานะ</label><select id="f-status" name="status">${optionsHTML(STATUSES, item.status ?? 'active')}</select></div>
        <div class="field"><label for="f-note">โน้ต</label><textarea id="f-note" name="note" rows="2" aria-describedby="e-note">${esc(item.note ?? '')}</textarea><p class="err" id="e-note"></p></div>
      </details>
      <div class="sheet-actions">
        ${editing ? '<button type="button" class="btn danger" data-delete>ย้ายไปถังขยะ</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>ยกเลิก</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`;
}

function validate(form) {
  const d = Object.fromEntries(new FormData(form));
  const errs = {};
  d.name = d.name.trim();
  const priceText = d.price.trim().replace(/,/g, '');
  const price = Number(priceText);
  if (!d.name) errs.name = 'ใส่ชื่อบริการ เช่น Netflix';
  if (!priceText || !Number.isFinite(price) || price < 0) errs.price = 'ใส่ราคาเป็นตัวเลข เช่น 149';
  if (!d.startDate) errs.date = 'เลือกวันตัดเงิน';
  if (d.trialEnd && d.startDate && d.trialEnd < d.startDate) errs.trial = 'วันหมด trial ต้องไม่ก่อนวันตัดเงิน';
  const cardMsg = 'ดูเหมือนเลขบัตรเต็ม ใส่แค่ชื่อเรียก เช่น "บัตรลงท้าย 1234"';
  if (looksLikeFullCard(d.payment)) errs.pay = cardMsg;
  if (looksLikeFullCard(d.note)) errs.note = cardMsg;
  return { d, price, errs };
}

function showErrors(form, errs) {
  const fieldFor = { name: 'f-name', price: 'f-price', date: 'f-date', trial: 'f-trial', pay: 'f-pay', note: 'f-note' };
  let first = null;
  for (const [k, id] of Object.entries(fieldFor)) {
    const input = form.querySelector(`#${id}`);
    const out = form.querySelector(`#e-${k}`);
    if (!input || !out) continue;
    out.textContent = errs[k] ?? '';
    if (errs[k]) { input.setAttribute('aria-invalid', 'true'); first ??= input; } else input.removeAttribute('aria-invalid');
  }
  // เปิด "รายละเอียดเพิ่มเติม" ถ้ามีข้อผิดพลาดซ่อนอยู่ข้างใน ไม่งั้นผู้ใช้จะไม่เห็นข้อความ
  if (errs.trial || errs.pay || errs.note) form.querySelector('details.more').open = true;
  first?.focus();
}

// ---- หมวดในฟอร์ม: อ่าน/ตั้งค่าสถานะ { categoryId, source } (source อยู่ที่ data-cat-source ของฟอร์ม) ----
const catState = (form) => ({ categoryId: form.querySelector('input[name=categoryId]:checked')?.value ?? DEFAULT_CATEGORY_ID, source: form.dataset.catSource });
function setCatState(form, { categoryId, source }) {
  const radio = [...form.querySelectorAll('input[name=categoryId]')].find((r) => r.value === categoryId);
  if (radio) radio.checked = true; // ตั้งด้วยโค้ดไม่ยิง change จึงไม่นับเป็นผู้ใช้เลือกเอง
  form.dataset.catSource = source;
  form.querySelector('#h-cat').textContent = source === 'guess' ? 'เดาจากชื่อ เปลี่ยนได้' : '';
  revealChip(radio?.closest('label'));
  refreshIconBtn(form);
}

// ---- ไอคอน: ค่าอยู่ใน hidden input name="icon" (JSON หรือว่าง = ตัวอักษรแรกของชื่อ) ----
const iconOf = (form) => { try { return JSON.parse(form.elements.icon.value); } catch { return null; } };
function refreshIconBtn(form) {
  const cat = state.categories.find((c) => c.id === catState(form).categoryId) ?? state.categories.at(-1);
  form.querySelector('#icon-btn').innerHTML = iconBadgeHTML(normalizeIcon(iconOf(form), form.querySelector('#f-name').value), cat);
}
function setIcon(form, icon, source) {
  form.elements.icon.value = icon ? JSON.stringify(icon) : '';
  form.dataset.iconSource = source;
  refreshIconBtn(form);
}

const ICON_TABS = { letter: 'ตัวอักษร', lucide: 'ไอคอน', emoji: 'อีโมจิ', image: 'รูป' };
function renderIconPicker(form, tab) {
  const body = {
    letter: '<p class="hint">ใช้ตัวอักษรแรกของชื่อบนสีของหมวด (ตามชื่อที่แก้ได้เสมอ)</p><button type="button" class="btn" data-icon-pick="letter">ใช้ตัวอักษรแรก</button>',
    lucide: `<div class="icon-grid">${LUCIDE_KEYS.map((k) => `<button type="button" class="icon-opt" data-icon-pick="lucide:${k}" aria-label="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[k]}</svg></button>`).join('')}</div>`,
    emoji: `<div class="icon-grid">${EMOJI_CHOICES.map((e) => `<button type="button" class="icon-opt" data-icon-pick="emoji:${e}" aria-label="${e}">${e}</button>`).join('')}</div>`,
    image: `<label class="btn" for="icon-file">เลือกรูป</label><input id="icon-file" type="file" accept="image/*" class="sr-only">
      <p class="hint">ย่อเป็น 96×96 WebP และต้องไม่เกิน 15 KB รูปอยู่ในเครื่อง/บัญชีของคุณเท่านั้น</p><p class="err" id="e-icon" role="alert"></p>`,
  }[tab];
  form.querySelector('#icon-picker').innerHTML = `<div class="icon-tabs" role="group" aria-label="ชนิดไอคอน">${Object.entries(ICON_TABS).map(([k, l]) => `<button type="button" class="chip-btn" data-icon-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>${body}`;
}

// เลื่อนแถบชิปเฉพาะแนวนอน ให้ชิปที่ระบบเลือกให้ (จากการเดา) โผล่ครบในแถบ ไม่เลื่อนทั้งหน้า
function revealChip(label) {
  const box = label?.closest('.cat-scroll');
  if (!box) return;
  const l = label.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // เลื่อนให้ชิปชิดขอบซ้ายของแถบ (ตรงจุด snap ของ scroll-snap จึงไม่เด้งกลับ)
  if (l.right > b.right || l.left < b.left) box.scrollBy({ left: l.left - b.left, behavior: 'instant' });
}

// การ์ดแนะนำหมวด: ยืนยันทีละรายการ ทุกปุ่มเลิกทำได้ (ยกเว้น "ถามทีหลัง" ซึ่งไม่ได้แก้ข้อมูล)
async function answerSuggestion(id, accept) {
  const before = state.items.find((i) => i.id === id);
  if (!before) return;
  const targetId = accept ? guessCategory(before.name) ?? before.categoryId : before.categoryId;
  const after = { ...before, categoryId: targetId, category: categoryName(state.categories, targetId), categorySource: 'user' };
  const put = async (item) => {
    await saveSubscription(item);
    state.items = state.items.map((i) => (i.id === item.id ? item : i));
    render('.suggest .btn.primary');
  };
  await put(after);
  toast(accept ? `ย้าย ${before.name} ไปหมวด ${after.category} แล้ว` : `จะไม่ถามเรื่องหมวดของ ${before.name} อีก`, () => put(before));
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form') return;
  e.preventDefault();
  const { d, price, errs } = validate(e.target);
  showErrors(e.target, errs);
  if (Object.keys(errs).length) return;
  const base = state.sheet.item;
  // categoryId คือค่าจริง ; category (ชื่อ) เก็บซ้ำเป็นสำเนาไว้ให้รุ่นเก่า/ไฟล์สำรองอ่านได้ ตอนแสดงผลจะหาชื่อใหม่จาก id เสมอ
  const saved = { ...base, ...d, price, id: base.id ?? newId(), category: categoryName(state.categories, d.categoryId), categorySource: e.target.dataset.catSource };
  // icon: เก็บเฉพาะที่ผู้ใช้เลือก (ว่าง = ตัวอักษรแรกของชื่อ ซึ่งตามชื่อเสมอ) ; ค่าผิดรูปถูกทิ้ง
  const pickedIcon = (() => { try { return JSON.parse(d.icon); } catch { return null; } })();
  const okIcon = pickedIcon && normalizeIcon(pickedIcon, '');
  saved.icon = okIcon && okIcon.type === pickedIcon.type ? okIcon : undefined;
  await saveSubscription(saved);
  state.items = [...state.items.filter((i) => i.id !== saved.id), saved];
  state.sheet = null;
  renderSheet();
  render(lastFocusSel);
  toast('บันทึกแล้ว');
});

// ---------- actions ----------
function openSheet(sheet, trigger) {
  const fresh = !state.sheet;
  if (fresh) lastFocusSel = focusSelFor(trigger);
  state.sheet = sheet;
  state.selected = sheet.type === 'day' ? sheet.date : null;
  renderSheet(fresh || sheet.type === 'form');
  render();
}

async function markPaid(key) {
  const [subId, date] = key.split('|');
  const item = state.items.find((i) => i.id === subId);
  if (!item) return;
  // บันทึกยอดจริง + snapshot ชื่อ/หมวด/อัตราแลกเปลี่ยน ณ ตอนจ่าย เพื่อให้ประวัติคงเดิมแม้แก้/ลบรายการภายหลัง
  const payment = {
    id: key, subId, date, name: item.name, category: item.category, categoryId: item.categoryId,
    amount: item.price, currency: item.currency,
    amountThb: toThb(item.price, item.currency, state.rates),
    paidAt: new Date().toISOString(),
  };
  await recordPayment(payment);
  state.payments = [...state.payments.filter((p) => p.id !== key), payment];
  state.paid[key] = true;
  state.transactions = [...state.transactions.filter((t) => t.paymentId !== key), paymentToTransaction(payment)];
  state.stamped = key; // เล่นแอนิเมชันตราเฉพาะครั้งที่เพิ่งกด
  renderSheet();
  render();
  $('#sheet').querySelector(`[data-unpay="${key}"]`)?.focus();
  setTimeout(() => { state.stamped = null; }, 800);
}

async function unpay(key) {
  await undoPayment(key);
  state.payments = state.payments.filter((p) => p.id !== key);
  delete state.paid[key];
  state.transactions = state.transactions.filter((t) => t.paymentId !== key);
  renderSheet();
  render();
  $('#sheet').querySelector(`[data-pay="${key}"]`)?.focus();
}

// ถังขยะ: ลบ = ย้ายเข้าถังขยะ (กู้คืนได้ มีปุ่ม "เลิกทำ") ; ลบถาวรเกิดเฉพาะในหน้าถังขยะ
const TRASH = {
  sub: { list: 'subscriptions', items: 'items', del: (id) => deleteSubscription(id), restore: (id) => restoreSubscription(id), purge: (id) => purgeSubscription(id) },
  tx: { list: 'transactions', items: 'transactions', del: (id) => deleteTransaction(id), restore: (id) => restoreTransaction(id), purge: (id) => purgeTransaction(id) },
};

async function moveToTrash(kind, item) {
  const k = TRASH[kind];
  const done = await k.del(item.id);
  if (state.trash[k.list].some((x) => x.id === item.id)) return; // กดลบซ้ำระหว่างรอ: ครั้งแรกจัดการไปแล้ว
  if (done === false) return toast('ลบไม่สำเร็จ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง');
  state[k.items] = state[k.items].filter((x) => x.id !== item.id);
  state.trash[k.list] = addToTrash(state.trash[k.list], item, new Date().toISOString());
  state.sheet = null;
  renderSheet();
  render();
  toast('ย้ายไปถังขยะแล้ว', () => restoreFromTrash(kind, item.id));
}

async function restoreFromTrash(kind, id) {
  const k = TRASH[kind];
  const item = state.trash[k.list].find((x) => x.id === id);
  if (!item) return;
  if ((await k.restore(id)) === false) return toast('กู้คืนไม่สำเร็จ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง');
  state.trash[k.list] = state.trash[k.list].filter((x) => x.id !== id);
  state[k.items] = [...state[k.items], { ...item, deletedAt: null }];
  render();
  toast('กู้คืนแล้ว');
}

async function purgeFromTrash(kind, id) {
  const k = TRASH[kind];
  if ((await k.purge(id)) === false) return toast('ลบถาวรไม่สำเร็จ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง');
  state.trash[k.list] = state.trash[k.list].filter((x) => x.id !== id);
  render();
  toast('ลบถาวรแล้ว');
}

// ลบ 2 ขั้น (ใช้กับการลบถาวร): กดครั้งแรกเปลี่ยนข้อความ กดซ้ำภายใน 4 วินาทีจึงลบจริง
function armDelete(el) {
  const label = el.textContent;
  el.dataset.armed = '1';
  el.textContent = 'กดอีกครั้งเพื่อยืนยันลบ';
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = label; } }, 4000);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-close]');
  if (!el) return;
  const d = el.dataset;
  if ('close' in d) return closeSheet();
  if (d.view) { state.view = d.view; window.scrollTo(0, 0); return render(); }
  if (d.vizToggle) { state.tables[d.vizToggle] = !state.tables[d.vizToggle]; return render(`[data-viz-toggle="${d.vizToggle}"]`); }
  if (d.catGo) { // จากแท่งหมวดในหน้าสรุป → หน้าบัญชีที่กรองหมวดนั้น + ช่วงเวลา/ประเภทเดียวกัน (ยอดจึงตรงกัน)
    const p = resolvePeriod(state.period, todayStr());
    Object.assign(state, { view: 'ledger', fcat: d.catGo, ftype: 'expense', ffrom: p.from ?? '', fto: p.to ?? '', lq: '', ledgerLimit: 50 });
    window.scrollTo(0, 0);
    return render();
  }
  if ('login' in d) return doLogin();
  if ('migrateStart' in d) return runMigrationUI();
  if ('migrateOpen' in d) return openMigration();
  if ('migrateLater' in d) { await setMeta(`local:declined:${state.fb.user.uid}`, true); return closeSheet(); }
  if ('backup' in d) return backupNow();
  if ('logout' in d) return signOutUser();
  if ('skipLogin' in d) { state.skipLogin = true; await setMeta('login-skipped', true); return render(); }
  if ('add' in d) return openSheet({ type: 'form', item: {} }, el);
  if ('quick' in d) return openSheet({ type: 'quick', tx: null }, el);
  if (d.tx) {
    const tx = state.transactions.find((t) => t.id === d.tx);
    return openSheet(tx.source === 'manual' ? { type: 'quick', tx } : { type: 'txview', tx }, el);
  }
  if ('ledgerMore' in d) { state.ledgerLimit += 50; return updateLedger(); }
  if ('clearFilters' in d) { Object.assign(state, { lq: '', ftype: '', fcat: '', ffrom: '', fto: '', ledgerLimit: 50 }); return render('#lq'); }
  if ('deleteTx' in d) return moveToTrash('tx', state.sheet.tx);
  if (d.restore) { const [kind, ...id] = d.restore.split(':'); return restoreFromTrash(kind, id.join(':')); }
  if (d.purge) {
    if (!el.dataset.armed) return armDelete(el);
    const [kind, ...id] = d.purge.split(':');
    return purgeFromTrash(kind, id.join(':'));
  }
  if ('emptyTrash' in d) {
    if (!el.dataset.armed) return armDelete(el);
    await emptyTrash();
    state.trash = { subscriptions: [], transactions: [] };
    render();
    return toast('ล้างถังขยะแล้ว');
  }
  if (d.day) return openSheet({ type: 'day', date: d.day }, el);
  if (d.openDay) {
    const [y, m] = d.openDay.split('-').map(Number);
    Object.assign(state, { year: y, month: m });
    return openSheet({ type: 'day', date: d.openDay }, el);
  }
  if (d.nav) return changeMonth(d.nav, `[data-nav="${d.nav}"]`);
  if ('iconOpen' in d) {
    const form = $('#form');
    const picker = form.querySelector('#icon-picker');
    picker.hidden = !picker.hidden;
    el.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) renderIconPicker(form, iconOf(form)?.type ?? 'letter');
    return;
  }
  if (d.iconTab) return renderIconPicker($('#form'), d.iconTab);
  if (d.iconPick) {
    const form = $('#form');
    const [type, ...rest] = d.iconPick.split(':');
    setIcon(form, type === 'letter' ? null : { type, value: rest.join(':') }, type === 'letter' ? 'default' : 'user');
    form.querySelector('#icon-picker').hidden = true;
    form.querySelector('#icon-btn').setAttribute('aria-expanded', 'false');
    return form.querySelector('#icon-btn').focus();
  }
  if (d.suggAccept) return answerSuggestion(d.suggAccept, true);
  if (d.suggKeep) return answerSuggestion(d.suggKeep, false);
  if (d.suggLater) { state.skippedSuggest.add(d.suggLater); return render('.suggest .btn.primary'); }
  if (d.pay) return markPaid(d.pay);
  if (d.unpay) return unpay(d.unpay);
  if (d.edit) return openSheet({ type: 'form', item: state.items.find((i) => i.id === d.edit) }, el);
  if (d.chip) {
    const p = POPULAR.find((x) => x.name === d.chip);
    const form = $('#form');
    form.name.value = p.name;
    const cur = catState(form);
    if (cur.source !== 'user') setCatState(form, { categoryId: p.categoryId, source: 'guess' }); // ผู้ใช้เลือกหมวดเองแล้ว → ไม่ทับ
    if (form.dataset.iconSource !== 'user') setIcon(form, p.icon, 'chip'); // ไอคอนที่ผู้ใช้เลือกเองก็ไม่ทับเช่นกัน
    else refreshIconBtn(form);
    form.querySelector('#e-name').textContent = '';
    form.name.removeAttribute('aria-invalid');
    return form.price.focus(); // ราคาให้กรอกเอง เพราะแต่ละแพ็กเกจไม่เท่ากัน
  }
  if ('delete' in d) return moveToTrash('sub', state.sheet.item);
  if (el.id === 'export') downloadICS(buildICS(state.items, todayStr()));
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'icon-file') { // อัปโหลดรูป → ย่อ 96×96 WebP ≤ 15 KB
    const form = t.form;
    const err = form.querySelector('#e-icon');
    const file = t.files[0];
    if (!file) return;
    err.textContent = 'กำลังย่อรูป…';
    try {
      setIcon(form, { type: 'image', value: await fileToIconDataUrl(file) }, 'user');
      form.querySelector('#icon-picker').hidden = true;
      form.querySelector('#icon-btn').setAttribute('aria-expanded', 'false');
      form.querySelector('#icon-btn').focus();
    } catch (er) {
      err.textContent = { 'too-big': 'รูปนี้ย่อแล้วยังใหญ่เกิน 15 KB ลองรูปที่เรียบกว่านี้', 'no-webp': 'เบราว์เซอร์นี้แปลงเป็น WebP ไม่ได้' }[er.message] ?? 'เปิดรูปนี้ไม่ได้ ลองไฟล์ภาพอื่น';
    }
    t.value = '';
    return;
  }
  if (t.name === 'categoryId' && t.form?.id === 'form') { // ผู้ใช้เลือกหมวดเอง → หยุดเดาจากชื่อ
    const next = chooseCategory(catState(t.form), t.value);
    t.form.dataset.catSource = next.source;
    t.form.querySelector('#h-cat').textContent = '';
    refreshIconBtn(t.form); // สีวงกลมตามหมวด
    return;
  }
  if (t.name === 'type' && t.form?.id === 'qform') {
    const cur = t.form.querySelector('input[name=category]:checked')?.value;
    $('#q-chips').innerHTML = chipsHTML(t.value, cur);
    return;
  }
  if (t.name === 'period') { state.period = t.value; return render('input[name="period"]:checked'); }
  if (t.name === 'ftype') { state.ftype = t.value; state.ledgerLimit = 50; return updateLedger(); }
  if (t.id === 'fcat') { state.fcat = t.value; state.ledgerLimit = 50; return updateLedger(); }
  if (t.id === 'ffrom' || t.id === 'fto') { state[t.id] = t.value; state.ledgerLimit = 50; return updateLedger(); }
  if (t.dataset.rate) {
    const v = Number(t.value.replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) {
      state.rates[t.dataset.rate] = v;
      await setMeta('rates', state.rates);
      render(`[data-rate="${t.dataset.rate}"]`);
    } else {
      t.value = state.rates[t.dataset.rate];
      toast('ใส่อัตราเป็นตัวเลขมากกว่า 0 เช่น 35');
    }
  } else if ('sort' in t.dataset) { state.sortKey = t.value; render('#sort'); }
  else if ('filter' in t.dataset) { state.filter = t.value; render('#filter'); }
});

// เปลี่ยนเดือน (ปุ่ม ‹ › และคีย์ลัด ← →) ; แผงรายละเอียดวันที่เปิดค้างอยู่จะปิดเมื่อวันนั้นไม่อยู่ในเดือนใหม่
function changeMonth(nav, refocusSel = null) {
  const t = new Date();
  Object.assign(state, nav === 'today' ? { year: t.getFullYear(), month: t.getMonth() + 1 } : shiftMonth(state.year, state.month, Number(nav)));
  if (state.sheet?.type === 'day' && !state.sheet.date.startsWith(`${state.year}-${pad(state.month)}`)) {
    state.sheet = null;
    renderSheet();
  }
  state.selected = state.sheet?.type === 'day' ? state.sheet.date : null;
  render(refocusSel);
}

// คีย์ลัด: N = บันทึกรายการใหม่, ← → = เปลี่ยนเดือน (ไม่ทำงานตอนพิมพ์ในช่องกรอก / ใช้ e.code เพื่อให้ใช้ได้ทั้งแป้นภาษาไทยและอังกฤษ)
const isTextEntry = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  || (el.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes(el.type)));
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (state.loading || document.body.classList.contains('gated') || state.sheet?.type === 'migrate') return;
  if (e.code === 'KeyN' && !isTextEntry(document.activeElement)) {
    const open = state.sheet;
    if (open?.type === 'quick' && !open.tx) { e.preventDefault(); $('#q-amount')?.focus(); return; }
    if (open && (open.type === 'form' || open.type === 'quick')) return; // กำลังกรอกฟอร์มอื่นอยู่ ไม่ทับ
    e.preventDefault();
    openSheet({ type: 'quick', tx: null }, document.activeElement);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    if (state.view !== 'calendar' || (state.sheet && !isDesktop())) return;
    e.preventDefault();
    changeMonth(e.key === 'ArrowLeft' ? '-1' : '1');
  }
});

document.addEventListener('keydown', (e) => {
  if (!state.sheet) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
  if (e.key !== 'Tab' || isDesktop()) return; // เดสก์ท็อปไม่ล็อกโฟกัสในแผง (ไม่ใช่ modal)
  const sheet = $('#sheet .sheet');
  const f = [...sheet.querySelectorAll('button, input, select, textarea, summary')].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---------- บันทึกด่วน (+) ----------
function chipsHTML(type, selected) {
  const names = rankCategories(state.transactions, type); // เรียงตามความถี่การใช้
  const pick = names.includes(selected) ? selected : names[0];
  return names.map((n) => `<label class="chip-opt"><input type="radio" name="category" value="${esc(n)}" ${n === pick ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('');
}

function quickHTML(tx) {
  const editing = !!tx;
  const type = tx?.type ?? 'expense';
  return `<h2 id="sheet-title">${editing ? 'แก้ไขรายการบัญชี' : 'บันทึกด่วน'}</h2>
    <form id="qform" novalidate>
      <fieldset class="seg two"><legend>ประเภท</legend>
        <label><input type="radio" name="type" value="expense" ${type === 'expense' ? 'checked' : ''}><span>รายจ่าย</span></label>
        <label><input type="radio" name="type" value="income" ${type === 'income' ? 'checked' : ''}><span>รายรับ</span></label>
      </fieldset>
      <div class="field"><label for="q-amount">จำนวนเงิน (บาท)</label>
        <input id="q-amount" class="amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" data-autofocus value="${editing ? tx.amount / 100 : ''}" aria-describedby="e-amount">
        <p class="err" id="e-amount"></p></div>
      <fieldset class="chips"><legend>หมวด</legend><div id="q-chips" class="chip-row">${chipsHTML(type, tx?.category)}</div></fieldset>
      <details class="more" ${editing && (tx.note || tx.date !== todayStr()) ? 'open' : ''}><summary>โน้ตและวันที่</summary>
        <div class="field"><label for="q-note">โน้ต</label><input id="q-note" name="note" autocomplete="off" placeholder="เช่น ข้าวกลางวัน" value="${esc(tx?.note ?? '')}" aria-describedby="e-qnote"><p class="err" id="e-qnote"></p></div>
        <div class="field"><label for="q-date">วันที่</label><input id="q-date" name="date" type="date" value="${tx?.date ?? todayStr()}" aria-describedby="e-qdate"><p class="err" id="e-qdate"></p></div>
      </details>
      <div class="sheet-actions">
        ${editing ? '<button type="button" class="btn danger" data-delete-tx>ย้ายไปถังขยะ</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>ยกเลิก</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`;
}

function txViewHTML(t) {
  const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<h2 id="sheet-title">${esc(t.name || t.category)}</h2>
    <dl class="facts">
      ${row('ประเภท', t.type === 'income' ? 'รายรับ' : 'รายจ่าย')}
      ${row('จำนวนเงิน', `<span class="money">${fmtSatang(t.type === 'income' ? t.amount : -t.amount, { signed: true })}</span>`)}
      ${row('หมวด', esc(t.category))}
      ${row('วันที่จ่าย', fmtDay(t.date))}
      ${t.dueDate ? row('ครบกำหนด', fmtDay(t.dueDate)) : ''}
      ${t.original ? row('ยอดเดิม', esc(fmtPrice(t.original.amount / 100, t.original.currency))) : ''}
    </dl>
    ${t.needsReview ? '<p class="err">รายการนี้ไม่มียอดเป็นบาทตอนย้ายข้อมูล ตรวจยอดอีกครั้งด้วยยอดเดิม</p>' : ''}
    <p class="sub">รายการนี้มาจากการกด "จ่ายแล้ว" ในปฏิทิน ถ้าต้องการยกเลิก ให้กด "ยกเลิกตรา" ที่วันนั้นในปฏิทิน</p>
    <div class="sheet-actions"><span class="spacer"></span><button class="btn" data-close>ปิด</button></div>`;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'qform') return;
  e.preventDefault();
  const form = e.target;
  if (form.dataset.busy) return;
  const d = Object.fromEntries(new FormData(form));
  const amount = parseAmount(d.amount);
  const errs = {};
  if (amount === null) errs.amount = 'ใส่จำนวนเงินเป็นตัวเลข เช่น 120 หรือ 59.50';
  if (!d.date) errs.qdate = 'เลือกวันที่';
  if (looksLikeFullCard(d.note)) errs.qnote = 'ดูเหมือนเลขบัตรเต็ม ลบออกแล้วใส่โน้ตสั้น ๆ แทน เช่น "ข้าวกลางวัน"';
  const fields = { amount: 'q-amount', qnote: 'q-note', qdate: 'q-date' };
  let first = null;
  for (const [k, id] of Object.entries(fields)) {
    const input = form.querySelector(`#${id}`);
    form.querySelector(`#e-${k}`).textContent = errs[k] ?? '';
    if (errs[k]) { input.setAttribute('aria-invalid', 'true'); first ??= input; } else input.removeAttribute('aria-invalid');
  }
  if (errs.qnote || errs.qdate) form.querySelector('details.more').open = true;
  if (first) return first.focus();

  form.dataset.busy = '1';
  const base = state.sheet.tx;
  const note = d.note.trim();
  const t = {
    ...(base ?? {}), id: base?.id ?? `tx:${newId()}`, type: d.type, category: d.category, amount, currency: 'THB',
    date: d.date, note, name: note || d.category, source: 'manual', createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  await saveTransaction(t);
  state.transactions = [...state.transactions.filter((x) => x.id !== t.id), t];
  if (isDesktop() && !base) {
    state.sheet = { type: 'quick', tx: null };
    renderSheet(true);
    render();
    return toast('บันทึกแล้ว');
  }
  state.sheet = null;
  renderSheet();
  render(lastFocusSel);
  toast('บันทึกแล้ว');
});

// ---------- หน้าบัญชี ----------
function ledgerView() {
  if (!state.transactions.length) {
    return `<div class="empty"><p class="lead">ยังไม่มีรายการบัญชี</p>
      <p class="sub">กด + เพื่อบันทึกรายรับหรือรายจ่ายรายการแรก</p>
      <button class="btn primary" data-quick>บันทึกรายการ</button></div>`;
  }
  let bal;
  try { bal = fmtSatang(balance(state.transactions)); } catch { bal = '—'; }
  const cats = [...new Set(state.transactions.map((t) => t.category))].sort((a, b) => a.localeCompare(b, 'th'));
  const moreOn = state.fcat || state.ffrom || state.fto;
  return `<div class="bal"><span class="sub">ยอดคงเหลือ (รายรับ − รายจ่าย ทั้งหมด)</span><strong class="money">${bal}</strong></div>
    <div class="field"><label for="lq">ค้นหา</label>
      <input id="lq" type="search" autocomplete="off" placeholder="ชื่อ หมวด โน้ต หรือจำนวนเงิน" value="${esc(state.lq)}"></div>
    <fieldset class="seg"><legend>ประเภท</legend>
      ${[['', 'ทั้งหมด'], ['income', 'รายรับ'], ['expense', 'รายจ่าย']].map(([v, l]) => `<label><input type="radio" name="ftype" value="${v}" ${state.ftype === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </fieldset>
    <details class="more" ${moreOn ? 'open' : ''}><summary>ตัวกรองเพิ่มเติม${moreOn ? ' (กำลังใช้)' : ''}</summary>
      <div class="field"><label for="fcat">หมวด</label><select id="fcat"><option value="">ทั้งหมด</option>${cats.map((c) => `<option ${c === state.fcat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="two-col">
        <div class="field"><label for="ffrom">ตั้งแต่วันที่</label><input id="ffrom" type="date" value="${state.ffrom}"></div>
        <div class="field"><label for="fto">ถึงวันที่</label><input id="fto" type="date" value="${state.fto}"></div>
      </div>
    </details>
    <p class="sum-line" id="ledger-sum" aria-live="polite"></p>
    <div id="ledger-list"></div>`;
}

const dayLabel = (date) => {
  const today = todayStr();
  if (date === today) return 'วันนี้';
  if (date === addDays(today, -1)) return 'เมื่อวาน';
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return asDate(date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

function txRow(t) {
  const inc = t.type === 'income';
  return `<li><button class="tx" data-tx="${esc(t.id)}">
    <span class="tx-sign" aria-hidden="true">${inc ? '+' : '−'}</span>
    <span class="grow"><strong>${esc(t.name || t.category)}</strong>
      <span class="sub">${[(t.name || t.category) !== t.category ? esc(t.category) : null, t.source === 'payment' ? 'จากปฏิทิน' : (t.name || t.category) === t.category ? 'บันทึกเอง' : null, t.needsReview ? 'ต้องตรวจยอด' : null].filter(Boolean).join(' · ')}</span></span>
    <span class="money"><span class="sr-only">${inc ? 'รายรับ ' : 'รายจ่าย '}</span>${fmtSatang(inc ? t.amount : -t.amount, { signed: true })}</span>
  </button></li>`;
}

let ledgerObserver;
// เลื่อนดูย้อนหลังได้ไม่จำกัด: กรอง/จัดกลุ่มทั้งหมดในหน่วยความจำ แต่วาดทีละ 50 รายการ แล้วโหลดเพิ่มเมื่อเลื่อนใกล้สุดท้าย (หรือกดปุ่ม)
function updateLedger() {
  const list = $('#ledger-list');
  if (!list) return;
  ledgerObserver?.disconnect();
  const filtered = sortTransactions(filterTransactions(state.transactions, { query: state.lq, type: state.ftype, category: state.fcat, from: state.ffrom, to: state.fto }));
  let inc = 0, exp = 0;
  for (const t of filtered) { if (t.type === 'income') inc += t.amount; else exp += t.amount; }
  const filtering = state.lq.trim() || state.ftype || state.fcat || state.ffrom || state.fto;
  $('#ledger-sum').innerHTML = `${filtered.length.toLocaleString('th-TH')} รายการ${filtered.length ? ` · รับ ${fmtSatang(inc, { signed: true })} · จ่าย ${fmtSatang(-exp)}` : ''}${filtering ? ' <button class="link" data-clear-filters>ล้างตัวกรอง</button>' : ''}`;

  let remaining = state.ledgerLimit;
  let html = '';
  for (const g of groupByDay(filtered)) {
    if (remaining <= 0) break;
    const shown = g.items.slice(0, remaining);
    remaining -= shown.length;
    html += `<section class="day-group"><h3 class="day-head"><span>${dayLabel(g.date)}</span><span class="money">${fmtSatang(g.net, { signed: true })}</span></h3><ul class="tx-list">${shown.map(txRow).join('')}</ul></section>`;
  }
  const left = filtered.length - state.ledgerLimit;
  list.innerHTML = !filtered.length
    ? '<p class="empty-line">ไม่พบรายการที่ตรงกัน ลองเปลี่ยนคำค้นหา หรือล้างตัวกรอง</p>'
    : html + (left > 0 ? `<div class="more-wrap" id="ledger-more"><button class="btn" data-ledger-more>โหลดรายการเก่ากว่า (อีก ${left.toLocaleString('th-TH')})</button></div>` : '<p class="end-line">ถึงรายการแรกสุดแล้ว</p>');
  const sentinel = $('#ledger-more');
  if (sentinel && 'IntersectionObserver' in window) {
    ledgerObserver = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      ledgerObserver.disconnect();
      state.ledgerLimit += 50;
      updateLedger();
    }, { rootMargin: '400px' });
    ledgerObserver.observe(sentinel);
  }
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'f-name' && e.target.form?.id === 'form') { // พิมพ์ชื่อ → เดาหมวด (หยุดเมื่อผู้ใช้เลือกเอง)
    const cur = catState(e.target.form);
    const next = applyGuess(cur, e.target.value);
    if (next !== cur) setCatState(e.target.form, next);
    refreshIconBtn(e.target.form); // ตัวอักษรแรกตามชื่อที่พิมพ์
    return;
  }
  if (e.target.id !== 'lq') return;
  state.lq = e.target.value;
  state.ledgerLimit = 50;
  clearTimeout(updateLedger.timer);
  updateLedger.timer = setTimeout(updateLedger, 120);
});

// ---------- บัญชี (Firebase) และสถานะซิงก์ ----------
let stopSync = null;

function updateSync() {
  const s = computeSyncState({ signedIn: !!state.fb.user, online: navigator.onLine, ...state.syncRaw });
  state.sync = s;
  const el = $('#sync');
  el.hidden = !s;
  if (s) { el.dataset.state = s; el.textContent = SYNC_LABELS[s]; }
  // หน้าตั้งค่าแสดงสถานะเป็นข้อความด้วย: วาดใหม่เฉพาะตอนไม่ได้พิมพ์อยู่ (ไม่ให้ช่องอัตราแลกเปลี่ยนเสียโฟกัส)
  if (state.view === 'settings' && !document.activeElement?.matches('input')) render();
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

async function doLogin() {
  if (state.fb.busy) return;
  state.fb.busy = true;
  state.fb.loginError = '';
  render();
  try { await signInWithGoogle(); } catch (err) { state.fb.loginError = authErrorMessage(err); }
  state.fb.busy = false;
  render();
}

// ---------- ย้ายข้อมูลเก่าในเครื่องขึ้นคลาวด์ ----------
const MIGRATE_STEPS = [['backup', 'ดาวน์โหลดไฟล์สำรอง JSON'], ['upload', 'อัปโหลดทั้งหมดขึ้นบัญชี'], ['verify', 'ตรวจจำนวนให้ครบ'], ['cleanup', 'ลบข้อมูลเดิมในเครื่อง']];
const sumCounts = (c) => Object.values(c ?? {}).reduce((a, b) => a + b, 0);

async function refreshLocalCounts() {
  state.localCounts = await getLocalCounts();
}

function openMigration() {
  lastFocusSel = null;
  state.sheet = { type: 'migrate', m: { phase: 'confirm', counts: state.localCounts, steps: {}, error: null } };
  state.selected = null;
  renderSheet(true);
}

function migrateErrorText(err) {
  const msg = err?.message ?? '';
  switch (err?.stage) {
    case 'offline': return 'ต้องออนไลน์เพื่ออัปโหลด ต่อเน็ตแล้วลองอีกครั้ง ข้อมูลในเครื่องยังอยู่ครบ';
    case 'backup': return 'สร้างไฟล์สำรองไม่ได้ จึงยังไม่ได้อัปโหลดอะไร ข้อมูลในเครื่องยังอยู่ครบ';
    case 'upload': return `อัปโหลดไม่สำเร็จ (${msg})${/permission/i.test(msg) ? ' ตรวจว่าปล่อย firestore.rules แล้ว' : ''} ข้อมูลในเครื่องยังอยู่ครบ ลองอีกครั้งได้ ไม่เกิดข้อมูลซ้ำ`;
    case 'verify': return `ตรวจจำนวนบนเซิร์ฟเวอร์ไม่ครบ (${Object.entries(err.details ?? {}).map(([k, v]) => `${k}: ควรมี ${v.expected} พบ ${v.got}`).join(', ')}) จึงยังไม่ลบข้อมูลในเครื่อง ลองอีกครั้งได้`;
    case 'cleanup': return 'อัปโหลดและตรวจครบแล้ว แต่ลบข้อมูลในเครื่องไม่สำเร็จ ข้อมูลปลอดภัยบนบัญชีแล้ว ลองอีกครั้งหรือปล่อยไว้ก็ได้';
    default: return `ย้ายข้อมูลไม่สำเร็จ (${msg}) ข้อมูลในเครื่องยังอยู่ครบ`;
  }
}

function migrateHTML(m) {
  const c = m.counts ?? {};
  const summary = `${c.subscriptions ?? 0} บริการ · ${c.payments ?? 0} ประวัติจ่าย · ${c.transactions ?? 0} รายการบัญชี · ${c.activityLog ?? 0} บันทึกกิจกรรม`;
  const steps = `<ol class="steps">${MIGRATE_STEPS.map(([k, label]) => {
    const st = m.steps[k];
    const mark = m.error?.stage === k ? '✗' : st === 'done' ? '✓' : st === 'start' ? '…' : '○';
    return `<li class="${st ?? ''}"><span aria-hidden="true">${mark}</span> ${label}</li>`;
  }).join('')}</ol>`;
  if (m.phase === 'confirm') {
    return `<h2 id="sheet-title">พบข้อมูลเก่าในเครื่องนี้</h2>
      <p>มี ${summary}</p>
      <p>อัปโหลดไปบัญชี ${esc(state.fb.user?.email ?? '')} ไหม?</p>
      ${steps}
      <p class="sub">ถ้าตรวจจำนวนไม่ครบ ระบบจะไม่ลบอะไรเลย</p>
      <div class="sheet-actions"><button class="btn" data-migrate-later>ไว้ก่อน</button><span class="spacer"></span><button class="btn primary" data-migrate-start>อัปโหลด</button></div>`;
  }
  if (m.phase === 'running') return `<h2 id="sheet-title">กำลังย้ายข้อมูล…</h2>${steps}<p class="sub" role="status">อย่าปิดหน้านี้จนกว่าจะเสร็จ</p>`;
  if (m.phase === 'done') return `<h2 id="sheet-title">อัปโหลดเสร็จแล้ว</h2><p>${summary}</p>${steps}<div class="sheet-actions"><span class="spacer"></span><button class="btn primary" data-close>ปิด</button></div>`;
  return `<h2 id="sheet-title">ย้ายข้อมูลไม่สำเร็จ</h2>${steps}<p class="err" role="alert">${esc(migrateErrorText(m.error))}</p>
    <div class="sheet-actions"><button class="btn" data-close>ปิด</button><span class="spacer"></span><button class="btn primary" data-migrate-start>ลองอีกครั้ง</button></div>`;
}

async function runMigrationUI() {
  const m = state.sheet?.m;
  if (!m || m.phase === 'running') return;
  m.phase = 'running';
  m.steps = {};
  m.error = null;
  renderSheet();
  try {
    await runMigration({
      local: await readAllLocal(),
      cloud: getCloudAdapter(),
      uid: state.fb.user.uid,
      dbVersion: DB_VERSION,
      backup: async (json, name) => downloadText(JSON.stringify(json, null, 2), name, 'application/json'),
      deleteLocal: clearLocalData,
      isOnline: () => navigator.onLine,
      onProgress: (step, st) => { m.steps[step] = st; renderSheet(); },
    });
    m.phase = 'done';
    await setMeta(`local:migrated:${state.fb.user.uid}`, new Date().toISOString());
    await loadData();
    await refreshLocalCounts();
  } catch (err) {
    console.error('migration failed', err);
    m.phase = 'error';
    m.error = err;
  }
  renderSheet();
}

// สำรองข้อมูลปัจจุบัน (จากที่เก็บที่ใช้อยู่) เป็นไฟล์ JSON
async function backupNow() {
  const meta = {};
  for (const k of ['rates', 'seeded', 'categories', 'categories-v2', 'categories-v3']) { const v = await getMeta(k); if (v !== undefined) meta[k] = v; }
  const local = {
    subscriptions: await getAllSubscriptions({ includeDeleted: true }), payments: await getAllPayments(),
    transactions: await getAllTransactions({ includeDeleted: true }), activityLog: await getActivityLog(), meta,
  };
  const now2 = new Date();
  const json = buildBackup({ local, exportedAt: now2.toISOString(), dbVersion: DB_VERSION, uid: state.fb.user?.uid ?? null, source: backendName() });
  downloadText(JSON.stringify(json, null, 2), backupFilename(now2), 'application/json');
  toast('สร้างไฟล์สำรองแล้ว');
}

// ---------- เริ่มต้นแอป: ล็อกอิน → เลือกที่เก็บข้อมูล → โหลด ----------
let stopWriteErr = null;
let authChain = Promise.resolve();

async function handleUser(user) {
  stopSync?.(); stopSync = null;
  stopWriteErr?.(); stopWriteErr = null;
  state.syncRaw = { pending: false, fromCache: true, error: null };
  state.fb.user = user;
  state.fb.status = user ? 'signedIn' : 'signedOut';
  state.fb.loginError = '';
  state.fb.error = '';
  if (user) {
    state.skipLogin = false;
    setMeta('login-skipped', false);
    try {
      await useFirestore(user.uid);
      stopWriteErr = onWriteError((err) => { state.syncRaw = { ...state.syncRaw, error: err }; updateSync(); });
      stopSync = await watchSync(user.uid, (raw) => { state.syncRaw = { ...raw, error: raw.error ?? state.syncRaw.error }; updateSync(); });
    } catch (err) {
      console.warn('Firestore unavailable, staying local', err);
      useLocal();
      state.fb.error = 'เชื่อมต่อฐานข้อมูลบนคลาวด์ไม่ได้ ตอนนี้ใช้ข้อมูลในเครื่อง';
    }
  } else {
    useLocal();
  }
  state.loading = false;
  state.sheet = null;
  renderSheet();
  try {
    await loadData();
  } catch (err) {
    console.error('load failed', err);
    state.fb.error = 'โหลดข้อมูลจากคลาวด์ไม่ได้ ลองรีเฟรชหน้านี้';
    render();
  }
  await refreshLocalCounts();
  updateSync();
  if (user && backendName() === 'firestore' && sumCounts(state.localCounts) > 0 && !(await getMeta(`local:declined:${user.uid}`))) openMigration();
}

async function boot() {
  if (!isFirebaseConfigured()) { await loadData(); return; } // ยังไม่ได้ตั้งค่า Firebase: ทำงานในเครื่องอย่างเดียว ไม่มีหน้าล็อกอิน
  state.fb.status = 'loading';
  state.loading = true;
  render();
  state.skipLogin = !!(await getMeta('login-skipped'));
  // เชื่อมต่อช้า/ออฟไลน์ครั้งแรกที่ยังไม่มี SDK → ใช้ข้อมูลในเครื่องไปก่อน (ถ้าเชื่อมต่อได้ภายหลังจะสลับให้เอง)
  const fallback = setTimeout(async () => {
    if (!state.loading) return;
    state.fb.status = 'off';
    state.fb.error = 'เชื่อมต่อ Firebase ช้า ตอนนี้ใช้ข้อมูลในเครื่อง';
    state.loading = false;
    await loadData();
  }, 6000);
  try {
    await onUser((user) => { authChain = authChain.then(() => handleUser(user)).catch((e) => console.error(e)); });
  } catch (err) {
    console.warn('Firebase unavailable', err);
    clearTimeout(fallback);
    state.fb.status = 'off';
    state.fb.error = 'โหลด Firebase ไม่ได้ (ออฟไลน์?) ตอนนี้ใช้ข้อมูลในเครื่อง';
    state.loading = false;
    await loadData();
  }
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed', err)));
}

