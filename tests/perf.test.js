import { describe, it, expect } from 'vitest';
import { resolvePeriod, periodTotals, categoryBreakdown, monthlySeries, trendWindow, serviceShare, topServices, spendingHabits, forecastEndOfMonth } from '../js/analytics.js';
import { dashboardHTML, RATE_DEFAULTS } from '../js/dashboard.js';
import { tx } from './helpers/sampleData.js';

// ข้อมูลตัวอย่าง 3 ปี (ม.ค. 2024 – ต.ค. 2026): ~125 รายการต่อเดือน
function threeYears() {
  const out = [];
  const cats = ['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', 'บิล/สาธารณูปโภค', 'สุขภาพ', 'บันเทิง'];
  for (let i = 0; i < 34; i++) {
    const y = 2024 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    const mm = String(m).padStart(2, '0');
    out.push(tx({ type: 'income', category: 'เงินเดือน', amount: 3000000, date: `${y}-${mm}-01` }));
    out.push(tx({ category: 'ค่าบริการ', subId: 'n', name: 'Netflix', amount: 41900, date: `${y}-${mm}-05` }));
    for (let k = 0; k < 120; k++) {
      const day = String((k % 28) + 1).padStart(2, '0');
      out.push(tx({ category: cats[k % cats.length], amount: 3000 + ((k * 37 + i * 11) % 90) * 100, date: `${y}-${mm}-${day}` }));
    }
  }
  return out;
}

describe('ประสิทธิภาพหน้าสรุป (ข้อมูล 3 ปี)', () => {
  const all = threeYears();
  const today = '2026-10-02';

  it('ข้อมูลตัวอย่างมีขนาดตามที่ตั้งใจ (> 4,000 รายการ)', () => {
    expect(all.length).toBeGreaterThan(4000);
  });

  it('คำนวณทุกส่วนของหน้าสรุปทุกช่วงเวลา รวมกันไม่เกิน 1 วินาที (เกณฑ์ตามสเปก)', () => {
    const t0 = performance.now();
    for (const kind of ['thisMonth', 'lastMonth', '6months', 'thisYear', 'all']) {
      const range = resolvePeriod(kind, today);
      periodTotals(all, range);
      categoryBreakdown(all, range);
      monthlySeries(all, trendWindow(kind, today, all));
      serviceShare(all, range);
      topServices(all, range);
      spendingHabits(all, { from: range.from, to: range.to, today });
    }
    forecastEndOfMonth({ transactions: all, subscriptions: [], paid: {}, rates: RATE_DEFAULTS, today });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('สร้าง HTML หน้าสรุป (ช่วง "ทั้งหมด") ไม่เกิน 1 วินาที และตัวเลขตรงกับ periodTotals', () => {
    const state = { transactions: all, items: [], paid: {}, rates: RATE_DEFAULTS, period: 'all', tables: {} };
    const t0 = performance.now();
    const html = dashboardHTML(state);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(html).toContain('data-cat-go');
    expect(html).toContain('แนวโน้ม 24 เดือน');
    const { expense } = periodTotals(all, { from: null, to: null });
    expect(categoryBreakdown(all, { from: null, to: null }).total).toBe(expense);
  });
});
