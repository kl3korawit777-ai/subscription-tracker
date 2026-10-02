// เดาหมวดจากชื่อบริการ (pure) + กติกา "หยุดเดาเมื่อผู้ใช้เลือกเอง"
import { DEFAULT_CATEGORY_ID } from './categories.js';

// ลำดับสำคัญ: หมวดที่อยู่ก่อนชนะ (คำเฉพาะต้องมาก่อนคำกว้าง เช่น "AIS Play" = บันเทิง ก่อนที่ "ais" จะเป็นอินเทอร์เน็ต)
// ตัวอักษรละติน: ต้องเป็นคำเต็ม (คำที่ยาว ≥5 ตัวใช้เป็นคำนำหน้าได้) เพื่อไม่ให้ "Maisai" ชน "ais" หรือ "Rent" ชน "nt"
// ภาษาไทย: ไม่มีช่องว่างคั่นคำ จึงเทียบแบบมีอยู่ในข้อความ
const RULES = [
  ['ai', ['chatgpt', 'chat gpt', 'gpt', 'openai', 'claude', 'anthropic', 'gemini', 'copilot', 'midjourney', 'perplexity', 'cursor', 'notion ai', 'grok', 'ai', 'เอไอ']],
  ['entertainment', ['netflix', 'spotify', 'youtube', 'disney', 'hbo', 'prime video', 'viu', 'wetv', 'iqiyi', 'joox', 'apple music', 'apple tv', 'twitch', 'steam', 'playstation', 'xbox', 'nintendo',
    'truevisions', 'true visions', 'trueid', 'true id', 'ais play', 'line tv', 'tidal', 'deezer', 'crunchyroll', 'เน็ตฟลิกซ์', 'สปอติฟาย', 'ยูทูบ', 'ซีรีส์', 'ดูหนัง', 'ฟังเพลง', 'เกม']],
  ['telecom', ['ais', 'true', 'truemove', 'dtac', 'nt', '3bb', 'tot', 'internet', 'wifi', 'wi fi', 'fiber', 'fibre', 'sim', 'broadband',
    'อินเทอร์เน็ต', 'อินเตอร์เน็ต', 'เน็ต', 'ไวไฟ', 'ไฟเบอร์', 'ซิม', 'โทรศัพท์', 'มือถือ', 'เบอร์โทร']],
  ['study', ['duolingo', 'coursera', 'udemy', 'skillshare', 'masterclass', 'linkedin learning', 'babbel', 'elsa', 'chegg', 'edx', 'brilliant', 'คอร์ส', 'เรียน', 'ติว', 'โรงเรียน', 'มหาวิทยาลัย', 'ค่าเทอม']],
  ['cloud', ['icloud', 'google one', 'google drive', 'dropbox', 'onedrive', 'one drive', 'aws', 'azure', 'digitalocean', 'vercel', 'netlify', 'github', 'cloudflare', 'mega', 'pcloud', 'cloud', 'hosting', 'คลาวด์', 'โฮสติ้ง']],
];

const THAI = /[฀-๿]/;

function matches(lower, padded, kw) {
  if (THAI.test(kw)) return lower.includes(kw);
  if (padded.includes(` ${kw} `)) return true;
  return kw.length >= 5 && !kw.includes(' ') && padded.includes(` ${kw}`);
}

// คืน id หมวดที่เดา หรือ null ถ้าไม่รู้จักชื่อ
export function guessCategory(name) {
  if (typeof name !== 'string') return null;
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const padded = ` ${lower.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const [id, words] of RULES) if (words.some((kw) => matches(lower, padded, kw))) return id;
  return null;
}

// ---- สถานะหมวดในฟอร์ม: { categoryId, source } ; source = 'default' | 'guess' | 'user' ----
// ผู้ใช้เลือกเองแล้ว (user) → ไม่เดาทับอีกเลย ; เดาไว้แล้วชื่อเปลี่ยนจนไม่รู้จัก → กลับเป็นค่าเริ่มต้น ไม่ค้างหมวดที่เดาผิด
export function applyGuess(state, name) {
  if (state.source === 'user') return state;
  const g = guessCategory(name);
  if (g) return { categoryId: g, source: 'guess' };
  return state.source === 'guess' ? { categoryId: DEFAULT_CATEGORY_ID, source: 'default' } : state;
}

export const chooseCategory = (state, categoryId) => ({ categoryId, source: 'user' });

// สถานะเริ่มต้นตอนเปิดฟอร์ม: แก้รายการเดิมที่มีหมวดเฉพาะแล้ว ถือว่าผู้ใช้เลือกมาเอง (ห้ามเดาทับเมื่อแก้ชื่อ)
export function initialSource(item) {
  if (!item?.id) return 'default';
  if (item.categorySource === 'user' || item.categorySource === 'guess' || item.categorySource === 'default') return item.categorySource;
  return item.categoryId && item.categoryId !== DEFAULT_CATEGORY_ID ? 'user' : 'default';
}

// การ์ด "แนะนำหมวดใหม่": รายการเดิมที่ยัง "อื่น ๆ" ซึ่งผู้ใช้ยังไม่เคยยืนยัน และชื่อเดาได้หมวดอื่น
// skipped = id ที่กด "ถามทีหลัง" ในรอบนี้
export function suggestCategories(items, skipped = new Set()) {
  return items
    .filter((i) => (i.categoryId ?? DEFAULT_CATEGORY_ID) === DEFAULT_CATEGORY_ID && i.categorySource !== 'user' && !skipped.has(i.id))
    .map((item) => ({ item, categoryId: guessCategory(item.name) }))
    .filter((s) => s.categoryId && s.categoryId !== DEFAULT_CATEGORY_ID)
    .sort((a, b) => a.item.name.localeCompare(b.item.name, 'th'));
}
