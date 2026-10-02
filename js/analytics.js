// ฟังก์ชันคำนวณสำหรับหน้าสรุป — รับข้อมูลเข้า คืนผลลัพธ์อย่างเดียว ไม่แตะ Firestore/IndexedDB/หน้าจอ และไม่อ่านเวลาปัจจุบันเอง (ส่ง today เข้ามา)
// เงินทั้งหมดเป็นสตางค์ (จำนวนเต็ม) ; รายการที่มี deletedAt (ถังขยะ) ไม่ถูกนับในทุกยอด
import { monthSchedule } from './recurrence.js';
import { toSatang, SERVICE_CATEGORY } from './ledger.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const toDays = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const weekdayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 = อาทิตย์
const monthStart = (y, m) => ymd(y, m, 1);
const monthEnd = (y, m) => ymd(y, m, daysInMonth(y, m));
const shiftMonth = (y, m, delta) => { const i = y * 12 + (m - 1) + delta; return [Math.floor(i / 12), (i % 12) + 1]; };

const live = (list) => list.filter((x) => !x.deletedAt);
const inRange = (t, from, to) => !((from && t.date < from) || (to && t.date > to));

function assertSatang(t) {
  if (!Number.isInteger(t.amount)) throw new TypeError(`transaction ${t.id}: amount must be an integer (satang), got ${t.amount}`);
}

// ช่วงเวลาที่เลือก + ช่วงก่อนหน้าที่ใช้เทียบ (ทั้งหมด = ไม่จำกัด ไม่มีช่วงเทียบ)
export function resolvePeriod(kind, today) {
  const [y, m] = today.split('-').map(Number);
  const month = (yy, mm) => ({ from: monthStart(yy, mm), to: monthEnd(yy, mm) });
  switch (kind) {
    case 'thisMonth': {
      const [py, pm] = shiftMonth(y, m, -1);
      return { kind, ...month(y, m), prevFrom: monthStart(py, pm), prevTo: monthEnd(py, pm) };
    }
    case 'lastMonth': {
      const [ly, lm] = shiftMonth(y, m, -1);
      const [py, pm] = shiftMonth(y, m, -2);
      return { kind, ...month(ly, lm), prevFrom: monthStart(py, pm), prevTo: monthEnd(py, pm) };
    }
    case '6months': {
      const [fy, fm] = shiftMonth(y, m, -5);
      const [pfy, pfm] = shiftMonth(y, m, -11);
      const [pty, ptm] = shiftMonth(y, m, -6);
      return { kind, from: monthStart(fy, fm), to: monthEnd(y, m), prevFrom: monthStart(pfy, pfm), prevTo: monthEnd(pty, ptm) };
    }
    case 'thisYear':
      return { kind, from: ymd(y, 1, 1), to: ymd(y, 12, 31), prevFrom: ymd(y - 1, 1, 1), prevTo: ymd(y - 1, 12, 31) };
    case 'all':
      return { kind, from: null, to: null, prevFrom: null, prevTo: null };
    default:
      throw new Error(`unknown period: ${kind}`);
  }
}

// รับ/จ่าย/สุทธิ ในช่วง [from, to] (รวมต้น-ท้าย; null = ไม่จำกัด)
export function periodTotals(transactions, { from = null, to = null } = {}) {
  let income = 0;
  let expense = 0;
  for (const t of live(transactions)) {
    if (!inRange(t, from, to)) continue;
    assertSatang(t);
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else throw new TypeError(`transaction ${t.id}: unknown type ${t.type}`);
  }
  return { income, expense, net: income - expense };
}

// ราคาของรายการสมัคร → สตางค์บาท (null ถ้าไม่มีอัตราแลกเปลี่ยนของสกุลนั้น)
function subscriptionThb(item, rates) {
  const rate = item.currency === 'THB' ? 1 : rates[item.currency];
  return Number.isFinite(rate) ? Math.round(toSatang(item.price) * rate) : null;
}

