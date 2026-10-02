import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// สร้างฐานข้อมูลตามสคีมาเก่า (v1/v2) ด้วย API ดิบ แล้วให้ storage.js เปิดด้วยเวอร์ชันใหม่ เพื่อทดสอบ onupgradeneeded จริง
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

async function seedOld(factory, version, { subs = [], payments = [], meta = {} } = {}) {
  const open = factory.open('subscription-tracker', version);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('subscriptions', { keyPath: 'id' });
    db.createObjectStore('meta');
    if (version >= 2) db.createObjectStore('payments', { keyPath: 'id' });
  };
  const db = await req(open);
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names, 'readwrite');
  subs.forEach((s) => tx.objectStore('subscriptions').put(s));
  payments.forEach((p) => tx.objectStore('payments').put(p));
  Object.entries(meta).forEach(([k, v]) => tx.objectStore('meta').put(v, k));
  await done(tx);
  db.close();
}

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const SUBS = [
  { id: 's1', name: 'Spotify', category: 'บันเทิง', price: 129, currency: 'THB', cycle: 'monthly', startDate: '2025-03-15', status: 'active' },
  { id: 's2', name: 'ChatGPT Plus', category: 'AI', price: 20, currency: 'USD', cycle: 'monthly', startDate: '2025-09-01', status: 'active' },
];
const PAYMENTS = [
  { id: 's1|2026-10-15', subId: 's1', date: '2026-10-15', name: 'Spotify', category: 'บันเทิง', amount: 129, currency: 'THB', amountThb: 129, paidAt: noon(2026, 10, 15) },
  { id: 's2|2026-10-01', subId: 's2', date: '2026-10-01', name: 'ChatGPT Plus', category: 'AI', amount: 20, currency: 'USD', amountThb: 700, paidAt: noon(2026, 10, 1) },
  { id: 's2|2026-09-01', subId: 's2', date: '2026-09-01', name: 'ChatGPT Plus', category: 'AI', amount: 20, currency: 'USD', paidAt: noon(2026, 9, 1) }, // ข้อมูลเก่าไม่มี amountThb
];

let factory;
let storage;
let ledger;
async function load() {
  vi.resetModules();
  globalThis.indexedDB = factory;
  storage = await import('../js/storage.js');
  ledger = await import('../js/ledger.js');
}

beforeEach(() => { factory = new IDBFactory(); });

describe('ย้ายข้อมูล v2 → v3', () => {
  beforeEach(async () => {
    await seedOld(factory, 2, { subs: SUBS, payments: PAYMENTS, meta: { seeded: true, rates: { USD: 35 } } });
    await load();
  });

  it('สร้าง store transactions และ activityLog', async () => {
    const db = await storage.openDB();
    expect([...db.objectStoreNames].sort()).toEqual(['activityLog', 'meta', 'payments', 'subscriptions', 'transactions']);
    expect(db.version).toBe(storage.DB_VERSION);
    expect(storage.DB_VERSION).toBe(3);
  });

  it('ข้อมูลเก่าอยู่ครบ ไม่ถูกลบหรือแก้ไข', async () => {
    expect(await storage.getAllSubscriptions()).toEqual(expect.arrayContaining(SUBS));
    expect((await storage.getAllSubscriptions())).toHaveLength(2);
    const payments = await storage.getAllPayments();
    expect(payments).toHaveLength(3);
    expect(payments).toEqual(expect.arrayContaining(PAYMENTS));
    expect(await storage.getMeta('seeded')).toBe(true);
    expect(await storage.getMeta('rates')).toEqual({ USD: 35 });
  });

  it('แปลงประวัติจ่ายแล้วทุกรายการเป็นรายจ่ายหมวดค่าบริการ (สตางค์ integer)', async () => {
    const txs = await storage.getAllTransactions();
    expect(txs).toHaveLength(3);
    for (const t of txs) {
      expect(t.type).toBe('expense');
      expect(t.category).toBe('ค่าบริการ');
      expect(t.currency).toBe('THB');
      expect(Number.isInteger(t.amount)).toBe(true);
      expect(t.source).toBe('payment');
    }
    const byId = Object.fromEntries(txs.map((t) => [t.paymentId, t]));
    expect(byId['s1|2026-10-15'].amount).toBe(12900);
    expect(byId['s1|2026-10-15'].date).toBe('2026-10-15');
    expect(byId['s2|2026-10-01'].amount).toBe(70000);
    expect(byId['s2|2026-10-01'].original).toEqual({ amount: 2000, currency: 'USD' });
    expect(byId['s2|2026-09-01'].needsReview).toBe(true);
  });

  it('ยอดคงเหลือจากรายการที่ย้ายมา = −(ยอดจ่ายรวม)', async () => {
    expect(ledger.balance(await storage.getAllTransactions())).toBe(-(12900 + 70000));
  });

  it('บันทึกการย้ายไว้ใน activityLog', async () => {
    const log = await storage.getActivityLog();
    const m = log.filter((e) => e.action === 'migrate');
    expect(m).toHaveLength(1);
    expect(m[0].detail).toMatchObject({ from: 2, to: 3, payments: 3, transactions: 3, needsReview: 1 });
    expect(typeof m[0].at).toBe('string');
  });

  it('เปิดซ้ำที่เวอร์ชันเดิม ไม่ย้ายซ้ำและไม่เกิดรายการซ้ำ', async () => {
    await load(); // โหลดโมดูลใหม่ เปิด DB เดิม (v3 อยู่แล้ว)
    expect(await storage.getAllTransactions()).toHaveLength(3);
    expect((await storage.getActivityLog()).filter((e) => e.action === 'migrate')).toHaveLength(1);
  });
});

