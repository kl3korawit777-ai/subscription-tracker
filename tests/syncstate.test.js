import { describe, it, expect } from 'vitest';
import { computeSyncState, SYNC_LABELS } from '../js/syncstate.js';

const base = { signedIn: true, online: true, pending: false, fromCache: false };

describe('computeSyncState (สถานะมุมจอ)', () => {
  it('ยังไม่ล็อกอิน → null (ไม่แสดงป้าย เพราะไม่มีอะไรให้ซิงก์)', () => {
    expect(computeSyncState({ ...base, signedIn: false })).toBeNull();
    expect(computeSyncState({ ...base, signedIn: false, online: false })).toBeNull();
  });
  it('ออฟไลน์ → offline ไม่ว่าจะมีข้อมูลค้างส่งหรือไม่', () => {
    expect(computeSyncState({ ...base, online: false })).toBe('offline');
    expect(computeSyncState({ ...base, online: false, pending: true })).toBe('offline');
    expect(computeSyncState({ ...base, online: false, fromCache: true })).toBe('offline');
  });
  it('ออนไลน์และมีข้อมูลที่ยังเขียนไม่ถึงเซิร์ฟเวอร์ → syncing', () => {
    expect(computeSyncState({ ...base, pending: true })).toBe('syncing');
  });
  it('ออนไลน์แต่ยังได้ข้อมูลจากแคชอย่างเดียว (ยังไม่เคยคุยกับเซิร์ฟเวอร์) → syncing', () => {
    expect(computeSyncState({ ...base, fromCache: true })).toBe('syncing');
  });
  it('ออนไลน์ ไม่มีค้างส่ง ข้อมูลมาจากเซิร์ฟเวอร์ → synced', () => {
    expect(computeSyncState(base)).toBe('synced');
  });
  it('ออนไลน์แต่ซิงก์ล้มเหลว (เช่น กฎปฏิเสธ) → error ไม่แสดงว่ากำลังซิงก์ค้างไปเรื่อย ๆ', () => {
    expect(computeSyncState({ ...base, fromCache: true, error: new Error('permission-denied') })).toBe('error');
    expect(computeSyncState({ ...base, error: new Error('x') })).toBe('error');
  });
  it('ออฟไลน์ชนะ error (ข้อผิดพลาดตอนไม่มีเน็ตไม่ใช่ความผิดของกฎ)', () => {
    expect(computeSyncState({ ...base, online: false, error: new Error('unavailable') })).toBe('offline');
  });
  it('ข้อความป้ายตรงกับที่กำหนด', () => {
    expect(SYNC_LABELS).toEqual({ offline: 'ออฟไลน์', syncing: 'กำลังซิงก์', synced: 'ซิงก์แล้ว', error: 'ซิงก์ไม่สำเร็จ' });
  });
});
