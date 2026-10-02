// ตัวกลางเลือกแหล่งเก็บข้อมูล: ใช้ IndexedDB (ในเครื่อง) ตามค่าเริ่มต้น แล้วสลับเป็น Firestore เมื่อล็อกอิน
// หน้าจออื่นเรียกฟังก์ชันชุดเดิมทั้งหมดโดยไม่ต้องรู้ว่าข้อมูลอยู่ที่ไหน
import * as idb from './storage.idb.js';
import { isLocalMetaKey } from './migrate.js';

export { openDB, upgradeDB, DB_VERSION, newId, getLocalCounts, readAllLocal, clearLocalData } from './storage.idb.js';

let backend = idb;
let name = 'idb';

export const backendName = () => name;
export function setBackend(n, impl) { backend = impl; name = n; }
export const useLocal = () => setBackend('idb', idb);
export async function useFirestore(uid) {
  const { initFirestoreBackend } = await import('./storage.firestore.js'); // โหลดเมื่อจำเป็น (ไม่โหลด SDK ตอนใช้แบบในเครื่อง)
  setBackend('firestore', await initFirestoreBackend(uid));
}

export const getAllSubscriptions = (o) => backend.getAllSubscriptions(o);
export const getAllPayments = () => backend.getAllPayments();
export const getAllTransactions = (o) => backend.getAllTransactions(o);
export const getActivityLog = () => backend.getActivityLog();
export const saveSubscription = (s) => backend.saveSubscription(s);
export const deleteSubscription = (id) => backend.deleteSubscription(id);
export const recordPayment = (p) => backend.recordPayment(p);
export const undoPayment = (id) => backend.undoPayment(id);
export const saveTransaction = (t) => backend.saveTransaction(t);
export const deleteTransaction = (id) => backend.deleteTransaction(id);

// ค่าเฉพาะเครื่อง (login-skipped, local:*) อยู่ในเครื่องเสมอ ที่เหลือตามแหล่งข้อมูลปัจจุบัน
const metaStore = (key) => (isLocalMetaKey(key) ? idb : backend);
export const getMeta = (key) => metaStore(key).getMeta(key);
export const setMeta = (key, value) => metaStore(key).setMeta(key, value);

export const onWriteError = (cb) => backend.onWriteError?.(cb) ?? (() => {});
export const getCloudAdapter = () => backend.getCloudAdapter();

// ถังขยะ
export const getDeleted = () => backend.getDeleted();
export const restoreSubscription = (id) => backend.restoreSubscription(id);
export const restoreTransaction = (id) => backend.restoreTransaction(id);
export const purgeSubscription = (id) => backend.purgeSubscription(id);
export const purgeTransaction = (id) => backend.purgeTransaction(id);
export const emptyTrash = () => backend.emptyTrash();
