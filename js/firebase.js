// Firebase (โหลด SDK จาก CDN แบบ ES module ไม่ต้อง build)
// Firestore ใช้แคชถาวร (IndexedDB) แบบหลายแท็บ จึงใช้งานออฟไลน์ได้และซิงก์เมื่อกลับมาออนไลน์
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const SDK_VERSION = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

let ready; // Promise<{ app, auth, db, fs, authMod } | null>

export function initFirebase() {
  ready ??= (async () => {
    if (!isFirebaseConfigured()) return null;
    const [{ initializeApp }, authMod, fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = initializeApp(firebaseConfig);
    let db;
    try {
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (err) {
      // เช่น เบราว์เซอร์ไม่มี IndexedDB (โหมดส่วนตัว): ใช้แคชในหน่วยความจำแทน ยังซิงก์ได้แต่ออฟไลน์ข้ามการปิดแอปไม่ได้
      console.warn('persistent cache unavailable, using memory cache', err);
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fs.memoryLocalCache() });
    }
    const auth = authMod.getAuth(app);
    authMod.getRedirectResult(auth).catch(() => {}); // จบกระบวนการล็อกอินแบบ redirect (ถ้ามี)
    return { app, auth, db, fs, authMod };
  })().catch((err) => { ready = undefined; throw err; });
  return ready;
}

// เรียก cb(user | null) ทุกครั้งที่สถานะล็อกอินเปลี่ยน (รวมครั้งแรกที่อ่านจากเซสชันที่เก็บไว้) คืนฟังก์ชันยกเลิก
export async function onUser(cb) {
  const fb = await initFirebase();
  if (!fb) return () => {};
  return fb.authMod.onAuthStateChanged(fb.auth, cb);
}

export async function signInWithGoogle() {
  const { auth, authMod } = await initFirebase();
  const provider = new authMod.GoogleAuthProvider();
  try {
    return await authMod.signInWithPopup(auth, provider);
  } catch (err) {
    // PWA แบบ standalone / เบราว์เซอร์มือถือบางตัวบล็อก popup → ใช้ redirect แทน
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      return authMod.signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

export async function signOutUser() {
  const { auth, authMod } = await initFirebase();
  return authMod.signOut(auth);
}

// ข้อความ error ภาษาไทยที่บอกว่าต้องทำอะไรต่อ
export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'ปิดหน้าต่างล็อกอินก่อนเสร็จ กด "เข้าสู่ระบบด้วย Google" เพื่อลองอีกครั้ง';
    case 'auth/network-request-failed': return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ต้องออนไลน์ตอนล็อกอิน ลองใหม่เมื่อมีสัญญาณ';
    case 'auth/unauthorized-domain': return 'โดเมนนี้ยังไม่ได้อนุญาตใน Firebase (Authentication → Settings → Authorized domains) เพิ่มโดเมนนี้แล้วลองใหม่';
    case 'auth/operation-not-allowed': return 'ยังไม่ได้เปิดการล็อกอินด้วย Google ใน Firebase Console (Authentication → Sign-in method)';
    default: return `ล็อกอินไม่สำเร็จ (${err?.code ?? err?.message ?? 'ไม่ทราบสาเหตุ'}) ลองอีกครั้ง`;
  }
}

// ติดตามสถานะซิงก์: ฟังเอกสาร users/{uid} พร้อม metadata แล้วรายงาน { pending, fromCache } ทุกครั้งที่เปลี่ยน
// พร้อมบันทึก lastLoginAt (ทำให้เห็นสถานะ กำลังซิงก์ → ซิงก์แล้ว จริง และตรวจว่ากฎ/เครือข่ายเขียนได้)
// คืนฟังก์ชันหยุดติดตาม
export async function watchSync(uid, cb) {
  const { db, fs } = await initFirebase();
  const ref = fs.doc(db, 'users', uid);
  const unsub = fs.onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snap) => cb({ pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache, error: null }),
    (error) => cb({ pending: false, fromCache: true, error }),
  );
  fs.setDoc(ref, { lastLoginAt: fs.serverTimestamp() }, { merge: true }).catch((error) => cb({ pending: false, fromCache: true, error }));
  return unsub;
}
