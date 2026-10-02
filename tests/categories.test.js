import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID, TELECOM_ID, mergeCategories, categoryName, resolveCategoryId, normalizeItem,
} from '../js/categories.js';

const byId = (id) => DEFAULT_CATEGORIES.find((c) => c.id === id);

describe('รายการหมวดตั้งต้น', () => {
  it('มีหมวด "อินเทอร์เน็ต/โทรศัพท์" และ "อื่น ๆ" อยู่ท้ายสุด', () => {
    expect(byId(TELECOM_ID).name).toBe('อินเทอร์เน็ต/โทรศัพท์');
    expect(DEFAULT_CATEGORIES.at(-1).id).toBe(DEFAULT_CATEGORY_ID);
    expect(DEFAULT_CATEGORY_ID).toBe('other');
  });

  it('id ไม่ซ้ำ ทุกหมวดมีชื่อ สี และไอคอน', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.name).toBeTruthy();
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.icon).toContain('<');
    }
  });

  it('ชื่อไม่ซ้ำกัน (ใช้เป็นป้ายแสดงผล)', () => {
    const names = DEFAULT_CATEGORIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('mergeCategories: รายการหมวดที่เก็บใน settings', () => {
  it('ไม่มีค่าที่เก็บไว้ → ใช้ค่าตั้งต้น', () => {
    expect(mergeCategories(undefined).map((c) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id));
    expect(mergeCategories(null)).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(mergeCategories('พัง')).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it('ผู้ใช้เก่าที่เก็บรายการไว้ก่อนมีหมวดใหม่ → หมวดใหม่ถูกเติมเข้ามา ไม่ซ้ำ ลำดับเดิมคงอยู่ และ "อื่น ๆ" อยู่ท้ายเสมอ', () => {
    const saved = [{ id: 'ai', name: 'AI' }, { id: 'other', name: 'อื่น ๆ' }, { id: 'entertainment', name: 'บันเทิง' }];
    const out = mergeCategories(saved);
    expect(out.slice(0, 2).map((c) => c.id)).toEqual(['ai', 'entertainment']);
    expect(out.map((c) => c.id)).toContain(TELECOM_ID);
    expect(out.at(-1).id).toBe('other');
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
  });

  it('ทิ้งรายการที่ผิดรูป (ไม่มี id หรือชื่อ) และ id ซ้ำ', () => {
    const out = mergeCategories([{ id: 'ai' }, { name: 'ไม่มี id' }, null, { id: 'ai', name: 'AI' }, { id: 'ai', name: 'AI ซ้ำ' }]);
    expect(out.filter((c) => c.id === 'ai')).toHaveLength(1);
    expect(out.find((c) => c.id === 'ai').name).toBe('AI');
    expect(out.every((c) => c.id && c.name)).toBe(true);
  });
});

describe('categoryName / resolveCategoryId', () => {
  const list = mergeCategories();

  it('categoryName: id → ชื่อ, ไม่รู้จัก → "อื่น ๆ"', () => {
    expect(categoryName(list, 'ai')).toBe('AI');
    expect(categoryName(list, TELECOM_ID)).toBe('อินเทอร์เน็ต/โทรศัพท์');
    expect(categoryName(list, 'nope')).toBe('อื่น ๆ');
    expect(categoryName(list, undefined)).toBe('อื่น ๆ');
  });

  it('มี categoryId ที่อยู่ในรายการ → ใช้เลย (ไม่สนชื่อเดิม)', () => {
    expect(resolveCategoryId({ categoryId: 'cloud', category: 'บันเทิง' }, list)).toBe('cloud');
  });

  it('categoryId ที่ไม่อยู่ในรายการ → ตกไปใช้ชื่อ แล้วค่อย "อื่น ๆ"', () => {
    expect(resolveCategoryId({ categoryId: 'deleted-cat', category: 'AI' }, list)).toBe('ai');
    expect(resolveCategoryId({ categoryId: 'deleted-cat', category: 'อะไรไม่รู้' }, list)).toBe('other');
  });

  it('ข้อมูลเดิมที่มีแต่ชื่อ → แปลงเป็น id (รวมชื่อหมวดรุ่นเก่า)', () => {
    expect(resolveCategoryId({ category: 'บันเทิง' }, list)).toBe('entertainment');
    expect(resolveCategoryId({ category: 'การเรียน' }, list)).toBe('study');
    expect(resolveCategoryId({ category: 'Cloud' }, list)).toBe('cloud');
    expect(resolveCategoryId({ category: 'ดนตรี' }, list)).toBe('entertainment');
    expect(resolveCategoryId({ category: 'ทำงาน/เครื่องมือ' }, list)).toBe('ai');
    expect(resolveCategoryId({ category: 'คลาวด์' }, list)).toBe('cloud');
    expect(resolveCategoryId({ category: 'การศึกษา' }, list)).toBe('study');
    expect(resolveCategoryId({ category: 'สุขภาพ' }, list)).toBe('other');
  });

  it('ไม่มีหมวดเลย → "อื่น ๆ"', () => {
    expect(resolveCategoryId({}, list)).toBe('other');
  });
});

describe('normalizeItem: เติม categoryId และชื่อหมวดปัจจุบันให้รายการ', () => {
  const list = mergeCategories();

  it('ข้อมูลเดิมมีแต่ชื่อ → ได้ categoryId และไม่ทำให้ฟิลด์อื่นหาย', () => {
    const out = normalizeItem({ id: 's1', name: 'Netflix', category: 'บันเทิง', price: 419 }, list);
    expect(out).toMatchObject({ id: 's1', name: 'Netflix', price: 419, categoryId: 'entertainment', category: 'บันเทิง' });
  });

  it('ชื่อหมวดมาจากรายการ ณ ปัจจุบัน (ไม่ใช่ชื่อที่ snapshot ไว้)', () => {
    const renamed = list.map((c) => (c.id === 'ai' ? { ...c, name: 'AI/เครื่องมือ' } : c));
    expect(normalizeItem({ categoryId: 'ai', category: 'AI' }, renamed).category).toBe('AI/เครื่องมือ');
  });

  it('ไม่แก้ออบเจ็กต์ต้นทาง', () => {
    const src = { category: 'ดนตรี' };
    normalizeItem(src, list);
    expect(src).toEqual({ category: 'ดนตรี' });
  });
});
