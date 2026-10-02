// ย้ายข้อมูลจาก IndexedDB ขึ้น Firestore: สำรองไฟล์ → อัปโหลด → นับตรวจ → ลบของเดิม
// ไฟล์นี้เป็นตรรกะล้วน (ไม่แตะ DOM/SDK) ตัวที่ติดต่อจริงถูกส่งเข้ามา (backup, cloud, deleteLocal) จึงทดสอบได้

export const DATA_COLLECTIONS = ['subscriptions', 'payments', 'transactions', 'activityLog'];
export const BATCH_SIZE = 400; // Firestore จำกัด 500 การเขียนต่อ batch

// ตัวบ่งชี้เฉพาะเครื่อง ไม่อัปโหลด และไม่ลบ
export const isLocalMetaKey = (k) => k === 'login-skipped' || k.startsWith('local:');

export class MigrationError extends Error {
  constructor(stage, message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.stage = stage; // offline | backup | upload | verify | cleanup
    this.details = details;
  }
}

export const countLocal = (local) => Object.fromEntries(DATA_COLLECTIONS.map((c) => [c, local[c]?.length ?? 0]));

// แปลงเป็นเอกสารที่จะเขียน: id เดิมของแต่ละรายการ, activityLog ที่ id เป็นเลขรัน → "legacy-<n>", meta → { value }
export function toCloudDocs(local) {
  const docs = {};
  for (const c of ['subscriptions', 'payments', 'transactions']) docs[c] = (local[c] ?? []).map((d) => ({ id: d.id, data: { ...d } }));
  docs.activityLog = (local.activityLog ?? []).map((row) => {
    const id = typeof row.id === 'number' ? `legacy-${row.id}` : String(row.id);
    return { id, data: { ...row, id } };
  });
  docs.meta = Object.entries(local.meta ?? {}).filter(([k]) => !isLocalMetaKey(k)).map(([k, v]) => ({ id: k, data: { value: v } }));
  return docs;
}

export function buildBackup({ local, exportedAt, dbVersion, uid, source = 'indexeddb' }) {
  const { meta = {}, ...rest } = local;
  const data = Object.fromEntries(DATA_COLLECTIONS.map((c) => [c, rest[c] ?? []]));
  return { app: 'subscription-tracker', format: 1, source, exportedAt, dbVersion, uid, counts: countLocal(local), data: { ...data, meta } };
}

const pad = (n) => String(n).padStart(2, '0');
export const backupFilename = (d) =>
  `subscription-tracker-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

async function stage(name, onProgress, fn) {
  onProgress(name, 'start');
  try {
    const r = await fn();
    onProgress(name, 'done');
    return r;
  } catch (err) {
    if (err instanceof MigrationError) throw err;
    throw new MigrationError(name, err?.message ?? String(err), { cause: err });
  }
}

// ลำดับสำคัญ: สำรองไฟล์ก่อนเขียนอะไรขึ้นคลาวด์เสมอ, ลบของเดิมเป็นขั้นสุดท้าย และเฉพาะเมื่อจำนวนบนเซิร์ฟเวอร์ครบ
// cloud = { listIds(col), commit(ops), count(col) }   (commit/count ต้องรอการยืนยันจากเซิร์ฟเวอร์จริง)
export async function runMigration({ local, cloud, backup, deleteLocal, onProgress = () => {}, isOnline = () => true, uid, dbVersion, now = new Date() }) {
  if (!isOnline()) throw new MigrationError('offline', 'ต้องออนไลน์เพื่ออัปโหลด');

  await stage('backup', onProgress, () => backup(buildBackup({ local, exportedAt: now.toISOString(), dbVersion, uid }), backupFilename(now)));

  const docs = toCloudDocs(local);
  const cols = [...DATA_COLLECTIONS, 'meta'];
  const expected = {};
  await stage('upload', onProgress, async () => {
    const ops = [];
    for (const col of cols) {
      const cloudIds = new Set(await cloud.listIds(col));
      docs[col].forEach((d) => cloudIds.add(d.id));
      expected[col] = cloudIds.size; // เอกสารที่มีอยู่แล้ว (เช่น จากอีกเครื่อง) ต้องอยู่ครบและไม่ถูกลบ
      ops.push(...docs[col].map((d) => ({ col, id: d.id, data: d.data })));
    }
    for (const part of chunk(ops, BATCH_SIZE)) await cloud.commit(part);
  });

  await stage('verify', onProgress, async () => {
    const mismatch = {};
    for (const col of cols) {
      const got = await cloud.count(col);
      if (got !== expected[col]) mismatch[col] = { expected: expected[col], got };
    }
    if (Object.keys(mismatch).length) throw new MigrationError('verify', 'จำนวนบนเซิร์ฟเวอร์ไม่ตรงกับที่อัปโหลด', mismatch);
  });

  await stage('cleanup', onProgress, () => deleteLocal());
  return { expected, counts: countLocal(local) };
}
