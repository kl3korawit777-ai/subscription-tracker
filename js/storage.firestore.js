// แหล่งเก็บข้อมูลบน Firestore (users/{uid}/...) API เดียวกับ storage.idb.js
// ออฟไลน์ก่อน: ฟังก์ชันเขียนคืนค่าทันทีที่การเขียนเข้า "แคชในเครื่อง" (Firestore ส่งขึ้นเซิร์ฟเวอร์เองเมื่อออนไลน์)
// ถ้าเซิร์ฟเวอร์ปฏิเสธภายหลัง (เช่น กฎ) จะแจ้งผ่าน onWriteError — ไม่ได้ throw จากฟังก์ชันเขียน
import { paymentToTransaction } from './ledger.js';
import { initFirebase } from './firebase.js';

const TX_TYPES = new Set(['income', 'expense']);
function assertTransaction(t) {
  if (!Number.isInteger(t.amount)) throw new TypeError(`transaction ${t.id}: amount must be an integer (satang), got ${t.amount}`);
  if (!TX_TYPES.has(t.type)) throw new TypeError(`transaction ${t.id}: unknown type ${t.type}`);
}

export function createFirestoreBackend({ db, fs, uid }) {
  const col = (name) => fs.collection(db, 'users', uid, name);
  const ref = (name, id) => fs.doc(db, 'users', uid, name, id);
  const newId = () => crypto.randomUUID();

  const errorListeners = new Set();
  const onWriteError = (cb) => { errorListeners.add(cb); return () => errorListeners.delete(cb); };
  // ไม่รอการยืนยันจากเซิร์ฟเวอร์ (ไม่งั้นตอนออฟไลน์ปุ่มบันทึกจะค้าง) แต่ไม่ปล่อยให้ error หายเงียบ
  const track = (promise) => {
    promise.catch((err) => { console.error('Firestore write failed', err); errorListeners.forEach((cb) => cb(err)); });
  };

  const visible = (rows, o) => (o?.includeDeleted ? rows : rows.filter((r) => !r.deletedAt));
  const readAll = async (name) => (await fs.getDocs(col(name))).docs.map((d) => d.data());
  // มีในแคชหรือไม่ (ไม่ยิงเครือข่าย ใช้แยก create/update ในบันทึกกิจกรรม)
  const cached = async (name, id) => {
    try { return (await fs.getDocFromCache(ref(name, id))).data(); } catch { return null; }
  };
  const logEntry = (action, entity, entityId, detail = {}) => {
    const id = newId();
    return [ref('activityLog', id), { id, at: new Date().toISOString(), action, entity, entityId, detail }];
  };
  const detailSub = (r) => ({ name: r.name });
  const detailTx = (r) => ({ type: r.type, category: r.category, amount: r.amount });
  // คืน true ถ้าเขียนจริง, false ถ้าไม่มีอะไรเปลี่ยน (ไม่มีในแคช / อยู่ในสถานะนั้นแล้ว) ให้หน้าจอไม่บอกว่าสำเร็จทั้งที่ไม่ได้เขียน
  const softDelete = async (name, entity, id, detail) => {
    const prev = await cached(name, id);
    if (!prev || prev.deletedAt) return false;
    commit((b) => {
      b.set(ref(name, id), { deletedAt: new Date().toISOString() }, { merge: true });
      b.set(...logEntry(`${entity}.delete`, entity, id, detail(prev)));
    });
    return true;
  };
  const restore = async (name, entity, id, detail) => {
    const prev = await cached(name, id);
    if (!prev?.deletedAt) return false;
    commit((b) => {
      b.set(ref(name, id), { deletedAt: null }, { merge: true });
      b.set(...logEntry(`${entity}.restore`, entity, id, detail(prev)));
    });
    return true;
  };
  const purge = async (name, entity, id, detail) => {
    const prev = await cached(name, id);
    if (!prev?.deletedAt) return false; // กันลบถาวรของที่ยังไม่ได้อยู่ในถังขยะ
    commit((b) => {
      b.delete(ref(name, id));
      b.set(...logEntry(`${entity}.purge`, entity, id, detail(prev)));
    });
    return true;
  };
  const getDeleted = async () => {
    const only = (rows) => rows.filter((r) => r.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return { subscriptions: only(await readAll('subscriptions')), transactions: only(await readAll('transactions')) };
  };
  const commit = (build) => {
    const batch = fs.writeBatch(db);
    build(batch);
    track(batch.commit());
  };

  return {
    onWriteError,

    getAllSubscriptions: async (o) => visible(await readAll('subscriptions'), o),
    getAllPayments: () => readAll('payments'),
    getAllTransactions: async (o) => visible(await readAll('transactions'), o),
    getActivityLog: async () => (await readAll('activityLog')).sort((a, b) => a.at.localeCompare(b.at)),

    async getMeta(key) {
      try {
        const s = await fs.getDoc(ref('meta', key));
        return s.exists() ? s.data().value : undefined;
      } catch { // ออฟไลน์และยังไม่เคยแคชคีย์นี้
        return undefined;
      }
    },
    async setMeta(key, value) { track(fs.setDoc(ref('meta', key), { value })); },

    async saveSubscription(sub) {
      const prev = await cached('subscriptions', sub.id);
      commit((b) => {
        b.set(ref('subscriptions', sub.id), sub);
        b.set(...logEntry(prev ? 'subscription.update' : 'subscription.create', 'subscription', sub.id, { name: sub.name }));
      });
    },


    async recordPayment(payment) {
      const t = paymentToTransaction(payment);
      commit((b) => {
        b.set(ref('payments', payment.id), payment);
        b.set(ref('transactions', t.id), t);
        b.set(...logEntry('payment.mark', 'payment', payment.id, { name: payment.name, amount: t.amount, currency: t.currency }));
      });
    },

    async undoPayment(id) {
      commit((b) => {
        b.delete(ref('payments', id));
        b.delete(ref('transactions', `pay:${id}`));
        b.set(...logEntry('payment.unmark', 'payment', id));
      });
    },

    async saveTransaction(t) {
      assertTransaction(t);
      const prev = await cached('transactions', t.id);
      commit((b) => {
        b.set(ref('transactions', t.id), t);
        b.set(...logEntry(prev ? 'transaction.update' : 'transaction.create', 'transaction', t.id, { type: t.type, category: t.category, amount: t.amount }));
      });
    },

    // ---- ถังขยะ: ลบ = เขียน deletedAt ทับ (merge) / กู้คืน = deletedAt null / ลบถาวร = ลบเอกสารจริง (เฉพาะที่อยู่ในถังขยะ) ----
    deleteSubscription: (id) => softDelete('subscriptions', 'subscription', id, detailSub),
    deleteTransaction: (id) => softDelete('transactions', 'transaction', id, detailTx),
    restoreSubscription: (id) => restore('subscriptions', 'subscription', id, detailSub),
    restoreTransaction: (id) => restore('transactions', 'transaction', id, detailTx),
    purgeSubscription: (id) => purge('subscriptions', 'subscription', id, detailSub),
    purgeTransaction: (id) => purge('transactions', 'transaction', id, detailTx),

    getDeleted,

    async emptyTrash() {
      const { subscriptions, transactions } = await getDeleted();
      const refs = [...subscriptions.map((r) => ref('subscriptions', r.id)), ...transactions.map((r) => ref('transactions', r.id))];
      if (!refs.length) return;
      for (let i = 0; i < refs.length; i += 400) {
        const last = i + 400 >= refs.length;
        commit((b) => {
          refs.slice(i, i + 400).forEach((r) => b.delete(r));
          if (last) b.set(...logEntry('trash.empty', 'trash', 'all', { subscriptions: subscriptions.length, transactions: transactions.length }));
        });
      }
    },

    // สำหรับย้ายข้อมูล: ต่างจากฟังก์ชันด้านบน commit/count "รอการยืนยันจากเซิร์ฟเวอร์จริง" เพื่อใช้ตรวจจำนวนก่อนลบของเดิม
    getCloudAdapter: () => ({
      listIds: async (name) => (await fs.getDocsFromServer(col(name))).docs.map((d) => d.id),
      commit: async (ops) => {
        const batch = fs.writeBatch(db);
        ops.forEach((op) => batch.set(ref(op.col, op.id), op.data));
        await batch.commit();
      },
      count: async (name) => (await fs.getCountFromServer(col(name))).data().count,
    }),
  };
}

export async function initFirestoreBackend(uid) {
  const { db, fs } = await initFirebase();
  return createFirestoreBackend({ db, fs, uid });
}