// คาดการณ์สิ้นเดือน: เหลือตอนนี้ (รับ − จ่ายที่เกิดขึ้นแล้วในเดือนของ today) − ค่าบริการที่ยังไม่ได้กด "จ่ายแล้ว" ในเดือนนั้น
// ค่าบริการที่จ่ายแล้วอยู่ในรายจ่ายอยู่แล้ว (มาจากการกดจ่าย) จึงไม่นับซ้ำ ; paid = { "<subId>|<วันครบกำหนด>": true }
export function forecastEndOfMonth({ transactions, subscriptions, paid = {}, rates, today }) {
  const [y, m] = today.split('-').map(Number);
  const range = { from: monthStart(y, m), to: monthEnd(y, m) };
  const { income, expense, net } = periodTotals(transactions, range);

  const items = [];
  const missing = new Set();
  let amount = 0;
  for (const { date, item } of monthSchedule(live(subscriptions), y, m)) {
    if (paid[`${item.id}|${date}`]) continue;
    const thb = subscriptionThb(item, rates);
    if (thb === null) missing.add(item.currency);
    amount += thb ?? 0;
    items.push({ id: item.id, name: item.name, date, amount: thb ?? 0 });
  }
  const projected = net - amount;
  return {
    month: `${y}-${pad(m)}`, income, expense, balance: net,
    unpaid: { count: items.length, amount, items, missingRates: [...missing] },
    projected, negative: projected < 0,
  };
}

// รายจ่าย (หรือรายรับ) แยกหมวด เรียงมาก→น้อย พร้อมเทียบช่วงก่อนหน้า
export function categoryBreakdown(transactions, { from = null, to = null, prevFrom = null, prevTo = null, type = 'expense' } = {}) {
  const sum = (a, b) => {
    const map = new Map();
    for (const t of live(transactions)) {
      if (t.type !== type || !inRange(t, a, b)) continue;
      assertSatang(t);
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    }
    return map;
  };
  const hasPrev = Boolean(prevFrom && prevTo);
  const cur = sum(from, to);
  const prev = hasPrev ? sum(prevFrom, prevTo) : new Map();
  const total = [...cur.values()].reduce((a, b) => a + b, 0);
  const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
  const categories = [...cur.entries()]
    .map(([category, amount]) => {
      const prevAmount = prev.get(category) ?? 0;
      const change = prevAmount > 0 ? Math.round(((amount - prevAmount) / prevAmount) * 100) : null;
      const direction = prevAmount === 0 ? 'new' : change > 0 ? 'up' : change < 0 ? 'down' : 'same';
      return { category, amount, share: total ? amount / total : 0, prevAmount, change, direction };
    })
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'th'));
  return { total, prevTotal, categories };
}

// สรุปรายเดือนย้อนหลัง N เดือนจนถึง endMonth ("YYYY-MM") เรียงเก่า→ใหม่ เติม 0 ให้เดือนที่ไม่มีข้อมูล
export function monthlySeries(transactions, { endMonth, months = 6 }) {
  const [ey, em] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const [y, m] = shiftMonth(ey, em, -i);
    out.push({ month: `${y}-${pad(m)}`, ...periodTotals(transactions, { from: monthStart(y, m), to: monthEnd(y, m) }) });
  }
  return out;
}

const serviceExpenses = (transactions, from, to) =>
  live(transactions).filter((t) => t.type === 'expense' && t.category === SERVICE_CATEGORY && inRange(t, from, to));

// สัดส่วนค่าบริการต่อรายจ่ายรวมของช่วง
export function serviceShare(transactions, { from = null, to = null } = {}) {
  const service = serviceExpenses(transactions, from, to).reduce((s, t) => (assertSatang(t), s + t.amount), 0);
  const { expense: total } = periodTotals(transactions, { from, to });
  const ratio = total ? service / total : 0;
  return { service, total, ratio, pct: Math.round(ratio * 100) };
}

