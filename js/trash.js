import { esc, fmtPrice } from './calendar.js';
import { fmtSatang } from './ledger.js';

// แยกรายการปกติกับรายการในถังขยะ (เรียงลบล่าสุดก่อน) — โหลดข้อมูลครั้งเดียวแล้วแยกในเครื่อง ไม่อ่านซ้ำจากคลาวด์
export function splitTrash(rows) {
  const live = [];
  const deleted = [];
  for (const r of rows) (r.deletedAt ? deleted : live).push(r);
  deleted.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { live, deleted };
}

// ใส่รายการเข้ารายการถังขยะ (ล่าสุดก่อน) ; มี id นี้อยู่แล้วคืนรายการเดิม (กันแถวซ้ำเมื่อกดลบรัว ๆ)
export function addToTrash(list, item, deletedAt) {
  if (list.some((x) => x.id === item.id)) return list;
  return [{ ...item, deletedAt }, ...list];
}

const when = (iso) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const CYCLES = { weekly: 'รายสัปดาห์', monthly: 'รายเดือน', yearly: 'รายปี', once: 'ครั้งเดียว' };

const row = (kind, id, title, sub, right, deletedAt) => `<li class="trash-row">
  <div class="grow"><strong>${title}</strong>
    <span class="sub">${sub}</span>
    <span class="sub">ลบเมื่อ ${when(deletedAt)}</span></div>
  ${right ? `<span class="money">${right}</span>` : ''}
  <div class="trash-actions">
    <button class="btn" data-restore="${kind}:${esc(id)}">กู้คืน</button>
    <button class="btn danger" data-purge="${kind}:${esc(id)}">ลบถาวร</button>
  </div>
</li>`;

export function trashHTML({ subscriptions, transactions }) {
  const total = subscriptions.length + transactions.length;
  const head = `<button class="link back" data-view="settings">‹ ตั้งค่า</button>
    <div class="page-head"><h2>ถังขยะ</h2></div>`;
  if (!total) return `<section class="trash">${head}<p class="empty-line">ถังขยะว่างเปล่า รายการที่ลบจะมาอยู่ที่นี่และกู้คืนได้</p></section>`;
  return `<section class="trash">${head}
    <p class="sub">รายการที่ลบไว้ ${total.toLocaleString('th-TH')} รายการ กู้คืนได้จนกว่าจะกด "ลบถาวร"</p>
    ${subscriptions.length ? `<h3>บริการสมัคร <small>${subscriptions.length}</small></h3><ul class="plain-rows">${subscriptions.map((s) =>
      row('sub', s.id, esc(s.name), `${esc(s.category)} · ${CYCLES[s.cycle] ?? ''}`, esc(fmtPrice(s.price, s.currency)), s.deletedAt)).join('')}</ul>` : ''}
    ${transactions.length ? `<h3>รายการบัญชี <small>${transactions.length}</small></h3><ul class="plain-rows">${transactions.map((t) =>
      row('tx', t.id, esc(t.name || t.category), `${esc(t.category)} · ${t.type === 'income' ? 'รายรับ' : 'รายจ่าย'} · ${t.date}`, fmtSatang(t.type === 'income' ? t.amount : -t.amount, { signed: true }), t.deletedAt)).join('')}</ul>` : ''}
    <button class="btn danger empty-trash" data-empty-trash>ล้างถังขยะ (${total})</button>
  </section>`;
}
