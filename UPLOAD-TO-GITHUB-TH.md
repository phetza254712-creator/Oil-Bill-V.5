# วิธีนำชุดโปรแกรม Oil Bill V5 ขึ้น GitHub

1. ดาวน์โหลดและแตกไฟล์ `Oil-Bill-V5-Source.zip` ลงในอุปกรณ์หรือคอมพิวเตอร์
2. เปิด Repository `https://github.com/phetza254712-creator/Oil-Bill-v.5`
3. เข้าแท็บ Code แล้วเลือก Add file → Upload files
4. อัปโหลด **เนื้อหาทั้งหมดภายในโฟลเดอร์ Oil-Bill-V5** ไปที่ราก Repository โดยต้องเห็น `package.json`, `index.html`, `src/` และ `.github/workflows/` อยู่ระดับบนสุด ไม่ใช่อัปโหลด ZIP เป็นไฟล์เดียว
5. เมื่อ GitHub แจ้งไฟล์ซ้ำ ให้เลือกแทนที่ไฟล์เดิมสำหรับ `README-TH.md` และ `package.json` (ไฟล์อื่นที่ซ้ำให้ตรวจสอบว่าเป็นรุ่นใหม่ในชุดนี้)
6. ลบไฟล์แพตช์เก่าของ V3 ที่ไม่ใช้แล้วออกจากราก Repository: `apply-update.mjs`, `importers.js`, `logic.js`, `logic.test.js`, `importers.test.js`, `logic.selftest.mjs`, `main-import-functions.txt` และ `style-additions.css`
7. Commit changes ไปยัง branch `main`
8. เปิดแท็บ Actions แล้วเลือก workflow `Oil Bill V5 - Build and Test`
9. เมื่อทั้ง Windows และ Android jobs สำเร็จ ให้เปิด run นั้นแล้วดาวน์โหลด artifacts:
   - `Oil-Bill-V5-Windows` — installer และ portable EXE
   - `Oil-Bill-V5-Android-APK` — debug APK

ห้ามอัปโหลดโฟลเดอร์ `node_modules`, `dist`, `release` หรือ `android` ที่เครื่องเดิมสร้างไว้ ให้ Actions สร้างใหม่เอง
