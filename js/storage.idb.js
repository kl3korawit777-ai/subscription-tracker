// IndexedDB wrapper
// v1: subscriptions, meta
// v2: + payments (ประวัติจ่ายแล้ว)
// v3: + transactions (บัญชีรายรับ/รายจ่าย เงินเป็นสตางค์ integer), + activityLog; ย้าย payments → transactions (ไม่ลบข้อมูลเดิม)
import { paymentToTransaction } from './ledger.js';

const DB_NAME = 'subscription-tracker';
export const DB_VERSION = 3;

// ย้ายประวัติจ่ายแล้วเป็นรายจ่ายหมวดค่าบริการ ภายใน upgrade transaction เดียวกัน (ล้มเหลว = rollback ทั้งหมด)
function migratePaymentsToTransactions(tx, oldVersion) {
  const payments = tx.objectStore('payments');
  const transactions = tx.objectStore('transactions');
  const log = tx.objectStore('activityLog');
  payments.getAll().onsuccess = (e) => {
    const rows = e.target.result;
    const converted = rows.map(paymentToTransaction);
    converted.forEach((t) => transactions.put(t));
    log.add({
      at: new Date().toISOString(), action: 'migrate', entity: 'db', entityId: `v${oldVersion}->v${DB_VERSION}`,
      detail: { from: oldVersion, to: DB_VERSION, payments: rows.length, transactions: converted.length, needsReview: converted.filter((t) => t.needsReview).length },
    });
  };
}

export function upgradeDB(db, tx, oldVersion) {
  const ensure = (name, opts, indexes = []) => {
    if (db.objectStoreNames.contains(name)) return;
    const store = db.createObjectStore(name, opts);
    indexes.forEach((k) => store.createIndex(k, k));
  };
  ensure('subscriptions', { keyPath: 'id' });
  ensure('meta');
  ensure('payments', { keyPath: 'id' });
  ensure('transactions', { keyPath: 'id' }, ['date', 'subId']);
  ensure('activityLog', { keyPath: 'id', autoIncrement: true }, ['at']);
  if (oldVersion >= 1 && oldVersion < 3) migratePaymentsToTransactions(tx, oldVersion);
}

