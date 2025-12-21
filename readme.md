
# ⚖️ Legal Case & Calendar Sync System (Hybrid Edition)

ระบบจัดการและซิงค์ข้อมูลนัดหมายคดีความจากระบบงานคดี (Internal API) ไปยัง **Google Calendar** แบบอัตโนมัติ พร้อมหน้าเว็บ Frontend ทันสมัย และระบบ **Admin Panel** สำหรับควบคุมการทำงาน

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Node.js](https://img.shields.io/badge/Node.js-v14+-green)
![Express](https://img.shields.io/badge/Express-EJS-blue)
![Security](https://img.shields.io/badge/Auth-Cookie%20%26%20OAuth2-red)

## ✨ ฟีเจอร์เด่น (Key Features)

### 🚀 Hybrid Configuration
* **Performance:** ตั้งค่าการเชื่อมต่อระบบคดี (API URL, User, Pass) ผ่าน **`.env`** เพื่อความรวดเร็ว
* **Flexibility:** จัดการ Token Telegram และ URL หน้าเว็บผ่าน **Google Sheets** เพื่อความยืดหยุ่น
* **Whitelist:** จัดการสิทธิ์ผู้เข้าใช้งานผ่าน Google Sheets (ไม่ต้องแก้โค้ด)

### 🛡️ Admin Control Panel
* **Secure Access:** ระบบล็อกอิน 2 ชั้น (Google OAuth + Signed Cookies) ป้องกันการเข้าถึงหน้า Admin
* **Manual Sync:** ปุ่มสั่งซิงค์ข้อมูลย้อนหลัง/ล่วงหน้า (1, 7, 30, 60 วัน) ได้ทันที
* **Notification Trigger:** ปุ่มสั่งส่งแจ้งเตือน "คดีวันนี้" เข้า Telegram แบบ Manual

### 📅 Calendar & Notification
* **Auto Sync:** ดึงข้อมูลคดีลง Google Calendar พร้อมตรวจสอบข้อมูลซ้ำ
* **Daily Summary:** สร้าง Event แบบ All-day สรุปยอดคดีในแต่ละวัน
* **Telegram Alert:** แจ้งเตือนรายการนัดพิจารณาประจำวัน (แยกกลุ่ม User และ Admin ได้)

---

## 🛠️ การตั้งค่า (Configuration)

ระบบนี้ใช้การตั้งค่าผสมระหว่าง **ไฟล์ .env** และ **Google Sheets**

### 1. ไฟล์ `.env` (สำหรับการตั้งค่าหลักและความปลอดภัย)
สร้างไฟล์ `.env` ที่ root folder และใส่ค่าดังนี้:

```env
# --- Server Config ---
PORT=3000
APP_URL=http://localhost:3000
COOKIE_SECRET=your_super_secret_key_change_me

# --- Google Cloud Service Account ---
GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CALENDAR_ID=xxxxxxxxxxx@group.calendar.google.com
GOOGLE_SHEET_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_CREDENTIALS={"type":"service_account", ... (JSON ทั้งก้อน) ...}

# --- Case System API (Core Config) ---
API_URL=http://localhost:8089
API_USER=your_api_username
API_PASS=your_api_password
TOKEN= (ใส่ค่าเริ่มต้นหรือเว้นว่างไว้ ระบบจะขอใหม่เอง)

```

### 2. Google Sheets (สำหรับการตั้งค่าที่เปลี่ยนบ่อย)

ต้องมี 3 แผ่นงาน (Tabs) ดังนี้:

#### แผ่นงาน: `Config`

| A (Key) | B (Value) | คำอธิบาย |
| --- | --- | --- |
| **TELEGRAM_TOKEN** | `123456:ABC...` | Token บอทแจ้งเตือน User ทั่วไป |
| **CHAT_ID** | `-100xxxx` | Chat ID กลุ่ม User |
| **TELEGRAM_TOKEN_ADMIN** | `654321:XYZ...` | Token บอทแจ้งเตือน Admin (Logs) |
| **CHAT_ID_ADMIN** | `-100yyyy` | Chat ID กลุ่ม Admin |
| **APP_URL** | `https://my-app.onrender.com` | URL เว็บจริง (Server) |
| **APP_URL_LOCAL** | `http://localhost:3000` | URL เครื่อง Local |

#### แผ่นงาน: `Users` (Whitelist)

| A | B |
| --- | --- |
| **Email** | **Name** |
| `admin@court.go.th` | ผู้ดูแลระบบ |
| `staff@gmail.com` | เจ้าหน้าที่ |

#### แผ่นงาน: `Logs`

| A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- |
| **Event ID** | **Action** | **User** | **Summary** | **Start** | **End** | **Timestamp** |

---

## 🚀 การติดตั้งและใช้งาน

1. **ติดตั้ง Libraries**
```bash
npm install

```


2. **รัน Server**
```bash
npm start
# หรือ
node app.js

```


3. **เข้าใช้งาน**
* เปิด Browser ไปที่ `http://localhost:3000`
* Login ด้วย Google Account (อีเมลต้องตรงกับใน Sheet `Users`)


4. **เข้าหน้า Admin**
* หลังจาก Login แล้ว กดปุ่ม **Admin** บนเมนูบาร์
* หรือเข้าผ่าน `http://localhost:3000/admin`
* *(หมายเหตุ: ต้อง Login ก่อนเท่านั้น ถึงจะเข้าได้)*


---

## 🔗 API Endpoints

| Method | Endpoint | รายละเอียด | Auth |
| --- | --- | --- | --- |
| **GET** | `/` | หน้า Dashboard หลัก | - |
| **GET** | `/admin` | หน้า Control Panel | **Cookie** |
| **GET** | `/events` | ดึงข้อมูลปฏิทิน | - |
| **POST** | `/api/google-login` | ล็อกอินและรับ Cookie | - |
| **GET** | `/sync-cases/:days` | สั่ง Sync ข้อมูล (ระบุจำนวนวัน) | **Token** |
| **GET** | `/casetoday` | สั่งส่งแจ้งเตือน Telegram | **Token** |

---

## 📦 Tech Stack

* **Backend:** Node.js, Express, Axios, Cookie-Parser
* **Frontend:** EJS, Bootstrap 5, SweetAlert2
* **Database:** Google Sheets (as Config Store & Logger)
* **Auth:** Google OAuth 2.0 + Signed Cookies

---

Developed for Internal Use.
