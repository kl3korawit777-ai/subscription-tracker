import { monthSchedule } from './recurrence.js';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID } from './categories.js';
import { itemBadge } from './icons.js';

// หมวด: สี + ไอคอน (ไม่ใช้สีอย่างเดียวในการบอกหมวด) ข้อมูลอยู่ที่ categories.js (อ้างอิงด้วย id) ที่นี่จัดเป็นตารางหาจากชื่อสำหรับวาดป้าย
export const CATEGORY_META = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.name, { id: c.id, color: c.color, glyph: c.glyph, icon: c.icon }]));
export const CATEGORIES = Object.keys(CATEGORY_META);
const OTHER_NAME = DEFAULT_CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY_ID).name;
const metaOf = (c) => CATEGORY_META[c] ?? CATEGORY_META[OTHER_NAME];
export const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY_META[c].color]));

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmtPrice = (p, c) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: c }).format(p);
// บาทแบบไม่มีทศนิยมถ้าเป็นจำนวนเต็ม เช่น ฿1,284
export const fmtThb = (v) => `฿${v.toLocaleString('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 })}`;

export function categoryBadge(category, cls = '') {
  const m = metaOf(category);
  return `<span class="cb ${cls}" style="--c:${m.color};--g:${m.glyph}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg></span>`;
}

const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const monthTitle = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

export function monthNav(year, month, rightHTML = '') {
  return `<div class="month-bar">
    <button class="icon-btn" data-nav="-1" aria-label="เดือนก่อนหน้า" title="เดือนก่อนหน้า (←)" aria-keyshortcuts="ArrowLeft">‹</button>
    <h2>${monthTitle(year, month)}</h2>
    <button class="icon-btn" data-nav="1" aria-label="เดือนถัดไป" title="เดือนถัดไป (→)" aria-keyshortcuts="ArrowRight">›</button>
    ${rightHTML}
  </div>`;
}

// ปฏิทินรายเดือน (สัปดาห์เริ่มวันจันทร์) — ยอดรวมเดือนอยู่ข้างชื่อเดือน
export function calendarHTML({ items, year, month, selected, paid = {}, totalThb }) {
  const schedule = monthSchedule(items, year, month);
  const byDate = {};
  for (const e of schedule) (byDate[e.date] ??= []).push(e.item);

  const first = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const now = new Date();
  const today = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const title = monthTitle(year, month);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="day blank" aria-hidden="true"></div>');
  for (let d = 1; d <= days; d++) {
    const date = ymd(year, month, d);
    const list = byDate[date] ?? [];
    const marks = list.slice(0, 3).map((i) => `<span class="mark">${paid[`${i.id}|${date}`] ? '<span class="tick" aria-hidden="true">✓</span>' : itemBadge(i, 'sm')}<span class="mk-name" aria-hidden="true">${esc(i.name)}</span></span>`).join('');
    const more = list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : '';
    const label = `${d} ${title}${list.length ? ` มี ${list.map((i) => `${i.name}${paid[`${i.id}|${date}`] ? ' จ่ายแล้ว' : ''}`).join(', ')}` : ''}`;
    cells.push(`<button class="day${date === today ? ' today' : ''}${date === selected ? ' sel' : ''}" data-day="${date}" aria-label="${esc(label)}"${date === today ? ' aria-current="date"' : ''}>
      <span class="num">${d}</span><span class="marks">${marks}${more}</span></button>`);
  }

  return `
    <section class="cal" aria-label="ปฏิทิน ${title}">
      ${monthNav(year, month, `<span class="month-total"><small>รวม</small> <strong class="money">${fmtThb(totalThb)}</strong></span>`)}
      <div class="grid" role="group">${WEEKDAYS.map((w) => `<div class="wd" aria-hidden="true">${w}</div>`).join('')}${cells.join('')}</div>
      <ul class="legend" aria-label="หมวดหมู่">${CATEGORIES.map((c) => `<li>${categoryBadge(c, 'sm')} ${c}</li>`).join('')}<li><span class="tick" aria-hidden="true">✓</span> จ่ายแล้ว</li></ul>
    </section>`;
}
