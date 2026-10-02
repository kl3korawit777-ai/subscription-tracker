import { describe, it, expect } from 'vitest';
import { occurrenceAt, occurrencesInRange, nextOccurrence } from '../js/recurrence.js';

const monthly = (startDate, interval = 1) => ({ cycle: 'monthly', interval, startDate });

describe('monthly', () => {
  it('วันที่ 31 เลื่อนเป็นวันสุดท้ายของเดือน และกลับเป็น 31 เมื่อเดือนมี 31 วัน', () => {
    expect(occurrencesInRange(monthly('2025-01-31'), '2025-01-01', '2025-05-31')).toEqual([
      '2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31',
    ]);
  });
  it('ก.พ. ปีอธิกสุรทิน = 29', () => {
    expect(occurrenceAt(monthly('2024-01-31'), 1)).toBe('2024-02-29');
  });
  it('วันที่ 29 และ 30', () => {
    expect(occurrenceAt(monthly('2025-01-29'), 1)).toBe('2025-02-28');
    expect(occurrenceAt(monthly('2025-01-30'), 1)).toBe('2025-02-28');
    expect(occurrenceAt(monthly('2025-01-30'), 3)).toBe('2025-04-30');
  });
  it('ข้ามปี', () => {
    expect(occurrencesInRange(monthly('2025-11-15'), '2025-11-01', '2026-02-28')).toEqual([
      '2025-11-15', '2025-12-15', '2026-01-15', '2026-02-15',
    ]);
  });
  it('interval > 1', () => {
    expect(occurrencesInRange(monthly('2025-01-31', 3), '2025-01-01', '2025-12-31')).toEqual([
      '2025-01-31', '2025-04-30', '2025-07-31', '2025-10-31',
    ]);
  });
});

