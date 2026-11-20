const DB_NAME = "oil-bill-v5";
const DB_VERSION = 1;
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("อุปกรณ์นี้ไม่รองรับ IndexedDB จึงไม่สามารถจัดเก็บข้อมูลถาวรได้"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("receipts")) {
        const store = db.createObjectStore("receipts", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("receipt_id", "receipt_id", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error("ฐานข้อมูลถูกเปิดค้างในหน้าต่างอื่น กรุณาปิดหน้าต่างโปรแกรมที่ซ้ำกัน"));
  });
  return dbPromise;
}

export async function getAllReceipts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction("receipts", "readonly").objectStore("receipts").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReceipt(row) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("receipts", "readwrite");
    tx.objectStore("receipts").put(row);
    tx.oncomplete = () => resolve(row);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("บันทึกข้อมูลไม่สำเร็จ"));
  });
}

export async function saveReceipts(rows) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("receipts", "readwrite");
    const store = tx.objectStore("receipts");
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("บันทึกข้อมูลชุดนำเข้าไม่สำเร็จ"));
  });
}

export async function removeReceipt(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("receipts", "readwrite");
    tx.objectStore("receipts").delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function replaceAllReceipts(rows) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("receipts", "readwrite");
    const store = tx.objectStore("receipts");
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("กู้คืนข้อมูลไม่สำเร็จ"));
  });
}