let dbPromise;
export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgradeDB(req.result, req.transaction, e.oldVersion);
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// transaction หลาย store: fn ใช้ callback ของ request เท่านั้น (ห้าม await อย่างอื่นระหว่างทาง ไม่งั้น transaction จบก่อน)
async function withTx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]));
    const out = {};
    fn(stores, out);
    tx.oncomplete = () => resolve(out.value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const read = (store, fn) => withTx([store], 'readonly', (s, out) => { const r = fn(s[store]); r.onsuccess = () => { out.value = r.result; }; });
const entry = (action, entity, entityId, detail = {}) => ({ at: new Date().toISOString(), action, entity, entityId, detail });

// รายการที่อยู่ในถังขยะ (deletedAt) ไม่ถูกคืนในการอ่านปกติ ; includeDeleted: true ใช้ตอนสำรอง/ย้ายข้อมูล
const visible = (o) => (rows) => (o?.includeDeleted ? rows : rows.filter((r) => !r.deletedAt));
export const getAllSubscriptions = (o) => read('subscriptions', (s) => s.getAll()).then(visible(o));
export const getAllPayments = () => read('payments', (s) => s.getAll());
export const getAllTransactions = (o) => read('transactions', (s) => s.getAll()).then(visible(o));
export const getActivityLog = () => read('activityLog', (s) => s.getAll());
export const getMeta = (key) => read('meta', (s) => s.get(key));
export const setMeta = (key, value) => withTx(['meta'], 'readwrite', (s) => s.meta.put(value, key));

export const saveSubscription = (sub) => withTx(['subscriptions', 'activityLog'], 'readwrite', (s) => {
  const prev = s.subscriptions.get(sub.id);
  prev.onsuccess = () => {
    s.subscriptions.put(sub);
    s.activityLog.add(entry(prev.result ? 'subscription.update' : 'subscription.create', 'subscription', sub.id, { name: sub.name }));
  };
});


// กด "จ่ายแล้ว": เขียน payments + transactions + activityLog พร้อมกัน (ทั้งหมดสำเร็จหรือไม่เลย)
export const recordPayment = (payment) => withTx(['payments', 'transactions', 'activityLog'], 'readwrite', (s) => {
  const t = paymentToTransaction(payment);
  s.payments.put(payment);
  s.transactions.put(t);
  s.activityLog.add(entry('payment.mark', 'payment', payment.id, { name: payment.name, amount: t.amount, currency: t.currency }));
});

export const undoPayment = (id) => withTx(['payments', 'transactions', 'activityLog'], 'readwrite', (s) => {
  s.payments.delete(id);
  s.transactions.delete(`pay:${id}`);
  s.activityLog.add(entry('payment.unmark', 'payment', id));
});

// รายการบัญชีที่บันทึกเอง: ตรวจก่อนเขียน (ยอดต้องเป็นจำนวนเต็มสตางค์, ชนิด income/expense)
function assertTransaction(t) {
  if (!Number.isInteger(t.amount)) throw new TypeError(`transaction ${t.id}: amount must be an integer (satang), got ${t.amount}`);
  if (t.type !== 'income' && t.type !== 'expense') throw new TypeError(`transaction ${t.id}: unknown type ${t.type}`);
}

export async function saveTransaction(t) {
  assertTransaction(t);
  return withTx(['transactions', 'activityLog'], 'readwrite', (s) => {
    const prev = s.transactions.get(t.id);
    prev.onsuccess = () => {
      s.transactions.put(t);
      s.activityLog.add(entry(prev.result ? 'transaction.update' : 'transaction.create', 'transaction', t.id, { type: t.type, category: t.category, amount: t.amount }));
    };
  });
}

// ---- ถังขยะ: ลบ = ใส่ deletedAt (ย้ายเข้าถังขยะ) / กู้คืน = deletedAt null / ลบถาวร = ลบจริง (เฉพาะที่อยู่ในถังขยะ) ----
// ทุกฟังก์ชันคืน true ถ้าเปลี่ยนจริง, false ถ้าไม่มีอะไรเปลี่ยน (ไม่มีรายการ / อยู่ในสถานะนั้นแล้ว)
const detailSub = (r) => ({ name: r.name });
const detailTx = (r) => ({ type: r.type, category: r.category, amount: r.amount });
const softDelete = (store, entity, detail) => (id) => withTx([store, 'activityLog'], 'readwrite', (s, out) => {
  out.value = false;
  const prev = s[store].get(id);
  prev.onsuccess = () => {
    if (!prev.result || prev.result.deletedAt) return;
    out.value = true;
    s[store].put({ ...prev.result, deletedAt: new Date().toISOString() });
    s.activityLog.add(entry(`${entity}.delete`, entity, id, detail(prev.result)));
  };
});
const restore = (store, entity, detail) => (id) => withTx([store, 'activityLog'], 'readwrite', (s, out) => {
  out.value = false;
  const prev = s[store].get(id);
  prev.onsuccess = () => {
    if (!prev.result?.deletedAt) return;
    out.value = true;
    s[store].put({ ...prev.result, deletedAt: null });
    s.activityLog.add(entry(`${entity}.restore`, entity, id, detail(prev.result)));
  };
});
const purge = (store, entity, detail) => (id) => withTx([store, 'activityLog'], 'readwrite', (s, out) => {
  out.value = false;
  const prev = s[store].get(id);
  prev.onsuccess = () => {
    if (!prev.result?.deletedAt) return; // กันลบถาวรของที่ยังไม่ได้อยู่ในถังขยะ
    out.value = true;
    s[store].delete(id);
    s.activityLog.add(entry(`${entity}.purge`, entity, id, detail(prev.result)));
  };
});

export const deleteSubscription = softDelete('subscriptions', 'subscription', detailSub);
export const deleteTransaction = softDelete('transactions', 'transaction', detailTx);
export const restoreSubscription = restore('subscriptions', 'subscription', detailSub);
export const restoreTransaction = restore('transactions', 'transaction', detailTx);
export const purgeSubscription = purge('subscriptions', 'subscription', detailSub);
export const purgeTransaction = purge('transactions', 'transaction', detailTx);

export async function getDeleted() {
  const [subs, txs] = await Promise.all([getAllSubscriptions({ includeDeleted: true }), getAllTransactions({ includeDeleted: true })]);
  const only = (rows) => rows.filter((r) => r.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { subscriptions: only(subs), transactions: only(txs) };
}

export const emptyTrash = () => withTx(['subscriptions', 'transactions', 'activityLog'], 'readwrite', (s) => {
  const counts = { subscriptions: 0, transactions: 0 };
  let pending = 2;
  const sweep = (name) => {
    s[name].openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        if (c.value.deletedAt) { c.delete(); counts[name] += 1; }
        c.continue();
      } else if (--pending === 0 && (counts.subscriptions || counts.transactions)) {
        s.activityLog.add(entry('trash.empty', 'trash', 'all', counts));
      }
    };
  };
  sweep('subscriptions');
  sweep('transactions');
});

export const newId = () => crypto.randomUUID();

// ---- สำหรับขั้นตอนย้ายข้อมูลขึ้นคลาวด์ ----
const USER_STORES = ['subscriptions', 'payments', 'transactions', 'activityLog'];

export async function getLocalCounts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_STORES, 'readonly');
    const out = {};
    for (const n of USER_STORES) { const r = tx.objectStore(n).count(); r.onsuccess = () => { out[n] = r.result; }; }
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// อ่านทุกอย่างในเครื่อง (รวม meta ทุกคีย์ เป็นออบเจ็กต์) เพื่อสำรอง/อัปโหลด
export async function readAllLocal() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...USER_STORES, 'meta'], 'readonly');
    const out = { meta: {} };
    for (const n of USER_STORES) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result; }; }
    tx.objectStore('meta').openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { out.meta[c.key] = c.value; c.continue(); }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// ลบข้อมูลผู้ใช้ในเครื่อง (หลังตรวจว่าอัปโหลดครบแล้วเท่านั้น) เก็บตัวบ่งชี้ของเครื่อง (seeded, categories-v2, login-skipped, local:*) ไว้
// เพื่อไม่ให้ข้อมูลตัวอย่างโผล่กลับมา; ลบเฉพาะ rates ซึ่งย้ายไปอยู่กับบัญชีแล้ว
export const clearLocalData = () => withTx([...USER_STORES, 'meta'], 'readwrite', (s) => {
  for (const n of USER_STORES) s[n].clear();
  s.meta.delete('rates');
});
