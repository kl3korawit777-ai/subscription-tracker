import { describe, it, expect } from 'vitest';
import { guessCategory, applyGuess, chooseCategory, initialSource, suggestCategories } from '../js/categoryGuess.js';

describe('guessCategory: เดาหมวดจากชื่อ', () => {
  const cases = [
    ['Netflix', 'entertainment'], ['NETFLIX', 'entertainment'], ['  netflix  ', 'entertainment'], ['Spotify Premium', 'entertainment'],
    ['YouTube Premium', 'entertainment'], ['Disney+ Hotstar', 'entertainment'], ['Apple Music', 'entertainment'], ['Viu', 'entertainment'],
    ['TrueVisions', 'entertainment'], ['True ID', 'entertainment'], ['AIS Play', 'entertainment'],
    ['ChatGPT Plus', 'ai'], ['Claude Pro', 'ai'], ['GitHub Copilot', 'ai'], ['Midjourney', 'ai'], ['Gemini Advanced', 'ai'],
    ['iCloud+ 50GB', 'cloud'], ['Google One', 'cloud'], ['Dropbox Plus', 'cloud'], ['AWS', 'cloud'], ['ค่าคลาวด์', 'cloud'],
    ['Duolingo Super', 'study'], ['Udemy', 'study'], ['Coursera Plus', 'study'], ['คอร์สภาษาอังกฤษ', 'study'], ['ค่าเรียนพิเศษ', 'study'],
    ['AIS Fibre', 'telecom'], ['True Online', 'telecom'], ['3BB', 'telecom'], ['dtac', 'telecom'], ['NT Fiber', 'telecom'],
    ['ค่าเน็ตบ้าน', 'telecom'], ['ค่าโทรศัพท์', 'telecom'], ['อินเทอร์เน็ตบ้าน', 'telecom'], ['ซิมรายเดือน', 'telecom'], ['Home WiFi', 'telecom'],
  ];
  it.each(cases)('"%s" → %s', (name, id) => {
    expect(guessCategory(name)).toBe(id);
  });

  it('ไม่รู้จัก/ว่าง → null', () => {
    for (const n of ['', '   ', 'xyz', 'ค่าอะไรสักอย่าง', undefined, null]) expect(guessCategory(n)).toBeNull();
  });

  it('คำสั้นต้องเป็นคำเต็ม ไม่ใช่เศษของคำอื่น (กันเดาผิด)', () => {
    expect(guessCategory('Maisai')).toBeNull(); // มี "ais" อยู่ข้างใน
    expect(guessCategory('Rent')).toBeNull(); // ลงท้าย "nt"
    expect(guessCategory('Apartment')).toBeNull();
    expect(guessCategory('Trueblood')).toBeNull();
  });

  it('คำเฉพาะชนะคำกว้าง: AIS Play = บันเทิง, AIS Fibre = อินเทอร์เน็ต, TrueVisions = บันเทิง', () => {
    expect(guessCategory('AIS Play')).toBe('entertainment');
    expect(guessCategory('AIS Fibre')).toBe('telecom');
    expect(guessCategory('TrueVisions')).toBe('entertainment');
  });

  it('ระหว่างพิมพ์ทีละตัว ยังไม่เดามั่วจนกว่าจะเป็นคำที่รู้จัก', () => {
    const typed = ['N', 'Ne', 'Net', 'Netf', 'Netfl', 'Netfli'].map(guessCategory);
    expect(typed).toEqual([null, null, null, null, null, null]);
    expect(guessCategory('Netflix')).toBe('entertainment');
  });
});

