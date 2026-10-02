import { describe, it, expect } from 'vitest';
import { toThb, annualCost, yearForecast, categoryTotals, topExpensive, paidTotalThb, monthTotalThb } from '../js/dashboard.js';
import { monthSchedule } from '../js/recurrence.js';

const rates = { THB: 1, USD: 35, EUR: 38, JPY: 0.24 };
const mk = (o) => ({ id: o.name, status: 'active', cycle: 'monthly', interval: 1, currency: 'THB', category: 'บันเทิง', startDate: '2025-01-01', trialEnd: '', ...o });

describe('dashboard calc', () => {
  it('แปลงสกุลเงินเป็นบาท', () => {
    expect(toThb(20, 'USD', rates)).toBe(700);
    expect(toThb(100, 'THB', rates)).toBe(100);
  });
  it('annualCost ตามรอบ', () => {
    expect(annualCost(mk({ name: 'a', price: 100 }))).toBe(1200);
    expect(annualCost(mk({ name: 'a', price: 100, cycle: 'yearly' }))).toBe(100);
    expect(annualCost(mk({ name: 'a', price: 10, cycle: 'weekly' }))).toBe(520);
    expect(annualCost(mk({ name: 'a', price: 100, interval: 3 }))).toBe(400);
  });
  it('ประมาณการรายปีรวมทั้ง 12 เดือน และตัดรายการที่ยกเลิก', () => {
    const items = [mk({ name: 'a', price: 100 }), mk({ name: 'b', price: 999, status: 'cancelled' }), mk({ name: 'y', price: 1200, cycle: 'yearly', startDate: '2024-06-10' })];
    const { total, byMonth } = yearForecast(items, 2025, rates);
    expect(total).toBe(1200 + 1200);
    expect(byMonth[5]).toBe(1300);
  });
  it('ประมาณการปีเริ่มกลางปีนับเฉพาะเดือนที่เริ่มแล้ว', () => {
    expect(yearForecast([mk({ name: 'a', price: 100, startDate: '2025-10-15' })], 2025, rates).total).toBe(300);
  });
  it('ยอดแยกหมวดเรียงมาก→น้อย และแปลงสกุลเงิน', () => {
    const s = monthSchedule([mk({ name: 'a', price: 100 }), mk({ name: 'b', price: 20, currency: 'USD', category: 'คลาวด์' })], 2025, 3);
    expect(categoryTotals(s, rates)).toEqual([{ category: 'คลาวด์', total: 700 }, { category: 'บันเทิง', total: 100 }]);
    expect(monthTotalThb(s, rates)).toBe(800);
  });
  it('Top 5 เรียงตามต่อปี ไม่รวมที่ยกเลิก/พัก', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => mk({ name: `n${n}`, price: n * 10 }))
      .concat([mk({ name: 'x', price: 99999, status: 'cancelled' }), mk({ name: 'p', price: 88888, status: 'paused' })]);
    expect(topExpensive(items, rates).map((t) => t.item.name)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2']);
  });
  it('ยอดจ่ายจริงแยกตามเดือนจากประวัติ ไม่ปนกับยอดคาดการณ์', () => {
    const p = [{ date: '2025-03-05', amountThb: 100 }, { date: '2025-03-20', amountThb: 50 }, { date: '2025-04-01', amountThb: 999 }];
    expect(paidTotalThb(p, 2025, 3)).toBe(150);
    expect(paidTotalThb(p, 2025, 5)).toBe(0);
  });
});
