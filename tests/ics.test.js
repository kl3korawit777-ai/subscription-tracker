import { describe, it, expect } from 'vitest';
import { buildICS, foldLine, escapeText } from '../js/ics.js';

const item = (o) => ({ id: 'i1', name: 'Netflix', category: 'บันเทิง', price: 419, currency: 'THB', cycle: 'monthly', interval: 1, startDate: '2025-01-31', trialEnd: '', payment: 'บัตรลงท้าย 1234', status: 'active', ...o });
const NOW = new Date('2025-02-01T00:00:00Z');
const dates = (ics) => [...ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map((m) => m[1]);

describe('ics', () => {
  it('escape อักขระพิเศษ', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
  it('พับบรรทัดไม่เกิน 75 octets และไม่ตัดกลางตัวอักษรไทย', () => {
    const folded = foldLine(`SUMMARY:${'จ่ายค่าบริการ'.repeat(20)}`);
    const enc = new TextEncoder();
    for (const l of folded.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'จ่ายค่าบริการ'.repeat(20)}`); // ไม่มีตัวอักษรเสียหาย
  });
  it('ทุกอีเวนต์มี VALARM เตือนล่วงหน้า 1 วัน และใช้ CRLF', () => {
    const ics = buildICS([item({})], '2025-02-01', { months: 3, now: NOW });
    const events = ics.match(/BEGIN:VEVENT/g).length;
    expect(events).toBe(3);
    expect(ics.match(/TRIGGER:-P1D/g).length).toBe(events);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('วันที่ 31 → 28 ก.พ. / 31 มี.ค. / 30 เม.ย.', () => {
    const ics = buildICS([item({})], '2025-02-01', { months: 3, now: NOW });
    expect(dates(ics)).toEqual(['20250228', '20250331', '20250430']);
  });
  it('ไม่มีอีเวนต์ของรายการที่ยกเลิก', () => {
    const ics = buildICS([item({ status: 'cancelled', trialEnd: '2025-02-10' })], '2025-02-01', { now: NOW });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
  it('วันหมด trial เป็นอีเวนต์แยก และไม่ตัดเงินก่อนหมด trial', () => {
    const ics = buildICS([item({ status: 'trial', startDate: '2025-02-01', trialEnd: '2025-02-15' })], '2025-02-01', { months: 1, now: NOW });
    expect(dates(ics).sort()).toEqual(['20250215', '20250301']);
    expect(ics).toContain('Free trial Netflix');
  });
  it('วันสิ้นสุดอีเวนต์ all-day = วันถัดไป', () => {
    const ics = buildICS([item({ startDate: '2025-12-31' })], '2025-12-31', { months: 1, now: NOW });
    expect(ics).toContain('DTSTART;VALUE=DATE:20251231');
    expect(ics).toContain('DTEND;VALUE=DATE:20260101');
  });
});
