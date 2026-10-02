import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGE_BYTES, LUCIDE_KEYS, EMOJI_CHOICES, firstLetter, defaultIcon, normalizeIcon, dataUrlBytes, encodeWithin, itemBadge, iconBadgeHTML,
} from '../js/icons.js';

const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
const webp = (bytes) => `data:image/webp;base64,${b64(bytes)}`;

describe('firstLetter: ตัวอักษรแรกของชื่อ', () => {
  it('ละติน → ตัวพิมพ์ใหญ่', () => {
    expect(firstLetter('netflix')).toBe('N');
    expect(firstLetter('  spotify ')).toBe('S');
    expect(firstLetter('3BB')).toBe('3');
  });
  it('ภาษาไทย: ข้ามสระนำ (เ แ โ ใ ไ) ไปที่พยัญชนะ', () => {
    expect(firstLetter('กาแฟ')).toBe('ก');
    expect(firstLetter('เน็ตบ้าน')).toBe('น');
    expect(firstLetter('ไฟเบอร์')).toBe('ฟ');
  });
  it('อีโมจิตัวแรกนับเป็นหนึ่งตัวอักษร ไม่ถูกตัดครึ่ง', () => {
    expect(firstLetter('🎬 หนัง')).toBe('🎬');
  });
  it('ว่าง/ไม่ใช่ข้อความ → "?"', () => {
    for (const v of ['', '   ', undefined, null]) expect(firstLetter(v)).toBe('?');
  });
});

