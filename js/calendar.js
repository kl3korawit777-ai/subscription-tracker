import { monthSchedule } from './recurrence.js';

// หมวด: สี + ไอคอน (ไม่ใช้สีอย่างเดียวในการบอกหมวด) glyph = สีของไอคอนบนวงกลมสี
export const CATEGORY_META = {
  'บันเทิง': { color: '#D99A1E', glyph: '#2B1D00', icon: '<path d="M9 7l8 5-8 5z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>' },
  'การเรียน': { color: '#2F855A', glyph: '#fff', icon: '<path d="M4 6.5C6.5 5.5 9.5 5.5 12 7c2.5-1.5 5.5-1.5 8-.5V18c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 7v11.5"/>' },
  'AI': { color: '#6D4BC9', glyph: '#fff', icon: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>' },
  'Cloud': { color: '#2B7CB3', glyph: '#fff', icon: '<path d="M7.5 18.5h9a4 4 0 0 0 .6-7.96 5.5 5.5 0 0 0-10.5 1.2A3.5 3.5 0 0 0 7.5 18.5z"/>' },
  'อื่น ๆ': { color: '#8A8F98', glyph: '#fff', icon: '<circle cx="6.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="17.5" cy="12" r="1.6" fill="currentColor"/>' },
};
export const CATEGORIES = Object.keys(CATEGORY_META);
const metaOf = (c) => CATEGORY_META[c] ?? CATEGORY_META['อื่น ๆ'];
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
    const marks = list.slice(0, 3).map((i) => `<span class="mark">${paid[`${i.id}|${date}`] ? '<span class="tick" aria-hidden="true">✓</span>' : categoryBadge(i.category, 'sm')}<span class="mk-name" aria-hidden="true">${esc(i.name)}</span></span>`).join('');
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
