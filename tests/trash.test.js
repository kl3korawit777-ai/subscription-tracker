import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { balance } from '../js/ledger.js';
import { periodTotals } from '../js/analytics.js';

let storage;
beforeEach(async () => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  storage = await import('../js/storage.js');
});

const sub = (id = 's1', o = {}) => ({ id, name: `Svc ${id}`, category: 'AI', currency: 'THB', cycle: 'monthly', startDate: '2025-01-01', status: 'active', price: 100, ...o });
const tx = (id = 'tx:1', o = {}) => ({ id, type: 'expense', category: 'อาหาร', amount: 5000, currency: 'THB', date: '2026-10-02', name: 'ข้าว', note: '', source: 'manual', createdAt: '2026-10-02T05:00:00.000Z', ...o });
const payment = { id: 's1|2026-10-15', subId: 's1', date: '2026-10-15', name: 'Svc s1', category: 'AI', amount: 100, currency: 'THB', amountThb: 100, paidAt: new Date(2026, 9, 15, 12).toISOString() };
const actions = async () => (await storage.getActivityLog()).map((l) => l.action);

describe('ถังขยะ: รายการสมัคร', () => {
  it('ลบ = ย้ายเข้าถังขยะ (soft delete): หายจากรายการปกติ ไปอยู่ใน getDeleted พร้อม deletedAt และข้อมูลเดิมครบ', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.saveSubscription(sub('s2'));
    await storage.deleteSubscription('s1');
    expect((await storage.getAllSubscriptions()).map((s) => s.id)).toEqual(['s2']);
    const { subscriptions } = await storage.getDeleted();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ id: 's1', name: 'Svc s1', price: 100 });
    expect(typeof subscriptions[0].deletedAt).toBe('string');
    expect(new Date(subscriptions[0].deletedAt).toString()).not.toBe('Invalid Date');
  });

  it('includeDeleted: true เห็นทุกรายการ (ใช้ตอนสำรองข้อมูล)', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.deleteSubscription('s1');
    expect(await storage.getAllSubscriptions()).toEqual([]);
    expect(await storage.getAllSubscriptions({ includeDeleted: true })).toHaveLength(1);
  });

  it('กู้คืน: กลับมาในรายการปกติ deletedAt = null และลงบันทึก', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.deleteSubscription('s1');
    await storage.restoreSubscription('s1');
    const [s] = await storage.getAllSubscriptions();
    expect(s).toMatchObject({ id: 's1', deletedAt: null, price: 100 });
    expect((await storage.getDeleted()).subscriptions).toEqual([]);
    expect(await actions()).toEqual(['subscription.create', 'subscription.delete', 'subscription.restore']);
  });

  it('ลบถาวร: หายจริง (แม้ includeDeleted) แต่ activityLog ยังอยู่ครบ', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.deleteSubscription('s1');
    await storage.purgeSubscription('s1');
    expect(await storage.getAllSubscriptions({ includeDeleted: true })).toEqual([]);
    expect(await actions()).toEqual(['subscription.create', 'subscription.delete', 'subscription.purge']);
  });

  it('ลบถาวรรายการที่ยังไม่ได้อยู่ในถังขยะ → ไม่ทำอะไร (กันลบพลาด)', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.purgeSubscription('s1');
    expect(await storage.getAllSubscriptions()).toHaveLength(1);
    expect(await actions()).toEqual(['subscription.create']);
  });

  it('ลบรายการสมัครแล้ว ประวัติจ่ายแล้วและรายการบัญชีที่เกิดจากมันยังอยู่', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.recordPayment(payment);
    await storage.deleteSubscription('s1');
    expect(await storage.getAllPayments()).toHaveLength(1);
    expect(await storage.getAllTransactions()).toHaveLength(1);
  });
});

describe('ถังขยะ: รายการบัญชี', () => {
  it('ลบ → ถังขยะ → กู้คืน และยอดคงเหลือ/สรุปไม่นับรายการที่อยู่ในถังขยะ', async () => {
    await storage.saveTransaction(tx('tx:1', { amount: 5000 }));
    await storage.saveTransaction(tx('tx:2', { amount: 7000 }));
    await storage.deleteTransaction('tx:1');
    const live = await storage.getAllTransactions();
    expect(live.map((t) => t.id)).toEqual(['tx:2']);
    expect(balance(live)).toBe(-7000);
    // แม้ส่งรายการที่ถูกลบเข้าฟังก์ชันคำนวณโดยตรงก็ไม่นับ
    const everything = await storage.getAllTransactions({ includeDeleted: true });
    expect(everything).toHaveLength(2);
    expect(balance(everything)).toBe(-7000);
    expect(periodTotals(everything).expense).toBe(7000);
    await storage.restoreTransaction('tx:1');
    expect(balance(await storage.getAllTransactions())).toBe(-12000);
    expect(await actions()).toEqual(['transaction.create', 'transaction.create', 'transaction.delete', 'transaction.restore']);
  });

  it('ลบถาวรรายการบัญชี', async () => {
    await storage.saveTransaction(tx('tx:1'));
    await storage.deleteTransaction('tx:1');
    await storage.purgeTransaction('tx:1');
    expect(await storage.getAllTransactions({ includeDeleted: true })).toEqual([]);
  });
});