describe('yearly', () => {
  const rule = { cycle: 'yearly', interval: 1, startDate: '2024-02-29' };
  it('29 ก.พ. → 28 ก.พ. ในปีไม่อธิกสุรทิน', () => {
    expect(occurrencesInRange(rule, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
  });
});

describe('weekly', () => {
  it('ทุก 2 สัปดาห์ ข้ามเดือน', () => {
    const rule = { cycle: 'weekly', interval: 2, startDate: '2025-01-20' };
    expect(occurrencesInRange(rule, '2025-01-01', '2025-02-28')).toEqual([
      '2025-01-20', '2025-02-03', '2025-02-17',
    ]);
  });
});

describe('range & next', () => {
  it('ไม่แสดงวันก่อนวันเริ่ม', () => {
    expect(occurrencesInRange(monthly('2025-03-10'), '2025-01-01', '2025-02-28')).toEqual([]);
  });
  it('ขอบเขต from/to รวมปลายทั้งสอง', () => {
    expect(occurrencesInRange(monthly('2025-01-10'), '2025-02-10', '2025-03-10')).toEqual([
      '2025-02-10', '2025-03-10',
    ]);
  });
  it('nextOccurrence ไม่รวมวันที่ระบุ', () => {
    expect(nextOccurrence(monthly('2025-01-31'), '2025-01-31')).toBe('2025-02-28');
    expect(nextOccurrence(monthly('2025-01-31'), '2025-01-01')).toBe('2025-01-31');
  });
  it('cycle ไม่รู้จัก → throw', () => {
    expect(() => occurrenceAt({ cycle: 'daily', startDate: '2025-01-01' }, 1)).toThrow();
  });
});

import { paymentsInMonth, monthSchedule } from '../js/recurrence.js';

const item = (o) => ({ id: 'x', name: 'X', status: 'active', cycle: 'monthly', interval: 1, startDate: '2025-01-01', trialEnd: '', ...o });

describe('paymentsInMonth', () => {
  it('วันที่ 31 ในเดือน 30 วัน → วันที่ 30', () => {
    expect(paymentsInMonth(item({ startDate: '2025-01-31' }), 2025, 4)).toEqual(['2025-04-30']);
    expect(paymentsInMonth(item({ startDate: '2025-01-31' }), 2025, 3)).toEqual(['2025-03-31']);
  });
  it('29 ก.พ. ในปีไม่อธิกสุรทิน (รายปี) → 28 ก.พ.', () => {
    const it29 = item({ cycle: 'yearly', startDate: '2024-02-29' });
    expect(paymentsInMonth(it29, 2025, 2)).toEqual(['2025-02-28']);
    expect(paymentsInMonth(it29, 2028, 2)).toEqual(['2028-02-29']);
    expect(paymentsInMonth(it29, 2025, 3)).toEqual([]);
  });
  it('รายปี: จ่ายเฉพาะเดือนครบรอบ', () => {
    const y = item({ cycle: 'yearly', startDate: '2023-07-10' });
    expect(paymentsInMonth(y, 2025, 7)).toEqual(['2025-07-10']);
    expect(paymentsInMonth(y, 2025, 8)).toEqual([]);
  });
  it('รายสัปดาห์: เดือนหนึ่งมี 4–5 ครั้ง', () => {
    const w = item({ cycle: 'weekly', startDate: '2025-01-01' });
    expect(paymentsInMonth(w, 2025, 1)).toEqual(['2025-01-01', '2025-01-08', '2025-01-15', '2025-01-22', '2025-01-29']);
    expect(paymentsInMonth(w, 2025, 2)).toEqual(['2025-02-05', '2025-02-12', '2025-02-19', '2025-02-26']);
  });
  it('เดือนก่อนวันเริ่ม → ว่าง', () => {
    expect(paymentsInMonth(item({ startDate: '2025-06-15' }), 2025, 5)).toEqual([]);
  });
  it('รายการที่ยกเลิกแล้ว → ไม่มีวันจ่าย', () => {
    expect(paymentsInMonth(item({ status: 'cancelled' }), 2025, 4)).toEqual([]);
  });
  it('รายการที่พักไว้ → ไม่มีวันจ่าย', () => {
    expect(paymentsInMonth(item({ status: 'paused' }), 2025, 4)).toEqual([]);
  });
  it('ไม่ตัดเงินก่อนวันหมด trial', () => {
    const t = item({ status: 'trial', startDate: '2025-09-01', trialEnd: '2025-09-15' });
    expect(paymentsInMonth(t, 2025, 9)).toEqual([]);
    expect(paymentsInMonth(t, 2025, 10)).toEqual(['2025-10-01']);
  });
  it('ใช้ได้กับ interval และธันวาคม/มกราคม', () => {
    const q = item({ interval: 3, startDate: '2024-12-31' });
    expect(paymentsInMonth(q, 2025, 3)).toEqual(['2025-03-31']);
    expect(paymentsInMonth(q, 2025, 2)).toEqual([]);
  });
});

describe('monthSchedule', () => {
  it('รวมหลายรายการ เรียงตามวัน และข้ามรายการที่ยกเลิก', () => {
    const a = item({ id: 'a', startDate: '2025-01-20' });
    const b = item({ id: 'b', startDate: '2025-01-05', cycle: 'weekly' });
    const c = item({ id: 'c', status: 'cancelled' });
    const s = monthSchedule([a, b, c], 2025, 2);
    expect(s.map((e) => `${e.date}:${e.item.id}`)).toEqual([
      '2025-02-02:b', '2025-02-09:b', '2025-02-16:b', '2025-02-20:a', '2025-02-23:b',
    ]);
  });
});

import { paymentsInRange, upcomingPayments, trialAlerts, addDays } from '../js/recurrence.js';

describe('addDays', () => {
  it('ข้ามเดือน/ปี/ก.พ.อธิกสุรทิน', () => {
    expect(addDays('2025-12-28', 7)).toBe('2026-01-04');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
  });
});

describe('paymentsInRange', () => {
  it('ข้ามเดือนและใช้กติกาวันสุดท้ายของเดือน', () => {
    expect(paymentsInRange(item({ startDate: '2025-01-31' }), '2025-02-25', '2025-03-05')).toEqual(['2025-02-28']);
  });
  it('ยกเลิก → ว่าง', () => {
    expect(paymentsInRange(item({ status: 'cancelled' }), '2025-01-01', '2025-12-31')).toEqual([]);
  });
});

describe('upcomingPayments (7 วัน)', () => {
  const items = [
    item({ id: 'a', name: 'A', startDate: '2025-01-10' }),
    item({ id: 'b', name: 'B', startDate: '2025-01-31' }),
    item({ id: 'c', name: 'C', startDate: '2025-01-11', status: 'cancelled' }),
  ];
  it('รวมวันนี้ถึงอีก 7 วัน เรียงตามวัน พร้อมจำนวนวันที่เหลือ', () => {
    const r = upcomingPayments(items, '2025-02-06');
    expect(r.map((e) => [e.item.id, e.date, e.daysLeft])).toEqual([['a', '2025-02-10', 4]]);
    const r2 = upcomingPayments(items, '2025-02-10');
    expect(r2.map((e) => [e.item.id, e.daysLeft])).toEqual([['a', 0]]);
  });
  it('วัน 31 ที่เลื่อนเป็น 28 ก.พ. ถูกนับ และข้ามเดือนได้', () => {
    const r = upcomingPayments(items, '2025-02-24');
    expect(r.map((e) => [e.item.id, e.date])).toEqual([['b', '2025-02-28']]);
    expect(upcomingPayments(items, '2025-02-05').map((e) => e.item.id)).toEqual(['a']);
  });
  it('ขอบเขต: วันที่ today+7 รวมอยู่, today+8 ไม่รวม', () => {
    const one = [item({ startDate: '2025-02-17' })];
    expect(upcomingPayments(one, '2025-02-10')).toHaveLength(1);
    expect(upcomingPayments(one, '2025-02-09')).toHaveLength(0);
  });
});

describe('trialAlerts', () => {
  const t = (o) => item({ status: 'trial', ...o });
  it('เตือนเฉพาะ trial ที่หมดภายใน 7 วัน (รวมวันนี้)', () => {
    const items = [t({ id: 'x', trialEnd: '2025-02-12' }), t({ id: 'y', trialEnd: '2025-02-20' }), t({ id: 'z', trialEnd: '2025-02-08' }), t({ id: 'w', trialEnd: '2025-02-10' })];
    expect(trialAlerts(items, '2025-02-10').map((e) => [e.item.id, e.daysLeft])).toEqual([['w', 0], ['x', 2]]);
  });
  it('ไม่เตือนรายการที่ยกเลิก/พัก หรือไม่มีวันหมด trial', () => {
    const items = [t({ trialEnd: '2025-02-12', status: 'cancelled' }), t({ trialEnd: '2025-02-12', status: 'paused' }), t({ trialEnd: '' })];
    expect(trialAlerts(items, '2025-02-10')).toEqual([]);
  });
});

describe('once (ครั้งเดียว)', async () => {
  const rec = await import('../js/recurrence.js');
  const once = (startDate, o = {}) => ({ cycle: 'once', startDate, ...o });

  it('occurrenceAt: ครั้งแรก = วันที่กำหนด ไม่มีครั้งถัดไป', () => {
    expect(rec.occurrenceAt(once('2025-03-15'), 0)).toBe('2025-03-15');
    expect(rec.occurrenceAt(once('2025-03-15'), 1)).toBeNull();
  });

  it('occurrencesInRange: มีเฉพาะเมื่อวันนั้นอยู่ในช่วง (รวมปลายทั้งสองด้าน) และไม่วนไม่รู้จบ', () => {
    const r = once('2025-03-15');
    expect(rec.occurrencesInRange(r, '2025-03-01', '2025-03-31')).toEqual(['2025-03-15']);
    expect(rec.occurrencesInRange(r, '2025-03-15', '2025-03-15')).toEqual(['2025-03-15']);
    expect(rec.occurrencesInRange(r, '2025-03-16', '2025-12-31')).toEqual([]);
    expect(rec.occurrencesInRange(r, '2024-01-01', '2025-03-14')).toEqual([]);
    expect(rec.occurrencesInRange(r, '2020-01-01', '2030-12-31')).toEqual(['2025-03-15']);
  });

  it('วันที่ 31 ไม่ถูกเลื่อน (ไม่ใช่รอบ จึงไม่มีกติกาวันสิ้นเดือน)', () => {
    expect(rec.occurrencesInRange(once('2025-01-31'), '2025-01-01', '2025-12-31')).toEqual(['2025-01-31']);
  });

  it('nextOccurrence: ก่อนวันนั้น = วันนั้น ; วันนั้นหรือหลังจากนั้น = null', () => {
    const r = once('2025-03-15');
    expect(rec.nextOccurrence(r, '2025-03-14')).toBe('2025-03-15');
    expect(rec.nextOccurrence(r, '2025-03-15')).toBeNull();
    expect(rec.nextOccurrence(r, '2026-01-01')).toBeNull();
  });

  it('ระดับรายการ: อยู่ในปฏิทินเดือนนั้นเดือนเดียว, ยกเลิกแล้วไม่มี, trial กรองตามวันหมด trial', () => {
    expect(rec.paymentsInMonth(once('2025-03-15'), 2025, 3)).toEqual(['2025-03-15']);
    expect(rec.paymentsInMonth(once('2025-03-15'), 2025, 4)).toEqual([]);
    expect(rec.paymentsInMonth(once('2025-03-15'), 2026, 3)).toEqual([]);
    expect(rec.paymentsInRange(once('2025-03-15', { status: 'cancelled' }), '2025-01-01', '2025-12-31')).toEqual([]);
    expect(rec.paymentsInRange(once('2025-03-15', { trialEnd: '2025-03-20' }), '2025-01-01', '2025-12-31')).toEqual([]);
  });

  it('upcomingPayments / monthSchedule เห็นรายการครั้งเดียว', () => {
    const it1 = { id: 'a', name: 'ค่าสมัครสอบ', status: 'active', ...once('2025-03-15') };
    expect(rec.upcomingPayments([it1], '2025-03-10').map((e) => [e.date, e.daysLeft])).toEqual([['2025-03-15', 5]]);
    expect(rec.upcomingPayments([it1], '2025-03-16')).toEqual([]);
    expect(rec.monthSchedule([it1], 2025, 3).map((e) => e.date)).toEqual(['2025-03-15']);
  });

  it('รอบเดิมไม่เปลี่ยน และรอบที่ไม่รู้จักยัง throw', () => {
    expect(rec.occurrenceAt({ cycle: 'monthly', startDate: '2025-01-31' }, 1)).toBe('2025-02-28');
    expect(() => rec.occurrenceAt({ cycle: 'daily', startDate: '2025-01-01' }, 0)).toThrow(/unknown cycle/);
  });
});

describe('annualCost: ครั้งเดียว', async () => {
  const { annualCost } = await import('../js/dashboard.js');
  it('นับเป็นยอดเต็มครั้งเดียว ไม่ใช่ NaN', () => {
    expect(annualCost({ cycle: 'once', price: 1500 })).toBe(1500);
    expect(annualCost({ cycle: 'monthly', price: 100 })).toBe(1200);
  });
});
