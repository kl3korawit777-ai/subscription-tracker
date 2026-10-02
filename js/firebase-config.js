// ค่าตั้งต้นของ Firebase (Project settings → Your apps → Web app → firebaseConfig)
// ค่าเหล่านี้ไม่ใช่ความลับ (ความปลอดภัยอยู่ที่ firestore.rules) แต่ต้องกรอกให้ตรงกับโปรเจกต์ของคุณ
// ถ้ายังว่าง แอปจะทำงานแบบในเครื่องอย่างเดียว ไม่แสดงหน้าล็อกอิน
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export const isFirebaseConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
