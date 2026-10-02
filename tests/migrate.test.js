import { describe, it, expect } from 'vitest';
import { toCloudDocs, buildBackup, backupFilename, chunk, runMigration, MigrationError, isLocalMetaKey, countLocal } from '../js/migrate.js';

const sub = (i) => ({ id: `s${i}`, name: `Svc${i}`, category: 'บันเทิง', currency: 'THB', cycle: 'monthly', startDate: '2025-01-01', status: 'active', price: 100 + i });
const pay = (i) => ({ id: `s${i}|2026-10-01`, subId: `s${i}`, date: '2026-10-01', amount: 100, currency: 'THB', amountThb: 100, paidAt: '2026-10-01T05:00:00.000Z' });
const tx = (i) => ({ id: `tx:${i}`, type: 'expense', category: 'อาหาร', amount: 1000 + i, currency: 'THB', date: '2026-10-01' });
const log = (n) => ({ id: n, at: `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z`, action: 'subscription.create', entity: 'subscription', entityId: `s${n}`, detail: {} });
const makeLocal = (n = 3) => ({
  subscriptions: Array.from({ length: n }, (_, i) => sub(i)),
  payments: Array.from({ length: n }, (_, i) => pay(i)),
  transactions: Array.from({ length: n }, (_, i) => tx(i)),
  activityLog: Array.from({ length: n }, (_, i) => log(i + 1)),
  meta: { rates: { USD: 36 }, seeded: true, 'categories-v2': true, 'login-skipped': true, 'local:declined:u1': true },
});

// คลาวด์จำลองในหน่วยความจำ (เก็บ id ต่อคอลเลกชัน) + บันทึกลำดับการเรียก
function fakeCloud({ existing = {}, dropId = null, failCommitAt = null, calls = [] } = {}) {
  const data = {};
  const col = (c) => (data[c] ??= new Map(Object.entries(existing[c] ?? {}).map(([k, v]) => [k, v])));
  let commits = 0;
  return {
    data, calls, commitSizes: [],
    async listIds(c) { calls.push(`listIds:${c}`); return [...col(c).keys()]; },
    async commit(ops) {
      commits += 1;
      calls.push('commit');
      this.commitSizes.push(ops.length);
      if (failCommitAt === commits) throw new Error('permission-denied');
      for (const op of ops) if (op.id !== dropId) col(op.col).set(op.id, op.data);
    },
    async count(c) { calls.push(`count:${c}`); return col(c).size; },
  };
}

const run = (over = {}) => {
  const calls = over.calls ?? [];
  const cloud = over.cloud ?? fakeCloud({ calls });
  const opts = {
    local: makeLocal(), cloud, uid: 'u1', dbVersion: 3, now: new Date(2026, 9, 2, 10, 30, 5),
    backup: async (json, name) => { calls.push('backup'); opts.backedUp = { json, name }; },
    deleteLocal: async () => { calls.push('deleteLocal'); },
    isOnline: () => true, onProgress: () => {}, ...over,
  };
  return { opts, cloud, calls, promise: runMigration(opts) };
};

describe('toCloudDocs', () => {
  it('แปลงเป็นเอกสาร: id เดิม, activityLog id ตัวเลข → "legacy-<n>", meta → {value}', () => {
    const d = toCloudDocs(makeLocal(2));
    expect(d.subscriptions.map((x) => x.id)).toEqual(['s0', 's1']);
    expect(d.payments[0].id).toBe('s0|2026-10-01');
    expect(d.transactions[1].id).toBe('tx:1');
    expect(d.activityLog.map((x) => x.id)).toEqual(['legacy-1', 'legacy-2']);
    expect(d.activityLog[0].data.id).toBe('legacy-1');
    expect(d.activityLog[0].data.at).toBe('2026-10-01T00:00:01.000Z');
  });
  it('meta: อัปโหลดเฉพาะของบัญชี ไม่อัปโหลดตัวบ่งชี้เฉพาะเครื่อง', () => {
    const d = toCloudDocs(makeLocal(1));
    expect(d.meta.map((x) => x.id).sort()).toEqual(['categories-v2', 'rates', 'seeded']);
    expect(d.meta.find((x) => x.id === 'rates').data).toEqual({ value: { USD: 36 } });
    expect(isLocalMetaKey('login-skipped')).toBe(true);
    expect(isLocalMetaKey('local:declined:u1')).toBe(true);
    expect(isLocalMetaKey('rates')).toBe(false);
  });
  it('ไม่แก้ข้อมูลต้นฉบับ', () => {
    const local = makeLocal(1);
    const copy = JSON.stringify(local);
    toCloudDocs(local);
    expect(JSON.stringify(local)).toBe(copy);
  });
});

describe('ไฟล์สำรอง', () => {
  it('buildBackup มีข้อมูลครบ พร้อมจำนวน/เวอร์ชัน/เวลา', () => {
    const b = buildBackup({ local: makeLocal(2), exportedAt: '2026-10-02T03:00:00.000Z', dbVersion: 3, uid: 'u1' });
    expect(b).toMatchObject({ app: 'subscription-tracker', format: 1, exportedAt: '2026-10-02T03:00:00.000Z', dbVersion: 3, uid: 'u1' });
    expect(b.counts).toEqual({ subscriptions: 2, payments: 2, transactions: 2, activityLog: 2 });
    expect(b.data.subscriptions).toHaveLength(2);
    expect(b.data.meta.rates).toEqual({ USD: 36 });
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });
  it('ชื่อไฟล์เรียงตามเวลา', () => {
    expect(backupFilename(new Date(2026, 9, 2, 10, 30, 5))).toBe('subscription-tracker-backup-20261002-103005.json');
  });
  it('countLocal นับเฉพาะข้อมูลของผู้ใช้ (ไม่รวม meta)', () => {
    expect(countLocal(makeLocal(3))).toEqual({ subscriptions: 3, payments: 3, transactions: 3, activityLog: 3 });
  });
});

