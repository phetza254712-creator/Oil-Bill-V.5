import { getAllReceipts, saveReceipt, saveReceipts, removeReceipt, replaceAllReceipts } from "./db.js";
import { importFile, fieldForHeader } from "./importers.js";
import { makeId, money, num, normalizeDate, parseReceiptText, summarize, validateReceipt } from "./logic.js";
import "./style.css";

const $ = selector => document.querySelector(selector);
const app = $("#app");
let receipts = [];
let page = "dashboard";
let query = "";
let statusFilter = "all";
let importDraft = [];
let importWarnings = [];
let busy = false;
let editingId = null;

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthISO = () => todayISO().slice(0, 7);
const dateTH = value => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(date);
};
const validReceipts = () => receipts.filter(row => row.status !== "draft" && row.status !== "cancelled");
const activeReceipts = () => receipts.filter(row => row.status !== "cancelled");

function toast(message, type = "success") {
  let element = $("#toast");
  if (!element) {
    element = document.createElement("div"); element.id = "toast"; element.className = "toast"; document.body.append(element);
  }
  element.textContent = message;
  element.dataset.type = type;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

function badge(status) {
  const labels = { saved: ["บันทึกแล้ว", "green"], draft: ["ฉบับร่าง", "amber"], cancelled: ["ยกเลิก", "gray"] };
  const [label, color] = labels[status] || labels.draft;
  return `<span class="badge ${color}">${label}</span>`;
}

function navButton(key, label, icon) {
  return `<button class="nav-item ${page === key ? "active" : ""}" data-page="${key}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
}

function shell(content) {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">OB</div><div><strong>OIL BILL <span>V5</span></strong><small>FUEL ACCOUNTING</small></div></div>
        <div class="nav-caption">WORKSPACE</div>
        <nav class="main-nav">
          ${navButton("dashboard", "ภาพรวม", "⌂")}
          ${navButton("receipts", "รายการบิล", "▤")}
          ${navButton("import", "นำเข้าเอกสาร", "⇧")}
          ${navButton("reports", "รายงานและสถิติ", "▥")}
          ${navButton("data", "สำรองข้อมูล", "▣")}
        </nav>
        <div class="sidebar-bottom"><div class="secure-dot"></div><div><b>จัดเก็บในอุปกรณ์นี้</b><small>ข้อมูลอยู่ในเครื่องของคุณ</small></div></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div><div class="eyebrow">OIL BILL MANAGEMENT</div><h1>${({ dashboard: "ภาพรวมธุรกิจ", receipts: "จัดการรายการบิล", import: "นำเข้าและตรวจสอบเอกสาร", reports: "รายงานและสถิติ", data: "ข้อมูลและการสำรอง" })[page]}</h1></div><div class="top-actions"><button class="button button-quiet" data-action="new-receipt">＋ <span>เพิ่มบิล</span></button><div class="avatar">OB</div></div></header>
        <section class="page-content">${content}</section>
        <footer class="footer">OIL BILL V5 <span>•</span> ระบบจัดการบิลน้ำมันและค่าใช้จ่าย</footer>
      </main>
    </div>
    <dialog id="receipt-dialog" class="modal"></dialog>
    <dialog id="source-dialog" class="modal source-modal"></dialog>
  `;
}

function statCard(label, value, note, icon, tone = "blue") {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;
}

function renderDashboard() {
  const valid = validReceipts();
  const today = valid.filter(row => row.date === todayISO());
  const month = valid.filter(row => row.date?.startsWith(monthISO()));
  const todayTotal = today.reduce((sum, row) => sum + num(row.total_amount), 0);
  const monthTotal = month.reduce((sum, row) => sum + num(row.total_amount), 0);
  const monthLiters = month.reduce((sum, row) => sum + num(row.quantity), 0);
  const draftCount = receipts.filter(row => row.status === "draft").length;
  const recent = [...receipts].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  const bars = summarize(valid, "month").slice(-6);
  const max = Math.max(1, ...bars.map(item => item.total));
  return `
    <div class="welcome-row"><div><div class="section-kicker">BUSINESS OVERVIEW</div><h2>ยินดีต้อนรับสู่ Oil Bill V5</h2><p>ติดตามค่าใช้จ่ายน้ำมันและตรวจสอบเอกสารทั้งหมดได้จากที่เดียว</p></div><div class="today-chip">◷ วันนี้ ${dateTH(todayISO())}</div></div>
    <div class="stats-grid">
      ${statCard("ยอดใช้จ่ายวันนี้", `฿${money(todayTotal)}`, `${today.length.toLocaleString("th-TH")} บิลที่บันทึกแล้ว`, "฿", "blue")}
      ${statCard("ยอดใช้จ่ายเดือนนี้", `฿${money(monthTotal)}`, `${month.length.toLocaleString("th-TH")} บิลในเดือนนี้`, "▥", "violet")}
      ${statCard("ปริมาณน้ำมันเดือนนี้", `${money(monthLiters)} <small>ลิตร</small>`, "รวมจากบิลที่บันทึกแล้ว", "◉", "teal")}
      ${statCard("เอกสารรอตรวจสอบ", draftCount.toLocaleString("th-TH"), "ฉบับร่างยังไม่รวมในรายงาน", "!", "amber")}
    </div>
    <div class="dashboard-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><div class="section-kicker">COST TREND</div><h3>ยอดใช้จ่ายรายเดือน</h3></div><span class="subtle-tag">6 เดือนล่าสุด</span></div>
        ${bars.length ? `<div class="bar-chart">${bars.map(item => `<div class="bar-row"><span class="bar-label">${escapeHTML(item.period)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.total / max * 100)}%"></div></div><b>฿${money(item.total)}</b></div>`).join("")}</div>` : `<div class="empty-state compact"><div class="empty-icon">▥</div><b>ยังไม่มีข้อมูลรายงาน</b><span>เริ่มเพิ่มบิลหรือนำเข้าเอกสารเพื่อดูสถิติ</span></div>`}
      </article>
      <article class="panel quick-panel"><div class="panel-heading"><div><div class="section-kicker">QUICK ACTIONS</div><h3>ทางลัดการทำงาน</h3></div></div><button class="quick-action" data-action="new-receipt"><span class="quick-icon blue">＋</span><span><b>เพิ่มบิลด้วยตนเอง</b><small>กรอกข้อมูลใบเสร็จใหม่</small></span><i>→</i></button><button class="quick-action" data-page="import"><span class="quick-icon violet">⇧</span><span><b>นำเข้าไฟล์เอกสาร</b><small>Excel, PDF, รูปภาพ และ Word</small></span><i>→</i></button><button class="quick-action" data-page="reports"><span class="quick-icon teal">▥</span><span><b>ดูรายงานค่าใช้จ่าย</b><small>สรุปรายวัน เดือน และปี</small></span><i>→</i></button></article>
    </div>
    <article class="panel recent-panel"><div class="panel-heading"><div><div class="section-kicker">LATEST RECORDS</div><h3>รายการบิลล่าสุด</h3></div><button class="text-button" data-page="receipts">ดูรายการทั้งหมด →</button></div>${recent.length ? receiptTable(recent, true) : `<div class="empty-state compact"><b>ยังไม่มีรายการบิล</b><span>เพิ่มบิลหรือนำเข้าเอกสารเพื่อเริ่มต้นใช้งาน</span></div>`}</article>
  `;
}

function receiptTable(rows, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>เลขที่บิล / วันที่</th><th>ผู้ขาย</th><th>ลูกค้า</th><th>ปริมาณ</th><th>ยอดสุทธิ</th><th>สถานะ</th>${compact ? "" : "<th></th>"}</tr></thead><tbody>${rows.map(row => `<tr><td><b>${escapeHTML(row.receipt_id || "ไม่ระบุเลขบิล")}</b><small>${dateTH(row.date)}</small></td><td>${escapeHTML(row.seller_name || "—")}</td><td>${escapeHTML(row.buyer_name || "—")}</td><td>${money(row.quantity)} ล.</td><td class="amount">฿${money(row.total_amount)}</td><td>${badge(row.status)}</td>${compact ? "" : `<td><button class="icon-button" title="แก้ไข" data-action="edit" data-id="${escapeHTML(row.id)}">✎</button><button class="icon-button danger-text" title="ยกเลิกบิล" data-action="cancel" data-id="${escapeHTML(row.id)}">×</button></td>`}</tr>`).join("")}</tbody></table></div>`;
}

function renderReceipts() {
  const rows = activeReceipts().filter(row => {
    const content = [row.receipt_id, row.seller_name, row.buyer_name, row.vehicle_plate, row.item_name].join(" ").toLowerCase();
    return (!query || content.includes(query.toLowerCase())) && (statusFilter === "all" || row.status === statusFilter);
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<div class="toolbar"><div class="search-box"><span>⌕</span><input id="receipt-search" placeholder="ค้นหาเลขบิล ผู้ขาย ลูกค้า ทะเบียนรถ..." value="${escapeHTML(query)}" /></div><select id="status-filter" class="select-control"><option value="all" ${statusFilter === "all" ? "selected" : ""}>ทุกสถานะ</option><option value="saved" ${statusFilter === "saved" ? "selected" : ""}>บันทึกแล้ว</option><option value="draft" ${statusFilter === "draft" ? "selected" : ""}>ฉบับร่าง</option></select><button class="button button-primary" data-action="new-receipt">＋ เพิ่มบิล</button></div>
  <div class="list-summary"><b>${rows.length.toLocaleString("th-TH")} รายการ</b><span>ฉบับร่างจะไม่ถูกรวมในยอดสรุปรายงาน</span><button class="text-button" data-action="export-csv">ส่งออก CSV ↓</button></div>${rows.length ? receiptTable(rows) : `<div class="panel empty-state"><div class="empty-icon">▤</div><h3>ไม่พบรายการบิล</h3><p>ลองเปลี่ยนคำค้นหา หรือนำเข้าข้อมูลจากไฟล์</p><button class="button button-primary" data-page="import">นำเข้าเอกสาร</button></div>`}`;
}

function importField(row, index, key, label, type = "text", step = "") {
  const value = row[key] ?? "";
  return `<label class="field"><span>${label}</span><input type="${type}" ${step ? `step="${step}"` : ""} value="${escapeHTML(value)}" data-import-index="${index}" data-import-field="${key}" /></label>`;
}

function renderImport() {
  const cards = importDraft.map((row, index) => {
    const errors = validateReceipt(row, [...receipts, ...importDraft.filter((_, i) => i !== index)]);
    return `<article class="import-card" data-import-card="${index}"><div class="import-card-title"><label class="check-label"><input type="checkbox" data-import-select="${index}" ${row._selected === false ? "" : "checked"}/><b>เอกสาร ${index + 1}</b></label><span class="file-tag">${escapeHTML(row.source_file || "ไฟล์นำเข้า")}</span><button class="text-button danger-text" data-action="remove-import" data-index="${index}">นำออก</button></div>
      <div class="import-fields">${importField(row,index,"receipt_id","เลขที่บิล")}${importField(row,index,"date","วันที่","date")}${importField(row,index,"seller_name","ชื่อผู้ขาย / สถานี")}${importField(row,index,"buyer_name","ชื่อผู้ซื้อ / ลูกค้า")}${importField(row,index,"seller_tax_id","เลขภาษีผู้ขาย")}${importField(row,index,"buyer_tax_id","เลขภาษีผู้ซื้อ")}${importField(row,index,"vehicle_plate","ทะเบียนรถ")}${importField(row,index,"item_name","ชนิดน้ำมัน / รายการ")}${importField(row,index,"quantity","ปริมาณ (ลิตร)","number","0.001")}${importField(row,index,"unit_price","ราคาต่อหน่วย","number","0.01")}${importField(row,index,"subtotal","มูลค่าก่อนภาษี","number","0.01")}${importField(row,index,"vat","VAT","number","0.01")}${importField(row,index,"discount","ส่วนลด","number","0.01")}${importField(row,index,"total_amount","ยอดสุทธิ","number","0.01")}${importField(row,index,"payment_method","วิธีชำระเงิน")}</div>
      ${(row.items || []).length ? `<div class="item-edit-list"><b>รายการสินค้า / น้ำมัน (${row.items.length})</b>${row.items.map((item, itemIndex) => `<div class="item-edit-row"><input aria-label="ชื่อรายการ" value="${escapeHTML(item.name)}" data-import-item-index="${index}" data-item-index="${itemIndex}" data-item-key="name"/><input aria-label="จำนวนลิตร" type="number" step="0.001" value="${escapeHTML(item.quantity)}" data-import-item-index="${index}" data-item-index="${itemIndex}" data-item-key="quantity"/><input aria-label="ราคาต่อหน่วย" type="number" step="0.01" value="${escapeHTML(item.unit_price)}" data-import-item-index="${index}" data-item-index="${itemIndex}" data-item-key="unit_price"/><input aria-label="มูลค่ารายการ" type="number" step="0.01" value="${escapeHTML(item.total)}" data-import-item-index="${index}" data-item-index="${itemIndex}" data-item-key="total"/></div>`).join("")}</div>` : ""}
      <div class="validation ${errors.length ? "warning" : "good"}"><b>${errors.length ? "ควรตรวจสอบก่อนบันทึก" : "ข้อมูลหลักครบแล้ว"}</b><span>${errors.length ? escapeHTML(errors.join(" • ")) : "ระบบจะตรวจสอบยอดรวมและเลขบิลซ้ำอีกครั้งเมื่อบันทึก"}</span>${errors.length ? `<small>รายการที่ข้อมูลไม่ครบจะเก็บเป็นฉบับร่าง ไม่ถูกทิ้ง</small>` : ""}</div>
      ${row.source_text ? `<details class="source-text"><summary>อ่านข้อความต้นฉบับเพื่อเทียบผลการอ่าน</summary><pre>${escapeHTML(row.source_text.slice(0, 10000))}</pre></details>` : ""}</article>`;
  }).join("");
  return `<div class="import-intro"><div><div class="section-kicker">SMART DOCUMENT INTAKE</div><h2>นำเข้าบิลจากไฟล์หลายรูปแบบ</h2><p>ระบบพยายามตรวจจับข้อมูลจากหัวตารางและข้อความในเอกสาร จากนั้นให้ตรวจและแก้ไขข้อมูลก่อนบันทึกทุกครั้ง</p></div><div class="import-symbol">⇧</div></div>
    <div class="upload-zone"><input id="file-input" type="file" multiple accept=".xlsx,.xls,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.docx" hidden/><div class="upload-icon">⇧</div><b>เลือกไฟล์เอกสารที่ต้องการนำเข้า</b><span>รองรับ Excel, CSV, JSON, PDF, JPG, PNG, WEBP และ Word (.docx)</span><button class="button button-primary" data-action="choose-files" ${busy ? "disabled" : ""}>${busy ? "กำลังประมวลผล..." : "เลือกไฟล์จากอุปกรณ์"}</button><small>ประมวลผลทีละไฟล์เพื่อลดการใช้หน่วยความจำ • ไฟล์จะไม่ถูกส่งไปยังเซิร์ฟเวอร์</small></div>
    ${importWarnings.length ? `<div class="notice"><b>หมายเหตุจากการอ่านไฟล์</b>${importWarnings.map(warning => `<span>• ${escapeHTML(warning)}</span>`).join("")}</div>` : ""}
    ${importDraft.length ? `<div class="review-heading"><div><h3>ตรวจสอบข้อมูลก่อนบันทึก</h3><span>อ่านพบ ${importDraft.length} รายการ • เลือกเฉพาะรายการที่ต้องการบันทึกได้</span></div><div><button class="button button-quiet" data-action="clear-import">ล้างรายการ</button><button class="button button-primary" data-action="commit-import">บันทึกรายการที่เลือก</button></div></div><div class="review-list">${cards}</div>` : `<div class="panel empty-state compact"><div class="empty-icon">▧</div><b>ยังไม่มีเอกสารรอตรวจสอบ</b><span>เลือกไฟล์ด้านบนเพื่อเริ่มนำเข้าข้อมูล</span></div>`}`;
}

function renderReports() {
  const period = window.reportPeriod || "month";
  const rows = summarize(validReceipts(), period);
  const total = validReceipts().reduce((sum, row) => sum + num(row.total_amount), 0);
  const liters = validReceipts().reduce((sum, row) => sum + num(row.quantity), 0);
  const max = Math.max(1, ...rows.map(row => row.total));
  return `<div class="report-controls"><div><div class="section-kicker">FINANCIAL INSIGHTS</div><h2>สรุปการใช้จ่ายน้ำมัน</h2><p>คำนวณจากบิลที่บันทึกสมบูรณ์เท่านั้น ไม่รวมฉบับร่างและรายการยกเลิก</p></div><select id="report-period" class="select-control"><option value="day" ${period === "day" ? "selected" : ""}>รายวัน</option><option value="month" ${period === "month" ? "selected" : ""}>รายเดือน</option><option value="year" ${period === "year" ? "selected" : ""}>รายปี</option></select></div>
  <div class="stats-grid report-stats">${statCard("ค่าใช้จ่ายสะสม", `฿${money(total)}`, "ยอดสุทธิจากบิลสมบูรณ์", "฿", "blue")}${statCard("ปริมาณน้ำมันรวม", `${money(liters)} <small>ลิตร</small>`, "ปริมาณจากทุกรายการ", "◉", "teal")}${statCard("จำนวนบิล", validReceipts().length.toLocaleString("th-TH"), "ไม่นับฉบับร่างและยกเลิก", "▤", "violet")}${statCard("เอกสารฉบับร่าง", receipts.filter(row => row.status === "draft").length.toLocaleString("th-TH"), "ต้องตรวจสอบข้อมูลเพิ่มเติม", "!", "amber")}</div>
  <article class="panel report-panel"><div class="panel-heading"><div><div class="section-kicker">PERIOD BREAKDOWN</div><h3>ยอดใช้จ่ายแยกตามช่วงเวลา</h3></div><button class="text-button" data-action="export-csv">ส่งออก CSV ↓</button></div>${rows.length ? `<div class="bar-chart report-bars">${rows.slice(-24).map(row => `<div class="bar-row"><span class="bar-label">${escapeHTML(row.period)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1.5, row.total / max * 100)}%"></div></div><b>฿${money(row.total)}</b><small>${row.count} บิล · ${money(row.liters)} ลิตร</small></div>`).join("")}</div>` : `<div class="empty-state compact"><b>ยังไม่มีข้อมูลเพียงพอสำหรับรายงาน</b><span>บันทึกบิลที่สมบูรณ์เพื่อเริ่มดูสถิติ</span></div>`}</article>
  <div class="notice info"><b>วิธีคำนวณ</b><span>ยอดใช้จ่ายคำนวณจากยอดสุทธิของแต่ละบิล รายการฉบับร่างจะไม่ถูกนำมารวมจนกว่าจะตรวจสอบและบันทึกเป็นบิลสมบูรณ์</span></div>`;
}

function renderData() {
  return `<div class="data-intro"><div class="section-kicker">DATA CONTROL</div><h2>ข้อมูลของคุณอยู่ในอุปกรณ์</h2><p>Oil Bill V5 จัดเก็บข้อมูลด้วยฐานข้อมูลภายในแอปบนอุปกรณ์นี้ การติดตั้งบนอุปกรณ์อื่นจะมีฐานข้อมูลแยกกัน จึงควรสำรองและกู้คืนเมื่อย้ายเครื่อง</p></div>
  <div class="data-grid"><article class="panel data-card"><div class="data-icon blue">⇩</div><h3>สำรองข้อมูลทั้งหมด</h3><p>ดาวน์โหลดบิลทั้งหมดรวมฉบับร่าง รายการยกเลิก และรายละเอียดสินค้าเป็นไฟล์ JSON</p><button class="button button-primary" data-action="backup">ดาวน์โหลดไฟล์สำรอง</button></article><article class="panel data-card"><div class="data-icon violet">⇧</div><h3>กู้คืนข้อมูลจากไฟล์</h3><p>นำไฟล์สำรอง JSON ที่สร้างจาก Oil Bill V5 กลับมาใช้งาน ข้อมูลปัจจุบันจะถูกแทนที่หลังยืนยัน</p><input id="restore-input" type="file" accept=".json,application/json" hidden/><button class="button button-quiet" data-action="restore">เลือกไฟล์เพื่อกู้คืน</button></article><article class="panel data-card"><div class="data-icon teal">⇩</div><h3>ส่งออกรายการเป็น CSV</h3><p>นำข้อมูลบิลไปเปิดใน Excel หรือโปรแกรมตารางคำนวณ โดยส่งออกเฉพาะข้อมูลปัจจุบันทุกสถานะ</p><button class="button button-quiet" data-action="export-csv">ส่งออก CSV</button></article></div>
  <div class="notice warning-notice"><b>ข้อควรทราบเรื่องการเก็บข้อมูล</b><span>ข้อมูลไม่ได้ซิงก์ขึ้น Cloud อัตโนมัติ และอาจสูญหายเมื่อล้างข้อมูลแอป ถอนการติดตั้ง หรือเปลี่ยนอุปกรณ์ กรุณาดาวน์โหลดไฟล์สำรองเป็นระยะ ๆ และเก็บไว้นอกเครื่อง</span></div>
  <article class="panel system-info"><div class="panel-heading"><h3>สถานะระบบ</h3><span class="badge green">Oil Bill V5.0.0</span></div><div class="system-row"><span>จำนวนรายการทั้งหมด</span><b>${receipts.length.toLocaleString("th-TH")} รายการ</b></div><div class="system-row"><span>บิลสมบูรณ์</span><b>${validReceipts().length.toLocaleString("th-TH")} รายการ</b></div><div class="system-row"><span>ฉบับร่าง</span><b>${receipts.filter(row => row.status === "draft").length.toLocaleString("th-TH")} รายการ</b></div></article>`;
}

function render() {
  const content = ({ dashboard: renderDashboard, receipts: renderReceipts, import: renderImport, reports: renderReports, data: renderData })[page]();
  shell(content);
  if (page === "receipts") {
    const search = $("#receipt-search");
    search?.focus(); search?.setSelectionRange(query.length, query.length);
  }
}

function receiptForm(row = {}) {
  const fields = [
    ["receipt_id", "เลขที่บิล", "text", true], ["date", "วันที่ออกบิล", "date", true],
    ["seller_name", "ชื่อผู้ขาย / สถานีบริการ", "text", true], ["seller_tax_id", "เลขประจำตัวผู้เสียภาษีผู้ขาย", "text", false],
    ["buyer_name", "ชื่อผู้ซื้อ / ลูกค้า", "text", true], ["buyer_tax_id", "เลขประจำตัวผู้เสียภาษีผู้ซื้อ", "text", false],
    ["branch", "สาขา", "text", false], ["vehicle_plate", "ทะเบียนรถ", "text", false],
    ["item_name", "ชนิดน้ำมัน / รายการสินค้า", "text", false], ["quantity", "ปริมาณ (ลิตร)", "number", false],
    ["unit_price", "ราคาต่อลิตร", "number", false], ["subtotal", "มูลค่าก่อนภาษี", "number", false],
    ["vat", "VAT", "number", false], ["discount", "ส่วนลด", "number", false],
    ["total_amount", "ยอดสุทธิ", "number", true], ["payment_method", "วิธีชำระเงิน", "text", false]
  ];
  const inputs = fields.map(([key, label, type, required]) => `<label class="field"><span>${label}${required ? " *" : ""}</span><input name="${key}" type="${type}" ${type === "number" ? 'step="0.01" min="0"' : ""} value="${escapeHTML(key === "date" ? (row[key] || todayISO()) : row[key] ?? "")}" ${required ? "required" : ""}/></label>`).join("");
  const dialog = $("#receipt-dialog");
  dialog.innerHTML = `<form id="receipt-form" class="modal-form"><div class="modal-heading"><div><div class="section-kicker">RECEIPT RECORD</div><h2>${row.id ? "แก้ไขข้อมูลบิล" : "เพิ่มบิลใหม่"}</h2><p>กรอกข้อมูลตามเอกสารจริง ช่องที่มี * จำเป็นสำหรับบิลสมบูรณ์</p></div><button type="button" class="close-button" data-action="close-modal">×</button></div><div class="form-grid">${inputs}</div><div class="form-note">ยอดก่อนภาษี + VAT - ส่วนลด ควรตรงกับยอดสุทธิ ระบบจะแจ้งเตือนเมื่อยอดไม่ตรงกัน</div><div class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">ยกเลิก</button><button type="submit" class="button button-primary">บันทึกบิล</button></div></form>`;
  if (!dialog.open) dialog.showModal();
}

function openSource(title, text) {
  const dialog = $("#source-dialog");
  dialog.innerHTML = `<div class="modal-form"><div class="modal-heading"><h2>${escapeHTML(title)}</h2><button class="close-button" data-action="close-source">×</button></div><pre>${escapeHTML(text)}</pre></div>`;
  dialog.showModal();
}

async function refresh() {
  receipts = await getAllReceipts();
  render();
}

async function handleImportFiles(files) {
  const queue = [...files];
  if (!queue.length || busy) return;
  busy = true; importDraft = []; importWarnings = [];
  render();
  let done = 0;
  for (const file of queue) {
    toast(`กำลังอ่าน ${file.name} (${++done}/${queue.length})`, "info");
    try {
      const result = await importFile(file);
      importWarnings.push(...(result.warnings || []).map(warning => `${file.name}: ${warning}`));
      for (const row of result.rows || []) importDraft.push({ ...row, id: row.id || makeId(), source_file: row.source_file || file.name, source_text: row.source_text || result.text || "", _selected: true });
      if (!(result.rows || []).length) importWarnings.push(`${file.name}: ไม่สามารถแยกข้อมูลบิลได้ กรุณาตรวจรูปแบบเอกสารหรือใช้กรอกด้วยตนเอง`);
    } catch (error) { importWarnings.push(`${file.name}: ${error.message || String(error)}`); }
  }
  busy = false; page = "import"; render();
  toast(`อ่านไฟล์เสร็จ พบ ${importDraft.length} รายการ`, importDraft.length ? "success" : "warning");
}

async function commitImport() {
  const selected = importDraft.filter(row => row._selected !== false);
  if (!selected.length) { toast("กรุณาเลือกรายการที่ต้องการบันทึก", "warning"); return; }
  const saved = [], drafts = [];
  const validationPool = [...receipts];
  for (const source of selected) {
    const row = { ...source, id: source.id || makeId(), status: "saved", cancelled: false };
    delete row._selected;
    const errors = validateReceipt(row, validationPool);
    row.status = errors.length ? "draft" : "saved";
    row.import_warnings = errors;
    if (row.status === "draft") drafts.push(row); else saved.push(row);
    validationPool.push(row);
  }
  try {
    await saveReceipts([...saved, ...drafts]);
    importDraft = [];
    await refresh();
    page = "receipts"; render();
    toast(`บันทึกแล้ว ${saved.length} บิล • เก็บเป็นฉบับร่าง ${drafts.length} บิล`);
  } catch (error) { toast(`บันทึกไม่สำเร็จ: ${error.message}`, "error"); }
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[=+@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function exportCSV() {
  const headers = ["เลขที่บิล", "วันที่", "ผู้ขาย", "เลขภาษีผู้ขาย", "ผู้ซื้อ", "เลขภาษีผู้ซื้อ", "ทะเบียนรถ", "รายการ", "ปริมาณลิตร", "ราคาต่อหน่วย", "ก่อนภาษี", "VAT", "ส่วนลด", "ยอดสุทธิ", "วิธีชำระ", "สถานะ", "ไฟล์ต้นทาง"];
  const keys = ["receipt_id", "date", "seller_name", "seller_tax_id", "buyer_name", "buyer_tax_id", "vehicle_plate", "item_name", "quantity", "unit_price", "subtotal", "vat", "discount", "total_amount", "payment_method", "status", "source_file"];
  const lines = [headers, ...receipts.map(row => keys.map(key => row[key] ?? ""))].map(line => line.map(csvEscape).join(","));
  download(`oil-bill-v5-${todayISO()}.csv`, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

async function restoreBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const records = Array.isArray(parsed) ? parsed : parsed.receipts;
    if (!Array.isArray(records) || records.some(row => !row || typeof row !== "object" || !row.id)) throw new Error("รูปแบบไฟล์สำรองไม่ถูกต้อง หรือไม่มีรายการ receipts ที่มี id");
    if (!confirm(`พบข้อมูล ${records.length} รายการ การกู้คืนจะแทนที่ข้อมูลทั้งหมดในอุปกรณ์นี้ ต้องการดำเนินการต่อหรือไม่?`)) return;
    await replaceAllReceipts(records);
    await refresh(); toast(`กู้คืนข้อมูล ${records.length} รายการเรียบร้อย`);
  } catch (error) { toast(`กู้คืนไม่สำเร็จ: ${error.message}`, "error"); }
}

app.addEventListener("click", async event => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) { page = pageButton.dataset.page; render(); return; }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "new-receipt") { editingId = null; receiptForm(); }
  else if (action === "edit") { const row = receipts.find(item => item.id === actionButton.dataset.id); editingId = row?.id || null; if (row) receiptForm(row); }
  else if (action === "cancel") {
    const row = receipts.find(item => item.id === actionButton.dataset.id);
    if (!row || !confirm(`ต้องการยกเลิกบิล ${row.receipt_id || "รายการนี้"} หรือไม่? ข้อมูลจะยังคงอยู่ในประวัติ แต่ไม่ถูกนับในรายงาน`)) return;
    row.status = "cancelled"; row.cancelled = true; await saveReceipt(row); await refresh(); toast("ยกเลิกรายการแล้ว");
  }
  else if (action === "choose-files") $("#file-input")?.click();
  else if (action === "commit-import") await commitImport();
  else if (action === "remove-import") { importDraft.splice(Number(actionButton.dataset.index), 1); render(); }
  else if (action === "clear-import") { if (confirm("ต้องการล้างรายการรอตรวจสอบทั้งหมดหรือไม่?")) { importDraft = []; importWarnings = []; render(); } }
  else if (action === "close-modal") $("#receipt-dialog")?.close();
  else if (action === "close-source") $("#source-dialog")?.close();
  else if (action === "export-csv") exportCSV();
  else if (action === "backup") {
    const payload = { app: "Oil Bill V5", version: "5.0.0", exported_at: new Date().toISOString(), receipts };
    download(`oil-bill-v5-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
  }
  else if (action === "restore") $("#restore-input")?.click();
});

app.addEventListener("input", event => {
  if (event.target.id === "receipt-search") { query = event.target.value; const position = event.target.selectionStart; render(); const input = $("#receipt-search"); input?.focus(); input?.setSelectionRange(position, position); }
  const itemField = event.target.closest("[data-import-item-index]");
  if (itemField) {
    const row = importDraft[Number(itemField.dataset.importItemIndex)];
    const item = row?.items?.[Number(itemField.dataset.itemIndex)];
    if (row && item) {
      const key = itemField.dataset.itemKey;
      item[key] = key === "name" ? itemField.value : num(itemField.value);
      row.quantity = row.items.reduce((sum, line) => sum + num(line.quantity), 0);
      row.item_name = row.items[0]?.name || "";
      row.unit_price = row.items[0]?.unit_price || 0;
    }
  }
  const field = event.target.closest("[data-import-field]");
  if (field) {
    const row = importDraft[Number(field.dataset.importIndex)];
    if (row) {
      const key = field.dataset.importField;
      row[key] = ["quantity", "unit_price", "subtotal", "vat", "discount", "total_amount"].includes(key) ? num(field.value) : field.value;
      if (key === "item_name" && row.items?.[0]) row.items[0].name = field.value;
      const card = field.closest("[data-import-card]");
      const warningBox = card?.querySelector(".validation");
      if (warningBox) {
        const errors = validateReceipt(row, [...receipts, ...importDraft.filter((_, i) => i !== Number(field.dataset.importIndex))]);
        warningBox.className = `validation ${errors.length ? "warning" : "good"}`;
        warningBox.innerHTML = errors.length
          ? `<b>ควรตรวจสอบก่อนบันทึก</b><span>${escapeHTML(errors.join(" • "))}</span><small>รายการที่ข้อมูลไม่ครบจะเก็บเป็นฉบับร่าง ไม่ถูกทิ้ง</small>`
          : `<b>ข้อมูลหลักครบแล้ว</b><span>ระบบจะตรวจสอบยอดรวมและเลขบิลซ้ำอีกครั้งเมื่อบันทึก</span>`;
      }
    }
  }
});

app.addEventListener("change", async event => {
  if (event.target.id === "status-filter") { statusFilter = event.target.value; render(); }
  else if (event.target.id === "report-period") { window.reportPeriod = event.target.value; render(); }
  else if (event.target.id === "file-input") { await handleImportFiles(event.target.files); event.target.value = ""; }
  else if (event.target.id === "restore-input") { const [file] = event.target.files; if (file) await restoreBackup(file); event.target.value = ""; }
  else if (event.target.matches("[data-import-select]")) { importDraft[Number(event.target.dataset.importSelect)]._selected = event.target.checked; }
});

app.addEventListener("submit", async event => {
  if (event.target.id !== "receipt-form") return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  const numeric = ["quantity", "unit_price", "subtotal", "vat", "discount", "total_amount"];
  for (const key of numeric) data[key] = num(data[key]);
  const id = editingId || makeId();
  const row = { ...data, id, status: "saved", cancelled: false, quantity: data.quantity, items: data.item_name || data.quantity ? [{ name: data.item_name || "น้ำมัน", quantity: data.quantity, unit_price: data.unit_price, total: data.subtotal }] : [] };
  const errors = validateReceipt(row, receipts);
  row.status = errors.length ? "draft" : "saved";
  row.import_warnings = errors;
  try {
    await saveReceipt(row); $("#receipt-dialog").close(); await refresh();
    toast(row.status === "draft" ? `บันทึกเป็นฉบับร่าง: ${errors.join(" • ")}` : "บันทึกบิลเรียบร้อย", row.status === "draft" ? "warning" : "success");
  } catch (error) { toast(`บันทึกไม่สำเร็จ: ${error.message}`, "error"); }
});

async function start() {
  try { receipts = await getAllReceipts(); }
  catch (error) { app.innerHTML = `<div class="fatal-error"><h2>เปิดฐานข้อมูลไม่ได้</h2><p>${escapeHTML(error.message)}</p><p>กรุณาเปิดโปรแกรมผ่านเบราว์เซอร์ที่รองรับ IndexedDB หรือ Electron/Capacitor</p></div>`; return; }
  render();
}

// Export selected pure functions for automated regression tests and future importer improvements.
export { fieldForHeader, parseReceiptText, validateReceipt, summarize };
start();
