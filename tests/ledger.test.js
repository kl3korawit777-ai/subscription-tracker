import { describe, it, expect } from 'vitest';
import { toSatang, fromSatang, paymentToTransaction, balance, SERVICE_CATEGORY } from '../js/ledger.js';

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const payment = (o = {}) => ({
  id: 'sub1|2026-10-15', subId: 'sub1', date: '2026-10-15', name: 'Spotify', category: 'บันเทิง',
  amount: 129, currency: 'THB', amountThb: 129, paidAt: noon(2026, 10, 16), ...o,
});

describe('เงินเป็นสตางค์ (integer)', () => {
  it('แปลงบาท→สตางค์ และกันปัญหา float', () => {
    expect(toSatang(129)).toBe(12900);
    expect(toSatang(0.1 + 0.2)).toBe(30);
    expect(toSatang(1.005)).toBe(101);
    expect(toSatang(0)).toBe(0);
  });
  it('ค่าที่ไม่ใช่ตัวเลข → throw', () => {
    expect(() => toSatang(NaN)).toThrow();
    expect(() => toSatang(undefined)).toThrow();
  });
  it('สตางค์→บาท', () => {
    expect(fromSatang(12900)).toBe(129);
    expect(fromSatang(5)).toBe(0.05);
    expect(() => fromSatang(1.5)).toThrow();
  });
});

describe('paymentToTransaction (ประวัติ "จ่ายแล้ว" → รายจ่ายหมวดค่าบริการ)', () => {
  it('แปลงรายการบาท', () => {
    const t = paymentToTransaction(payment());
    expect(t).toMatchObject({
      id: 'pay:sub1|2026-10-15', type: 'expense', category: SERVICE_CATEGORY, amount: 12900, currency: 'THB',
      date: '2026-10-16', dueDate: '2026-10-15', subId: 'sub1', name: 'Spotify', paymentId: 'sub1|2026-10-15', source: 'payment',
    });
    expect(SERVICE_CATEGORY).toBe('ค่าบริการ');
    expect(Number.isInteger(t.amount)).toBe(true);
    expect(t.original).toBeUndefined();
    expect(t.needsReview).toBeUndefined();
  });
  it('สกุลอื่น: ยอดเป็นบาทตามอัตราตอนจ่าย เก็บยอด/สกุลเดิมเป็น minor unit ไว้ด้วย', () => {
    const t = paymentToTransaction(payment({ id: 'sub2|2026-10-01', amount: 20, currency: 'USD', amountThb: 700 }));
    expect(t.amount).toBe(70000);
    expect(t.currency).toBe('THB');
    expect(t.original).toEqual({ amount: 2000, currency: 'USD' });
  });
  it('id คงที่ จึงย้ายซ้ำแล้วไม่เกิดรายการซ้ำ', () => {
    expect(paymentToTransaction(payment()).id).toBe(paymentToTransaction(payment()).id);
  });
  it('ไม่มี amountThb และไม่ใช่บาท → ไม่เดาอัตรา: amount 0 + needsReview แต่ไม่ทิ้งข้อมูลเดิม', () => {
    const t = paymentToTransaction(payment({ amount: 20, currency: 'USD', amountThb: undefined }));
    expect(t.amount).toBe(0);
    expect(t.needsReview).toBe(true);
    expect(t.original).toEqual({ amount: 2000, currency: 'USD' });
  });
  it('ไม่มี amountThb แต่เป็นบาท → ใช้ amount', () => {
    expect(paymentToTransaction(payment({ amountThb: undefined })).amount).toBe(12900);
  });
});