describe('chunk', () => {
  it('แบ่งเป็นก้อนไม่เกิน n', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('runMigration', () => {
  it('สำเร็จ: สำรองก่อน → อัปโหลด → นับตรวจ → ลบของเดิมเป็นขั้นสุดท้าย', async () => {
    const { opts, cloud, calls, promise } = run();
    const res = await promise;
    expect(calls[0]).toBe('backup');
    expect(calls.indexOf('backup')).toBeLessThan(calls.indexOf('commit'));
    expect(calls.indexOf('commit')).toBeLessThan(calls.findIndex((c) => c.startsWith('count:')));
    expect(calls.at(-1)).toBe('deleteLocal');
    expect(cloud.data.subscriptions.size).toBe(3);
    expect(cloud.data.activityLog.has('legacy-3')).toBe(true);
    expect(cloud.data.meta.get('rates')).toEqual({ value: { USD: 36 } });
    expect(opts.backedUp.name).toBe('subscription-tracker-backup-20261002-103005.json');
    expect(opts.backedUp.json.counts.subscriptions).toBe(3);
    expect(res.expected).toMatchObject({ subscriptions: 3, payments: 3, transactions: 3, activityLog: 3, meta: 3 });
  });

  it('รายงานความคืบหน้าตามลำดับ', async () => {
    const steps = [];
    await run({ onProgress: (s, st) => steps.push(`${s}:${st}`) }).promise;
    expect(steps).toEqual(['backup:start', 'backup:done', 'upload:start', 'upload:done', 'verify:start', 'verify:done', 'cleanup:start', 'cleanup:done']);
  });

  it('ข้อมูลมาก: แบ่งเขียนเป็นก้อนไม่เกิน 400 รายการ และนับครบ', async () => {
    const { cloud, promise } = run({ local: makeLocal(1000) });
    await promise;
    expect(Math.max(...cloud.commitSizes)).toBeLessThanOrEqual(400);
    expect(cloud.data.transactions.size).toBe(1000);
    expect(cloud.commitSizes.reduce((a, b) => a + b, 0)).toBe(4000 + 3);
  });

  it('นับไม่ครบ → throw verify และไม่ลบของเดิม', async () => {
    const calls = [];
    const { promise } = run({ calls, cloud: fakeCloud({ calls, dropId: 's1' }) });
    await expect(promise).rejects.toMatchObject({ name: 'MigrationError', stage: 'verify' });
    expect(calls).not.toContain('deleteLocal');
    expect(calls).toContain('backup');
  });

  it('เขียนขึ้นคลาวด์ไม่สำเร็จ (เช่น กฎปฏิเสธ) → throw upload และไม่ลบของเดิม', async () => {
    const calls = [];
    const { promise } = run({ calls, cloud: fakeCloud({ calls, failCommitAt: 1 }) });
    await expect(promise).rejects.toMatchObject({ stage: 'upload' });
    expect(calls).not.toContain('deleteLocal');
    expect(calls).toContain('backup');
  });

  it('สำรองไฟล์ไม่ได้ → หยุดทันที ไม่แตะคลาวด์และไม่ลบอะไร', async () => {
    const calls = [];
    const { promise } = run({ calls, backup: async () => { throw new Error('blocked'); } });
    await expect(promise).rejects.toMatchObject({ stage: 'backup' });
    expect(calls).toEqual([]);
  });

  it('ออฟไลน์ → หยุดก่อนทำอะไรทั้งสิ้น', async () => {
    const calls = [];
    const { promise } = run({ calls, isOnline: () => false });
    await expect(promise).rejects.toMatchObject({ stage: 'offline' });
    expect(calls).toEqual([]);
  });

  it('ย้ายซ้ำ/ย้ายต่อจากครั้งที่ค้าง: เอกสารที่มีอยู่แล้วทับด้วยของเดิม ไม่เกิดซ้ำ และยอดนับ = รวมแบบไม่ซ้ำ', async () => {
    const calls = [];
    const existing = { subscriptions: { s0: { stale: true } }, transactions: { 'tx:other-device': { id: 'tx:other-device' } } };
    const { cloud, promise } = run({ calls, cloud: fakeCloud({ calls, existing }) });
    const res = await promise;
    expect(cloud.data.subscriptions.size).toBe(3);
    expect(cloud.data.subscriptions.get('s0').name).toBe('Svc0');
    expect(cloud.data.transactions.size).toBe(4); // 3 ของเครื่องนี้ + 1 ที่มีอยู่แล้วจากอีกเครื่อง (ต้องไม่ถูกลบ)
    expect(res.expected.transactions).toBe(4);
    expect(calls.at(-1)).toBe('deleteLocal');
  });

  it('ลบของเดิมไม่สำเร็จ → throw cleanup (ข้อมูลอยู่บนคลาวด์ครบแล้ว)', async () => {
    const { promise } = run({ deleteLocal: async () => { throw new Error('idb locked'); } });
    await expect(promise).rejects.toBeInstanceOf(MigrationError);
    await expect(run({ deleteLocal: async () => { throw new Error('x'); } }).promise).rejects.toMatchObject({ stage: 'cleanup' });
  });
});
