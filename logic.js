export const money = value => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

export function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const thai = String(value ?? "").replace(/[๐-๙]/g, digit => "๐๑๒๓๔๕๖๗๘๙".indexOf(digit));
  const normalized = thai.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const makeId = () => globalThis.crypto?.randomUUID?.()
  || `ob-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function normalizeDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && value > 20000 && value < 90000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  let source = String(value).trim().replace(/[๐-๙]/g, d => "๐๑๒๓๔๕๖๗๘๙".indexOf(d));
  const thaiMonths = { "ม.ค.": "01", "มกราคม": "01", "ก.พ.": "02", "กุมภาพันธ์": "02", "มี.ค.": "03", "มีนาคม": "03", "เม.ย.": "04", "เมษายน": "04", "พ.ค.": "05", "พฤษภาคม": "05", "มิ.ย.": "06", "มิถุนายน": "06", "ก.ค.": "07", "กรกฎาคม": "07", "ส.ค.": "08", "สิงหาคม": "08", "ก.ย.": "09", "กันยายน": "09", "ต.ค.": "10", "ตุลาคม": "10", "พ.ย.": "11", "พฤศจิกายน": "11", "ธ.ค.": "12", "ธันวาคม": "12" };
  for (const [monthName, monthNumber] of Object.entries(thaiMonths)) {
    const thaiDate = source.match(new RegExp(`(\\d{1,2})\\s*${monthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d{2,4})`, "i"));
    if (thaiDate) { source = `${thaiDate[1]}/${monthNumber}/${thaiDate[2]}`; break; }
  }
  const compactDate = source.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    let year = Number(compactDate[1]); if (year > 2400) year -= 543;
    const month = Number(compactDate[2]), day = Number(compactDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  let match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year > 2400) year -= 543;
    if (year < 100) year += 2000;
    const month = Number(match[2]), day = Number(match[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  match = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    let year = Number(match[1]);
    if (year > 2400) year -= 543;
    const month = Number(match[2]), day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

const getLineValue = (lines, pattern) => {
  const line = lines.find(item => pattern.test(item));
  if (!line) return "";
  const cleaned = line.replace(pattern, "").replace(/^\s*[:：#-]?\s*/, "").trim();
  return cleaned;
};
const getAmount = (lines, pattern) => {
  const line = lines.find(item => pattern.test(item));
  if (!line) return 0;
  const matches = [...line.matchAll(/-?\d[\d,]*(?:\.\d{1,2})?/g)];
  return matches.length ? num(matches.at(-1)[0]) : 0;
};

export function parseReceiptText(input) {
  const text = String(input || "")
    .replace(/\r/g, "\n")
    .replace(/[๐-๙]/g, digit => "๐๑๒๓๔๕๖๗๘๙".indexOf(digit));
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const joined = lines.join("\n");
  const receiptMatch = joined.match(/(?:เลขที่\s*(?:บิล|ใบเสร็จ(?:รับเงิน)?|ใบกำกับ(?:ภาษี)?)?|receipt\s*(?:no|number)|invoice\s*(?:no|number))\s*[:：#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i);
  const dateLine = lines.find(line => /วันที่|date/i.test(line)) || "";
  const dateMatch = dateLine.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/);
  let seller = getLineValue(lines, /^(?:ชื่อผู้ขาย|ผู้ขาย|สถานีบริการ|ชื่อสถานีบริการ|บริษัทผู้ขาย)\s*[:：]?/i);
  let buyer = getLineValue(lines, /^(?:ชื่อผู้ซื้อ|ผู้ซื้อ|ลูกค้า|บริษัทลูกค้า|customer|buyer)\s*[:：]?/i);
  const buyerMarker = lines.findIndex(line => /ข้อมูลผู้ซื้อ|ผู้ซื้อ|ลูกค้า|customer|buyer/i.test(line));
  const companyCandidates = lines.filter(line => line.length >= 5 && line.length <= 100 &&
    /(?:บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|หจก\.?|co\.?\s*,?\s*ltd|company|limited)/i.test(line) &&
    !/(?:ใบกำกับ|ใบเสร็จ|ใบแจ้งหนี้|เลขที่|วันที่|เวลา|โทรศัพท์|ที่อยู่|สำนักงานใหญ่|สาขาที่|tax id|vat)/i.test(line) &&
    !/\d{6,}/.test(line));
  if (!seller && companyCandidates.length) seller = companyCandidates.find(line => buyerMarker < 0 || lines.indexOf(line) < buyerMarker) || companyCandidates[0];
  if (!buyer && buyerMarker >= 0) buyer = companyCandidates.find(line => lines.indexOf(line) > buyerMarker && line !== seller) || "";
  const quantityMatches = [...joined.matchAll(/([\d,]+(?:\.\d{1,3})?)\s*(?:ลิตร|liters?|litres?|ltr)/gi)];
  const items = quantityMatches.map(match => {
    const lineStart = joined.lastIndexOf("\n", match.index) + 1;
    const lineEndRaw = joined.indexOf("\n", match.index);
    const lineEnd = lineEndRaw < 0 ? joined.length : lineEndRaw;
    const line = joined.slice(lineStart, lineEnd);
    const qty = num(match[1]);
    const before = line.slice(0, match.index - lineStart).replace(/^[\d.\s-]+/, "").trim();
    const numbers = [...line.matchAll(/[\d,]+(?:\.\d{1,2})?/g)].map(x => num(x[0]));
    return { name: before || "น้ำมัน", quantity: qty, unit_price: numbers.length > 1 ? numbers[1] : 0, total: numbers.length > 1 ? numbers.at(-1) : 0 };
  });
  const subtotal = getAmount(lines, /มูลค่าสินค้า|ราคาก่อนภาษี|ยอดก่อนภาษี|subtotal/i);
  const vat = getAmount(lines, /ภาษีมูลค่าเพิ่ม|\bvat\b/i);
  const discount = getAmount(lines, /ส่วนลด|discount/i);
  const total = getAmount(lines, /ยอดสุทธิ|รวมเงินทั้งสิ้น|รวมเป็นเงิน|grand\s*total|total\s*amount|\btotal\b/i);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const taxIds = [...joined.matchAll(/(?:เลขประจำตัวผู้เสียภาษี|เลขผู้เสียภาษี|tax\s*id)\s*[:：]?\s*(\d{13})/gi)].map(match => match[1]);
  const plateMatch = joined.match(/(?:ทะเบียนรถ|ทะเบียน|vehicle\s*plate)\s*[:：]?\s*([ก-๙]{1,3}\s*\d{1,4}(?:\s*[ก-๙]{0,2})?)/i);
  return {
    receipt_id: receiptMatch?.[1] || "",
    date: normalizeDate(dateMatch?.[1] || ""),
    seller_name: seller,
    seller_tax_id: taxIds[0] || "",
    buyer_name: buyer,
    buyer_tax_id: taxIds[1] || "",
    vehicle_plate: plateMatch?.[1]?.replace(/\s/g, "") || "",
    item_name: items[0]?.name || "",
    items,
    quantity,
    unit_price: items.length === 1 ? items[0].unit_price : (quantity && subtotal ? subtotal / quantity : 0),
    subtotal,
    vat,
    discount,
    total_amount: total,
    payment_method: getLineValue(lines, /^(?:วิธีชำระเงิน|ชำระโดย|payment\s*method)\s*[:：]?/i),
    source_text: text
  };
}

export function validateReceipt(row, existing = []) {
  const errors = [];
  if (!String(row.receipt_id || "").trim()) errors.push("ไม่พบเลขที่บิล");
  if (!normalizeDate(row.date)) errors.push("ไม่พบวันที่หรือรูปแบบวันที่ไม่ถูกต้อง");
  if (!String(row.seller_name || "").trim()) errors.push("ไม่พบชื่อผู้ขาย");
  if (!String(row.buyer_name || "").trim()) errors.push("ไม่พบชื่อผู้ซื้อ/ลูกค้า");
  if (!(Number(row.total_amount) > 0)) errors.push("ไม่พบยอดสุทธิ");
  if (row.receipt_id && row.seller_name && existing.some(item =>
    item.id !== row.id && item.status !== "cancelled" &&
    String(item.receipt_id).trim().toLowerCase() === String(row.receipt_id).trim().toLowerCase() &&
    String(item.seller_name).trim().toLowerCase() === String(row.seller_name).trim().toLowerCase())) {
    errors.push("พบเลขที่บิลซ้ำของผู้ขายรายเดียวกัน");
  }
  const subtotal = Number(row.subtotal) || 0;
  const vat = Number(row.vat) || 0;
  const discount = Number(row.discount) || 0;
  const total = Number(row.total_amount) || 0;
  if (total > 0 && subtotal > 0 && Math.abs(subtotal + vat - discount - total) > 1.01) {
    errors.push("ยอดสุทธิไม่ตรงกับมูลค่าก่อนภาษี + VAT - ส่วนลด");
  }
  for (const item of row.items || []) {
    if (Number(item.quantity) < 0 || Number(item.unit_price) < 0 || Number(item.total) < 0) {
      errors.push("พบจำนวนหรือราคาติดลบในรายการสินค้า"); break;
    }
  }
  return errors;
}

export function summarize(rows, period = "month") {
  const valid = rows.filter(row => row.status !== "draft" && row.status !== "cancelled");
  const bucket = date => {
    if (period === "day") return date;
    if (period === "year") return date.slice(0, 4);
    return date.slice(0, 7);
  };
  const groups = new Map();
  for (const row of valid) {
    const key = row.date ? bucket(row.date) : "ไม่ระบุวันที่";
    const current = groups.get(key) || { period: key, count: 0, total: 0, liters: 0 };
    current.count += 1;
    current.total += Number(row.total_amount) || 0;
    current.liters += Number(row.quantity) || 0;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function mergeInvoiceRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.receipt_id && row.seller_name
      ? [row.receipt_id.trim().toLowerCase(), row.seller_name.trim().toLowerCase(), row.date || ""].join("|")
      : `${row.id || Math.random()}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ...row, items: [...(row.items || [])] });
      continue;
    }
    const first = grouped.get(key);
    const additions = row.items?.length ? row.items : (row.item_name || row.quantity ? [{ name: row.item_name || "สินค้า", quantity: row.quantity || 0, unit_price: row.unit_price || 0, total: row.subtotal || 0 }] : []);
    for (const item of additions) {
      const signature = [item.name, item.quantity, item.unit_price, item.total].join("|");
      if (!first.items.some(current => [current.name, current.quantity, current.unit_price, current.total].join("|") === signature)) first.items.push(item);
    }
    first.quantity = first.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    for (const keyName of ["subtotal", "vat", "discount", "total_amount"]) {
      if (!(Number(first[keyName]) > 0) && Number(row[keyName]) > 0) first[keyName] = Number(row[keyName]);
    }
    for (const keyName of ["buyer_name", "buyer_tax_id", "vehicle_plate", "payment_method"]) {
      if (!first[keyName] && row[keyName]) first[keyName] = row[keyName];
    }
  }
  return [...grouped.values()];
}
