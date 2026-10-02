// ข้อความของหน้าสรุป (ตรรกะล้วน ทดสอบได้) — ตัวเลขเป็นสตางค์ แสดงเป็นบาทด้วย Intl th-TH
export const PERIOD_LABELS = { thisMonth: 'เดือนนี้', lastMonth: 'เดือนก่อน', '6months': '6 เดือน', thisYear: 'ปีนี้', all: 'ทั้งหมด' };

const num = (satang) => {
  const abs = Math.abs(satang) / 100;
  return abs.toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 });
};
const left = (satang) => (satang < 0 ? `ติดลบ ${num(satang)}` : `เหลือ ${num(satang)}`);

// ประโยคคาดการณ์สิ้นเดือน (ส่วนบนสุดของหน้า) ; negative = คาดว่าสิ้นเดือนติดลบ → หน้าจอแสดงสีตรายางแดง
export function forecastText(f, monthName) {
  const { income, expense, balance, unpaid, projected, negative } = f;
  if (!income && !expense && !unpaid.count) return { empty: true, negative: false, lines: [] };
  const lines = [`${monthName}: รับ ${num(income)} จ่ายไป ${num(expense)} ${left(balance)} บาท`];
  lines.push(unpaid.count
    ? `ยังมีค่าบริการต้องจ่ายอีก ${unpaid.count} รายการ (${num(unpaid.amount)} บาท) ถ้าไม่ใช้อะไรเพิ่ม สิ้นเดือนจะ${left(projected)} บาท`
    : `ไม่มีค่าบริการค้างจ่ายแล้ว ถ้าไม่ใช้อะไรเพิ่ม สิ้นเดือนจะ${left(projected)} บาท`);
  if (unpaid.missingRates?.length) lines.push(`ยอดนี้ยังไม่รวมบริการสกุล ${unpaid.missingRates.join(', ')} เพราะยังไม่ได้ตั้งอัตราแลกเปลี่ยน (ตั้งได้ที่หน้าตั้งค่า)`);
  return { empty: false, negative, lines };
}

// ลูกศรเทียบช่วงก่อนหน้า เช่น "↑ 15%" ; hasPrev = false (ช่วง "ทั้งหมด") → ไม่แสดง
export function deltaText({ direction, change }, hasPrev) {
  if (!hasPrev) return '';
  if (direction === 'new') return 'ใหม่';
  if (direction === 'up') return `↑ ${change}%`;
  if (direction === 'down') return `↓ ${Math.abs(change)}%`;
  return '→ 0%';
}

export function deltaLabel({ direction, change }, hasPrev) {
  if (!hasPrev) return '';
  if (direction === 'new') return 'ไม่มีในช่วงก่อน';
  if (direction === 'up') return `เพิ่มขึ้น ${change}% จากช่วงก่อน`;
  if (direction === 'down') return `ลดลง ${Math.abs(change)}% จากช่วงก่อน`;
  return 'เท่าช่วงก่อน';
}

export const WEEKDAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const dayWord = (n) => (n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : `อีก ${n} วัน`);

const SCOPE = { thisMonth: 'เดือนนี้', lastMonth: 'เดือนก่อน', '6months': 'ใน 6 เดือน', thisYear: 'ปีนี้', all: 'ทั้งหมด' };

// ส่วนค่าบริการ: "18% ของรายจ่ายเดือนนี้"
export function serviceSentence({ service, total, pct }, kind) {
  if (!service || !total) return { lead: 'ช่วงนี้ยังไม่มีรายจ่ายค่าบริการ', sub: '' };
  return { lead: `${pct}% ของรายจ่าย${SCOPE[kind]}`, sub: `ค่าบริการรวม ${num(service)} บาท จากรายจ่ายทั้งหมด ${num(total)} บาท` };
}

// นิสัยการใช้จ่าย: "ใช้เงินมากที่สุดวันศุกร์ เฉลี่ย 140 บาท"
export function habitsText({ total, avgPerDay, top }) {
  if (!total || !top) return ['ช่วงนี้ยังไม่มีรายจ่าย'];
  return [`เฉลี่ยวันละ ${num(avgPerDay)} บาท`, `ใช้เงินมากที่สุดวัน${WEEKDAY_NAMES[top.day]} เฉลี่ย ${num(top.avg)} บาท`];
}