describe('defaultIcon / normalizeIcon', () => {
  it('ค่าเริ่มต้นเป็นตัวอักษรแรกของชื่อ', () => {
    expect(defaultIcon('Netflix')).toEqual({ type: 'letter', value: 'N' });
  });

  it('ไม่มีค่า/ค่าผิดรูป → ตัวอักษรแรกของชื่อ', () => {
    for (const bad of [undefined, null, 'x', 5, {}, { type: 'nope', value: 'a' }, { type: 'letter' }, { type: 'letter', value: '' }]) {
      expect(normalizeIcon(bad, 'Spotify')).toEqual({ type: 'letter', value: 'S' });
    }
  });

  it('ค่าที่ถูกต้องผ่านตามเดิม', () => {
    expect(normalizeIcon({ type: 'letter', value: 'Z' }, 'x')).toEqual({ type: 'letter', value: 'Z' });
    expect(normalizeIcon({ type: 'lucide', value: LUCIDE_KEYS[0] }, 'x')).toEqual({ type: 'lucide', value: LUCIDE_KEYS[0] });
    expect(normalizeIcon({ type: 'emoji', value: '🎬' }, 'x')).toEqual({ type: 'emoji', value: '🎬' });
    const img = { type: 'image', value: webp(1000) };
    expect(normalizeIcon(img, 'x')).toEqual(img);
  });

  it('lucide ที่ไม่รู้จักชื่อ → ตกไปตัวอักษร', () => {
    expect(normalizeIcon({ type: 'lucide', value: 'does-not-exist' }, 'Hulu')).toEqual({ type: 'letter', value: 'H' });
  });

  it('รูป: ต้องเป็น data URL WebP เท่านั้น และไม่เกิน 15 KB', () => {
    const fb = { type: 'letter', value: 'X' };
    expect(normalizeIcon({ type: 'image', value: 'https://evil.example/a.webp' }, 'X')).toEqual(fb);
    expect(normalizeIcon({ type: 'image', value: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'X')).toEqual(fb);
    expect(normalizeIcon({ type: 'image', value: 'data:image/png;base64,AAAA' }, 'X')).toEqual(fb);
    expect(normalizeIcon({ type: 'image', value: 'data:image/webp;base64,"><script>' }, 'X')).toEqual(fb);
    expect(normalizeIcon({ type: 'image', value: webp(MAX_IMAGE_BYTES) }, 'X').type).toBe('image');
    expect(normalizeIcon({ type: 'image', value: webp(MAX_IMAGE_BYTES + 100) }, 'X')).toEqual(fb);
  });

  it('อีโมจิ: จำกัดความยาว และห้ามมีเครื่องหมาย HTML', () => {
    expect(normalizeIcon({ type: 'emoji', value: '<b>' }, 'X').type).toBe('letter');
    expect(normalizeIcon({ type: 'emoji', value: 'x'.repeat(20) }, 'X').type).toBe('letter');
  });
});

describe('dataUrlBytes', () => {
  it('นับขนาดไบต์จริงของข้อมูล base64', () => {
    expect(dataUrlBytes(webp(0))).toBe(0);
    expect(dataUrlBytes(webp(1))).toBe(1);
    expect(dataUrlBytes(webp(2))).toBe(2);
    expect(dataUrlBytes(webp(3))).toBe(3);
    expect(dataUrlBytes(webp(15000))).toBe(15000);
  });
});

describe('encodeWithin: ลดคุณภาพจนไม่เกินขีดจำกัด', () => {
  it('ใช้คุณภาพสูงสุดที่ยังไม่เกิน', async () => {
    const tried = [];
    const out = await encodeWithin(async (q) => { tried.push(q); return webp(q > 0.65 ? 20000 : 9000); }, MAX_IMAGE_BYTES);
    expect(dataUrlBytes(out)).toBe(9000);
    expect(tried[0]).toBeGreaterThan(tried.at(-1));
    expect(tried.at(-1)).toBeLessThanOrEqual(0.65);
  });
  it('เล็กพอตั้งแต่ครั้งแรก → ไม่ลองซ้ำ', async () => {
    let n = 0;
    await encodeWithin(async () => { n += 1; return webp(500); }, MAX_IMAGE_BYTES);
    expect(n).toBe(1);
  });
  it('ลดจนสุดแล้วก็ยังใหญ่ → null', async () => {
    expect(await encodeWithin(async () => webp(50000), MAX_IMAGE_BYTES)).toBeNull();
  });
});

describe('การแสดงผล', () => {
  const cat = { color: '#6D4BC9', glyph: '#fff' };

  it('ตัวอักษร: อยู่บนสีของหมวด', () => {
    const html = iconBadgeHTML({ type: 'letter', value: 'N' }, cat, 'sm');
    expect(html).toContain('--c:#6D4BC9');
    expect(html).toContain('>N<');
    expect(html).toContain('cb sm');
  });
  it('lucide → svg, อีโมจิ → ตัวอีโมจิ, รูป → img', () => {
    expect(iconBadgeHTML({ type: 'lucide', value: 'film' }, cat)).toContain('<svg');
    expect(iconBadgeHTML({ type: 'emoji', value: '🎬' }, cat)).toContain('🎬');
    const img = iconBadgeHTML({ type: 'image', value: webp(100) }, cat);
    expect(img).toContain('<img');
    expect(img).toContain('data:image/webp;base64,');
  });
  it('ตัวอักษรที่เป็นเครื่องหมาย HTML ถูก escape', () => {
    expect(iconBadgeHTML({ type: 'letter', value: '<' }, cat)).toContain('&lt;');
  });
  it('itemBadge: ไม่มี icon → ตัวอักษรแรกของชื่อบนสีของหมวดตาม categoryId', () => {
    const html = itemBadge({ name: 'Claude Pro', categoryId: 'ai', category: 'AI' });
    expect(html).toContain('>C<');
    expect(html).toContain('#6D4BC9');
  });
  it('itemBadge: ตามชื่อรายการเมื่อเปลี่ยนชื่อ (ค่าเริ่มต้นไม่ถูกเก็บตายตัว)', () => {
    expect(itemBadge({ name: 'Spotify', categoryId: 'entertainment' })).toContain('>S<');
  });
  it('itemBadge: ข้อมูลเดิมไม่มี categoryId ใช้ชื่อหมวด ; ไม่รู้จักเลย → สีหมวด "อื่น ๆ"', () => {
    expect(itemBadge({ name: 'x', category: 'Cloud' })).toContain('#2B7CB3');
    expect(itemBadge({ name: 'x' })).toContain('#8A8F98');
  });
  it('มีรายการเลือกให้ครบ: lucide และอีโมจิ', () => {
    expect(LUCIDE_KEYS.length).toBeGreaterThanOrEqual(12);
    expect(EMOJI_CHOICES.length).toBeGreaterThanOrEqual(16);
  });
});