describe('ย้ายข้อมูลจาก v1 (ยังไม่มี payments)', () => {
  it('อัปเกรดได้ ข้อมูลรายการสมัครไม่หาย', async () => {
    await seedOld(factory, 1, { subs: SUBS, meta: { seeded: true } });
    await load();
    expect(await storage.getAllSubscriptions()).toHaveLength(2);
    expect(await storage.getAllPayments()).toEqual([]);
    expect(await storage.getAllTransactions()).toEqual([]);
    expect(await storage.getMeta('seeded')).toBe(true);
  });
});

describe('ติดตั้งใหม่ (ไม่มีฐานข้อมูลเดิม)', () => {
  it('สร้างครบทุก store ว่างเปล่า และไม่มีบันทึกการย้าย', async () => {
    await load();
    expect(await storage.getAllTransactions()).toEqual([]);
    expect(await storage.getActivityLog()).toEqual([]);
  });
});

describe('หลังย้ายแล้ว การใช้งานปกติต้องเขียนทั้งสามที่พร้อมกัน', () => {
  beforeEach(async () => { await load(); });

  it('recordPayment → payments + transactions + log', async () => {
    await storage.recordPayment(PAYMENTS[0]);
    expect(await storage.getAllPayments()).toHaveLength(1);
    const txs = await storage.getAllTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(12900);
    expect((await storage.getActivityLog()).map((e) => e.action)).toEqual(['payment.mark']);
  });

  it('recordPayment ซ้ำ id เดิม → ไม่เกิดรายการซ้ำ', async () => {
    await storage.recordPayment(PAYMENTS[0]);
    await storage.recordPayment(PAYMENTS[0]);
    expect(await storage.getAllTransactions()).toHaveLength(1);
  });

  it('undoPayment ลบทั้ง payment และ transaction แล้วลงบันทึก', async () => {
    await storage.recordPayment(PAYMENTS[0]);
    await storage.undoPayment(PAYMENTS[0].id);
    expect(await storage.getAllPayments()).toEqual([]);
    expect(await storage.getAllTransactions()).toEqual([]);
    expect((await storage.getActivityLog()).map((e) => e.action)).toEqual(['payment.mark', 'payment.unmark']);
  });

  it('saveSubscription / deleteSubscription ลง activityLog (create → update → delete)', async () => {
    await storage.saveSubscription(SUBS[0]);
    await storage.saveSubscription({ ...SUBS[0], price: 149 });
    await storage.deleteSubscription('s1');
    expect((await storage.getActivityLog()).map((e) => e.action)).toEqual(['subscription.create', 'subscription.update', 'subscription.delete']);
    expect(await storage.getAllSubscriptions()).toEqual([]);
  });
});

describe('รายการบัญชีที่บันทึกเอง (saveTransaction / deleteTransaction)', () => {
  beforeEach(async () => { await load(); });
  const tx = (o = {}) => ({ id: 'tx:1', type: 'expense', category: 'อาหาร', amount: 5950, currency: 'THB', date: '2026-10-02', name: 'ข้าวมันไก่', note: '', source: 'manual', createdAt: '2026-10-02T05:00:00.000Z', ...o });

  it('บันทึก → แก้ไข → ลบ และลง activityLog ทุกครั้ง', async () => {
    await storage.saveTransaction(tx());
    await storage.saveTransaction(tx({ amount: 6000 }));
    expect(await storage.getAllTransactions()).toEqual([tx({ amount: 6000 })]);
    await storage.deleteTransaction('tx:1');
    expect(await storage.getAllTransactions()).toEqual([]);
    expect((await storage.getActivityLog()).map((e) => e.action)).toEqual(['transaction.create', 'transaction.update', 'transaction.delete']);
  });

  it('ปฏิเสธยอดที่ไม่ใช่จำนวนเต็มสตางค์ และไม่เขียนอะไรลงฐาน', async () => {
    await expect(storage.saveTransaction(tx({ amount: 59.5 }))).rejects.toThrow(/integer/);
    await expect(storage.saveTransaction(tx({ type: 'transfer' }))).rejects.toThrow(/type/);
    expect(await storage.getAllTransactions()).toEqual([]);
    expect(await storage.getActivityLog()).toEqual([]);
  });

  it('ยอดคงเหลือรวมรายรับที่บันทึกเอง + รายจ่ายที่ย้ายมาจากประวัติจ่ายแล้ว', async () => {
    await storage.recordPayment(PAYMENTS[0]);
    await storage.saveTransaction(tx({ id: 'tx:in', type: 'income', category: 'เงินเดือน', amount: 3000000 }));
    expect(ledger.balance(await storage.getAllTransactions())).toBe(3000000 - 12900);
  });
});
