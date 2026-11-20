import * as XLSX from "xlsx";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker } from "tesseract.js";
import mammoth from "mammoth";
import { makeId, normalizeDate, num, parseReceiptText, mergeInvoiceRows } from "./logic.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ALIASES = {
  receipt_id: ["receipt id", "receipt no", "receipt number", "invoice no", "invoice number", "tax invoice no", "เลขที่บิล", "เลขที่ใบเสร็จ", "เลขที่ใบเสร็จรับเงิน", "เลขที่ใบกำกับภาษี", "เลขที่เอกสาร", "เลขที่ใบกำกับ"],
  date: ["date", "invoice date", "receipt date", "transaction date", "วันที่", "วันที่ขาย", "วันที่ออกเอกสาร", "วันทำรายการ", "วันที่เติมน้ำมัน"],
  seller_name: ["seller name", "seller", "vendor", "merchant", "station", "station name", "ชื่อผู้ขาย", "ชื่อบริษัทผู้ขาย", "บริษัทผู้ขาย", "ผู้ขาย", "สถานีบริการ", "ชื่อสถานีบริการ", "ชื่อปั๊มน้ำมัน", "ชื่อปั๊ม", "ปั๊มน้ำมัน"],
  seller_tax_id: ["seller tax id", "vendor tax id", "เลขผู้เสียภาษีผู้ขาย", "เลขประจำตัวผู้เสียภาษีผู้ขาย", "เลขผู้เสียภาษีอากรผู้ขาย"],
  buyer_name: ["buyer name", "buyer", "customer", "customer name", "client", "ชื่อผู้ซื้อ", "ชื่อบริษัทผู้ซื้อ", "บริษัทผู้ซื้อ", "ผู้ซื้อ", "ชื่อลูกค้า", "บริษัทลูกค้า", "ลูกค้า", "ชื่อบริษัท/ลูกค้า", "company name"],
  buyer_tax_id: ["buyer tax id", "customer tax id", "เลขผู้เสียภาษีผู้ซื้อ", "เลขประจำตัวผู้เสียภาษีผู้ซื้อ", "เลขผู้เสียภาษีลูกค้า"],
  branch: ["branch", "สาขา", "สาขาผู้ขาย", "สาขาที่"],
  vehicle_plate: ["vehicle plate", "license plate", "car plate", "ทะเบียนรถ", "ทะเบียน", "เลขทะเบียนรถ"],
  item_name: ["item", "product", "product name", "fuel type", "รายการสินค้า", "รายการน้ำมัน", "ชนิดน้ำมัน", "ประเภทน้ำมัน", "สินค้า"],
  quantity: ["quantity", "qty", "liters", "litres", "liter", "จำนวน", "ปริมาณ", "ปริมาณน้ำมัน", "จำนวนลิตร", "ลิตร"],
  unit_price: ["unit price", "price per liter", "price/liter", "ราคาต่อหน่วย", "ราคาต่อลิตร", "ราคา/ลิตร"],
  subtotal: ["subtotal", "before vat", "net before vat", "มูลค่าสินค้า", "มูลค่าสินค้าก่อนภาษี", "ราคาก่อนภาษี", "ยอดก่อนภาษี"],
  vat: ["vat", "vat amount", "tax amount", "ภาษีมูลค่าเพิ่ม", "ภาษี"],
  discount: ["discount", "ส่วนลด", "ส่วนลดท้ายบิล"],
  total_amount: ["total amount", "grand total", "net total", "total", "ยอดสุทธิ", "ยอดรวมสุทธิ", "รวมเป็นเงินทั้งสิ้น", "รวมเป็นเงิน", "รวมเงิน", "จำนวนเงินรวม"],
  payment_method: ["payment method", "payment", "วิธีชำระเงิน", "ชำระโดย", "การชำระเงิน"]
};

