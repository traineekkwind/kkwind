<div align="center">
  <img src="./public/logo.png" alt="โลโก้วิทยาลัยการอาชีพวังไกลกังวล" width="120" />
  <h1>วิทยาลัยการอาชีพวังไกลกังวล</h1>
  <h3>ระบบทำข้อสอบออนไลน์และตรวจจับการทุจริตแบบเรียลไทม์</h3>
  <p><strong>Wang Klai Kangwon Industrial and Community Education College - Online Examination & Real-Time Anti-Cheating System</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Version-2.0.0-indigo.svg" alt="Version" />
    <img src="https://img.shields.io/badge/Frontend-Vanilla_JS_%2B_TailwindCSS-blue.svg" alt="Frontend" />
    <img src="https://img.shields.io/badge/Backend-Supabase_PostgreSQL-emerald.svg" alt="Backend" />
    <img src="https://img.shields.io/badge/Realtime-Multi--Channel_Sync-orange.svg" alt="Realtime" />
    <img src="https://img.shields.io/badge/Security-Anti--Cheat_%26_Lockdown-red.svg" alt="Security" />
  </p>
</div>

---

## 📖 สรุปภาพรวมของระบบ (Project Overview)

ระบบสอบออนไลน์พัฒนาขึ้นเพื่อการใช้งานในสถานศึกษาอาชีวศึกษา รองรับโครงสร้างระดับชั้น (ปวช.1 – ปวส.2), 7 แผนกวิชาช่างและพาณิชยกรรม, และห้องเรียน 1–2 พร้อมระบบป้องกันและตรวจจับพฤติกรรมการทุจริตแบบเรียลไทม์ (Live Anti-Cheating Telemetry) เชื่อมต่อแบบ Offline-First ทำงานได้ทั้งแบบมีหรือไม่มีอินเทอร์เน็ต และซิงก์ข้อมูลอัตโนมัติ 0 ms โดยไม่ต้องกดรีเฟรชหน้าจอ

---

## ✨ ฟีเจอร์หลัก (Key Features)