// บริการที่ใช้เงินมากสุดในช่วง (รวมยอดของบริการเดียวกัน)
export function topServices(transactions, { from = null, to = null } = {}, n = 3) {
  const map = new Map();
  for (const t of serviceExpenses(transactions, from, to)) {
    assertSatang(t);
    const key = t.subId ?? t.name ?? t.id;
    const cur = map.get(key) ?? { key, name: t.name ?? String(key), amount: 0 };
    cur.amount += t.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'th')).slice(0, n);
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // จันทร์ก่อน ใช้ตัดสินเมื่อค่าเท่ากัน

// นิสัยการใช้จ่าย: เฉลี่ยต่อวัน + เฉลี่ยของแต่ละวันในสัปดาห์
// ช่วงที่ยังไม่จบนับเฉพาะวันที่ผ่านมาแล้ว (ถึง today) ; from ว่าง = เริ่มจากรายจ่ายรายการแรกสุด
export function spendingHabits(transactions, { from = null, to = null, today }) {
  const expenses = live(transactions).filter((t) => t.type === 'expense' && inRange(t, from, to));
  expenses.forEach(assertSatang);
  const empty = { days: 0, total: 0, avgPerDay: 0, weekdays: Array.from({ length: 7 }, (_, day) => ({ day, total: 0, occurrences: 0, avg: 0 })), top: null };
  if (!expenses.length && !from) return empty;

  const start = from ?? expenses.map((t) => t.date).sort()[0];
  const end = to && to < today ? to : today;
  if (end < start) return empty;
  const days = toDays(end) - toDays(start) + 1;

  const totals = Array(7).fill(0);
  let total = 0;
  for (const t of expenses) {
    if (t.date < start || t.date > end) continue;
    totals[weekdayOf(t.date)] += t.amount;
    total += t.amount;
  }
  const occ = Array(7).fill(0);
  for (let d = toDays(start); d <= toDays(end); d++) occ[new Date(d * 86400000).getUTCDay()] += 1;

  const weekdays = totals.map((tot, day) => ({ day, total: tot, occurrences: occ[day], avg: occ[day] ? Math.round(tot / occ[day]) : 0 }));
  const best = WEEK_ORDER.map((d) => weekdays[d]).reduce((a, b) => (b.avg > a.avg ? b : a));
  return { days, total, avgPerDay: Math.round(total / days), weekdays, top: total > 0 ? { day: best.day, avg: best.avg } : null };
}

// ช่วงของกราฟแนวโน้มตามตัวเลือกช่วงเวลา: 6 เดือน (เดือนก่อน = จบที่เดือนก่อน) / ปีนี้ = ทั้ง 12 เดือน /
// ทั้งหมด = ตั้งแต่เดือนแรกสุดถึงเดือนนี้ อย่างน้อย 6 อย่างมาก 24 เดือน
export function trendWindow(kind, today, transactions) {
  const [y, m] = today.split('-').map(Number);
  const cur = `${y}-${pad(m)}`;
  if (kind === 'lastMonth') { const [py, pm] = shiftMonth(y, m, -1); return { endMonth: `${py}-${pad(pm)}`, months: 6 }; }
  if (kind === 'thisYear') return { endMonth: `${y}-12`, months: 12 };
  if (kind === 'all') {
    const dates = live(transactions).map((t) => t.date).sort();
    if (!dates.length) return { endMonth: cur, months: 6 };
    const [fy, fm] = dates[0].split('-').map(Number);
    const span = (y - fy) * 12 + (m - fm) + 1;
    return { endMonth: cur, months: Math.min(24, Math.max(6, span)) };
  }
  return { endMonth: cur, months: 6 };
}

// มีข้อมูลพอให้เห็น "แนวโน้ม" ไหม (อย่างน้อย 2 เดือนที่มีรายการ)
export const hasTrendData = (series) => series.filter((s) => s.income || s.expense).length >= 2;
