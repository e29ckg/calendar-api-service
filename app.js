const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. ตั้งค่า EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(__dirname));

// --- Environment Variables (ค่าคงที่) ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID; 

// --- Google Client Setup ---
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets'
];

const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// --- Global Variables (Runtime) ---
let TOKEN = process.env.TOKEN || null; // Token ระบบงานคดี

// ==========================================
// Helper Functions: Config & Sheet
// ==========================================

// 1. ดึงค่า Config ระบบทั้งหมดจาก Sheet 'Config'
async function getSystemConfig() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Config!A2:B', 
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return null;

        const config = {};
        rows.forEach(row => {
            if (row[0] && row[1]) {
                config[row[0].trim()] = row[1].trim();
            }
        });

        return {
            appUrl: config['APP_URL'], 
            telegram: {
                token: config['TELEGRAM_TOKEN'],
                chatId: config['CHAT_ID']
            },
            api: {
                baseUrl: config['BASE_URL'], 
                user: config['API_USER'],
                pass: config['API_PASS']
            }
        };

    } catch (error) {
        console.error('Error fetching system config:', error.message);
        return null;
    }
}

// 2. ดึงรายชื่อ Email ที่อนุญาตจาก Sheet 'Users'
async function getAllowedEmails() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A2:A',
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        return rows.map(row => row[0] ? row[0].trim().toLowerCase() : '');

    } catch (error) {
        console.error('Error fetching allowed users:', error.message);
        return [];
    }
}

// 3. บันทึก Log ลง Google Sheet
async function logToSheet(action, eventData, performedBy = 'System') {
    try {
        const values = [[
            eventData.id || '-',
            action,
            performedBy, 
            eventData.summary || '-',
            JSON.stringify(eventData.start) || '-',
            JSON.stringify(eventData.end) || '-',
            new Date().toLocaleString('th-TH')
        ]];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Logs!A:G',
            valueInputOption: 'RAW',
            resource: { values },
        });

    } catch (error) {
        console.error('Error logging to sheet:', error.message);
    }
}

// 4. แปลงวันที่สำหรับ API งานคดี (DD/MM/YYYY พ.ศ.)
function getBuddhistDateString(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() + 543;
    return `${day}/${month}/${year}`;
}

// ==========================================
// Middleware: Check & Renew Token (Dynamic)
// ==========================================
const checkToken = async (req, res, next) => {
    try {
        // 1. ดึง Config ล่าสุดจาก Sheet
        const sysConfig = await getSystemConfig();
        
        if (!sysConfig || !sysConfig.api.baseUrl || !sysConfig.api.user) {
            console.error('❌ API Config missing in Google Sheet');
            return res.status(500).json({ error: 'System Config Error' });
        }

        // แนบ config ไปกับ request เพื่อให้ route อื่นใช้ต่อได้
        req.sysConfig = sysConfig;

        // 2. ถ้ามี Token อยู่แล้ว ให้ผ่านไปก่อน (หรือจะเพิ่ม Logic เช็ค Expire ก็ได้)
        if (TOKEN) {
            next();
            return;
        }

        // 3. ถ้าไม่มี Token ให้ขอใหม่ โดยใช้ User/Pass จาก Sheet
        console.log('🔄 Renewing Token from Case System...');
        const loginUrl = `${sysConfig.api.baseUrl}/jvncUser/api/v1/users/login`;
        // หมายเหตุ: เช็ค URL Login ของระบบคุณอีกทีว่าใช้ path ไหนแน่ (jvncUser หรือ jvncProceed)
        // ตามโค้ดเก่าใช้: /jvncUser/api/v1/users/login
        
        const postBody = { 
            "version": 1, 
            "name": sysConfig.api.user, 
            "passwords": sysConfig.api.pass 
        };

        const response = await axios.post(loginUrl, postBody);
        const authHeader = response.headers.authorization;

        if (authHeader) {
            TOKEN = authHeader.replace("Bearer ", "");
            console.log('✅ Token Updated Successfully');
            next();
        } else {
            throw new Error('No Authorization header received');
        }

    } catch (error) {
        console.error('Check Token Error:', error.message);
        res.status(500).json({ error: 'Cannot connect to Case System (Check Config/VPN)' });
    }
};

// ==========================================
// Routes
// ==========================================

// Route: หน้าแรก (Render UI)
app.get('/', async (req, res) => {
    const sysConfig = await getSystemConfig();
    const currentAppUrl = sysConfig?.appUrl || 'http://localhost:3000';

    res.render('index', { 
        googleClientId: GOOGLE_CLIENT_ID,
        apiUrl: currentAppUrl
    });
});

