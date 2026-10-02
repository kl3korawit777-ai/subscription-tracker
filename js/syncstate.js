export const SYNC_LABELS = { offline: 'ออฟไลน์', syncing: 'กำลังซิงก์', synced: 'ซิงก์แล้ว', error: 'ซิงก์ไม่สำเร็จ' };

// สถานะป้ายมุมจอ: null = ไม่แสดง (ยังไม่ล็อกอิน จึงไม่มีอะไรให้ซิงก์)
// error = ซิงก์ล้มเหลวทั้งที่ออนไลน์ (เช่น กฎปฏิเสธ), pending = มีการเขียนที่ยังไม่ถึงเซิร์ฟเวอร์, fromCache = ข้อมูลล่าสุดมาจากแคชในเครื่องอย่างเดียว
export function computeSyncState({ signedIn, online, pending, fromCache, error = null }) {
  if (!signedIn) return null;
  if (!online) return 'offline';
  if (error) return 'error';
  if (pending || fromCache) return 'syncing';
  return 'synced';
}
