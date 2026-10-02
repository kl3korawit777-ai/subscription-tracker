import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

let storage;
beforeEach(async () => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  storage = await import('../js/storage.js');
});

const sub = (i) => ({ id: `s${i}`, name: `S${i}`, category: 'AI', currency: 'THB', cycle: 'monthly', startDate: '2025-01-01', status: 'active', price: 10 });
const payment = { id: 's0|2026-10-01', subId: 's0', date: '2026-10-01', name: 'S0', category: 'AI', amount: 10, currency: 'THB', amountThb: 10, paidAt: new Date(2026, 9, 1, 12).toISOString() };

async function seedLocal() {
  await storage.saveSubscription(sub(0));
  await storage.saveSubscription(sub(1));
  await storage.recordPayment(payment);
  await storage.saveTransaction({ id: 'tx:1', type: 'income', category: 'เงินเดือน', amount: 100000, currency: 'THB', date: '2026-10-01' });
  await storage.setMeta('rates', { USD: 36 });
  await storage.setMeta('seeded', true);
  await storage.setMeta('login-skipped', true);
}

describe('ข้อมูลในเครื่อง (IndexedDB) สำหรับขั้นตอนย้าย', () => {
  it('getLocalCounts นับแต่ละคอลเลกชัน (activityLog รวมที่ระบบบันทึกเอง)', async () => {
    await seedLocal();
    const c = await storage.getLocalCounts();
    expect(c).toMatchObject({ subscriptions: 2, payments: 1, transactions: 2 });
    expect(c.activityLog).toBeGreaterThanOrEqual(4);
  });

  it('readAllLocal คืนทุกอย่างรวม meta เป็นออบเจ็กต์', async () => {
    await seedLocal();
    const all = await storage.readAllLocal();
    expect(all.subscriptions).toHaveLength(2);
    expect(all.payments).toHaveLength(1);
    expect(all.transactions.map((t) => t.id).sort()).toEqual(['pay:s0|2026-10-01', 'tx:1']);
    expect(all.meta).toMatchObject({ rates: { USD: 36 }, seeded: true, 'login-skipped': true });
    expect(all.activityLog.every((l) => typeof l.id === 'number')).toBe(true);
  });

  it('clearLocalData ลบข้อมูลผู้ใช้ + rates แต่เก็บตัวบ่งชี้ (seeded / login-skipped) ไว้ ไม่ให้ข้อมูลตัวอย่างโผล่กลับมา', async () => {
    await seedLocal();
    await storage.clearLocalData();
    expect(await storage.getLocalCounts()).toEqual({ subscriptions: 0, payments: 0, transactions: 0, activityLog: 0 });
    expect(await storage.getMeta('rates')).toBeUndefined();
    expect(await storage.getMeta('seeded')).toBe(true);
    expect(await storage.getMeta('login-skipped')).toBe(true);
  });
});

describe('storage.js เป็นตัวกลางเลือกแหล่งเก็บข้อมูล', () => {
  it('เริ่มต้นใช้ IndexedDB', () => {
    expect(storage.backendName()).toBe('idb');
  });

  it('สลับเป็น backend อื่น: ฟังก์ชันข้อมูลทั้งหมดไปที่ backend นั้น หน้าจอไม่ต้องรู้', async () => {
    const calls = [];
    const fake = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return name === 'getAllSubscriptions' ? ['from-fake'] : undefined; } });
    storage.setBackend('fake', fake);
    expect(storage.backendName()).toBe('fake');
    expect(await storage.getAllSubscriptions()).toEqual(['from-fake']);
    await storage.saveSubscription(sub(9));
    await storage.recordPayment(payment);
    await storage.undoPayment('x');
    await storage.saveTransaction({ id: 't' });
    await storage.deleteTransaction('t');
    await storage.deleteSubscription('s9');
    await storage.getAllPayments(); await storage.getAllTransactions(); await storage.getActivityLog();
    expect(calls.map((c) => c[0])).toEqual(['getAllSubscriptions', 'saveSubscription', 'recordPayment', 'undoPayment', 'saveTransaction', 'deleteTransaction', 'deleteSubscription', 'getAllPayments', 'getAllTransactions', 'getActivityLog']);
  });

  it('meta ที่เป็นของเครื่อง (login-skipped, local:*) อยู่ใน IndexedDB เสมอ ส่วนที่เหลือตาม backend', async () => {
    const store = new Map();
    storage.setBackend('fake', { getMeta: async (k) => store.get(k), setMeta: async (k, v) => { store.set(k, v); } });
    await storage.setMeta('rates', { USD: 1 });
    await storage.setMeta('login-skipped', true);
    await storage.setMeta('local:declined:u1', true);
    expect([...store.keys()]).toEqual(['rates']);
    storage.useLocal();
    expect(await storage.getMeta('login-skipped')).toBe(true);
    expect(await storage.getMeta('local:declined:u1')).toBe(true);
    expect(await storage.getMeta('rates')).toBeUndefined(); // ของ backend เดิมไม่ปนเข้ามา
  });

  it('useLocal กลับมาใช้ IndexedDB', () => {
    storage.setBackend('fake', {});
    storage.useLocal();
    expect(storage.backendName()).toBe('idb');
  });
});