describe('ถังขยะ: ล้างทั้งหมด / สำรอง / ย้ายข้อมูล', () => {
  it('emptyTrash ลบถาวรเฉพาะของในถังขยะ ของปกติอยู่ครบ และเก็บบันทึกกิจกรรมไว้', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.saveSubscription(sub('s2'));
    await storage.saveTransaction(tx('tx:1'));
    await storage.saveTransaction(tx('tx:2'));
    await storage.deleteSubscription('s1');
    await storage.deleteTransaction('tx:1');
    await storage.emptyTrash();
    expect((await storage.getAllSubscriptions({ includeDeleted: true })).map((s) => s.id)).toEqual(['s2']);
    expect((await storage.getAllTransactions({ includeDeleted: true })).map((t) => t.id)).toEqual(['tx:2']);
    expect(await storage.getDeleted()).toEqual({ subscriptions: [], transactions: [] });
    const log = await storage.getActivityLog();
    expect(log.at(-1)).toMatchObject({ action: 'trash.empty', detail: { subscriptions: 1, transactions: 1 } });
  });

  it('getDeleted เรียงล่าสุดก่อน', async () => {
    await storage.saveSubscription(sub('a'));
    await storage.saveSubscription(sub('b'));
    await storage.deleteSubscription('a');
    await new Promise((r) => setTimeout(r, 5));
    await storage.deleteSubscription('b');
    expect((await storage.getDeleted()).subscriptions.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('readAllLocal (ใช้สำรอง/ย้ายขึ้นคลาวด์) รวมรายการในถังขยะด้วย ไม่ทำให้ถังขยะหายตอนย้าย', async () => {
    await storage.saveSubscription(sub('s1'));
    await storage.deleteSubscription('s1');
    const all = await storage.readAllLocal();
    expect(all.subscriptions).toHaveLength(1);
    expect(all.subscriptions[0].deletedAt).toBeTruthy();
  });
});

describe('addToTrash (กันแถวซ้ำเมื่อกดลบรัว ๆ)', () => {
  it('ใส่รายการใหม่ไว้หน้าสุดพร้อม deletedAt', async () => {
    const { addToTrash } = await import('../js/trash.js');
    const out = addToTrash([{ id: 'a', deletedAt: '2026-10-01T00:00:00.000Z' }], { id: 'b', name: 'B' }, '2026-10-02T00:00:00.000Z');
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
    expect(out[0]).toMatchObject({ name: 'B', deletedAt: '2026-10-02T00:00:00.000Z' });
  });

  it('มี id นี้ในถังขยะอยู่แล้ว → ไม่เพิ่มซ้ำและไม่เขียนทับเวลาลบเดิม', async () => {
    const { addToTrash } = await import('../js/trash.js');
    const list = [{ id: 'a', deletedAt: '2026-10-01T00:00:00.000Z' }];
    const out = addToTrash(list, { id: 'a' }, '2026-10-02T00:00:00.000Z');
    expect(out).toBe(list);
    expect(out).toHaveLength(1);
    expect(out[0].deletedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('ถังขยะ: คืนค่าบอกว่าทำสำเร็จหรือไม่ (IndexedDB)', () => {
  it('ลบ/กู้คืน/ลบถาวรที่ทำได้ → true ; ทำซ้ำหรือไม่มีรายการ → false', async () => {
    await storage.saveSubscription(sub('s1'));
    expect(await storage.purgeSubscription('s1')).toBe(false); // ยังไม่อยู่ในถังขยะ
    expect(await storage.restoreSubscription('s1')).toBe(false); // ไม่ได้อยู่ในถังขยะ
    expect(await storage.deleteSubscription('s1')).toBe(true);
    expect(await storage.deleteSubscription('s1')).toBe(false); // ลบซ้ำ
    expect(await storage.deleteSubscription('nope')).toBe(false); // ไม่มีรายการ
    expect(await storage.restoreSubscription('s1')).toBe(true);
    await storage.deleteSubscription('s1');
    expect(await storage.purgeSubscription('s1')).toBe(true);
  });

  it('รายการบัญชีเหมือนกัน', async () => {
    await storage.saveTransaction(tx('tx:1'));
    expect(await storage.deleteTransaction('tx:1')).toBe(true);
    expect(await storage.deleteTransaction('tx:1')).toBe(false);
    expect(await storage.restoreTransaction('tx:1')).toBe(true);
    expect(await storage.purgeTransaction('tx:1')).toBe(false);
  });
});
