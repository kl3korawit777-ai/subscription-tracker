// ค่าตั้งต้นของ Firebase (Project settings → Your apps → Web app → firebaseConfig)
// ค่าเหล่านี้ไม่ใช่ความลับ (ความปลอดภัยอยู่ที่ firestore.rules) แต่ต้องกรอกให้ตรงกับโปรเจกต์ของคุณ
// ถ้ายังว่าง แอปจะทำงานแบบในเครื่องอย่างเดียว ไม่แสดงหน้าล็อกอิน
export const firebaseConfig = {
  apiKey: 'AIzaSyCg7GsW-xJs5fOFnpOBJK_XKu3Mv1V8CxE',
  authDomain: 'subscription-tracker-7d42f.firebaseapp.com',
  projectId: 'subscription-tracker-7d42f',
  storageBucket: 'subscription-tracker-7d42f.firebasestorage.app',
  messagingSenderId: '852720605495',
  appId: '1:852720605495:web:6b74f20a366272a90a22b2',
};

export const isFirebaseConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
