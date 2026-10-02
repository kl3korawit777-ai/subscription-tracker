import { paymentsInRange, addDays } from './recurrence.js';

const enc = new TextEncoder();

// ตามมาตรฐาน RFC 5545: escape \ ; , และขึ้นบรรทัดใหม่
export const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// พับบรรทัดไม่เกิน 75 octets โดยไม่ตัดกลางตัวอักษร UTF-8 (สำคัญกับภาษาไทย)
export function foldLine(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = (d) => d.replace(/-/g, '');
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const money = (p, c) => `${c === 'THB' ? '฿' : `${c} `}${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function event({ uid, date, summary, description, now }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@subscription-tracker`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'TRANSP:TRANSPARENT',
    // เตือนล่วงหน้า 1 วัน
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(summary)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
  ];
}

// สร้างไฟล์ .ics: วันจ่ายที่ขยายตามกฎแล้ว ตั้งแต่ today ถึง +months เดือน และวันหมด trial
// (ขยายเป็นอีเวนต์รายวัน ไม่ใช้ RRULE เพราะกติกาวันที่ 29–31 ต่างจาก RRULE)
export function buildICS(items, today, { months = 12, now = new Date() } = {}) {
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Subscription Tracker//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Subscription Tracker'];
  for (const item of items) {
    const base = `${money(item.price, item.currency)} · ${item.category}${item.payment ? ` · ${item.payment}` : ''}`;
    for (const date of paymentsInRange(item, today, end)) {
      lines.push(...event({ uid: `${item.id}-${date}`, date, now, summary: `จ่าย ${item.name} ${money(item.price, item.currency)}`, description: base }));
    }
    if (item.trialEnd && item.trialEnd >= today && item.status !== 'cancelled' && item.status !== 'paused') {
      lines.push(...event({ uid: `${item.id}-trial-${item.trialEnd}`, date: item.trialEnd, now, summary: `Free trial ${item.name} หมดวันนี้`, description: `ยกเลิกก่อนถูกตัดเงิน ${base}` }));
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export const downloadICS = (text, filename = 'subscriptions.ics') => downloadText(text, filename, 'text/calendar');

export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
