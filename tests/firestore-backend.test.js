import { describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreBackend } from '../js/storage.firestore.js';
import { createFakeFirestore } from './helpers/fakeFirestore.js';

const sub = (o = {}) => ({ id: 's1', name: 'Spotify', category: 'บันเทิง', currency: 'THB', cycle: 'monthly', startDate: '2025-03-15', status: 'active', price: 129, ...o });
const payment = (o = {}) => ({ id: 's1|2026-10-15', subId: 's1', date: '2026-10-15', name: 'Spotify', category: 'บันเทิง', amount: 129, currency: 'THB', amountThb: 129, paidAt: new Date(2026, 9, 16, 12).toISOString(), ...o });
const tx = (o = {}) => ({ id: 'tx:1', type: 'expense', category: 'อาหาร', amount: 5950, currency: 'THB', date: '2026-10-02', name: 'ข้าว', note: '', source: 'manual', createdAt: '2026-10-02T05:00:00.000Z', ...o });

let fake;
let be;
beforeEach(() => {
  fake = createFakeFirestore();
  be = createFirestoreBackend({ db: fake.db, fs: fake.fs, uid: 'u1' });
});
const actions = async () => (await be.getActivityLog()).map((l) => l.action);

describe('Firestore backend: รายการสมัคร', () => {
  it('บันทึก/อ่าน/ลบ อยู่ใต้ users/<uid>/ เท่านั้น และลง activityLog (create → update → delete)', async () => {
    await be.saveSubscription(sub());
    await be.saveSubscription(sub({ price: 149 }));
    expect(await be.getAllSubscriptions()).toEqual([sub({ price: 149 })]);
    expect([...fake.local.keys()].filter((k) => !k.includes('/activityLog/')).every((k) => k.startsWith('users/u1/'))).toBe(true);
    await be.deleteSubscription('s1');
    expect(await be.getAllSubscriptions()).toEqual([]);
    expect(await actions()).toEqual(['subscription.create', 'subscription.update', 'subscription.delete']);
  });

  it('ผู้ใช้แต่ละคนแยกกัน', async () => {
    await be.saveSubscription(sub());
    const other = createFirestoreBackend({ db: fake.db, fs: fake.fs, uid: 'u2' });
    expect(await other.getAllSubscriptions()).toEqual([]);
  });
});

describe('Firestore backend: ไม่รอเซิร์ฟเวอร์ (ใช้งานออฟไลน์ได้)', () => {
  it('ฟังก์ชันเขียนคืนค่าทันทีแม้เซิร์ฟเวอร์ยังไม่ยืนยัน และข้อมูลเห็นในเครื่องทันที', async () => {
    fake.state.ackMode = 'hold';
    await be.saveSubscription(sub());
    await be.recordPayment(payment());
    expect(await be.getAllSubscriptions()).toHaveLength(1);
    expect(await be.getAllTransactions()).toHaveLength(1);
    expect(fake.server.size).toBe(0);
    fake.flush();
    expect(fake.server.size).toBeGreaterThan(0);
  });

  it('เซิร์ฟเวอร์ปฏิเสธภายหลัง → แจ้งผ่าน onWriteError', async () => {
    const errors = [];
    be.onWriteError((e) => errors.push(e.code));
    fake.state.ackMode = 'reject';
    await be.saveSubscription(sub());
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual(['permission-denied']);
  });
});

