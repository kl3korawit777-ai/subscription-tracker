import { describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreBackend } from '../js/storage.firestore.js';
import { createFakeFirestore } from './helpers/fakeFirestore.js';

const sub = (id = 's1', o = {}) => ({ id, name: `Svc ${id}`, category: 'AI', currency: 'THB', cycle: 'monthly', startDate: '2025-01-01', status: 'active', price: 100, ...o });
const tx = (id = 'tx:1', o = {}) => ({ id, type: 'expense', category: 'อาหาร', amount: 5000, currency: 'THB', date: '2026-10-02', name: 'ข้าว', note: '', source: 'manual', createdAt: '2026-10-02T05:00:00.000Z', ...o });

let fake;
let be;
beforeEach(() => {
  fake = createFakeFirestore();
  be = createFirestoreBackend({ db: fake.db, fs: fake.fs, uid: 'u1' });
});
const actions = async () => (await be.getActivityLog()).map((l) => l.action);

describe('Firestore: ถังขยะ', () => {
  it('ลบ = เขียน deletedAt ทับเอกสารเดิม (ไม่ลบเอกสาร) และข้อมูลเดิมครบ', async () => {
    await be.saveSubscription(sub('s1'));
    await be.deleteSubscription('s1');
    expect(await be.getAllSubscriptions()).toEqual([]);
    const doc = fake.local.get('users/u1/subscriptions/s1');
    expect(doc).toMatchObject({ id: 's1', name: 'Svc s1', price: 100 });
    expect(typeof doc.deletedAt).toBe('string');
    expect((await be.getDeleted()).subscriptions.map((s) => s.id)).toEqual(['s1']);
    expect((await be.getAllSubscriptions({ includeDeleted: true }))).toHaveLength(1);
  });

  it('กู้คืนตั้ง deletedAt = null และลงบันทึก; ลบถาวรลบเอกสารจริงแต่เก็บ activityLog', async () => {
    await be.saveSubscription(sub('s1'));
    await be.deleteSubscription('s1');
    await be.restoreSubscription('s1');
    expect(await be.getAllSubscriptions()).toMatchObject([{ id: 's1', deletedAt: null }]);
    await be.deleteSubscription('s1');
    await be.purgeSubscription('s1');
    expect(fake.local.has('users/u1/subscriptions/s1')).toBe(false);
    expect(await actions()).toEqual(['subscription.create', 'subscription.delete', 'subscription.restore', 'subscription.delete', 'subscription.purge']);
  });

  it('ลบถาวรของที่ยังไม่อยู่ในถังขยะ → ไม่ทำอะไร', async () => {
    await be.saveSubscription(sub('s1'));
    await be.purgeSubscription('s1');
    expect(await be.getAllSubscriptions()).toHaveLength(1);
  });

  it('รายการบัญชี: ลบ → กู้คืน → ลบถาวร', async () => {
    await be.saveTransaction(tx('tx:1'));
    await be.deleteTransaction('tx:1');
    expect(await be.getAllTransactions()).toEqual([]);
    expect((await be.getDeleted()).transactions).toHaveLength(1);
    await be.restoreTransaction('tx:1');
    expect(await be.getAllTransactions()).toHaveLength(1);
    await be.deleteTransaction('tx:1');
    await be.purgeTransaction('tx:1');
    expect(await be.getAllTransactions({ includeDeleted: true })).toEqual([]);
  });

  it('emptyTrash ลบถาวรเฉพาะที่อยู่ในถังขยะ', async () => {
    await be.saveSubscription(sub('s1'));
    await be.saveSubscription(sub('s2'));
    await be.saveTransaction(tx('tx:1'));
    await be.deleteSubscription('s1');
    await be.deleteTransaction('tx:1');
    await be.emptyTrash();
    expect((await be.getAllSubscriptions({ includeDeleted: true })).map((s) => s.id)).toEqual(['s2']);
    expect(await be.getAllTransactions({ includeDeleted: true })).toEqual([]);
    expect((await be.getActivityLog()).at(-1)).toMatchObject({ action: 'trash.empty', detail: { subscriptions: 1, transactions: 1 } });
  });

  it('ลบแล้วเขียนได้โดยไม่รอเซิร์ฟเวอร์ (ออฟไลน์)', async () => {
    await be.saveSubscription(sub('s1'));
    fake.state.ackMode = 'hold';
    await be.deleteSubscription('s1');
    expect(await be.getAllSubscriptions()).toEqual([]);
  });
});

describe('Firestore: ถังขยะคืนค่าสำเร็จ/ไม่สำเร็จ', () => {
  it('ลบรายการที่ไม่มีในแคช → false และไม่เขียนอะไร (ไม่ปล่อยให้หน้าจอบอกว่าลบแล้วทั้งที่ยังไม่ได้ลบ)', async () => {
    const writes = fake.local.size;
    expect(await be.deleteSubscription('ghost')).toBe(false);
    expect(await be.restoreTransaction('ghost')).toBe(false);
    expect(await be.purgeSubscription('ghost')).toBe(false);
    expect(fake.local.size).toBe(writes);
  });

  it('ทำได้ → true ; ทำซ้ำ → false', async () => {
    await be.saveSubscription(sub('s1'));
    expect(await be.purgeSubscription('s1')).toBe(false);
    expect(await be.deleteSubscription('s1')).toBe(true);
    expect(await be.deleteSubscription('s1')).toBe(false);
    expect(await be.restoreSubscription('s1')).toBe(true);
    expect(await be.restoreSubscription('s1')).toBe(false);
  });

  it('emptyTrash ใช้ได้เมื่อดึงฟังก์ชันออกมาเรียกลอย ๆ (ไม่พึ่ง this)', async () => {
    await be.saveSubscription(sub('s1'));
    await be.deleteSubscription('s1');
    const { emptyTrash } = be;
    await emptyTrash();
    expect(fake.local.has('users/u1/subscriptions/s1')).toBe(false);
  });
});
