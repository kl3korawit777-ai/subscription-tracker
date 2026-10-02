// กราฟ SVG แบบตรรกะล้วน (คืนสตริง) — สีทั้งหมดกำหนดผ่านคลาส + CSS variables ใน style.css
// จึงเปลี่ยนตามธีม (dark mode) เองโดยไม่ต้องอ่านสีแล้ววาดใหม่ และใช้งานออฟไลน์ได้โดยไม่พึ่ง CDN

const W = 360;
const H = 200;
const PAD = { l: 8, r: 8, t: 12, b: 28 };
const r2 = (n) => Math.round(n * 100) / 100;
const baht = (s) => (s / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const monthShort = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'short' });
const monthLong = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

// แท่งคู่ (รายรับ/รายจ่าย) ต่อเดือน + เส้นยอดสุทธิทับ ; series = [{ month:'YYYY-MM', income, expense, net }] เป็นสตางค์
export function trendSVG(series) {
  if (!series.some((m) => m.income || m.expense)) return '';
  const n = series.length;
  const max = Math.max(0, ...series.flatMap((m) => [m.income, m.expense, m.net]));
  const min = Math.min(0, ...series.map((m) => m.net));
  const span = max - min || 1;
  const ph = H - PAD.t - PAD.b;
  const y = (v) => PAD.t + ((max - v) / span) * ph;
  const base = y(0);
  const group = (W - PAD.l - PAD.r) / n;
  const bw = Math.min(group * 0.34, 22);
  const bar = (cls, cx, v, label) => {
    const h = (Math.abs(v) / span) * ph;
    return `<rect class="${cls}" x="${r2(cx)}" y="${r2(v >= 0 ? base - h : base)}" width="${r2(bw)}" height="${r2(h)}" rx="2"><title>${label}</title></rect>`;
  };

  const bars = [];
  const labels = [];
  const pts = [];
  series.forEach((m, i) => {
    const cx = PAD.l + group * i + group / 2;
    bars.push(bar('ch-income', cx - bw - 1, m.income, `${monthLong(m.month)} รายรับ ${baht(m.income)} บาท`));
    bars.push(bar('ch-expense', cx + 1, m.expense, `${monthLong(m.month)} รายจ่าย ${baht(m.expense)} บาท`));
    pts.push(`${r2(cx)},${r2(y(m.net))}`);
    labels.push(`<text class="ch-label" x="${r2(cx)}" y="${H - 8}" text-anchor="middle">${monthShort(m.month)}</text>`);
  });
  const netDots = series.map((m, i) => {
    const [cx, cy] = pts[i].split(',');
    return `<circle class="ch-dot" cx="${cx}" cy="${cy}" r="4"><title>${monthLong(m.month)} สุทธิ ${m.net < 0 ? '−' : ''}${baht(Math.abs(m.net))} บาท</title></circle>`;
  });

  const desc = `แนวโน้ม ${n} เดือน ${monthLong(series[0].month)} ถึง ${monthLong(series[n - 1].month)}: แท่งรายรับ แท่งรายจ่าย และเส้นยอดสุทธิรายเดือน (ดูตัวเลขได้ที่ปุ่มดูเป็นตาราง)`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${desc}" xmlns="http://www.w3.org/2000/svg">
    <line class="ch-base" x1="${PAD.l}" x2="${W - PAD.r}" y1="${r2(base)}" y2="${r2(base)}"/>
    ${bars.join('')}
    <polyline class="ch-halo" fill="none" points="${pts.join(' ')}"/>
    <polyline class="ch-net" fill="none" points="${pts.join(' ')}"/>
    ${netDots.join('')}
    ${labels.join('')}
  </svg>`;
}
