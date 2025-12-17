```markdown
# 📅 Google Calendar & Sheets Integration Service
```

โปรเจ็กต์นี้เป็น Web Application สำหรับจัดการนัดหมายบน **Google Calendar** (สร้าง, ดู, แก้ไข, ลบ) โดยมีการบันทึกประวัติการทำรายการ (Activity Log) ลงใน **Google Sheets** โดยอัตโนมัติ มาพร้อมกับหน้า Frontend ที่ทันสมัยและใช้งานง่าย

![Project Status](https://img.shields.io/badge/Status-Completed-success)
![Node.js](https://img.shields.io/badge/Node.js-v14+-green)
![Express](https://img.shields.io/badge/Express-4.x-blue)

## ✨ ฟีเจอร์หลัก (Features)

* **CRUD Operation:** สร้าง, อ่าน, แก้ไข และลบนัดหมายใน Google Calendar
* **Smart Date Handling:** รองรับทั้งแบบระบุเวลา (Timed) และตลอดทั้งวัน (All-day) โดยจัดการ Timezone และวันที่ให้อัตโนมัติ
* **Activity Logging:** บันทึกทุกการกระทำ (Create/Update/Delete) ลง Google Sheets เพื่อเป็น Audit Log
* **Modern UI:** หน้าเว็บสวยงามสไตล์ Glassmorphism, มี Loading State, และปุ่ม Toggle ที่ใช้งานง่าย
* **Security:** เชื่อมต่อผ่าน Google Service Account

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

* **Backend:** Node.js, Express.js
* **Google APIs:** Google Calendar API v3, Google Sheets API v4
* **Frontend:** HTML5, Bootstrap 5, Vanilla JavaScript (Single Page)
* **Libraries:** `googleapis`, `cors`, `body-parser`, `sweetalert2`

## ⚙️ การติดตั้ง (Installation)

1.  **Clone โปรเจ็กต์**
    ```bash
    git clone https://github.com/e29ckg/calendar-api-service.git
    cd calendar-api-service
    ```

2.  **ติดตั้ง Dependencies**
    ```bash
    npm install
    ```

3.  **ตั้งค่า Google Cloud Platform (GCP)**
    * สร้าง Project ใหม่ใน GCP Console
    * เปิดใช้งาน API: **Google Calendar API** และ **Google Sheets API**
    * สร้าง **Service Account** และดาวน์โหลดไฟล์ Key มา ตั้งชื่อว่า `service-account-key.json`
    * นำไฟล์ `service-account-key.json` มาวางไว้ในโฟลเดอร์ราก (Root) ของโปรเจ็กต์

4.  **ตั้งค่าสิทธิ์ (Permission Configuration)**
    * เปิดไฟล์ JSON Key ดูอีเมลในช่อง `client_email`
    * **Google Calendar:** แชร์ปฏิทินให้เมลนั้น พร้อมสิทธิ์ *"Make changes to events"*
    * **Google Sheets:** แชร์ไฟล์ Sheet ให้เมลนั้น พร้อมสิทธิ์ *"Editor"*

5.  **ตั้งค่า Config ในโค้ด**
    เปิดไฟล์ `app.js` และแก้ไขค่าตัวแปร:
    ```javascript
    const CALENDAR_ID = 'your_calendar_id@group.calendar.google.com';
    const SPREADSHEET_ID = 'your_spreadsheet_id';
    ```

## 🚀 การรันโปรแกรม (Usage)

1.  **Start Server**
    ```bash
    node app.js
    ```
    *Server จะรันที่: http://localhost:3000*

2.  **เปิดใช้งาน**
    * เปิดไฟล์ `index.html` ใน Browser

## 📝 รูปแบบข้อมูล Log ใน Google Sheets

โปรดสร้าง Header ใน Google Sheets แถวที่ 1 ดังนี้:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| **Event ID** | **Action** | **Summary** | **Start** | **End** | **Timestamp** |

## 📂 โครงสร้างไฟล์ (File Structure)

```text
├── service-account-key.json  # (ห้าม Upload ขึ้น Git!) ไฟล์กุญแจลับ
├── app.js                    # Backend Server Logic
├── index.html                # Frontend UI
├── package.json              # Dependencies list
└── README.md                 # Documentation

```

## ⚠️ ข้อควรระวัง

ไฟล์ `service-account-key.json` เป็นความลับ **ห้าม** Upload ขึ้น GitHub หรือ Public Repository เด็ดขาด

---

Developed by E29ckg


