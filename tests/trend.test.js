import { describe, it, expect } from 'vitest';
import { trendWindow, hasTrendData } from '../js/analytics.js';
import { tx } from './helpers/sampleData.js';

describe('trendWindow (ช่วงของกราฟแนวโน้มตามตัวเลือกช่วงเวลา)', () => {
  const t = (date) => tx({ date });
  it('เดือนนี้ / เดือนก่อน / 6 เดือน = 6 เดือน', () => {
    expect(trendWindow('thisMonth', '2026-10-02', [])).toEqual({ endMonth: '2026-10', months: 6 });
    expect(trendWindow('lastMonth', '2026-10-02', [])).toEqual({ endMonth: '2026-09', months: 6 });
    expect(trendWindow('6months', '2026-10-02', [])).toEqual({ endMonth: '2026-10', months: 6 });
    expect(trendWindow('lastMonth', '2026-01-02', [])).toEqual({ endMonth: '2025-12', months: 6 });
  });
  it('ปีนี้ = ทั้ง 12 เดือนของปี', () => {
    expect(trendWindow('thisYear', '2026-10-02', [])).toEqual({ endMonth: '2026-12', months: 12 });
  });
  it('ทั้งหมด = ตั้งแต่เดือนแรกสุดถึงเดือนนี้ อย่างน้อย 6 อย่างมาก 24 เดือน', () => {
    expect(trendWindow('all', '2026-10-02', [])).toEqual({ endMonth: '2026-10', months: 6 });
    expect(trendWindow('all', '2026-10-02', [t('2026-08-10')])).toEqual({ endMonth: '2026-10', months: 6 });
    expect(trendWindow('all', '2026-10-02', [t('2025-01-05')]).months).toBe(22);
    expect(trendWindow('all', '2026-10-02', [t('2020-01-05')]).months).toBe(24);
  });
  it('ไม่นับรายการในถังขยะตอนหาเดือนแรกสุด', () => {
    expect(trendWindow('all', '2026-10-02', [tx({ date: '2020-01-01', deletedAt: 'x' }), t('2025-01-05')]).months).toBe(22);
  });
});

describe('hasTrendData (ข้อมูลพอให้เห็นแนวโน้มไหม)', () => {
  const m = (month, income, expense) => ({ month, income, expense, net: income - expense });
  it('ต้องมีข้อมูลอย่างน้อย 2 เดือน', () => {
    expect(hasTrendData([m('2026-09', 0, 0), m('2026-10', 100, 50)])).toBe(false);
    expect(hasTrendData([m('2026-09', 0, 20), m('2026-10', 100, 50)])).toBe(true);
    expect(hasTrendData([])).toBe(false);
  });
});