const normalizeHeader = value => String(value ?? "").normalize("NFKC").toLowerCase()
  .replace(/[\s\u200b_./\\()（）\[\]{}:：#-]+/g, "").replace(/[ฯๆ]/g, "");

export function fieldForHeader(header) {
  const key = normalizeHeader(header);
  if (!key) return "";
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(alias => key === normalizeHeader(alias))) return field;
  }
  const candidates = [];
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const normalized = normalizeHeader(alias);
      if (normalized.length >= 5 && key.includes(normalized)) candidates.push({ field, length: normalized.length });
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  if (!candidates.length || (candidates[1] && candidates[0].length === candidates[1].length && candidates[0].field !== candidates[1].field)) return "";
  return candidates[0].field;
}

function findHeader(matrix) {
  let best = null;
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 40); rowIndex++) {
    const fields = (matrix[rowIndex] || []).map(fieldForHeader);
    const unique = new Set(fields.filter(Boolean));
    const score = unique.size + (unique.has("receipt_id") ? 2 : 0) + (unique.has("date") ? 2 : 0);
    if (!best || score > best.score) best = { rowIndex, fields, score, count: unique.size };
  }
  return best?.count >= 2 ? best : null;
}

function importedRow(raw, meta = {}) {
  const row = {
    id: raw.id || makeId(), receipt_id: String(raw.receipt_id ?? raw.invoice_no ?? "").trim(),
    date: normalizeDate(raw.date ?? raw.invoice_date ?? ""),
    seller_name: String(raw.seller_name ?? raw.seller ?? raw.station_name ?? "").trim(),
    seller_tax_id: String(raw.seller_tax_id ?? "").replace(/\s/g, ""),
    buyer_name: String(raw.buyer_name ?? raw.customer_name ?? raw.customer ?? "").trim(),
    buyer_tax_id: String(raw.buyer_tax_id ?? "").replace(/\s/g, ""),
    branch: String(raw.branch ?? "").trim(), vehicle_plate: String(raw.vehicle_plate ?? raw.plate ?? "").replace(/\s/g, ""),
    item_name: String(raw.item_name ?? raw.product_name ?? "").trim(),
    quantity: num(raw.quantity ?? raw.liters), unit_price: num(raw.unit_price),
    subtotal: num(raw.subtotal), vat: num(raw.vat), discount: num(raw.discount),
    total_amount: num(raw.total_amount ?? raw.total), payment_method: String(raw.payment_method ?? "").trim(),
    items: Array.isArray(raw.items) ? raw.items.map(item => ({ name: String(item.name ?? item.item_name ?? "").trim(), quantity: num(item.quantity), unit_price: num(item.unit_price), total: num(item.total) })) : [],
    status: raw.status === "cancelled" ? "cancelled" : "draft", cancelled: raw.status === "cancelled",
    confidence: raw.confidence || {}, source_text: String(raw.source_text || ""),
    source_file: meta.source_file || raw.source_file || "", source_sheet: meta.source_sheet || raw.source_sheet || "",
    source_row: meta.source_row || raw.source_row || null
  };
  if (!row.items.length && (row.item_name || row.quantity)) row.items = [{ name: row.item_name || "น้ำมัน", quantity: row.quantity, unit_price: row.unit_price, total: row.subtotal }];
  if (!row.item_name && row.items[0]) row.item_name = row.items[0].name;
  return row;
}

function rowsFromMatrix(matrix, fileName, sheetName) {
  const header = findHeader(matrix);
  if (!header) {
    const text = matrix.map(row => (row || []).map(value => String(value ?? "").trim()).filter(Boolean).join(" : ")).filter(Boolean).join("\n");
    const parsed = parseReceiptText(text);
    const hasData = parsed.receipt_id || parsed.date || parsed.seller_name || parsed.buyer_name || parsed.total_amount || parsed.quantity;
    return { rows: hasData ? [importedRow(parsed, { source_file: fileName, source_sheet: sheetName })] : [], warnings: hasData ? [`${sheetName}: อ่านข้อมูลแบบป้ายกำกับและค่า เนื่องจากไม่พบหัวตารางชัดเจน`] : [`${sheetName}: ไม่พบหัวตารางหรือข้อมูลบิลที่รู้จัก`] };
  }
  const columns = new Map();
  header.fields.forEach((field, index) => { if (field && !columns.has(field)) columns.set(field, index); });
  const rows = [];
  for (let index = header.rowIndex + 1; index < matrix.length; index++) {
    const values = matrix[index] || [];
    if (!values.some(value => String(value ?? "").trim() !== "")) continue;
    const raw = {};
    for (const [field, column] of columns) raw[field] = values[column] ?? "";
    const row = importedRow(raw, { source_file: fileName, source_sheet: sheetName, source_row: index + 1 });
    if (row.receipt_id || row.date || row.seller_name || row.buyer_name || row.total_amount || row.quantity) rows.push(row);
  }
  return { rows: mergeInvoiceRows(rows), warnings: [] };
}

