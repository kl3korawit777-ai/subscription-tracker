// Firestore จำลองในหน่วยความจำ — มุมมองในเครื่อง (local) เห็นการเขียนทันที ส่วนฝั่งเซิร์ฟเวอร์ (server) เห็นเมื่อ "ยืนยันแล้ว"
// ackMode: 'auto' = ยืนยันทันที, 'hold' = ค้างจนเรียก flush() (จำลองออฟไลน์), 'reject' = เซิร์ฟเวอร์ปฏิเสธ
export function createFakeFirestore() {
  const local = new Map();
  const server = new Map();
  const held = [];
  const state = { ackMode: 'auto' };

  const ref = (type, segs) => ({ type, path: segs.join('/'), id: segs.at(-1) });
  const underCollection = (map, path) => [...map.entries()]
    .filter(([p]) => p.startsWith(`${path}/`) && p.slice(path.length + 1).split('/').length === 1)
    .map(([p, data]) => ({ id: p.split('/').at(-1), data: () => ({ ...data }) }));
  const snap = (map, r) => ({ exists: () => map.has(r.path), data: () => ({ ...map.get(r.path) }) });

  function applyWrite(op) {
    const target = op.type === 'delete'
      ? (m) => m.delete(op.path)
      : (m) => m.set(op.path, JSON.parse(JSON.stringify(op.merge ? { ...(m.get(op.path) ?? {}), ...op.data } : op.data)));
    target(local);
    return () => target(server);
  }

  function commitOps(ops) {
    const toServer = ops.map(applyWrite);
    if (state.ackMode === 'reject') return Promise.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    if (state.ackMode === 'hold') return new Promise((resolve) => held.push(() => { toServer.forEach((f) => f()); resolve(); }));
    toServer.forEach((f) => f());
    return Promise.resolve();
  }

  const fs = {
    collection: (_db, ...segs) => ref('col', segs),
    doc: (_db, ...segs) => ref('doc', segs),
    getDocs: async (c) => ({ docs: underCollection(local, c.path) }),
    getDocsFromServer: async (c) => ({ docs: underCollection(server, c.path) }),
    getDoc: async (r) => snap(local, r),
    getDocFromCache: async (r) => { if (!local.has(r.path)) throw new Error('not cached'); return snap(local, r); },
    getCountFromServer: async (c) => ({ data: () => ({ count: underCollection(server, c.path).length }) }),
    setDoc: (r, data, opts) => commitOps([{ type: 'set', path: r.path, data, merge: opts?.merge }]),
    writeBatch: () => {
      const ops = [];
      return {
        set: (r, data, opts) => ops.push({ type: 'set', path: r.path, data, merge: opts?.merge }),
        delete: (r) => ops.push({ type: 'delete', path: r.path }),
        commit: () => commitOps(ops),
      };
    },
  };

  return { fs, db: {}, state, local, server, flush: () => { while (held.length) held.shift()(); } };
}
