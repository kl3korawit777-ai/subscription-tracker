import { describe, it, expect } from 'vitest';
import { serviceSentence, habitsText, WEEKDAY_NAMES, dayWord } from '../js/summaryText.js';

describe('serviceSentence (ส่วนค่าบริการ)', () => {
  const share = { service: 100200, total: 200200, ratio: 0.5, pct: 50 };
  it('"N% ของรายจ่ายเดือนนี้" ตามสเปก พร้อมยอด', () => {
    expect(serviceSentence(share, 'thisMonth')).toEqual({ lead: '50% ของรายจ่ายเดือนนี้', sub: 'ค่าบริการรวม 1,002 บาท จากรายจ่ายทั้งหมด 2,002 บาท' });
  });
  it('คำเรียกช่วงเวลาอื่น', () => {
    expect(serviceSentence(share, 'lastMonth').lead).toBe('50% ของรายจ่ายเดือนก่อน');
    expect(serviceSentence(share, '6months').lead).toBe('50% ของรายจ่ายใน 6 เดือน');
    expect(serviceSentence(share, 'thisYear').lead).toBe('50% ของรายจ่ายปีนี้');
    expect(serviceSentence(share, 'all').lead).toBe('50% ของรายจ่ายทั้งหมด');
  });
  it('ไม่มีรายจ่ายค่าบริการ → ข้อความว่างแบบสุภาพ', () => {
    expect(serviceSentence({ service: 0, total: 5000, ratio: 0, pct: 0 }, 'thisMonth')).toEqual({ lead: 'ช่วงนี้ยังไม่มีรายจ่ายค่าบริการ', sub: '' });
    expect(serviceSentence({ service: 0, total: 0, ratio: 0, pct: 0 }, 'all').lead).toBe('ช่วงนี้ยังไม่มีรายจ่ายค่าบริการ');
  });
});

describe('habitsText (นิสัยการใช้จ่าย)', () => {
  it('ตรงกับตัวอย่างในสเปก', () => {
    expect(habitsText({ total: 35000, avgPerDay: 42000, top: { day: 5, avg: 14000 } })).toEqual(['เฉลี่ยวันละ 420 บาท', 'ใช้เงินมากที่สุดวันศุกร์ เฉลี่ย 140 บาท']);
  });
  it('ไม่มีรายจ่าย', () => {
    expect(habitsText({ total: 0, avgPerDay: 0, top: null })).toEqual(['ช่วงนี้ยังไม่มีรายจ่าย']);
  });
  it('ชื่อวันครบ 7 วัน เริ่มอาทิตย์ตาม getDay()', () => {
    expect(WEEKDAY_NAMES).toEqual(['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']);
  });
});

describe('dayWord', () => {
  it('วันนี้ / พรุ่งนี้ / อีก N วัน', () => {
    expect([0, 1, 5].map(dayWord)).toEqual(['วันนี้', 'พรุ่งนี้', 'อีก 5 วัน']);
  });
});
