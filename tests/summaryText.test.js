import { describe, it, expect } from 'vitest';
import { forecastText, deltaText, deltaLabel, PERIOD_LABELS } from '../js/summaryText.js';

const f = (o = {}) => ({ income: 300000, expense: 185000, balance: 115000, unpaid: { count: 2, amount: 29800, missingRates: [] }, projected: 85200, negative: false, ...o });

describe('forecastText (ประโยคคาดการณ์ด้านบนสุด)', () => {
  it('ตรงกับตัวอย่างในสเปกทุกตัวอักษร', () => {
    expect(forecastText(f(), 'ตุลาคม')).toEqual({
      empty: false, negative: false,
      lines: [
        'ตุลาคม: รับ 3,000 จ่ายไป 1,850 เหลือ 1,150 บาท',
        'ยังมีค่าบริการต้องจ่ายอีก 2 รายการ (298 บาท) ถ้าไม่ใช้อะไรเพิ่ม สิ้นเดือนจะเหลือ 852 บาท',
      ],
    });
  });
  it('คาดการณ์ติดลบ → negative (หน้าจอใช้สีตรายางแดง) และใช้คำว่า "ติดลบ"', () => {
    const r = forecastText(f({ income: 100000, expense: 90000, balance: 10000, projected: -19800, negative: true }), 'ตุลาคม');
    expect(r.negative).toBe(true);
    expect(r.lines[0]).toBe('ตุลาคม: รับ 1,000 จ่ายไป 900 เหลือ 100 บาท');
    expect(r.lines[1]).toBe('ยังมีค่าบริการต้องจ่ายอีก 2 รายการ (298 บาท) ถ้าไม่ใช้อะไรเพิ่ม สิ้นเดือนจะติดลบ 198 บาท');
  });
  it('ตอนนี้ติดลบอยู่แล้ว → "ติดลบ" ในบรรทัดแรก', () => {
    const r = forecastText(f({ income: 0, expense: 5000, balance: -5000, unpaid: { count: 0, amount: 0, missingRates: [] }, projected: -5000, negative: true }), 'ตุลาคม');
    expect(r.lines[0]).toBe('ตุลาคม: รับ 0 จ่ายไป 50 ติดลบ 50 บาท');
  });
  it('ไม่มีค่าบริการค้างจ่าย', () => {
    const r = forecastText(f({ unpaid: { count: 0, amount: 0, missingRates: [] }, projected: 115000 }), 'ตุลาคม');
    expect(r.lines[1]).toBe('ไม่มีค่าบริการค้างจ่ายแล้ว ถ้าไม่ใช้อะไรเพิ่ม สิ้นเดือนจะเหลือ 1,150 บาท');
  });
  it('มีสตางค์ แสดงทศนิยม 2 ตำแหน่ง', () => {
    const r = forecastText(f({ income: 300000, expense: 12950, balance: 287050, unpaid: { count: 1, amount: 14950, missingRates: [] }, projected: 272100 }), 'ตุลาคม');
    expect(r.lines[0]).toBe('ตุลาคม: รับ 3,000 จ่ายไป 129.50 เหลือ 2,870.50 บาท');
    expect(r.lines[1]).toContain('(149.50 บาท)');
  });
  it('เดือนที่ยังไม่มีอะไรเลย → empty', () => {
    expect(forecastText(f({ income: 0, expense: 0, balance: 0, unpaid: { count: 0, amount: 0, missingRates: [] }, projected: 0 }), 'ตุลาคม').empty).toBe(true);
  });
  it('ขาดอัตราแลกเปลี่ยน → บอกผู้ใช้ว่ายอดนี้ยังไม่รวมบริการสกุลนั้น', () => {
    const r = forecastText(f({ unpaid: { count: 1, amount: 0, missingRates: ['USD'] }, projected: 115000 }), 'ตุลาคม');
    expect(r.lines.at(-1)).toContain('USD');
    expect(r.lines.at(-1)).toContain('อัตราแลกเปลี่ยน');
  });
});

describe('deltaText / deltaLabel (ลูกศรเทียบช่วงก่อน)', () => {
  it('ขึ้น ลง เท่าเดิม ใหม่', () => {
    expect(deltaText({ direction: 'up', change: 15 }, true)).toBe('↑ 15%');
    expect(deltaText({ direction: 'down', change: -50 }, true)).toBe('↓ 50%');
    expect(deltaText({ direction: 'same', change: 0 }, true)).toBe('→ 0%');
    expect(deltaText({ direction: 'new', change: null }, true)).toBe('ใหม่');
  });
  it('ไม่มีช่วงเทียบ (ทั้งหมด) → ไม่แสดง', () => {
    expect(deltaText({ direction: 'new', change: null }, false)).toBe('');
    expect(deltaLabel({ direction: 'new', change: null }, false)).toBe('');
  });
  it('ข้อความสำหรับโปรแกรมอ่านหน้าจอ', () => {
    expect(deltaLabel({ direction: 'up', change: 15 }, true)).toBe('เพิ่มขึ้น 15% จากช่วงก่อน');
    expect(deltaLabel({ direction: 'down', change: -50 }, true)).toBe('ลดลง 50% จากช่วงก่อน');
    expect(deltaLabel({ direction: 'same', change: 0 }, true)).toBe('เท่าช่วงก่อน');
    expect(deltaLabel({ direction: 'new', change: null }, true)).toBe('ไม่มีในช่วงก่อน');
  });
});

describe('PERIOD_LABELS', () => {
  it('ตัวเลือกช่วงเวลาเรียงตามสเปก', () => {
    expect(Object.entries(PERIOD_LABELS)).toEqual([['thisMonth', 'เดือนนี้'], ['lastMonth', 'เดือนก่อน'], ['6months', '6 เดือน'], ['thisYear', 'ปีนี้'], ['all', 'ทั้งหมด']]);
  });
});