async function parseSpreadsheet(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const rows = [], warnings = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: false });
    const parsed = rowsFromMatrix(matrix, file.name, sheetName);
    rows.push(...parsed.rows); warnings.push(...parsed.warnings);
  }
  return { rows, warnings, text: "" };
}

async function makeOcrWorker() {
  const worker = await createWorker("tha+eng");
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return worker;
}

async function ocrImage(worker, image) {
  const result = await worker.recognize(image);
  return result.data?.text || "";
}

async function parsePdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages = [], warnings = [];
  let worker = null;
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = content.items.map(item => item.str || "").join(" ").trim();
      if (text.replace(/\s/g, "").length < 18) {
        if (!worker) worker = await makeOcrWorker();
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: context, viewport }).promise;
        text = await ocrImage(worker, canvas);
        canvas.width = 0; canvas.height = 0;
        if (!text.trim()) warnings.push(`PDF หน้า ${number}: OCR ไม่พบข้อความที่อ่านได้`);
      }
      pages.push(`--- หน้า ${number} ---\n${text}`);
      page.cleanup();
    }
  } finally {
    if (worker) await worker.terminate();
    await pdf.destroy();
  }
  const text = pages.join("\n\n");
  const parsed = parseReceiptText(text);
  const hasData = parsed.receipt_id || parsed.date || parsed.seller_name || parsed.buyer_name || parsed.total_amount || parsed.quantity;
  return { rows: hasData ? [importedRow({ ...parsed, source_text: text }, { source_file: file.name })] : [], warnings, text };
}

async function parseImage(file) {
  const worker = await makeOcrWorker();
  try {
    const text = await ocrImage(worker, file);
    const parsed = parseReceiptText(text);
    const hasData = parsed.receipt_id || parsed.date || parsed.seller_name || parsed.buyer_name || parsed.total_amount || parsed.quantity;
    return { rows: hasData ? [importedRow({ ...parsed, source_text: text }, { source_file: file.name })] : [], warnings: text.trim() ? [] : ["OCR ไม่พบข้อความในภาพ"], text };
  } finally { await worker.terminate(); }
}

async function parseDocx(file) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = result.value || "";
  const parsed = parseReceiptText(text);
  const hasData = parsed.receipt_id || parsed.date || parsed.seller_name || parsed.buyer_name || parsed.total_amount || parsed.quantity;
  return { rows: hasData ? [importedRow({ ...parsed, source_text: text }, { source_file: file.name })] : [], warnings: result.messages.map(message => message.message), text };
}

export async function importFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (["xlsx", "xls", "csv"].includes(extension)) return parseSpreadsheet(file);
  if (extension === "json") {
    const parsed = JSON.parse(await file.text());
    const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.receipts) ? parsed.receipts : null);
    if (!records) throw new Error("ไฟล์ JSON ต้องเป็น Array หรือมี property receipts เป็น Array");
    return { rows: records.map(row => importedRow(row, { source_file: file.name })), warnings: [], text: "" };
  }
  if (extension === "pdf") return parsePdf(file);
  if (["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(extension)) return parseImage(file);
  if (extension === "docx") return parseDocx(file);
  if (extension === "doc") throw new Error("ยังไม่รองรับ Word รุ่น .doc กรุณาบันทึกเป็น .docx หรือ PDF ก่อนนำเข้า");
  throw new Error(`ไม่รองรับไฟล์ .${extension || "ไม่ทราบชนิด"}`);
}