describe('Firestore backend: จ่ายแล้ว / บัญชี', () => {
  it('recordPayment เขียน payments + transactions (สตางค์ int) + log; undoPayment ลบทั้งคู่', async () => {
    await be.recordPayment(payment());
    expect(await be.getAllPayments()).toHaveLength(1);
    const [t] = await be.getAllTransactions();
    expect(t).toMatchObject({ id: 'pay:s1|2026-10-15', amount: 12900, category: 'ค่าบริการ', type: 'expense' });
    await be.recordPayment(payment()); // ซ้ำ id เดิม → ไม่เกิดรายการซ้ำ
    expect(await be.getAllTransactions()).toHaveLength(1);
    await be.undoPayment('s1|2026-10-15');
    expect(await be.getAllPayments()).toEqual([]);
    expect(await be.getAllTransactions()).toEqual([]);
    expect((await actions()).filter((a) => a.startsWith('payment.'))).toEqual(['payment.mark', 'payment.mark', 'payment.unmark']);
  });

  it('saveTransaction: บันทึก/แก้/ลบ + log และปฏิเสธยอดที่ไม่ใช่จำนวนเต็ม/ชนิดไม่รู้จัก โดยไม่เขียนอะไร', async () => {
    await be.saveTransaction(tx());
    await be.saveTransaction(tx({ amount: 6000 }));
    expect((await be.getAllTransactions())[0].amount).toBe(6000);
    await be.deleteTransaction('tx:1');
    expect(await be.getAllTransactions()).toEqual([]);
    expect(await actions()).toEqual(['transaction.create', 'transaction.update', 'transaction.delete']);
    const before = fake.local.size;
    await expect(be.saveTransaction(tx({ id: 'tx:2', amount: 59.5 }))).rejects.toThrow(/integer/);
    await expect(be.saveTransaction(tx({ id: 'tx:3', type: 'transfer' }))).rejects.toThrow(/type/);
    expect(fake.local.size).toBe(before);
  });

  it('activityLog: id เป็นข้อความ (UUID) และเรียงตามเวลา', async () => {
    await be.saveSubscription(sub());
    await be.saveSubscription(sub({ id: 's2' }));
    const log = await be.getActivityLog();
    expect(log.every((l) => typeof l.id === 'string' && l.id.length > 8)).toBe(true);
    expect([...log].sort((a, b) => a.at.localeCompare(b.at))).toEqual(log);
  });
});

describe('Firestore backend: meta', () => {
  it('setMeta / getMeta (ไม่มี → undefined)', async () => {
    expect(await be.getMeta('rates')).toBeUndefined();
    await be.setMeta('rates', { USD: 36 });
    expect(await be.getMeta('rates')).toEqual({ USD: 36 });
    expect(fake.local.get('users/u1/meta/rates')).toEqual({ value: { USD: 36 } });
  });
});

describe('Firestore backend: cloud adapter สำหรับย้ายข้อมูล', () => {
  it('listIds / commit / count ทำงานกับฝั่งเซิร์ฟเวอร์ และรอการยืนยัน', async () => {
    const cloud = be.getCloudAdapter();
    expect(await cloud.listIds('subscriptions')).toEqual([]);
    await cloud.commit([{ col: 'subscriptions', id: 'a', data: { id: 'a' } }, { col: 'meta', id: 'rates', data: { value: 1 } }]);
    expect(await cloud.listIds('subscriptions')).toEqual(['a']);
    expect(await cloud.count('subscriptions')).toBe(1);
    expect(await cloud.count('meta')).toBe(1);
    expect(fake.server.has('users/u1/subscriptions/a')).toBe(true);
  });

  it('commit ไม่คืนค่าจนกว่าเซิร์ฟเวอร์จะยืนยัน (ใช้ยืนยันก่อนลบของเดิม)', async () => {
    fake.state.ackMode = 'hold';
    const cloud = be.getCloudAdapter();
    let done = false;
    const p = cloud.commit([{ col: 'subscriptions', id: 'a', data: { id: 'a' } }]).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    fake.flush();
    await p;
    expect(done).toBe(true);
  });

  it('commit ล้มเหลวเมื่อเซิร์ฟเวอร์ปฏิเสธ', async () => {
    fake.state.ackMode = 'reject';
    await expect(be.getCloudAdapter().commit([{ col: 'subscriptions', id: 'a', data: { id: 'a' } }])).rejects.toThrow(/permission/);
  });
});