describe('applyGuess / chooseCategory: หยุดเดาเมื่อผู้ใช้เลือกเอง', () => {
  const fresh = { categoryId: 'other', source: 'default' };

  it('ยังไม่ได้เลือกเอง + เดาได้ → เปลี่ยนตามที่เดา และบอกว่ามาจากการเดา', () => {
    expect(applyGuess(fresh, 'Netflix')).toEqual({ categoryId: 'entertainment', source: 'guess' });
  });

  it('เดาไว้แล้วแก้ชื่อต่อ → เดาใหม่ตามชื่อล่าสุด', () => {
    let s = applyGuess(fresh, 'Netflix');
    s = applyGuess(s, 'ChatGPT');
    expect(s).toEqual({ categoryId: 'ai', source: 'guess' });
  });

  it('เดาไว้แล้วชื่อกลายเป็นคำที่ไม่รู้จัก → กลับเป็น "อื่น ๆ" (ไม่ค้างหมวดที่เดาผิด)', () => {
    let s = applyGuess(fresh, 'Netflix');
    s = applyGuess(s, 'Netfl');
    expect(s).toEqual({ categoryId: 'other', source: 'default' });
  });

  it('ไม่รู้จักชื่อและยังไม่เคยเดา → ไม่เปลี่ยนอะไร', () => {
    expect(applyGuess(fresh, 'xyz')).toBe(fresh);
  });

  it('ผู้ใช้เลือกเองแล้ว → หยุดเดาตลอด แม้ชื่อตรงกับอีกหมวดหรือแก้ชื่อภายหลัง', () => {
    let s = chooseCategory(fresh, 'cloud');
    expect(s).toEqual({ categoryId: 'cloud', source: 'user' });
    expect(applyGuess(s, 'Netflix')).toBe(s);
    expect(applyGuess(s, 'ChatGPT')).toBe(s);
    expect(applyGuess(s, '')).toBe(s);
  });

  it('ผู้ใช้เลือกทับหมวดที่ระบบเดาไว้ → กลายเป็นเลือกเอง และหยุดเดา', () => {
    let s = applyGuess(fresh, 'Netflix');
    s = chooseCategory(s, 'study');
    expect(applyGuess(s, 'Spotify')).toEqual({ categoryId: 'study', source: 'user' });
  });

  it('เลือก "อื่น ๆ" เองก็นับว่าเลือกเอง (ไม่โดนเดาทับ)', () => {
    const s = chooseCategory(applyGuess(fresh, 'Netflix'), 'other');
    expect(applyGuess(s, 'Spotify')).toBe(s);
  });
});

describe('initialSource: ตอนเปิดฟอร์ม', () => {
  it('รายการใหม่ → default (เดาได้)', () => {
    expect(initialSource({})).toBe('default');
  });
  it('แก้รายการที่ผู้ใช้เลือกไว้เอง → user (ไม่เดาทับ)', () => {
    expect(initialSource({ id: 'a', categoryId: 'ai', categorySource: 'user' })).toBe('user');
  });
  it('แก้รายการที่ระบบเดาไว้ → guess (เดาใหม่ได้ถ้าเปลี่ยนชื่อ)', () => {
    expect(initialSource({ id: 'a', categoryId: 'ai', categorySource: 'guess' })).toBe('guess');
  });
  it('ข้อมูลเดิมไม่มี source: มีหมวดเฉพาะแล้ว = ผู้ใช้เลือกมาเอง → user ; ยัง "อื่น ๆ" → default', () => {
    expect(initialSource({ id: 'a', categoryId: 'entertainment' })).toBe('user');
    expect(initialSource({ id: 'a', categoryId: 'other' })).toBe('default');
    expect(initialSource({ id: 'a' })).toBe('default');
  });
});

describe('suggestCategories: การ์ด "แนะนำหมวดใหม่" สำหรับข้อมูลเดิม', () => {
  const sub = (id, name, categoryId = 'other', o = {}) => ({ id, name, categoryId, ...o });

  it('แนะนำเฉพาะรายการที่ยัง "อื่น ๆ" และเดาได้หมวดอื่น', () => {
    const items = [sub('1', 'AIS Fibre'), sub('2', 'Netflix', 'entertainment'), sub('3', 'xyz'), sub('4', 'ChatGPT Plus')];
    const out = suggestCategories(items);
    expect(out.map((s) => [s.item.id, s.categoryId])).toEqual([['1', 'telecom'], ['4', 'ai']]); // เรียงตามชื่อ: AIS Fibre ก่อน ChatGPT Plus
  });

  it('ไม่แนะนำรายการที่ผู้ใช้ยืนยัน/เลือกเองแล้ว (categorySource = user)', () => {
    expect(suggestCategories([sub('1', 'AIS Fibre', 'other', { categorySource: 'user' })])).toEqual([]);
  });

  it('ข้ามรายการที่กด "ถามทีหลัง" ในรอบนี้', () => {
    const items = [sub('1', 'AIS Fibre'), sub('2', 'Claude Pro')];
    expect(suggestCategories(items, new Set(['1'])).map((s) => s.item.id)).toEqual(['2']);
  });

  it('เรียงตามชื่อให้ลำดับคงที่ และไม่แก้รายการเดิม', () => {
    const items = [sub('b', 'True Online'), sub('a', 'AIS Fibre')];
    const copy = JSON.parse(JSON.stringify(items));
    expect(suggestCategories(items).map((s) => s.item.name)).toEqual(['AIS Fibre', 'True Online']);
    expect(items).toEqual(copy);
  });

  it('ไม่มีอะไรให้แนะนำ → ลิสต์ว่าง', () => {
    expect(suggestCategories([])).toEqual([]);
    expect(suggestCategories([sub('1', 'xyz')])).toEqual([]);
  });
});
