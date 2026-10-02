// รายการหมวดของบริการสมัคร: อ้างอิงด้วย id (เก็บใน subscription.categoryId) ไม่ผูกกับชื่อที่แสดง
// รายการเก็บใน settings (meta 'categories') ; ถ้ายังไม่เคยเก็บหรือมีหมวดใหม่ในโค้ด จะเติมค่าตั้งต้นให้ (mergeCategories)

export const DEFAULT_CATEGORY_ID = 'other';
export const TELECOM_ID = 'telecom';

// สี + ไอคอน (ไม่ใช้สีอย่างเดียวในการบอกหมวด) glyph = สีของไอคอนบนวงกลมสี
export const DEFAULT_CATEGORIES = [
  { id: 'entertainment', name: 'บันเทิง', color: '#D99A1E', glyph: '#2B1D00', icon: '<path d="M9 7l8 5-8 5z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>' },
  { id: 'study', name: 'การเรียน', color: '#2F855A', glyph: '#fff', icon: '<path d="M4 6.5C6.5 5.5 9.5 5.5 12 7c2.5-1.5 5.5-1.5 8-.5V18c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 7v11.5"/>' },
  { id: 'ai', name: 'AI', color: '#6D4BC9', glyph: '#fff', icon: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>' },
  { id: 'cloud', name: 'Cloud', color: '#2B7CB3', glyph: '#fff', icon: '<path d="M7.5 18.5h9a4 4 0 0 0 .6-7.96 5.5 5.5 0 0 0-10.5 1.2A3.5 3.5 0 0 0 7.5 18.5z"/>' },
  { id: TELECOM_ID, name: 'อินเทอร์เน็ต/โทรศัพท์', color: '#B5427A', glyph: '#fff', icon: '<path d="M5 10a10 10 0 0 1 14 0"/><path d="M8 13.2a6 6 0 0 1 8 0"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>' },
  { id: DEFAULT_CATEGORY_ID, name: 'อื่น ๆ', color: '#8A8F98', glyph: '#fff', icon: '<circle cx="6.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="17.5" cy="12" r="1.6" fill="currentColor"/>' },
];

// ชื่อหมวดรุ่นเก่า (ก่อนมี categoryId) → id
const LEGACY_ALIASES = { 'ดนตรี': 'entertainment', 'ทำงาน/เครื่องมือ': 'ai', 'คลาวด์': 'cloud', 'สุขภาพ': DEFAULT_CATEGORY_ID, 'การศึกษา': 'study' };

const byId = (id) => DEFAULT_CATEGORIES.find((c) => c.id === id);
const OTHER = byId(DEFAULT_CATEGORY_ID);
const validEntry = (c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id && typeof c.name === 'string' && c.name;

// รวมรายการที่เก็บไว้ใน settings กับค่าตั้งต้น: คงลำดับที่เก็บไว้ ทิ้งรายการผิดรูป/id ซ้ำ เติมหมวดตั้งต้นที่ยังไม่มี และให้ "อื่น ๆ" อยู่ท้ายเสมอ
export function mergeCategories(saved) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const d = byId(c.id) ?? OTHER;
    out.push({ id: c.id, name: c.name, color: c.color ?? d.color, glyph: c.glyph ?? d.glyph, icon: c.icon ?? d.icon });
  };
  if (Array.isArray(saved)) saved.filter(validEntry).forEach(add);
  DEFAULT_CATEGORIES.forEach(add);
  return [...out.filter((c) => c.id !== DEFAULT_CATEGORY_ID), ...out.filter((c) => c.id === DEFAULT_CATEGORY_ID)];
}

export function categoryName(list, id) {
  return (list.find((c) => c.id === id) ?? list.find((c) => c.id === DEFAULT_CATEGORY_ID) ?? OTHER).name;
}

// หา id ของรายการ: categoryId ที่ยังอยู่ในรายการ → ชื่อหมวดที่ตรงกัน → ชื่อรุ่นเก่า → "อื่น ๆ"
export function resolveCategoryId(item, list) {
  if (item.categoryId && list.some((c) => c.id === item.categoryId)) return item.categoryId;
  const byName = list.find((c) => c.name === item.category);
  if (byName) return byName.id;
  const legacy = LEGACY_ALIASES[item.category];
  if (legacy && list.some((c) => c.id === legacy)) return legacy;
  return DEFAULT_CATEGORY_ID;
}

// เติม categoryId และ category (ชื่อ ณ ปัจจุบัน ใช้แสดงผล) ให้รายการ — ไม่แก้ออบเจ็กต์ต้นทาง
export function normalizeItem(item, list) {
  const categoryId = resolveCategoryId(item, list);
  return { ...item, categoryId, category: categoryName(list, categoryId) };
}
