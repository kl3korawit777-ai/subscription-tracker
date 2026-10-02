import { esc } from './calendar.js';
import { RATE_DEFAULTS } from './dashboard.js';
import { SYNC_LABELS } from './syncstate.js';
import { backendName } from './storage.js';

const SYNC_HELP = {
  offline: 'ตอนนี้ไม่มีอินเทอร์เน็ต ใช้งานต่อได้ ข้อมูลที่แก้จะซิงก์เมื่อกลับมาออนไลน์',
  syncing: 'กำลังส่ง/รับข้อมูลกับเซิร์ฟเวอร์',
  synced: 'ข้อมูลตรงกับเซิร์ฟเวอร์แล้ว',
};

function accountHTML({ fb, sync }) {
  if (fb.status === 'off') {
    return `<p>ยังไม่ได้ตั้งค่า Firebase แอปจึงเก็บข้อมูลในเครื่องนี้อย่างเดียว</p>
      <p class="sub">กรอกค่าโปรเจกต์ในไฟล์ <code>js/firebase-config.js</code> เพื่อเปิดการล็อกอินและซิงก์${fb.error ? ` · เชื่อมต่อไม่ได้: ${esc(fb.error)}` : ''}</p>`;
  }
  if (fb.status === 'loading') return '<p>กำลังเชื่อมต่อบัญชี…</p>';
  if (fb.status === 'signedOut') {
    return `<p>ยังไม่ได้เข้าสู่ระบบ ข้อมูลอยู่ในเครื่องนี้อย่างเดียว</p>
      <button class="btn primary" data-login>เข้าสู่ระบบด้วย Google</button>
      ${fb.loginError ? `<p class="err" role="alert">${esc(fb.loginError)}</p>` : ''}`;
  }
  const u = fb.user;
  return `<dl class="facts">
      <div><dt>บัญชี</dt><dd>${esc(u.displayName || '—')}</dd></div>
      <div><dt>อีเมล</dt><dd>${esc(u.email || '—')}</dd></div>
      <div><dt>การซิงก์</dt><dd>${sync ? SYNC_LABELS[sync] : '—'}</dd></div>
    </dl>
    ${sync ? `<p class="sub">${SYNC_HELP[sync]}</p>` : ''}
    <button class="btn" data-logout>ออกจากระบบ</button>
    <p class="sub">ออกจากระบบแล้วข้อมูลในเครื่องนี้ยังอยู่ครบ</p>`;
}

export function settingsHTML({ fb, sync, rates, localCounts, trash }) {
  const trashCount = (trash?.subscriptions.length ?? 0) + (trash?.transactions.length ?? 0);
  const localTotal = Object.values(localCounts ?? {}).reduce((a, b) => a + b, 0);
  return `<section class="settings">
    <h2 class="page-title">ตั้งค่า</h2>
    <h3>บัญชีและการซิงก์</h3>
    ${accountHTML({ fb, sync })}
    <p class="sub">ที่เก็บข้อมูลตอนนี้: ${backendName() === 'firestore' ? 'บัญชีของคุณบนคลาวด์ (ใช้ออฟไลน์ได้)' : 'ในเครื่องนี้'}</p>
    ${fb.status === 'signedIn' && localTotal > 0 ? `<p>ยังมีข้อมูลเก่าในเครื่องที่ไม่ได้อัปโหลด ${localTotal.toLocaleString('th-TH')} รายการ</p><button class="btn" data-migrate-open>อัปโหลดข้อมูลเก่า</button>` : ''}
    <h3>ถังขยะ</h3>
    <p>${trashCount ? `มีรายการที่ลบไว้ ${trashCount.toLocaleString('th-TH')} รายการ กู้คืนได้` : 'ยังไม่มีรายการที่ลบไว้'}</p>
    <button class="btn" data-view="trash">เปิดถังขยะ${trashCount ? ` (${trashCount})` : ''}</button>
    <h3>อัตราแลกเปลี่ยน <small>บาทต่อ 1 หน่วย</small></h3>
    <div class="rates">${Object.keys(RATE_DEFAULTS).filter((c) => c !== 'THB').map((c) => `<label>${c}<input type="text" inputmode="decimal" data-rate="${c}" value="${rates[c]}"></label>`).join('')}</div>
    <p class="sub">ใช้แปลงยอดสกุลอื่นเป็นบาทในปฏิทิน สรุป และประวัติจ่าย ค่าเริ่มต้นเป็นค่าสมมติ โปรดแก้ให้ตรงกับที่คุณใช้</p>
    <h3>ส่งออกและสำรองข้อมูล</h3>
    <button class="btn" data-backup aria-describedby="backup-hint">สำรองข้อมูลเป็นไฟล์ JSON</button>
    <p class="sub" id="backup-hint">ไฟล์เดียวมีข้อมูลทั้งหมดของที่เก็บที่ใช้อยู่ตอนนี้ เก็บไว้เผื่อกู้คืน</p>
    <button id="export" class="btn" aria-describedby="export-hint">ส่งออก .ics</button>
    <p class="sub" id="export-hint">ไฟล์ปฏิทินสำหรับนำเข้า Google Calendar เตือนล่วงหน้า 1 วัน</p>
  </section>`;
}

export function loginHTML({ loginError, busy }) {
  return `<section class="login">
    <h1>Subscription Tracker</h1>
    <p class="lead">เข้าสู่ระบบเพื่อซิงก์ข้อมูลข้ามเครื่อง</p>
    <button class="btn primary big" data-login ${busy ? 'disabled' : ''}>${busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วย Google'}</button>
    ${loginError ? `<p class="err" role="alert">${esc(loginError)}</p>` : ''}
    <button class="link" data-skip-login>ใช้งานโดยไม่ซิงก์ไปก่อน</button>
    <p class="sub">ข้อมูลเดิมในเครื่องนี้จะไม่หาย ไม่ว่าจะล็อกอินหรือไม่</p>
  </section>`;
}
