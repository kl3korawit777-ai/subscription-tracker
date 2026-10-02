// ข้อมูลตัวอย่าง 6 เดือน (พ.ค.–ต.ค. 2026) แบบกำหนดผลได้ (ไม่สุ่มจริง) เงินเป็นสตางค์จำนวนเต็ม
const pad = (n) => String(n).padStart(2, '0');
const date = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

let seq = 0;
export const tx = (o) => ({ id: `t${++seq}`, type: 'expense', category: 'อาหาร', amount: 10000, currency: 'THB', date: '2026-10-01', source: 'manual', createdAt: `${o.date ?? '2026-10-01'}T08:00:00Z`, ...o });

export function sixMonths() {
  const out = [];
  const months = [[2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10]];
  months.forEach(([y, m], mi) => {
    out.push(tx({ type: 'income', category: 'เงินเดือน', amount: 3000000 + mi * 10000, date: date(y, m, 1) }));
    out.push(tx({ category: 'ค่าบริการ', subId: 's-netflix', name: 'Netflix', amount: 41900, date: date(y, m, 5) }));
    out.push(tx({ category: 'ค่าบริการ', subId: 's-spotify', name: 'Spotify', amount: 12900, date: date(y, m, 15) }));
    for (let d = 1; d <= daysIn(y, m); d += 3) {
      out.push(tx({ category: 'อาหาร', amount: 5000 + ((d * 37 + mi * 11) % 60) * 100, date: date(y, m, d) }));
      if (d % 2 === 1) out.push(tx({ category: 'เดินทาง', amount: 3000 + ((d * 13) % 20) * 100, date: date(y, m, d) }));
    }
  });
  return out;
}
