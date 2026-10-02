import { monthSchedule } from './recurrence.js';
import { esc, fmtPrice } from './calendar.js';
import { trialAlerts } from './recurrence.js';
import { trendSVG } from './charts.js';
import { fmtSatang } from './ledger.js';
import { resolvePeriod, forecastEndOfMonth, categoryBreakdown, monthlySeries, trendWindow, hasTrendData, serviceShare, topServices, spendingHabits } from './analytics.js';
import { forecastText, deltaText, deltaLabel, serviceSentence, habitsText, dayWord, WEEKDAY_NAMES, PERIOD_LABELS } from './summaryText.js';

// อัตราเริ่มต้น (บาทต่อ 1 หน่วย) — ตั้งเองได้ ยังไม่มีหน้า Settings จึงแก้ในส่วน "อัตราแลกเปลี่ยน" ของหน้าสรุป
export const RATE_DEFAULTS = { THB: 1, USD: 35, EUR: 38, JPY: 0.24 };

export const toThb = (amount, currency, rates) => amount * (rates[currency] ?? (currency === 'THB' ? 1 : NaN));

const PER_YEAR = { weekly: 52, monthly: 12, yearly: 1, once: 1 }; // once = ยอดเต็มครั้งเดียว
const isActive = (i) => i.status === 'active' || i.status === 'trial';

// ค่าใช้จ่ายต่อปีโดยเฉลี่ย (สกุลเงินของรายการ)
export const annualCost = (item) => (item.price * PER_YEAR[item.cycle]) / (item.interval ?? 1);

export const monthTotalThb = (schedule, rates) =>
  schedule.reduce((sum, { item }) => sum + toThb(item.price, item.currency, rates), 0);

// ประมาณการรายปี = ผลรวมวันจ่ายจริงตามกฎของทั้ง 12 เดือน (รวมวันที่เลื่อน และตัด trial/ยกเลิก)
export function yearForecast(items, year, rates) {
  const byMonth = Array.from({ length: 12 }, (_, m) => monthTotalThb(monthSchedule(items, year, m + 1), rates));
  return { byMonth, total: byMonth.reduce((a, b) => a + b, 0) };
}

// ยอดแยกหมวด (บาท) เรียงมาก→น้อย
export function categoryTotals(schedule, rates) {
  const map = {};
  for (const { item } of schedule) map[item.category] = (map[item.category] ?? 0) + toThb(item.price, item.currency, rates);
  return Object.entries(map).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

// 5 อันดับแพงสุด จัดตามค่าใช้จ่ายต่อปี (บาท) เฉพาะรายการที่ยังใช้งาน
export function topExpensive(items, rates, n = 5) {
  return items
    .filter(isActive)
    .map((item) => ({ item, yearly: toThb(annualCost(item), item.currency, rates) }))
    .sort((a, b) => b.yearly - a.yearly)
    .slice(0, n);
}

// ยอดที่จ่ายจริงในเดือน (บาท ณ เวลาที่กดจ่าย)
export const paidTotalThb = (payments, year, month) =>
  payments.filter((p) => p.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)).reduce((s, p) => s + p.amountThb, 0);

const todayOf = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

// ส่วนบนสุด: ประโยคคาดการณ์สิ้นเดือนของเดือนปัจจุบัน (ไม่เปลี่ยนตามช่วงเวลาที่เลือก เพราะคาดการณ์มีความหมายเฉพาะเดือนนี้)
function forecastHTML({ transactions, items, paid, rates }, today) {
  const f = forecastEndOfMonth({ transactions, subscriptions: items, paid, rates, today });
  const monthName = new Date(`${today}T00:00:00`).toLocaleDateString('th-TH', { month: 'long' });
  const t = forecastText(f, monthName);
  if (t.empty) return '<p class="sum-lead">เดือนนี้ยังไม่มีรายการ กด + เพื่อบันทึกรายรับรายจ่าย</p>';
  const [first, ...rest] = t.lines;
  return `<div class="sum-forecast${t.negative ? ' neg' : ''}">
    <p class="sum-lead">${esc(first)}</p>
    ${rest.map((l) => `<p>${esc(l)}</p>`).join('')}
  </div>`;
}

