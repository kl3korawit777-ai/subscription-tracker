// ไอคอนของรายการ: icon = { type: 'letter' | 'lucide' | 'emoji' | 'image', value }
// ไม่มี icon (ค่าเริ่มต้น) = ตัวอักษรแรกของชื่อบนสีของหมวด ; ทุกครั้งที่อ่านผ่าน normalizeIcon ค่าผิดรูป/ไม่ปลอดภัยจะตกกลับเป็นค่าเริ่มต้น
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID } from './categories.js';

export const MAX_IMAGE_BYTES = 15 * 1024;
export const IMAGE_SIZE = 96;

// ชุดไอคอนเส้นสไตล์ Lucide (24×24, stroke) ฝังในโค้ดเอง ไม่โหลดจาก CDN จึงใช้ออฟไลน์ได้
export const LUCIDE = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11.5" r=".6"/><circle cx="18" cy="14" r=".6"/>',
  cloud: '<path d="M7.5 18.5h9a4 4 0 0 0 .6-7.96 5.5 5.5 0 0 0-10.5 1.2A3.5 3.5 0 0 0 7.5 18.5z"/>',
  sparkles: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/>',
  book: '<path d="M4 6.5C6.5 5.5 9.5 5.5 12 7c2.5-1.5 5.5-1.5 8-.5V18c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 7v11.5"/>',
  wifi: '<path d="M5 10a10 10 0 0 1 14 0"/><path d="M8 13.2a6 6 0 0 1 8 0"/><circle cx="12" cy="17" r="1.2"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  car: '<path d="M5 16v-4l2-5h10l2 5v4"/><path d="M3 16h18v2H3z"/>',
  coffee: '<path d="M5 8h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/>',
  zap: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
};
export const LUCIDE_KEYS = Object.keys(LUCIDE);
export const EMOJI_CHOICES = ['🎬', '🎵', '🎮', '📺', '📚', '🎓', '🤖', '☁️', '📶', '📱', '🛒', '🍔', '☕', '🚗', '🏠', '💪', '💊', '✈️', '🎧', '📰', '🔒', '💡', '🐶', '⭐'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const graphemes = (s) => (typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : Array.from(s));
const LEADING_VOWELS = 'เแโใไ'; // สระที่เขียนนำหน้าพยัญชนะ ไม่เหมาะเป็นตัวแทนชื่อ
const SYMBOL = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

// ตัวอักษรแรกของชื่อ: ข้ามเครื่องหมาย/ช่องว่างนำหน้า ข้ามสระนำภาษาไทย ละตินเป็นตัวพิมพ์ใหญ่
export function firstLetter(name) {
  if (typeof name !== 'string') return '?';
  const gs = graphemes(name.trim()).filter((g) => SYMBOL.test(g));
  let i = 0;
  if (gs.length > 1 && LEADING_VOWELS.includes(gs[0])) i = 1;
  const g = gs[i];
  if (!g) return '?';
  return (/\p{Extended_Pictographic}/u.test(g) ? g : g.replace(/\p{M}/gu, '') || g).toUpperCase(); // ตัดวรรณยุกต์/ไม้ไต่คู้ที่ติดมากับพยัญชนะ
}

export const defaultIcon = (name) => ({ type: 'letter', value: firstLetter(name) });

export function dataUrlBytes(url) {
  const payload = String(url).split(',')[1] ?? '';
  const pad = (payload.match(/=+$/) ?? [''])[0].length;
  return Math.floor((payload.length * 3) / 4) - pad;
}

const IMAGE_URL = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;
const valid = {
  letter: (v) => typeof v === 'string' && v.length > 0 && v.length <= 4 && !/[<>&"]/.test(v),
  lucide: (v) => typeof v === 'string' && Object.hasOwn(LUCIDE, v),
  emoji: (v) => typeof v === 'string' && v.length > 0 && v.length <= 16 && !/[<>&"]/.test(v),
  image: (v) => typeof v === 'string' && IMAGE_URL.test(v) && dataUrlBytes(v) <= MAX_IMAGE_BYTES,
};

// ค่าผิดรูป/ไม่ปลอดภัย (เช่น URL ภายนอก, SVG, ใหญ่เกิน) → ตัวอักษรแรกของชื่อ
export function normalizeIcon(icon, name) {
  if (icon && typeof icon === 'object' && valid[icon.type]?.(icon.value)) return { type: icon.type, value: icon.value };
  return defaultIcon(name);
}

// ลองคุณภาพจากสูงไปต่ำจนขนาดไม่เกิน max ; ต่ำสุดแล้วยังเกิน → null
export async function encodeWithin(encode, max, qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]) {
  for (const q of qualities) {
    const url = await encode(q);
    if (dataUrlBytes(url) <= max) return url;
  }
  return null;
}

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// วงกลมไอคอน (ใช้ class .cb เดียวกับป้ายหมวด) ; cat = { color, glyph }
export function iconBadgeHTML(icon, cat, cls = '') {
  let inner;
  if (icon.type === 'lucide') inner = svg(LUCIDE[icon.value]);
  else if (icon.type === 'image') inner = `<img class="cb-img" src="${esc(icon.value)}" alt="">`;
  else inner = `<span class="cb-t${icon.type === 'emoji' ? ' cb-emoji' : ''}">${esc(icon.value)}</span>`;
  return `<span class="cb ${cls}${icon.type === 'image' ? ' has-img' : ''}" style="--c:${cat.color};--g:${cat.glyph}" aria-hidden="true">${inner}</span>`;
}

export function categoryMeta(item) {
  return DEFAULT_CATEGORIES.find((c) => c.id === item.categoryId)
    ?? DEFAULT_CATEGORIES.find((c) => c.name === item.category)
    ?? DEFAULT_CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY_ID);
}

export const itemBadge = (item, cls = '') => iconBadgeHTML(normalizeIcon(item.icon, item.name), categoryMeta(item), cls);
