import { describe, it, expect } from 'vitest';
import {
  resolvePeriod, periodTotals, forecastEndOfMonth, categoryBreakdown, monthlySeries, serviceShare, topServices, spendingHabits,
} from '../js/analytics.js';
import { balance } from '../js/ledger.js';
import { tx, sixMonths } from './helpers/sampleData.js';

const sub = (o = {}) => ({ id: 's1', name: 'Svc', category: 'บันเทิง', currency: 'THB', cycle: 'monthly', interval: 1, startDate: '2025-01-20', trialEnd: '', status: 'active', price: 149, ...o });
const rates = { THB: 1, USD: 35, EUR: 38, JPY: 0.24 };

describe('resolvePeriod', () => {
  it('เดือนนี้ / เดือนก่อน เทียบกับเดือนก่อนหน้า', () => {
    expect(resolvePeriod('thisMonth', '2026-10-02')).toEqual({ kind: 'thisMonth', from: '2026-10-01', to: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' });
    expect(resolvePeriod('lastMonth', '2026-10-02')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-31' });
  });
  it('ข้ามปี และ ก.พ. ปีอธิกสุรทิน', () => {
    expect(resolvePeriod('thisMonth', '2026-01-15')).toMatchObject({ from: '2026-01-01', to: '2026-01-31', prevFrom: '2025-12-01', prevTo: '2025-12-31' });
    expect(resolvePeriod('lastMonth', '2024-03-10')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
  });
  it('6 เดือน = รวมเดือนนี้ย้อนหลัง 6 เดือน เทียบกับ 6 เดือนก่อนหน้า', () => {
    expect(resolvePeriod('6months', '2026-10-02')).toMatchObject({ from: '2026-05-01', to: '2026-10-31', prevFrom: '2025-11-01', prevTo: '2026-04-30' });
  });
  it('ปีนี้ เทียบกับปีก่อน', () => {
    expect(resolvePeriod('thisYear', '2026-10-02')).toMatchObject({ from: '2026-01-01', to: '2026-12-31', prevFrom: '2025-01-01', prevTo: '2025-12-31' });
  });
  it('ทั้งหมด = ไม่จำกัดช่วง ไม่มีช่วงเทียบ', () => {
    expect(resolvePeriod('all', '2026-10-02')).toEqual({ kind: 'all', from: null, to: null, prevFrom: null, prevTo: null });
  });
  it('ชนิดที่ไม่รู้จัก → throw', () => {
    expect(() => resolvePeriod('weekly', '2026-10-02')).toThrow();
  });
});

describe('periodTotals', () => {
  const list = [
    tx({ type: 'income', amount: 300000, date: '2026-10-01' }),
    tx({ amount: 12900, date: '2026-10-05' }),
    tx({ amount: 5000, date: '2026-09-30' }),
    tx({ amount: 700, date: '2026-11-01' }),
  ];
  it('รวมรับ/จ่าย/สุทธิตามช่วง รวมวันต้นและวันท้าย', () => {
    expect(periodTotals(list, { from: '2026-10-01', to: '2026-10-31' })).toEqual({ income: 300000, expense: 12900, net: 287100 });
    expect(periodTotals(list, { from: '2026-09-30', to: '2026-10-01' })).toEqual({ income: 300000, expense: 5000, net: 295000 });
  });
  it('ไม่ระบุช่วง = ทั้งหมด และว่างเปล่า = 0', () => {
    expect(periodTotals(list).expense).toBe(12900 + 5000 + 700);
    expect(periodTotals([])).toEqual({ income: 0, expense: 0, net: 0 });
  });
  it('ไม่นับรายการในถังขยะ (deletedAt)', () => {
    const withDeleted = [...list, tx({ amount: 999999, date: '2026-10-10', deletedAt: '2026-10-11T00:00:00Z' })];
    expect(periodTotals(withDeleted, { from: '2026-10-01', to: '2026-10-31' }).expense).toBe(12900);
  });
  it('ยอดไม่ใช่จำนวนเต็มสตางค์ → throw', () => {
    expect(() => periodTotals([tx({ amount: 1.5 })])).toThrow(/integer/);
  });
  it('ตรงกับ balance() ของหน้าบัญชีทุกสตางค์', () => {
    const all = sixMonths();
    for (const [from, to] of [['2026-10-01', '2026-10-31'], ['2026-05-01', '2026-10-31'], ['2026-07-15', '2026-09-03']]) {
      expect(periodTotals(all, { from, to }).net).toBe(balance(all, { from, to }));
    }
  });
});

describe('forecastEndOfMonth (คาดการณ์สิ้นเดือน)', () => {
  const base = [
    tx({ type: 'income', category: 'เงินเดือน', amount: 300000, date: '2026-10-01' }),
    tx({ amount: 185000, date: '2026-10-03' }),
  ];
  const today = '2026-10-10';

  it('เหลือตอนนี้ − ค่าบริการที่ยังไม่ได้กด "จ่ายแล้ว" ในเดือนนี้', () => {
    const subs = [sub({ id: 'a', startDate: '2025-01-20' }), sub({ id: 'b', startDate: '2025-01-25' })];
    const f = forecastEndOfMonth({ transactions: base, subscriptions: subs, paid: {}, rates, today });
    expect(f).toMatchObject({ month: '2026-10', income: 300000, expense: 185000, balance: 115000, negative: false });
    expect(f.unpaid.count).toBe(2);
    expect(f.unpaid.amount).toBe(29800);
    expect(f.projected).toBe(85200);
    expect(f.unpaid.items.map((i) => i.date)).toEqual(['2026-10-20', '2026-10-25']);
  });

  it('รายการที่กด "จ่ายแล้ว" ไม่ถูกนับซ้ำ', () => {
    const subs = [sub({ id: 'a', startDate: '2025-01-20' }), sub({ id: 'b', startDate: '2025-01-25' })];
    const f = forecastEndOfMonth({ transactions: base, subscriptions: subs, paid: { 'a|2026-10-20': true }, rates, today });
    expect(f.unpaid.count).toBe(1);
    expect(f.unpaid.amount).toBe(14900);
    expect(f.projected).toBe(100100);
  });

  it('ไม่นับรายการยกเลิก/พัก/อยู่ในช่วง trial/ยังไม่ถึงวันเริ่ม/อยู่ในถังขยะ', () => {
    const subs = [
      sub({ id: 'c', status: 'cancelled' }),
      sub({ id: 'p', status: 'paused' }),
      sub({ id: 't', status: 'trial', startDate: '2026-10-01', trialEnd: '2026-10-28' }),
      sub({ id: 'f', startDate: '2026-12-01' }),
      sub({ id: 'd', deletedAt: '2026-10-02T00:00:00Z' }),
    ];
    const f = forecastEndOfMonth({ transactions: base, subscriptions: subs, paid: {}, rates, today });
    expect(f.unpaid.count).toBe(0);
    expect(f.projected).toBe(115000);
  });

  it('สกุลอื่นแปลงเป็นบาทตามอัตรา และรายสัปดาห์นับทุกครั้งที่ตัดในเดือน', () => {
    const usd = sub({ id: 'u', currency: 'USD', price: 20, startDate: '2025-01-12' });
    expect(forecastEndOfMonth({ transactions: base, subscriptions: [usd], paid: {}, rates, today }).unpaid.amount).toBe(70000);
    const weekly = sub({ id: 'w', cycle: 'weekly', price: 10, startDate: '2026-10-02' });
    const f = forecastEndOfMonth({ transactions: base, subscriptions: [weekly], paid: {}, rates, today });
    expect(f.unpaid.count).toBe(5); // 2, 9, 16, 23, 30 ต.ค.
    expect(f.unpaid.amount).toBe(5000);
  });

  it('ยอดคาดการณ์ติดลบ → negative = true', () => {
    const f = forecastEndOfMonth({ transactions: base, subscriptions: [sub({ price: 2000 })], paid: {}, rates, today });
    expect(f.projected).toBe(115000 - 200000);
    expect(f.negative).toBe(true);
  });

  it('ไม่นับรายการบัญชีในถังขยะ และไม่นับเดือนอื่น', () => {
    const list = [...base, tx({ amount: 999999, date: '2026-10-04', deletedAt: 'x' }), tx({ amount: 777777, date: '2026-09-30' })];
    const f = forecastEndOfMonth({ transactions: list, subscriptions: [], paid: {}, rates, today });
    expect(f.expense).toBe(185000);
  });

  it('ไม่มีอัตราของสกุลเงิน → ไม่เดา ใส่ missingRates และไม่นับยอด', () => {
    const f = forecastEndOfMonth({ transactions: base, subscriptions: [sub({ currency: 'GBP', price: 5 })], paid: {}, rates, today });
    expect(f.unpaid.missingRates).toEqual(['GBP']);
    expect(f.unpaid.amount).toBe(0);
    expect(f.unpaid.count).toBe(1);
  });

  it('ผลเป็นจำนวนเต็มสตางค์เสมอ', () => {
    const f = forecastEndOfMonth({ transactions: base, subscriptions: [sub({ currency: 'JPY', price: 333 })], paid: {}, rates, today });
    expect(Number.isInteger(f.unpaid.amount) && Number.isInteger(f.projected)).toBe(true);
  });
});

describe('categoryBreakdown', () => {
  const cur = { from: '2026-10-01', to: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' };
  const list = [
    tx({ category: 'อาหาร', amount: 92000, date: '2026-10-03' }),
    tx({ category: 'อาหาร', amount: 80000, date: '2026-09-03' }),
    tx({ category: 'เดินทาง', amount: 30000, date: '2026-10-04' }),
    tx({ category: 'เดินทาง', amount: 60000, date: '2026-09-04' }),
    tx({ category: 'ช้อปปิ้ง', amount: 25000, date: '2026-10-05' }),
    tx({ category: 'บันเทิง', amount: 10000, date: '2026-10-06' }),
    tx({ category: 'บันเทิง', amount: 10000, date: '2026-09-06' }),
    tx({ type: 'income', category: 'เงินเดือน', amount: 900000, date: '2026-10-01' }),
  ];
  it('เรียงมาก→น้อย พร้อม % เปลี่ยนจากช่วงก่อนและทิศทาง', () => {
    const r = categoryBreakdown(list, cur);
    expect(r.categories.map((c) => c.category)).toEqual(['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', 'บันเทิง']);
    const by = Object.fromEntries(r.categories.map((c) => [c.category, c]));
    expect(by['อาหาร']).toMatchObject({ amount: 92000, prevAmount: 80000, change: 15, direction: 'up' });
    expect(by['เดินทาง']).toMatchObject({ change: -50, direction: 'down' });
    expect(by['ช้อปปิ้ง']).toMatchObject({ prevAmount: 0, change: null, direction: 'new' });
    expect(by['บันเทิง']).toMatchObject({ change: 0, direction: 'same' });
  });
  it('ยอดรวมของหมวดทั้งหมด = รายจ่ายรวมของช่วง (ตรงกับ periodTotals) และสัดส่วนรวมเป็น 1', () => {
    const r = categoryBreakdown(list, cur);
    expect(r.total).toBe(periodTotals(list, cur).expense);
    expect(r.categories.reduce((s, c) => s + c.amount, 0)).toBe(r.total);
    expect(r.categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 10);
    expect(r.prevTotal).toBe(150000);
  });
  it('ไม่มีช่วงเทียบ (ทั้งหมด) → change เป็น null ทั้งหมด', () => {
    const r = categoryBreakdown(list, { from: null, to: null, prevFrom: null, prevTo: null });
    expect(r.categories.every((c) => c.change === null && c.direction === 'new')).toBe(true);
  });
  it('ชนิดรายรับก็แยกหมวดได้', () => {
    expect(categoryBreakdown(list, { ...cur, type: 'income' }).categories).toMatchObject([{ category: 'เงินเดือน', amount: 900000 }]);
  });
  it('ไม่นับถังขยะ และช่วงไม่มีรายการ → ว่าง', () => {
    const r = categoryBreakdown([...list, tx({ category: 'อาหาร', amount: 500000, date: '2026-10-09', deletedAt: 'x' })], cur);
    expect(r.categories.find((c) => c.category === 'อาหาร').amount).toBe(92000);
    expect(categoryBreakdown(list, { from: '2030-01-01', to: '2030-01-31' })).toEqual({ total: 0, prevTotal: 0, categories: [] });
  });
});

describe('monthlySeries (แนวโน้มย้อนหลัง)', () => {
  const all = sixMonths();
  it('คืน N เดือนเรียงเก่า→ใหม่ เติม 0 ให้เดือนที่ไม่มีข้อมูล', () => {
    const s = monthlySeries(all, { endMonth: '2026-10', months: 6 });
    expect(s.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.every((m) => m.net === m.income - m.expense)).toBe(true);
    const wide = monthlySeries(all, { endMonth: '2027-02', months: 3 });
    expect(wide.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(wide.every((m) => m.income === 0 && m.expense === 0 && m.net === 0)).toBe(true);
  });
  it('ข้ามปี', () => {
    expect(monthlySeries([], { endMonth: '2026-02', months: 4 }).map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('ผลรวมแต่ละเดือนตรงกับ periodTotals ของเดือนนั้น และยอดรวมทั้งหมดตรงกับ balance()', () => {
    const s = monthlySeries(all, { endMonth: '2026-10', months: 6 });
    for (const m of s) {
      expect(m).toMatchObject(periodTotals(all, { from: `${m.month}-01`, to: `${m.month}-31` }));
    }
    expect(s.reduce((a, m) => a + m.net, 0)).toBe(balance(all));
  });
  it('ไม่นับถังขยะ', () => {
    const s = monthlySeries([tx({ amount: 100, date: '2026-10-02' }), tx({ amount: 900, date: '2026-10-03', deletedAt: 'x' })], { endMonth: '2026-10', months: 1 });
    expect(s[0].expense).toBe(100);
  });
});

describe('ค่าบริการ', () => {
  const list = [
    tx({ category: 'ค่าบริการ', subId: 'n', name: 'Netflix', amount: 41900, date: '2026-10-05' }),
    tx({ category: 'ค่าบริการ', subId: 'n', name: 'Netflix', amount: 41900, date: '2026-10-25' }),
    tx({ category: 'ค่าบริการ', subId: 's', name: 'Spotify', amount: 12900, date: '2026-10-15' }),
    tx({ category: 'ค่าบริการ', subId: 'c', name: 'iCloud', amount: 3500, date: '2026-10-16' }),
    tx({ category: 'ค่าบริการ', subId: 'x', name: 'ChatGPT', amount: 70000, date: '2026-09-01' }),
    tx({ category: 'อาหาร', amount: 100000, date: '2026-10-02' }),
    tx({ type: 'income', category: 'ค่าบริการ', amount: 5000, date: '2026-10-02' }),
  ];
  const range = { from: '2026-10-01', to: '2026-10-31' };
  it('สัดส่วนค่าบริการต่อรายจ่ายรวม (นับเฉพาะรายจ่าย)', () => {
    const s = serviceShare(list, range);
    expect(s).toMatchObject({ service: 100200, total: 200200, pct: 50 });
    expect(s.ratio).toBeCloseTo(100200 / 200200, 10);
  });
  it('ไม่มีรายจ่าย → 0% ไม่หารศูนย์', () => {
    expect(serviceShare([], range)).toEqual({ service: 0, total: 0, ratio: 0, pct: 0 });
  });
  it('3 อันดับแพงสุดในช่วง (รวมยอดของบริการเดียวกัน)', () => {
    expect(topServices(list, range).map((t) => [t.name, t.amount])).toEqual([['Netflix', 83800], ['Spotify', 12900], ['iCloud', 3500]]);
    expect(topServices(list, range, 2)).toHaveLength(2);
    expect(topServices(list, { from: '2026-09-01', to: '2026-09-30' })[0].name).toBe('ChatGPT');
  });
  it('ไม่นับถังขยะ', () => {
    const l = [...list, tx({ category: 'ค่าบริการ', subId: 'z', name: 'Big', amount: 9999999, date: '2026-10-02', deletedAt: 'x' })];
    expect(topServices(l, range)[0].name).toBe('Netflix');
    expect(serviceShare(l, range).service).toBe(100200);
  });
});

describe('spendingHabits (นิสัยการใช้จ่าย)', () => {
  // 2026-10-01 = พฤหัส ; ศุกร์ = 2, 9 ต.ค. ; ถึง "วันนี้" 14 ต.ค. = 14 วัน
  const list = [
    tx({ amount: 14000, date: '2026-10-02' }), // ศุกร์
    tx({ amount: 14000, date: '2026-10-09' }), // ศุกร์
    tx({ amount: 7000, date: '2026-10-03' }), // เสาร์
    tx({ type: 'income', amount: 900000, date: '2026-10-01' }),
  ];
  it('เฉลี่ยต่อวัน และวันที่ใช้เงินมากสุดตามค่าเฉลี่ยของวันนั้นในสัปดาห์', () => {
    const h = spendingHabits(list, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-14' });
    expect(h.days).toBe(14);
    expect(h.total).toBe(35000);
    expect(h.avgPerDay).toBe(2500);
    expect(h.weekdays).toHaveLength(7);
    const fri = h.weekdays.find((w) => w.day === 5);
    expect(fri).toMatchObject({ total: 28000, occurrences: 2, avg: 14000 });
    expect(h.top).toEqual({ day: 5, avg: 14000 });
  });
  it('ช่วงที่ยังไม่จบ นับเฉพาะวันที่ผ่านมาแล้ว (ไม่เอาวันในอนาคตมาหาร)', () => {
    const h = spendingHabits(list, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-09' });
    expect(h.days).toBe(9);
    expect(h.avgPerDay).toBe(Math.round(35000 / 9));
  });
  it('ไม่มีรายจ่าย → 0 และไม่มีวันเด่น', () => {
    const h = spendingHabits([], { from: '2026-10-01', to: '2026-10-31', today: '2026-10-14' });
    expect(h).toMatchObject({ total: 0, avgPerDay: 0, top: null });
  });
  it('ทั้งหมด (from ว่าง) เริ่มนับจากรายการแรกสุด', () => {
    const h = spendingHabits(list, { from: null, to: null, today: '2026-10-14' });
    expect(h.days).toBe(13); // 2 ต.ค. .. 14 ต.ค. (รายรับวันที่ 1 ไม่ใช่รายจ่าย แต่เริ่มจากรายการแรกสุดของรายจ่าย)
  });
  it('ค่าเสมอ → เลือกวันที่มาก่อนเมื่อเรียงจันทร์ก่อน', () => {
    const l = [tx({ amount: 1000, date: '2026-10-05' }), tx({ amount: 1000, date: '2026-10-06' })]; // จันทร์, อังคาร
    expect(spendingHabits(l, { from: '2026-10-05', to: '2026-10-06', today: '2026-10-06' }).top.day).toBe(1);
  });
  it('ไม่นับถังขยะ', () => {
    const h = spendingHabits([...list, tx({ amount: 9999999, date: '2026-10-04', deletedAt: 'x' })], { from: '2026-10-01', to: '2026-10-31', today: '2026-10-14' });
    expect(h.total).toBe(35000);
  });
  it('ยอดเฉลี่ยเป็นจำนวนเต็มเสมอ', () => {
    const h = spendingHabits(list, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-14' });
    expect(Number.isInteger(h.avgPerDay) && h.weekdays.every((w) => Number.isInteger(w.avg))).toBe(true);
  });
});

describe('ความสอดคล้องกับหน้าบัญชี (ตรวจทุกบาท)', () => {
  it('เลือกเดือนหนึ่ง: รวมจากหมวด = รายจ่ายรวม = ยอดที่หน้าบัญชีรวมได้', () => {
    const all = sixMonths();
    for (const month of ['2026-05', '2026-08', '2026-10']) {
      const range = { from: `${month}-01`, to: `${month}-31` };
      const t = periodTotals(all, range);
      const cats = categoryBreakdown(all, range);
      const ledgerExpense = all.filter((x) => x.type === 'expense' && x.date >= range.from && x.date <= range.to).reduce((s, x) => s + x.amount, 0);
      expect(cats.total).toBe(t.expense);
      expect(cats.total).toBe(ledgerExpense);
      expect(t.net).toBe(balance(all, range));
    }
  });
});