describe('balance (ยอดคงเหลือ)', () => {
  const tx = (type, amount, date) => ({ id: `${type}${amount}${date}`, type, amount, date });
  it('ไม่มีรายการ → เท่ากับยอดตั้งต้น (ค่าเริ่มต้น 0)', () => {
    expect(balance([])).toBe(0);
    expect(balance([], { opening: 5000 })).toBe(5000);
  });
  it('รายรับ − รายจ่าย + ยอดตั้งต้น', () => {
    const list = [tx('income', 500000, '2026-10-01'), tx('expense', 12900, '2026-10-16'), tx('expense', 70000, '2026-10-17')];
    expect(balance(list)).toBe(417100);
    expect(balance(list, { opening: 100000 })).toBe(517100);
  });
  it('คงเหลือติดลบได้', () => {
    expect(balance([tx('expense', 100, '2026-01-01')])).toBe(-100);
  });
  it('กรองช่วงวันที่ รวมวันต้น/ท้าย', () => {
    const list = [tx('expense', 100, '2026-09-30'), tx('expense', 200, '2026-10-01'), tx('expense', 400, '2026-10-31'), tx('expense', 800, '2026-11-01')];
    expect(balance(list, { from: '2026-10-01', to: '2026-10-31' })).toBe(-600);
    expect(balance(list, { to: '2026-10-01' })).toBe(-300);
  });
  it('บวกรายการเล็ก ๆ จำนวนมากแล้วไม่เพี้ยน (ไม่มีเศษ float)', () => {
    const list = Array.from({ length: 1000 }, (_, i) => tx('income', 10, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`));
    expect(balance(list)).toBe(10000);
  });
  it('ยอดไม่ใช่จำนวนเต็ม หรือชนิดรายการไม่รู้จัก → throw (กันข้อมูลเพี้ยนเงียบ ๆ)', () => {
    expect(() => balance([tx('expense', 1.5, '2026-01-01')])).toThrow(/integer/);
    expect(() => balance([tx('transfer', 100, '2026-01-01')])).toThrow(/type/);
  });
  it('รายการที่ย้ายจากประวัติจ่ายแล้วถูกหักจากยอดคงเหลือ', () => {
    const t = paymentToTransaction(payment());
    expect(balance([tx('income', 100000, '2026-10-01'), t])).toBe(87100);
  });
});

import { parseAmount, fmtSatang, rankCategories, filterTransactions, groupByDay, sortTransactions, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../js/ledger.js';

describe('parseAmount (ช่องจำนวนเงินบันทึกด่วน)', () => {
  it('รับตัวเลขปกติ ทศนิยมไม่เกิน 2 ตำแหน่ง และคอมมาคั่นหลักพัน', () => {
    expect(parseAmount('120')).toBe(12000);
    expect(parseAmount(' 59.50 ')).toBe(5950);
    expect(parseAmount('0.5')).toBe(50);
    expect(parseAmount('1,234.5')).toBe(123450);
    expect(parseAmount('1,000')).toBe(100000);
  });
  it('ปฏิเสธค่าที่ไม่ใช่จำนวนเงินที่ถูกต้อง → null', () => {
    for (const bad of ['', '   ', 'abc', '-5', '0', '0.00', '12.345', '1e3', '12,3', '1,23', '.5', '5.', '12 บาท', '๑๒๓']) expect(parseAmount(bad), bad).toBeNull();
  });
  it('คืนจำนวนเต็มเสมอ', () => {
    expect(Number.isInteger(parseAmount('19.99'))).toBe(true);
    expect(parseAmount('19.99')).toBe(1999);
  });
});

describe('fmtSatang', () => {
  it('แสดงบาท ตัดทศนิยมถ้าเป็นจำนวนเต็ม', () => {
    expect(fmtSatang(12900)).toBe('฿129');
    expect(fmtSatang(123450)).toBe('฿1,234.50');
    expect(fmtSatang(5)).toBe('฿0.05');
  });
  it('ใส่เครื่องหมาย +/− (U+2212) เมื่อ signed', () => {
    expect(fmtSatang(-12900, { signed: true })).toBe('−฿129');
    expect(fmtSatang(50000, { signed: true })).toBe('+฿500');
    expect(fmtSatang(0, { signed: true })).toBe('฿0');
    expect(fmtSatang(-12900)).toBe('−฿129');
  });
});

describe('rankCategories (ชิปหมวดเรียงตามความถี่)', () => {
  const t = (type, category) => ({ type, category });
  it('ไม่มีประวัติ → ลำดับเริ่มต้น', () => {
    expect(rankCategories([], 'expense')).toEqual(EXPENSE_CATEGORIES);
    expect(rankCategories([], 'income')).toEqual(INCOME_CATEGORIES);
  });
  it('เรียงมาก→น้อย และหมวดที่ถูกใช้เท่ากันคงลำดับเริ่มต้น', () => {
    const txs = [t('expense', 'เดินทาง'), t('expense', 'เดินทาง'), t('expense', 'ช้อปปิ้ง'), t('expense', 'อาหาร'), t('expense', 'อาหาร'), t('expense', 'อาหาร')];
    const r = rankCategories(txs, 'expense');
    expect(r.slice(0, 3)).toEqual(['อาหาร', 'เดินทาง', 'ช้อปปิ้ง']);
    expect(r).toHaveLength(EXPENSE_CATEGORIES.length);
    expect(new Set(r).size).toBe(r.length);
  });
  it('นับแยกตามประเภท รายรับไม่ปนรายจ่าย', () => {
    const txs = [t('income', 'อื่น ๆ'), t('income', 'อื่น ๆ'), t('expense', 'อาหาร')];
    expect(rankCategories(txs, 'income')[0]).toBe('อื่น ๆ');
    expect(rankCategories(txs, 'expense')[0]).toBe('อาหาร');
  });
  it('หมวดที่เคยใช้แต่ไม่อยู่ในรายการเริ่มต้นยังแสดง (ไม่ทำให้ประวัติหาย)', () => {
    expect(rankCategories([t('expense', 'กาแฟ'), t('expense', 'กาแฟ')], 'expense')[0]).toBe('กาแฟ');
  });
});

describe('filterTransactions / sortTransactions / groupByDay', () => {
  const mk = (id, type, amount, date, o = {}) => ({ id, type, amount, date, category: 'อาหาร', name: id, note: '', createdAt: `${date}T10:00:00Z`, ...o });
  const all = [
    mk('a', 'expense', 12900, '2026-10-02', { name: 'Spotify', category: 'ค่าบริการ' }),
    mk('b', 'income', 500000, '2026-10-02', { name: 'เงินเดือน', category: 'เงินเดือน', createdAt: '2026-10-02T12:00:00Z' }),
    mk('c', 'expense', 5950, '2026-10-01', { name: 'ข้าวมันไก่', note: 'มื้อเที่ยง' }),
    mk('d', 'expense', 100000, '2025-01-15', { name: 'ตั๋วเครื่องบิน', category: 'เดินทาง' }),
  ];
  it('sort: วันที่ใหม่→เก่า วันเดียวกันดู createdAt ล่าสุดก่อน และไม่แก้ array เดิม', () => {
    const copy = [...all];
    expect(sortTransactions(all).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(all).toEqual(copy);
  });
  it('ค้นหาจากชื่อ โน้ต หมวด และจำนวนเงิน (ไม่สนตัวพิมพ์)', () => {
    expect(filterTransactions(all, { query: 'spot' }).map((x) => x.id)).toEqual(['a']);
    expect(filterTransactions(all, { query: 'เที่ยง' }).map((x) => x.id)).toEqual(['c']);
    expect(filterTransactions(all, { query: 'เดินทาง' }).map((x) => x.id)).toEqual(['d']);
    expect(filterTransactions(all, { query: '129' }).map((x) => x.id)).toEqual(['a']);
    expect(filterTransactions(all, { query: '  ' })).toHaveLength(4);
  });
  it('กรองตามประเภท หมวด และช่วงวันที่ (รวมต้น/ท้าย) แบบรวมเงื่อนไข', () => {
    expect(filterTransactions(all, { type: 'income' }).map((x) => x.id)).toEqual(['b']);
    expect(filterTransactions(all, { category: 'อาหาร' }).map((x) => x.id)).toEqual(['c']);
    expect(filterTransactions(all, { from: '2026-10-01', to: '2026-10-01' }).map((x) => x.id)).toEqual(['c']);
    expect(filterTransactions(all, { from: '2026-01-01' })).toHaveLength(3);
    expect(filterTransactions(all, { type: 'expense', from: '2026-10-01' }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterTransactions(all, { query: 'zzz' })).toEqual([]);
  });
  it('groupByDay: จัดกลุ่มตามวัน พร้อมยอดสุทธิของวัน (รับ − จ่าย) เป็นสตางค์', () => {
    const g = groupByDay(sortTransactions(all));
    expect(g.map((x) => x.date)).toEqual(['2026-10-02', '2026-10-01', '2025-01-15']);
    expect(g[0].items.map((x) => x.id)).toEqual(['b', 'a']);
    expect(g[0].net).toBe(500000 - 12900);
    expect(g[1].net).toBe(-5950);
    expect(groupByDay([])).toEqual([]);
  });
});
