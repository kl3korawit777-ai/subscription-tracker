import { describe, it, expect } from 'vitest';
import { trendSVG } from '../js/charts.js';

const m = (month, income, expense) => ({ month, income, expense, net: income - expense });
const series = [m('2026-05', 3000000, 1500000), m('2026-06', 3000000, 2000000), m('2026-07', 1500000, 2500000), m('2026-08', 3000000, 1000000), m('2026-09', 3000000, 3000000), m('2026-10', 3000000, 500000)];
const num = (el, k) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(el)[1]);
const rects = (svg, cls) => [...svg.matchAll(new RegExp(`<rect class="${cls}"[^>]*>`, 'g'))].map((x) => x[0]);
const netPoints = (svg) => /<polyline class="ch-net"[^>]*points="([^"]+)"/.exec(svg)[1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
const viewBox = (svg) => /viewBox="0 0 (\d+) (\d+)"/.exec(svg).slice(1).map(Number);

describe('trendSVG', () => {
  const svg = trendSVG(series);

  it('เป็น SVG ที่โปรแกรมอ่านหน้าจออ่านได้ (role=img + คำอธิบาย)', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toMatch(/aria-label="แนวโน้ม 6 เดือน/);
  });

  it('แท่งคู่ต่อเดือน: รายรับ 6 แท่ง รายจ่าย 6 แท่ง และเส้นยอดสุทธิ 6 จุด', () => {
    expect(rects(svg, 'ch-income')).toHaveLength(6);
    expect(rects(svg, 'ch-expense')).toHaveLength(6);
    expect(netPoints(svg)).toHaveLength(6);
  });

  it('ความสูงแท่งเป็นสัดส่วนกับยอด (3,000,000 สูงเป็น 2 เท่าของ 1,500,000)', () => {
    const inc = rects(svg, 'ch-income').map((r) => num(r, 'height'));
    expect(inc[0] / inc[2]).toBeCloseTo(2, 5);
  });

  it('ยอดสุทธิติดลบอยู่ใต้เส้นฐาน ยอดบวกอยู่เหนือ ยอดศูนย์อยู่บนเส้น', () => {
    const base = num(/<line class="ch-base"[^>]*>/.exec(svg)[0], 'y1');
    const ys = netPoints(svg).map((p) => p[1]);
    expect(ys[2]).toBeGreaterThan(base); // ก.ค. สุทธิ -1,000,000
    expect(ys[0]).toBeLessThan(base); // พ.ค. สุทธิ +1,500,000
    expect(ys[4]).toBeCloseTo(base, 5); // ก.ย. สุทธิ 0
  });

  it('ไม่มี NaN/undefined และแท่งไม่ล้นกรอบ', () => {
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    const [, h] = viewBox(svg);
    for (const r of [...rects(svg, 'ch-income'), ...rects(svg, 'ch-expense')]) {
      expect(num(r, 'y')).toBeGreaterThanOrEqual(0);
      expect(num(r, 'y') + num(r, 'height')).toBeLessThanOrEqual(h + 0.001);
    }
  });

  it('ทุกแท่งมี <title> บอกยอด (เลื่อนเมาส์ดูได้)', () => {
    expect((svg.match(/<title>/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it('ไม่มีข้อมูลเลย → คืนสตริงว่าง (หน้าจอแสดงข้อความแทน)', () => {
    expect(trendSVG([m('2026-10', 0, 0), m('2026-09', 0, 0)])).toBe('');
    expect(trendSVG([])).toBe('');
  });

  it('ใช้สีผ่านคลาส (CSS variables) ไม่ฝังสี — สลับ dark mode แล้วเปลี่ยนเองโดยไม่ต้องวาดใหม่', () => {
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(svg).not.toMatch(/(fill|stroke)="rgb/);
  });

  it('เดือนเดียว หรือรายจ่ายล้วน ก็วาดได้ ไม่เพี้ยน', () => {
    expect(trendSVG([m('2026-10', 0, 1000)])).toContain('<svg');
    expect(trendSVG([m('2026-09', 0, 500), m('2026-10', 0, 1000)])).not.toMatch(/NaN/);
  });
});