### 1. 👨‍🎓 ระบบสำหรับนักเรียน (Student Portal)
- **เข้าสู่ระบบด้วยรหัสนักเรียน & เลขบัตรประชาชน 13 หลัก**: ตรวจสอบกับทะเบียนรายชื่อนักเรียน พร้อมดึงระดับชั้น แผนกวิชา และห้องเรียนอัตโนมัติ
- **ห้องเลือกข้อสอบเฉพาะบุคคล (Targeted Lobby)**: กรองแสดงเฉพาะชุดข้อสอบที่อาจารย์เปิดให้ระดับชั้นและห้องเรียนของตนเองเข้าสอบ
- **🔀 ระบบสุ่มสลับข้อสอบ & สลับตัวเลือกเฉพาะบุคคล (Shuffle Engine)**: สุ่มสลับลำดับคำถามและตัวเลือก ก, ข, ค, ง ให้แต่ละคนไม่เหมือนกัน ป้องกันการชะโงกลอกข้อสอบ 100%
- **💾 ระบบบันทึกคำตอบสดอัตโนมัติ (Real-Time Auto-Save & Resume)**: บันทึกคำตอบทุกข้อที่คลิกเลือก หากเกิดไฟดับ/เน็ตหลุด สามารถเปิดเครื่องกลับมาทำต่อได้ทันทีโดยคำตอบเดิมไม่สูญหาย
- **🚫 ระบบล็อกความปลอดภัยห้องสอบ (Exam Lockdown)**: 
  - ปิดการคลิกขวา (Disable Right-Click)
  - ปิดการคัดลอก/ตัด/วาง (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`)
  - ปิดปุ่มลัด DevTools / ซอร์สโค้ด / ปริ้นท์ (`F12`, `Ctrl+Shift+I`, `Ctrl+U`, `Ctrl+P`, `Ctrl+S`)
  - ล็อกการลากคลุมดำข้อความ (`user-select: none`)

### 2. 👩‍🏫 ระบบสำหรับอาจารย์ (Teacher Portal)
- **👥 จัดการรายชื่อนักเรียน (Student Roster Management)**:
  - เพิ่ม แก้ไข และลบรายชื่อนักเรียน พร้อมกำหนดเลขบัตร ปชช. 13 หลักเป็นรหัสผ่าน
  - **📥 นำเข้ารายชื่อนักเรียนจาก Excel (Bulk Import)**: เพิ่มนักเรียนทั้งห้อง/ทั้งแผนกในคลิกเดียว พร้อมพรีวิวก่อนบันทึก
  - **📄 ดาวน์โหลดเทมเพลต Excel**: โครงสร้างตารางมาตรฐานสำหรับกรอกข้อมูล
- **📚 จัดการรายวิชา & สร้างชุดข้อสอบ (Exam Creator)**:
  - กำหนดเวลาสอบ, เกณฑ์จำกัดจำนวนครั้งการสลับหน้าจอ (Max Tab Switches)
  - กำหนดกลุ่มเป้าหมายนักเรียนที่สอบได้ (ระดับชั้น, แผนกวิชา, ห้องเรียน)
- **📥 นำเข้าโจทย์ข้อสอบจาก Excel (Excel Question Importer)**: นำเข้าโจทย์ ตัวเลือก เฉลย และคำอธิบายผ่าน `.xlsx`
- **📊 ตรวจสอบผลคะแนน & พฤติกรรมการสอบ (Submissions & Cheat Audit)**:
  - ดูคะแนนสอบ คะแนนเฉลี่ย และสถิติการสลับหน้าจอของนักเรียนแต่ละคน
  - ตรวจดูคำตอบรายข้อของนักเรียน
  - **📤 ส่งออกรายงานผลคะแนนเป็น Excel (.xlsx)**

### 3. 🚨 ระบบตรวจจับและแจ้งเตือนการทุจริตเรียลไทม์ (Live Anti-Cheating Feed)
- ตรวจจับการสลับแท็บเบราว์เซอร์, การย่อหน้าต่าง, การเปิดโปรแกรมอื่น, การออกจากโหมดเต็มหน้าจอ และโหมดแบ่งหน้าจอ (Split-Screen)
- **แจ้งเตือนสดขึ้นจออาจารย์ทันทีพร้อมเสียงเตือน (Chime Sound & Warning Toast)** โดยไม่ต้องกดรีเฟรช
- มีระบบตัดคะแนนหรือ Flag ติดสถานะตรวจสอบการทุจริตอัตโนมัติหากเกินเกณฑ์ที่กำหนด

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

| ส่วนของระบบ | เทคโนโลยีที่ใช้ |
| :--- | :--- |
| **Frontend UI** | HTML5, Tailwind CSS, Font Awesome 6, Prompt Font |
| **Logic & State** | Vanilla JavaScript (ES6+), Multi-Channel Auto-Sync Engine |
| **Real-Time Engine** | `BroadcastChannel` API + `localStorage` Signal Sync + Supabase WebSocket |
| **Excel Processing** | SheetJS (`xlsx.full.min.js`) Client-side Parser & Generator |
| **Backend & Database** | Supabase (PostgreSQL, Row Level Security, RPC Stored Procedures) |
| **Offline Fallback** | Local-First Storage Cache Layer with Conflict-Free Deduplication |

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── index.html                  # หน้าเว็บหลัก Single Page Application (รวมทุก View & Modal)
├── public/
│   ├── app.js                  # ตัวควบคุม Logic, State, Anti-Cheat, Auto-Save, Roster & Sync
│   ├── styles.css              # สไตล์ CSS, Animations และการล็อกความปลอดภัย
│   └── logo.png                # ตราสัญลักษณ์ทางการวิทยาลัยการอาชีพวังไกลกังวล
├── supabase/
│   ├── schema.sql              # สคริปต์ SQL สร้างตาราง, RLS Policy และ Stored Procedure
│   └── functions/              # Supabase Edge Functions สำหรับ Server-Side Grading
├── .gitignore                  # รายการไฟล์ที่ไม่นำขึ้น Git
└── README.md                   # เอกสารคู่มือโครงการ
```

---

## 🚀 วิธีการติดตั้งและการนำไปใช้งาน (Deployment)

### 1. ใช้งานแบบ Client-Side Standalone (ไม่ต้องติดตั้งเซิร์ฟเวอร์)
1. ดาวน์โหลดหรือ Clone repository นี้
2. เปิดไฟล์ `index.html` บนเบราว์เซอร์ (Chrome / Edge / Firefox / Safari) หรือเปิดผ่าน Live Server ใน VS Code
3. ระบบจะทำงานในโหมด **Offline-First Storage** ทันที สามารถเพิ่มรายวิชา สร้างข้อสอบ จัดการนักเรียน และสอบได้ทันที

### 2. เชื่อมต่อฐานข้อมูล Supabase Cloud (ทางเลือกสำหรับ Production)
1. สมัครใช้งานและสร้างโปรเจกต์ใหม่ที่ [Supabase](https://supabase.com)
2. ไปที่เมนู **SQL Editor** -> นำโค้ดในไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ไปวางแล้วกด **Run**
3. เข้าสู่ระบบในหน้าเว็บด้วยบทบาท **แอดมิน (Admin)** -> กรอก `Supabase URL` และ `Anon Key` แล้วกดบันทึก

### 3. Deploy ขึ้น Web Hosting ฟรี
สามารถนำโปรเจกต์นี้ขึ้น GitHub และเชื่อมต่อ Deploy ได้ทันทีบน:
- **GitHub Pages**
- **Vercel**
- **Netlify**
- **Cloudflare Pages**

---

<div align="center">
  <p>© 2026 วิทยาลัยการอาชีพวังไกลกังวล. All Rights Reserved.</p>
</div>
