import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, num, parseReceiptText, summarize, validateReceipt, mergeInvoiceRows } from "../src/logic.js";

test("normalizes Thai Buddhist dates and numeric dates", () => {
  assert.equal(normalizeDate("1/2/2569"), "2026-02-01");
  assert.equal(normalizeDate("2026-11-20"), "2026-11-20");
  assert.equal(normalizeDate("20 พ.ย. 2569"), "2026-11-20");
  assert.equal(normalizeDate("20261120"), "2026-11-20");
  assert.equal(normalizeDate("๑๕/๐๓/๒๕๖๘"), "2025-03-15");
});

test("parses Thai digits and formatted numbers", () => {
  assert.equal(num("๑,๒๓๔.๕๐ บาท"), 1234.5);
  assert.equal(num("not-a-number"), 0);
});

test("extracts common bill fields from labelled OCR text", () => {
  const parsed = parseReceiptText(`เลขที่ใบเสร็จ: INV-2026-001\nวันที่: 20/11/2569\nชื่อผู้ขาย: บริษัท ปั๊มน้ำมัน จำกัด\nชื่อผู้ซื้อ: บริษัท ลูกค้าทดสอบ จำกัด\nทะเบียนรถ: กข 1234\nดีเซล 100 ลิตร 32.50 3,250.00\nมูลค่าสินค้า 3,250.00\nภาษีมูลค่าเพิ่ม 227.50\nยอดสุทธิ 3,477.50`);
  assert.equal(parsed.receipt_id, "INV-2026-001");
  assert.equal(parsed.date, "2026-11-20");
  assert.match(parsed.seller_name, /ปั๊มน้ำมัน/);
  assert.match(parsed.buyer_name, /ลูกค้าทดสอบ/);
  assert.equal(parsed.quantity, 100);
  assert.equal(parsed.vat, 227.5);
  assert.equal(parsed.total_amount, 3477.5);
});

test("validation reports incomplete and duplicate records and math mismatches", () => {
  const row = { id: "a", receipt_id: "R-1", date: "2026-11-20", seller_name: "Seller", buyer_name: "Buyer", subtotal: 100, vat: 7, discount: 0, total_amount: 110 };
  assert.ok(validateReceipt(row).some(message => message.includes("ยอดสุทธิ")));
  const duplicate = { ...row, id: "b", total_amount: 107 };
  assert.ok(validateReceipt(duplicate, [row]).some(message => message.includes("ซ้ำ")));
  assert.deepEqual(validateReceipt({ ...row, total_amount: 107 }), []);
});

test("summaries exclude drafts and cancelled entries", () => {
  const rows = [
    { date: "2026-11-01", total_amount: 100, quantity: 10, status: "saved" },
    { date: "2026-11-02", total_amount: 200, quantity: 20, status: "saved" },
    { date: "2026-11-03", total_amount: 900, quantity: 90, status: "draft" },
    { date: "2026-11-04", total_amount: 800, quantity: 80, status: "cancelled" }
  ];
  assert.deepEqual(summarize(rows, "month"), [{ period: "2026-11", count: 2, total: 300, liters: 30 }]);
});

test("merges repeated invoice rows into line items without adding totals twice", () => {
  const rows = [
    { id: "1", receipt_id: "R-2", date: "2026-11-01", seller_name: "Seller", quantity: 10, item_name: "Diesel", unit_price: 30, subtotal: 300, vat: 21, total_amount: 321, items: [{ name: "Diesel", quantity: 10, unit_price: 30, total: 300 }] },
    { id: "2", receipt_id: "R-2", date: "2026-11-01", seller_name: "Seller", quantity: 5, item_name: "Gasohol", unit_price: 35, items: [{ name: "Gasohol", quantity: 5, unit_price: 35, total: 175 }] }
  ];
  const merged = mergeInvoiceRows(rows);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].items.length, 2);
  assert.equal(merged[0].quantity, 15);
  assert.equal(merged[0].total_amount, 321);
});
