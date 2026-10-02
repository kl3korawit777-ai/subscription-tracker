// กฎรายการซ้ำ: { cycle: 'weekly'|'monthly'|'yearly', interval: number, startDate: 'YYYY-MM-DD' }
// วันที่ทั้งหมดเป็น string 'YYYY-MM-DD' (local, ไม่ผูก timezone)

const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
};
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const toDays = (s) => {
  const { y, m, d } = parse(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const fromDays = (n) => {
  const dt = new Date(n * 86400000);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

// วันจ่ายลำดับที่ k (k=0 คือวันเริ่ม) คำนวณจากวันเริ่มเสมอ ไม่ไล่ต่อจากผลก่อนหน้า
export function occurrenceAt(rule, k) {
  const { cycle, startDate } = rule;
  const interval = rule.interval ?? 1;
  const { y, m, d } = parse(startDate);
  if (cycle === 'weekly') return fromDays(toDays(startDate) + 7 * interval * k);
  let ty = y;
  let tm = m;
  if (cycle === 'monthly') {
    const idx = y * 12 + (m - 1) + interval * k;
    ty = Math.floor(idx / 12);
    tm = (idx % 12) + 1;
  } else if (cycle === 'yearly') {
    ty = y + interval * k;
  } else {
    throw new Error(`unknown cycle: ${cycle}`);
  }
  return fmt(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

// วันจ่ายทั้งหมดในช่วง [from, to] (รวมปลายทั้งสองด้าน)
export function occurrencesInRange(rule, from, to) {
  const out = [];
  for (let k = 0; ; k++) {
    const dt = occurrenceAt(rule, k);
    if (dt > to) break;
    if (dt >= from) out.push(dt);
  }
  return out;
}

// วันจ่ายแรกที่อยู่หลัง afterDate (ไม่รวม afterDate)
export function nextOccurrence(rule, afterDate) {
  for (let k = 0; ; k++) {
    const dt = occurrenceAt(rule, k);
    if (dt > afterDate) return dt;
  }
}

// ---- ระดับรายการ (subscription item) ----
// รายการที่ยกเลิก/พักไว้ไม่มีวันจ่าย; ช่วง trial (วันเริ่ม..trialEnd ก่อนวันหมด) ไม่ตัดเงิน
const INACTIVE = new Set(['cancelled', 'paused']);

export const addDays = (dateStr, n) => fromDays(toDays(dateStr) + n);
const daysUntil = (from, to) => toDays(to) - toDays(from);

// วันจ่ายของรายการในช่วง [from, to] (ข้ามเดือนได้)
export function paymentsInRange(item, from, to) {
  if (INACTIVE.has(item.status)) return [];
  const dates = occurrencesInRange(item, from, to);
  return item.trialEnd ? dates.filter((d) => d >= item.trialEnd) : dates;
}

// วันจ่ายทั้งหมดของรายการในเดือนที่ระบุ (month = 1–12)
export const paymentsInMonth = (item, year, month) =>
  paymentsInRange(item, fmt(year, month, 1), fmt(year, month, daysInMonth(year, month)));

// รายการจ่ายตั้งแต่ today ถึง today+days (รวมทั้งสองวัน) เรียงตามวัน
export function upcomingPayments(items, today, days = 7) {
  const to = addDays(today, days);
  return items
    .flatMap((item) => paymentsInRange(item, today, to).map((date) => ({ date, item, daysLeft: daysUntil(today, date) })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name));
}

// Free trial ที่จะหมดภายใน days วัน (รวมวันนี้) — ไม่รวมรายการยกเลิก/พักไว้
export function trialAlerts(items, today, days = 7) {
  return items
    .filter((i) => i.trialEnd && !INACTIVE.has(i.status) && i.trialEnd >= today && i.trialEnd <= addDays(today, days))
    .map((item) => ({ item, date: item.trialEnd, daysLeft: daysUntil(today, item.trialEnd) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// [{ date, item }] ของทุกรายการในเดือนนั้น เรียงตามวัน
export function monthSchedule(items, year, month) {
  return items
    .flatMap((item) => paymentsInMonth(item, year, month).map((date) => ({ date, item })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.item.name?.localeCompare(b.item.name ?? '') || 0);
}
