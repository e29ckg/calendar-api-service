const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- การตั้งค่า Configuration ---
const KEY_FILE_PATH = 'service-account-key.json'; // ชื่อไฟล์ Key ของคุณ
const CALENDAR_ID = '0c71548cee9e8047655bc9c08bac3b5cb0a3f746051d1935700261d622062933@group.calendar.google.com'; 
const SPREADSHEET_ID = '1-0DlVp0PM-OjkrnMiuPR8atSolaN18icJBdf-E9_cBw';
const SCOPES = ['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/spreadsheets'];

// --- เชื่อมต่อ Google Auth ---
const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// ==========================================
// 1. ดึงข้อมูล (รายวัน/รายเดือน)
// GET /events?startDate=2023-10-01&endDate=2023-10-31
// ==========================================
app.get('/events', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // ถ้าไม่ส่งวันที่มา ให้ Default เป็นวันนี้
        const timeMin = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
        const timeMax = endDate ? new Date(endDate).toISOString() : undefined;

        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin,
            timeMax: timeMax, // ถ้าไม่ใส่ timeMax จะดึงตั้งแต่วันนี้ไปเรื่อยๆ
            singleEvents: true,
            orderBy: 'startTime',
        });

        res.json({
            message: 'ดึงข้อมูลสำเร็จ',
            count: response.data.items.length,
            events: response.data.items
        });

    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลได้' });
    }
});

// ==========================================
// 2. สร้างนัดหมายใหม่
// POST /events
// Body: { "summary": "Meeting", "description": "Details", "start": "...", "end": "..." }
// ==========================================
app.post('/events', async (req, res) => {
    try {
        const { summary, description, start, end, isAllDay } = req.body;

        // สร้าง Object event ตามเงื่อนไข isAllDay
        const event = {
            summary,
            description,
            start: isAllDay 
                ? { date: start } // กรณี All-day ส่งแค่ '2023-12-25'
                : { dateTime: start, timeZone: 'Asia/Bangkok' },
            end: isAllDay 
                ? { date: end }   // กรณี All-day ส่งแค่ '2023-12-26'
                : { dateTime: end, timeZone: 'Asia/Bangkok' },
        };

        const response = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event,
        });

        await logToSheet('CREATE', response.data); // Log ลง Sheet
        res.json({ message: 'สร้างสำเร็จ', eventId: response.data.id });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

// ==========================================
// 3. อัปเดตข้อมูล (แก้ไข)
// PUT /events/:eventId
// ==========================================
app.put('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const { summary, description, start, end, isAllDay } = req.body;

        // ดึงอันเก่ามาเช็คก่อน (เผื่อ user ส่งมาไม่ครบ)
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        
        // Logic การ update: ถ้า user ส่งค่าใหม่มาให้ใช้ค่าใหม่ ถ้าไม่ส่งให้ใช้ค่าเดิม
        const updatedEvent = {
            ...oldEvent.data,
            summary: summary || oldEvent.data.summary,
            description: description || oldEvent.data.description,
            // เช็คว่า User เปลี่ยนโหมดเป็น All Day หรือไม่
            start: isAllDay 
                ? { date: start, dateTime: null, timeZone: null } // ลบ dateTime ทิ้งถ้าเป็น All Day
                : (start ? { dateTime: start, timeZone: 'Asia/Bangkok', date: null } : oldEvent.data.start),
            end: isAllDay 
                ? { date: end, dateTime: null, timeZone: null }
                : (end ? { dateTime: end, timeZone: 'Asia/Bangkok', date: null } : oldEvent.data.end),
        };

        const response = await calendar.events.update({
            calendarId: CALENDAR_ID,
            eventId: eventId,
            resource: updatedEvent,
        });

        await logToSheet('UPDATE', response.data);
        res.json({ message: 'อัปเดตสำเร็จ', event: response.data });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

// ==========================================
// 4. ลบข้อมูล
// DELETE /events/:eventId
// ==========================================
app.delete('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;

        // ดึงข้อมูลเก่ามาก่อน เพื่อบันทึกลง Sheet
        const oldEvent = await calendar.events.get({
            calendarId: CALENDAR_ID,
            eventId: eventId
        });

        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: eventId,
        });

        await logToSheet('DELETE', oldEvent.data);

        res.json({ message: 'ลบนัดหมายสำเร็จแล้ว' });

    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'ไม่สามารถลบข้อมูลได้' });
    }
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`ตรวจสอบ Calendar ID: ${CALENDAR_ID}`);
});


// ฟังก์ชันสำหรับบันทึกลง Google Sheet (Append ต่อท้าย)
async function logToSheet(action, eventData) {
    try {
        const values = [
            [
                eventData.id || '-',            // Event ID
                action,                         // Action: CREATE, UPDATE, DELETE
                eventData.summary || '-',       // หัวข้อ
                eventData.start?.dateTime || eventData.start?.date || '-', // เวลาเริ่ม
                eventData.end?.dateTime || eventData.end?.date || '-',     // เวลาจบ
                new Date().toLocaleString('th-TH') // เวลาที่บันทึก
            ]
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Logs!A:F', // ชื่อแผ่นงาน และคอลัมน์ A ถึง F
            valueInputOption: 'USER_ENTERED',
            resource: { values: values },
        });
        console.log(`บันทึก ${action} ลง Sheet สำเร็จ`);
    } catch (error) {
        console.error('Error logging to sheet:', error);
    }
}