function periodHTML(period) {
  return `<fieldset class="chips period"><legend class="sr-only">ช่วงเวลา</legend>
    <div class="chip-row">${Object.entries(PERIOD_LABELS).map(([k, label]) => `<label class="chip-opt"><input type="radio" name="period" value="${k}" ${k === period ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
  </fieldset>`;
}

// ทุกกราฟมีปุ่ม "ดูเป็นตาราง" (สำหรับคนที่อ่านกราฟยาก และโปรแกรมอ่านหน้าจอ) ; tables[id] เก็บว่าตอนนี้ดูตารางอยู่ไหม
function vizHTML(id, tables, chartHTML, tableHTML) {
  const on = !!tables[id];
  return `<div class="viz">
    <button class="link viz-toggle" data-viz-toggle="${id}" aria-pressed="${on}" aria-controls="viz-${id}">${on ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}</button>
    <div id="viz-${id}">${on ? tableHTML : chartHTML}</div>
  </div>`;
}

const table = (head, rows) => `<table class="data-table"><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="num">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;

// รายจ่ายแยกหมวด: กราฟแท่งแนวนอน เรียงมาก→น้อย กดแล้วไปหน้าบัญชีที่กรองหมวดนั้น (และช่วงเวลาเดียวกัน)
function categoriesHTML({ transactions, tables }, range) {
  const hasPrev = Boolean(range.prevFrom);
  const r = categoryBreakdown(transactions, range);
  const label = PERIOD_LABELS[range.kind];
  if (!r.categories.length) return `<h3>รายจ่ายแยกหมวด <small>${label}</small></h3><p class="empty-line">ช่วงนี้ยังไม่มีรายจ่าย</p>`;
  const max = r.categories[0].amount;
  const bars = `<ul class="cats">${r.categories.map((c) => `<li><button class="cat-row" data-cat-go="${esc(c.category)}" aria-label="${esc(c.category)} ${fmtSatang(c.amount)} ${deltaLabel(c, hasPrev)} ดูรายการในบัญชี">
      <span class="cat-head"><span class="cat-name">${esc(c.category)}</span><span class="money">${fmtSatang(c.amount)}</span><span class="delta">${deltaText(c, hasPrev)}</span></span>
      <span class="bar" aria-hidden="true"><i style="width:${Math.max((c.amount / max) * 100, 2)}%"></i></span>
    </button></li>`).join('')}</ul>`;
  const tbl = table(['หมวด', 'ยอด', 'สัดส่วน', ...(hasPrev ? ['เทียบช่วงก่อน'] : [])],
    r.categories.map((c) => [esc(c.category), fmtSatang(c.amount), `${Math.round(c.share * 100)}%`, ...(hasPrev ? [deltaText(c, hasPrev) || '—'] : [])]));
  return `<h3>รายจ่ายแยกหมวด <small>${label}</small></h3>
    <p class="sub">รวม ${fmtSatang(r.total)}${hasPrev ? ` · ช่วงก่อน ${fmtSatang(r.prevTotal)}` : ''}</p>
    ${vizHTML('category', tables, bars, tbl)}`;
}

// แนวโน้ม: แท่งคู่รายรับ/รายจ่าย + เส้นยอดสุทธิ ; ข้อมูลไม่ถึง 2 เดือนให้ข้อความแทนกราฟว่าง
function trendHTML({ transactions, tables }, kind, today) {
  const win = trendWindow(kind, today, transactions);
  const series = monthlySeries(transactions, win);
  const title = `<h3>แนวโน้ม <small>${win.months} เดือน</small></h3>`;
  if (!hasTrendData(series)) return `${title}<p class="empty-line">บันทึกต่ออีกสักพักเพื่อดูแนวโน้ม</p>`;
  const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  const chart = `${trendSVG(series)}
    <ul class="legend2" aria-hidden="true"><li><i class="sw sw-income"></i>รายรับ</li><li><i class="sw sw-expense"></i>รายจ่าย</li><li><i class="sw sw-net"></i>ยอดสุทธิ</li></ul>`;
  const tbl = table(['เดือน', 'รายรับ', 'รายจ่าย', 'สุทธิ'], series.map((m) => [monthLabel(m.month), fmtSatang(m.income), fmtSatang(m.expense), fmtSatang(m.net)]));
  return `${title}${vizHTML('trend', tables, chart, tbl)}`;
}

// ค่าบริการ: สัดส่วนของรายจ่าย + 3 อันดับแพงสุด + แถบแดง trial ที่จะหมดใน 7 วัน
function servicesHTML({ transactions, items }, range, today) {
  const s = serviceSentence(serviceShare(transactions, range), range.kind);
  const top = topServices(transactions, range, 3);
  const trials = trialAlerts(items.filter((i) => !i.deletedAt), today).map((t) => `<button class="band" data-edit="${esc(t.item.id)}">
      <strong>Free trial ${esc(t.item.name)}</strong> หมด${dayWord(t.daysLeft)} — ยกเลิกก่อนโดนตัดเงิน ${esc(fmtPrice(t.item.price, t.item.currency))}</button>`).join('');
  return `<h3>ค่าบริการ <small>${PERIOD_LABELS[range.kind]}</small></h3>
    ${trials}
    <p class="sum-lead">${esc(s.lead)}</p>${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ''}
    ${top.length ? `<ol class="plain top3">${top.map((t) => `<li><span class="grow">${esc(t.name)}</span><span class="money">${fmtSatang(t.amount)}</span></li>`).join('')}</ol>` : ''}`;
}

// นิสัยการใช้จ่าย: เขียนเป็นประโยค + ตารางเฉลี่ยรายวันในสัปดาห์
function habitsHTML({ transactions, tables }, range, today) {
  const h = spendingHabits(transactions, { from: range.from, to: range.to, today });
  const lines = habitsText(h);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const tbl = table(['วัน', 'ใช้รวม', 'จำนวนวัน', 'เฉลี่ย'], order.map((d) => { const w = h.weekdays[d]; return [WEEKDAY_NAMES[d], fmtSatang(w.total), String(w.occurrences), fmtSatang(w.avg)]; }));
  const text = `<p class="sum-lead">${esc(lines[0])}</p>${lines[1] ? `<p>${esc(lines[1])}</p>` : ''}`;
  const heading = `<h3>นิสัยการใช้จ่าย <small>${PERIOD_LABELS[range.kind]}</small></h3>`;
  return h.total ? `${heading}${vizHTML('habits', tables, text, tbl)}` : `${heading}${text}`;
}

// หน้าสรุป ตอบคำถามเรียงตามความสำคัญ: เหลือเงินพอไหม → เงินไปไหน → ดีขึ้นหรือแย่ลง → ค่าบริการ → ใช้จ่ายแบบไหน
export function dashboardHTML(state) {
  const today = todayOf();
  if (!state.transactions.length && !state.items.length) {
    return `<div class="empty"><p class="lead">ยังไม่มีข้อมูลให้สรุป</p>
      <p class="sub">บันทึกรายรับรายจ่าย หรือเพิ่มค่าบริการ เพื่อดูภาพรวมของเดือนนี้</p>
      <button class="btn primary" data-quick>บันทึกรายการ</button></div>`;
  }
  const range = resolvePeriod(state.period, today);
  const s = { ...state, tables: state.tables ?? {} };
  return `<section class="sum">
    ${forecastHTML(s, today)}
    ${periodHTML(s.period)}
    <section class="sum-section">${categoriesHTML(s, range)}</section>
    <section class="sum-section">${trendHTML(s, state.period, today)}</section>
    <section class="sum-section">${servicesHTML(s, range, today)}</section>
    <section class="sum-section">${habitsHTML(s, range, today)}</section>
  </section>`;
}
