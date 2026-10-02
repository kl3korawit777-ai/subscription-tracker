// บัญชีรายรับ/รายจ่าย: เงินเก็บเป็นสตางค์ (จำนวนเต็ม) เพื่อไม่ให้เศษ float สะสม
export const SERVICE_CATEGORY = 'ค่าบริการ';

// บาท → สตางค์ (toPrecision ตัดเศษ float เช่น 1.005*100 = 100.49999… ให้ได้ 101)
export function toSatang(baht) {
  if (typeof baht !== 'number' || !Number.isFinite(baht)) throw new TypeError(`amount must be a finite number, got ${baht}`);
  return Math.round(Number((baht * 100).toPrecision(12)));
}

export function fromSatang(satang) {
  if (!Number.isInteger(satang)) throw new TypeError(`satang must be an integer, got ${satang}`);
  return satang / 100;
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// ประวัติ "จ่ายแล้ว" → รายจ่ายหมวดค่าบริการ
// id คงที่ (pay:<paymentId>) ย้ายซ้ำจึงทับรายการเดิม ไม่เกิดซ้ำ
// amount = ยอดเป็นบาท (สตางค์) ตามอัตราตอนจ่าย; สกุลอื่นเก็บยอด/สกุลเดิม (minor unit) ไว้ใน original
// ถ้าไม่มี amountThb และไม่ใช่บาท จะไม่เดาอัตรา: amount 0 + needsReview
export function paymentToTransaction(p) {
  const t = {
    id: `pay:${p.id}`,
    type: 'expense',
    category: SERVICE_CATEGORY,
    currency: 'THB',
    date: localDate(p.paidAt),
    dueDate: p.date,
    subId: p.subId,
    name: p.name,
    paymentId: p.id,
    source: 'payment',
    createdAt: p.paidAt,
  };
  if (Number.isFinite(p.amountThb)) t.amount = toSatang(p.amountThb);
  else if (p.currency === 'THB') t.amount = toSatang(p.amount);
  else { t.amount = 0; t.needsReview = true; }
  if (p.currency !== 'THB') t.original = { amount: toSatang(p.amount), currency: p.currency };
  return t;
}

// ยอดคงเหลือ = ยอดตั้งต้น + รายรับ − รายจ่าย (สตางค์) เฉพาะรายการที่วันที่อยู่ใน [from, to]
export function balance(transactions, { opening = 0, from, to } = {}) {
  let sum = opening;
  for (const t of transactions) {
    if (t.deletedAt || (from && t.date < from) || (to && t.date > to)) continue; // รายการในถังขยะไม่นับ
    if (!Number.isInteger(t.amount)) throw new TypeError(`transaction ${t.id}: amount must be an integer (satang), got ${t.amount}`);
    if (t.type === 'income') sum += t.amount;
    else if (t.type === 'expense') sum -= t.amount;
    else throw new TypeError(`transaction ${t.id}: unknown type ${t.type}`);
  }
  return sum;
}

// ---- บันทึกด่วน / หน้าบัญชี ----
export const EXPENSE_CATEGORIES = ['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', SERVICE_CATEGORY, 'บิล/สาธารณูปโภค', 'สุขภาพ', 'บันเทิง', 'อื่น ๆ'];
export const INCOME_CATEGORIES = ['เงินเดือน', 'รายได้เสริม', 'ของขวัญ', 'อื่น ๆ'];

// ข้อความจำนวนเงิน → สตางค์ (จำนวนเต็ม) หรือ null ถ้าไม่ถูกต้อง: เลขอารบิก ทศนิยมไม่เกิน 2 ตำแหน่ง มากกว่า 0
export function parseAmount(text) {
  const s = String(text ?? '').trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
  const satang = toSatang(Number(s.replace(/,/g, '')));
  return satang > 0 && Number.isSafeInteger(satang) ? satang : null;
}

// สตางค์ → "฿1,234.50" (ไม่มีทศนิยมถ้าเป็นจำนวนเต็ม) ; signed = ใส่ +/− (U+2212)
export function fmtSatang(satang, { signed = false } = {}) {
  const abs = Math.abs(satang) / 100;
  const body = `฿${abs.toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 })}`;
  if (satang < 0) return `−${body}`;
  return signed && satang > 0 ? `+${body}` : body;
}

// ชิปหมวดเรียงตามความถี่การใช้ (แยกตามประเภท) เท่ากันคงลำดับเริ่มต้น; หมวดที่เคยใช้แต่ไม่อยู่ในรายการเริ่มต้นก็แสดง
export function rankCategories(transactions, type) {
  const defaults = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const count = new Map();
  for (const t of transactions) if (t.type === type) count.set(t.category, (count.get(t.category) ?? 0) + 1);
  const names = [...defaults, ...[...count.keys()].filter((c) => !defaults.includes(c))];
  return names
    .map((name, i) => ({ name, n: count.get(name) ?? 0, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.name);
}

// วันที่ใหม่→เก่า วันเดียวกันดู createdAt ล่าสุดก่อน (ไม่แก้ array เดิม)
export const sortTransactions = (txs) => [...txs].sort((a, b) =>
  b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id));

// ค้นหา (ชื่อ/โน้ต/หมวด/จำนวนเงินเป็นบาท) + กรองประเภท/หมวด/ช่วงวันที่ (รวมต้น-ท้าย)
export function filterTransactions(txs, { query = '', type = '', category = '', from = '', to = '' } = {}) {
  const q = query.trim().toLowerCase();
  return txs.filter((t) => {
    if (type && t.type !== type) return false;
    if (category && t.category !== category) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (!q) return true;
    return [t.name, t.note, t.category, String(t.amount / 100)].some((f) => f && String(f).toLowerCase().includes(q));
  });
}

// จัดกลุ่มตามวัน (ต้องเรียงมาแล้ว) พร้อมยอดสุทธิของวัน (รับ − จ่าย) เป็นสตางค์
export function groupByDay(sortedTxs) {
  const groups = [];
  for (const t of sortedTxs) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) groups.push((g = { date: t.date, items: [], net: 0 }));
    g.items.push(t);
    g.net += t.type === 'income' ? t.amount : -t.amount;
  }
  return groups;
}