// Route: API Login (Google)
app.post('/api/google-login', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email.toLowerCase();

        console.log(`Checking permission for: ${email}`);
        const allowedList = await getAllowedEmails();

        if (allowedList.includes(email)) {
            console.log(`✅ Login Success: ${email}`);
            
            // Log การเข้าใช้งาน
            logToSheet('LOGIN', { id: '-', summary: 'User Login' }, email);

            res.json({ 
                success: true, 
                user: { 
                    name: payload.name, 
                    email: email, 
                    picture: payload.picture 
                } 
            });
        } else {
            console.log(`❌ Access Denied: ${email}`);
            res.status(403).json({ success: false, message: 'Access Denied: Email not in whitelist.' });
        }
    } catch (error) {
        console.error('Login Error:', error);
        res.status(401).json({ success: false, message: 'Invalid Token' });
    }
});

// Route: Google Calendar (Get Events)
app.get('/events', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const timeMin = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
        const timeMax = endDate ? new Date(endDate).toISOString() : undefined;

        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin, timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        res.json({ events: response.data.items });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Route: Create Event
app.post('/events', async (req, res) => {
    try {
        const { summary, description, start, end, isAllDay, userEmail } = req.body;
        const event = {
            summary, description,
            start: isAllDay ? { date: start } : { dateTime: start, timeZone: 'Asia/Bangkok' },
            end: isAllDay ? { date: end } : { dateTime: end, timeZone: 'Asia/Bangkok' },
        };
        const response = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
        await logToSheet('MANUAL-CREATE', response.data , userEmail || 'Unknown User');
        res.json({ message: 'Success', eventId: response.data.id });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

// Route: Update Event
app.put('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const { summary, description, start, end, isAllDay, userEmail } = req.body;
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        
        const updatedEvent = {
            ...oldEvent.data,
            summary: summary || oldEvent.data.summary,
            description: description || oldEvent.data.description,
            start: isAllDay 
                ? { date: start, dateTime: null, timeZone: null } 
                : (start ? { dateTime: start, timeZone: 'Asia/Bangkok', date: null } : oldEvent.data.start),
            end: isAllDay 
                ? { date: end, dateTime: null, timeZone: null }
                : (end ? { dateTime: end, timeZone: 'Asia/Bangkok', date: null } : oldEvent.data.end),
        };
        
        const response = await calendar.events.update({ calendarId: CALENDAR_ID, eventId, resource: updatedEvent });
        await logToSheet('MANUAL-UPDATE', response.data, userEmail || 'Unknown User');
        res.json({ message: 'Updated', event: response.data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

// Route: Delete Event
app.delete('/events/:eventId/:userEmail', async (req, res) => {
    try {
        const { eventId, userEmail } = req.params;
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
        await logToSheet('MANUAL-DELETE', oldEvent.data, userEmail || 'Unknown User');
        res.json({ message: 'Deleted' });
    } catch (error) {
        console.error('Error deleting:', error.message);
        res.status(500).json({ error: 'Failed' });
    }
});

// Route: Notify Today Cases (Telegram Only)
app.get('/casetoday', checkToken, async (req, res) => {
    try {
        console.log('--- Sending Today Cases Notification (Telegram) ---');
        
        // รับค่า Config ที่ได้จาก checkToken (ไม่ต้องดึงซ้ำ)
        const { telegram, api } = req.sysConfig;
        
        if (!telegram.token || !telegram.chatId) {
            return res.status(500).json({ error: 'Telegram config missing' });
        }

        const today = new Date();
        const dateForApi = getBuddhistDateString(today);
        const dateShow = today.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const url = `${api.baseUrl}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
        const postBody = { "version": 1, "appointDate": dateForApi, "offset": 0, "limit": 200 };
        const config = { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };

        const apiRes = await axios.post(url, postBody, config);
        const data = apiRes.data;

        let message = `📅 <b>รายการนัดพิจารณาประจำวัน</b>\n${dateShow}\n--------------------------------\n`;
        let caseCount = 0;

        if (data.success && data.data && data.data.length > 0) {
            const cases = data.data;
            caseCount = cases.length;
            cases.sort((a, b) => parseFloat(a.appointTime.replace(/:/g, '.')) - parseFloat(b.appointTime.replace(/:/g, '.')));

            cases.forEach((item, index) => {
                const shortTime = item.appointTime ? item.appointTime.substring(0, 5) : 'ไม่ระบุ';
                message += `<b>${index + 1}. ${item.fullCaseId}</b>\n   🕒 ${shortTime} น. | 🏛️ ห้อง ${item.roomName}\n   📝 ${item.reasonName}\n\n`;
            });
            message += `--------------------------------\nรวมทั้งหมด: <b>${caseCount}</b> คดี`;
        } else {
            message += `✅ <i>ไม่มีนัดพิจารณาคดีในวันนี้</i>`;
        }

        await axios.post(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
            chat_id: telegram.chatId,
            text: message,
            parse_mode: 'HTML'
        });

        console.log(`✅ Sent notification: ${caseCount} cases`);
        res.json({ success: true, count: caseCount });

    } catch (error) {
        console.error('Notification Error:', error.message);
        res.status(500).json({ error: 'Failed' });
    }
});

// Route: Sync Daily Summary
app.get('/sync-cases', checkToken, async (req, res) => {
    const DAYS_TO_FETCH = 30;
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };
    const { api } = req.sysConfig; // ใช้ Config จาก Sheet

    try {
        console.log(`--- Syncing Daily Summary (${DAYS_TO_FETCH} days) ---`);

        for (let i = 0; i < DAYS_TO_FETCH; i++) {
            const currentDate = new Date();
            currentDate.setDate(currentDate.getDate() + i); 
            const dateForApi = getBuddhistDateString(currentDate); 
            
            // แปลงวันที่สำหรับ Google Calendar (YYYY-MM-DD)
            const yyyyEN = currentDate.getFullYear();
            const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
            const dd = String(currentDate.getDate()).padStart(2, '0');
            const dateISO = `${yyyyEN}-${mm}-${dd}`;
            
            const nextDay = new Date(currentDate);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayISO = nextDay.toISOString().split('T')[0];

            // ยิง API งานคดี
            const url = `${api.baseUrl}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
            const postBody = { "version": 1, "appointDate": dateForApi, "offset": 0, "limit": 200 };
            
            try {
                const apiRes = await axios.post(url, postBody, { 
                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } 
                });
                
                const data = apiRes.data;
                if (!data.success || !data.data || data.data.length === 0) continue;

                const cases = data.data;
                const totalCases = cases.length;
                cases.sort((a, b) => parseFloat(a.appointTime.replace(/:/g, '.')) - parseFloat(b.appointTime.replace(/:/g, '.')));

                let descriptionList = `สรุปรายการนัดหมายประจำวันที่ ${dateForApi}\n----------------------------\n`;
                cases.forEach((item, index) => {
                    const shortTime = item.appointTime ? item.appointTime.substring(0, 5) : 'ไม่ระบุ';
                    descriptionList += `${index + 1}. ${item.fullCaseId} (${item.reasonName})\n   ห้อง: ${item.roomName} | เวลา: ${shortTime} น.\n\n`;
                });
                descriptionList += `(Updated: ${new Date().toLocaleString('th-TH')})`;

                const eventResource = {
                    summary: `⚖️ คดีวันนี้ ${totalCases} คดี`,
                    description: descriptionList,
                    start: { date: dateISO },
                    end: { date: nextDayISO }
                };

                // เช็คว่ามี Event เดิมไหม
                const existingEvents = await calendar.events.list({
                    calendarId: CALENDAR_ID,
                    timeMin: `${dateISO}T00:00:00Z`,
                    timeMax: `${dateISO}T23:59:59Z`,
                    q: 'คดีวันนี้',
                    singleEvents: true
                });

                if (existingEvents.data.items.length > 0) {
                    await calendar.events.update({
                        calendarId: CALENDAR_ID,
                        eventId: existingEvents.data.items[0].id,
                        resource: eventResource
                    });
                    await logToSheet('DAILY-UPDATE', { id: existingEvents.data.items[0].id, summary: eventResource.summary }, 'Auto-Bot');
                    results.updated++;
                } else {
                    const response = await calendar.events.insert({
                        calendarId: CALENDAR_ID,
                        resource: eventResource,
                    });
                    await logToSheet('DAILY-CREATE', { id: response.data.id, summary: eventResource.summary }, 'Auto-Bot');
                    results.added++;
                }

            } catch (innerError) {
                // ข้าม Error ปกติ (เช่น ไม่พบคดี)
                if (innerError.response && innerError.response.data.success === false) continue;
                console.error(`Error processing ${dateForApi}:`, innerError.message);
                results.errors++;
            }
        }
        res.json({ message: 'Sync Completed', summary: results });

    } catch (error) {
        console.error('Fatal Sync Error:', error);
        res.status(500).json({ error: 'Sync Failed' });
    }
});

// Route Test Token (Optional)
app.get('/manual-token', checkToken, (req, res) => {
    res.json({ message: 'Token Active', token_preview: TOKEN ? TOKEN.substring(0, 10) + '...' : 'None' });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});