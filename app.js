const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. ตั้งค่า Cookie Parser (ใช้ Secret จาก .env)
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'fallback_secret_key';
app.use(cookieParser(COOKIE_SECRET));

// 2. ตั้งค่า EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(__dirname));

// --- 3. Environment Variables (โหลดค่าจาก .env) ---
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Google Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Case System API Config (จาก .env)
const API_URL = process.env.API_URL;   // http://localhost:8089
const API_USER = process.env.API_USER; // 1223
const API_PASS = process.env.API_PASS; // 1234
let GLOBAL_TOKEN = process.env.TOKEN || null; // Token เริ่มต้น

// --- 4. Google Client Setup ---
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets'
];

// แปลง GOOGLE_CREDENTIALS จาก String เป็น Object
let googleCredentials;
try {
    googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (e) {
    console.error('Error parsing GOOGLE_CREDENTIALS:', e.message);
}

const auth = new google.auth.GoogleAuth({
    credentials: googleCredentials,
    scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });


// ==========================================
// Helper Functions
// ==========================================

// 1. ดึง Telegram Config จาก Sheet (ยังคงไว้ใน Sheet เพื่อความยืดหยุ่น)
async function getTelegramConfig() {
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
            token: config['TELEGRAM_TOKEN'],
            chatId: config['CHAT_ID'],
            tokenAdmin: config['ADMIN_TELEGRAM_TOKEN'],
            chatIdAdmin: config['ADMIN_CHAT_ID']
        };

    } catch (error) {
        console.error('Error fetching Telegram config:', error.message);
        return null;
    }
}

// 2. ดึงรายชื่อ Email จาก Sheet 'Users'
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

// 3. บันทึก Log
async function logToSheet(action, eventData, performedBy = 'System') {
    try {
        const values = [[
            eventData.id || '-',
            action,
            performedBy, 
            eventData.summary || '-',
            JSON.stringify(eventData.start) || '-',
            JSON.stringify(eventData.end) || '-',
            new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
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

// 4. แปลงวันที่ (DD/MM/YYYY พ.ศ.)
function getBuddhistDateString(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() + 543;
    return `${day}/${month}/${year}`;
}

// ==========================================
// Middleware
// ==========================================

// 1. Check Token (ใช้ค่าจาก .env มา Renew)
const checkToken = async (req, res, next) => {
    try {
        // ถ้ามี Token อยู่แล้ว ให้ผ่านไป
        if (GLOBAL_TOKEN) {
            next();
            return;
        }

        console.log('🔄 Renewing Token from Case System...');
        
        // ใช้ค่าจาก .env โดยตรง
        const loginUrl = `${API_URL}/jvncUser/api/v1/users/login`; 
        const postBody = { "version": 1, "name": API_USER, "passwords": API_PASS };

        const response = await axios.post(loginUrl, postBody);
        const authHeader = response.headers.authorization;

        if (authHeader) {
            GLOBAL_TOKEN = authHeader.replace("Bearer ", "");
            console.log('✅ Token Updated Successfully');
            next();
        } else {
            throw new Error('No Authorization header received');
        }
    } catch (error) {
        console.error('Check Token Error:', error.message);
        res.status(500).json({ error: 'Cannot connect to Case System API' });
    }
};

// 2. Check Admin Auth (Cookie)
const checkAdminAuth = async (req, res, next) => {
    const userEmail = req.signedCookies.user_email;
    if (!userEmail) {
        console.log('⛔ Admin Access Blocked: No Cookie');
        return res.redirect('/'); 
    }

    const allowedList = await getAllowedEmails();
    if (allowedList.includes(userEmail)) {
        next();
    } else {
        res.status(403).send('<h1>403 Forbidden</h1><p>Access Denied</p>');
    }
};

// ==========================================
// Routes
// ==========================================

// หน้าแรก
app.get('/', (req, res) => {
    res.render('index', { 
        googleClientId: GOOGLE_CLIENT_ID,
        apiUrl: APP_URL
    });
});

// หน้า Admin
app.get('/admin', checkAdminAuth, (req, res) => {
    res.render('admin', { 
        sheetId: SPREADSHEET_ID, 
        apiUrl: APP_URL
    });
});

// API Login (Google) -> ฝัง Cookie
app.post('/api/google-login', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const email = payload.email.toLowerCase();

        console.log(`Checking permission: ${email}`);
        const allowedList = await getAllowedEmails();

        if (allowedList.includes(email)) {
            console.log(`✅ Login Success: ${email}`);

            // ฝัง Cookie
            res.cookie('user_email', email, { 
                signed: true,       
                httpOnly: true,     
                maxAge: 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                secure: false // true ถ้าใช้ https
            });
            
            logToSheet('LOGIN', { id: '-', summary: 'User Login' }, email);
            res.json({ success: true, user: { name: payload.name, email: email, picture: payload.picture } });
        } else {
            res.status(403).json({ success: false, message: 'Email not in whitelist.' });
        }
    } catch (error) {
        console.error('Login Error:', error);
        res.status(401).json({ success: false, message: 'Invalid Token' });
    }
});

// API Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('user_email');
    res.json({ success: true });
});

// Google Calendar Events
app.get('/events', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const timeMin = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
        const timeMax = endDate ? new Date(endDate).toISOString() : undefined;
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin, timeMax, singleEvents: true, orderBy: 'startTime',
        });
        res.json({ events: response.data.items });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

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
        res.status(500).json({ error: 'Failed' });
    }
});

app.put('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const { summary, description, start, end, isAllDay, userEmail } = req.body;

        // 1. ดึงข้อมูลเก่ามาก่อน
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });

        // 2. เตรียม Object สำหรับ Start และ End ใหม่
        // ต้องระบุ timeZone: 'Asia/Bangkok' เสมอสำหรับแบบระบุเวลา
        // และต้องเคลียร์ค่าที่ไม่ใช้ออก (เช่น เป็น AllDay ต้องไม่มี dateTime)
        const eventResource = {
            ...oldEvent.data, // เก็บข้อมูลเดิมอื่นๆ ไว้ (เช่น สี, ผู้เข้าร่วม)
            summary: summary || oldEvent.data.summary,
            description: description || oldEvent.data.description,
            
            start: isAllDay 
                ? { date: start, dateTime: null, timeZone: null } // แบบตลอดวัน: เอาเวลาและโซนออก
                : { dateTime: start, timeZone: 'Asia/Bangkok', date: null }, // แบบระบุเวลา: บังคับโซนไทย

            end: isAllDay 
                ? { date: end, dateTime: null, timeZone: null }
                : { dateTime: end, timeZone: 'Asia/Bangkok', date: null },
        };

        // 3. ส่งข้อมูลไปอัปเดต
        const response = await calendar.events.update({ 
            calendarId: CALENDAR_ID, 
            eventId, 
            resource: eventResource 
        });

        // 4. บันทึก Log
        await logToSheet('MANUAL-UPDATE', response.data, userEmail || 'Unknown User');

        res.json({ message: 'Updated', event: response.data });

    } catch (error) {
        // เพิ่ม console.error เพื่อให้เห็นสาเหตุเวลา Server พัง
        console.error('Update Error:', error.message);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

app.delete('/events/:eventId/:userEmail', async (req, res) => {
    try {
        const { eventId, userEmail } = req.params;
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
        await logToSheet('MANUAL-DELETE', oldEvent.data, userEmail || 'Unknown User');
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

function getThaiDate() {
    const now = new Date();
    // แปลงเวลาให้เป็น String ตามโซนไทย แล้วแปลงกลับเป็น Date Object
    const thaiTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    return new Date(thaiTimeStr);
}

// Notify Today Cases (Telegram)
app.get('/casetoday', checkToken, async (req, res) => {
    try {
        console.log('--- Sending Today Cases Notification (Telegram) ---');
        const telegram = await getTelegramConfig();
        
        if (!telegram || !telegram.token || !telegram.chatId) {
            return res.status(500).json({ error: 'Telegram config missing in Sheet' });
        }

        const today = getThaiDate();
        const dateForApi = getBuddhistDateString(today);
        const dateShow = today.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const url = `${API_URL}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
        const postBody = { "version": 1, "appointDate": dateForApi, "offset": 0, "limit": 200 };
        
        const apiRes = await axios.post(url, postBody, { 
            headers: { 'Authorization': `Bearer ${GLOBAL_TOKEN}`, 'Content-Type': 'application/json' } 
        });
        const data = apiRes.data;

        let message = `📅 <b>รายการนัดพิจารณาประจำวัน</b>\n${dateShow}\n--------------------------------\n`;
        let caseCount = 0;

        if (data.success && data.data && data.data.length > 0) {
            const cases = data.data;
            caseCount = cases.length;
            cases.sort((a, b) => parseFloat(a.appointTime.replace(/:/g, '.')) - parseFloat(b.appointTime.replace(/:/g, '.')));

            cases.forEach((item, index) => {
                const shortTime = item.appointTime ? item.appointTime.substring(0, 5) : 'ไม่ระบุ';
                message += `<b>${index + 1}. ${item.fullCaseId}</b>\n   🕒 ${shortTime} น. | 🏛️ ห้อง ${item.roomName}\n   📝 ${item.reasonName}\n\n`;
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

// ==========================================
// Helper: ดึงข้อมูลผู้พิพากษา (Active Judges)
// ==========================================
async function getActiveJudges() {
    const url = `${API_URL}/jvncLookup/api/v1/judges/listAllActivedWork?version=1`;
    try {
        const config = {
            headers: {
                'Authorization': `Bearer ${GLOBAL_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };
        const response = await axios.get(url, config);
        const judges = response.data.data;
        
        if (!judges || judges.length === 0) return [];

        // Filter เฉพาะผู้พิพากษา (status = 1) และ Map ข้อมูล
        return judges
            .filter(j => j.judgeStatus === 1)
            .map(item => ({
                judgeId: item.id,
                judgeName: item.judgeName
            }));

    } catch (error) {
        console.error('Error fetching judges:', error.message);
        return [];
    }
}

// ==========================================
// Route: แจ้งเตือนเวรชี้ (Judge Schedule)
// GET /judgeschedule
// ==========================================
app.get('/judgeschedule', checkToken, async (req, res) => {
    try {
        console.log('--- Checking Judge Schedule ---');
        
        // 1. เตรียม Config
        const telegram = await getTelegramConfig();
        
        if (!telegram || !telegram.token || !telegram.chatId) {
            return res.status(500).json({ error: 'Telegram config missing in Sheet' });
        }

        // 2. จัดการเรื่องวันเวลา (Timezone Thailand)
        const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
        const today = new Date(now);
        
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = today.getFullYear();
        const yearTH = year + 543;

        // รูปแบบสำหรับ URL API (MM/YYYY ค.ศ.)
        const urlDate = `${month}/${year}`; 
        
        // รูปแบบสำหรับ Filter ข้อมูล (DD/MM/YYYY พ.ศ. 00:00:00)
        const targetDateStr = `${day}/${month}/${yearTH} 00:00:00`;

        console.log(`Checking schedule for: ${targetDateStr}`);

        // 3. ดึงรายชื่อผู้พิพากษารอไว้
        const activeJudges = await getActiveJudges();

        // 4. ดึงตารางเวรจาก API
        const url = `${API_URL}/jvncManager/api/v1/managerjudgepool/judgeschedule/${urlDate}/0?version=1.0&offset=0&limit=100`;
        const config = {
            headers: {
                'Authorization': `Bearer ${GLOBAL_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.get(url, config);
        
        if (!response.data || !response.data.data) {
            throw new Error('No schedule data from API');
        }

        // 5. หาเวรของ "วันนี้"
        const dailySchedule = response.data.data.filter(item => item.poolDate === targetDateStr);
        
        let message = '';
        let foundData = null;

        if (dailySchedule.length === 0) {
            // กรณีไม่มีเวร
            message = `⚖️ <b>เวรชี้ประจำวันที่ ${day}/${month}/${yearTH}</b>\n` +
                      `--------------------------------\n` +
                      `❌ <i>ไม่พบข้อมูลเวรชี้ในระบบ</i>`;
        } else {
            // กรณีเจอเวร
            foundData = dailySchedule[0];
            
            // แมพชื่อผู้พิพากษา
            const judgeInfo = activeJudges.find(j => j.judgeId === foundData.judgeId);
            const judgeName = judgeInfo ? judgeInfo.judgeName : `Unknown ID: ${foundData.judgeId}`; // ถ้าไม่เจอชื่อ ให้โชว์ ID แทน
            
            foundData.judgeName = judgeName; // แปะชื่อกลับเข้าไปใน Object เพื่อ return json

            message = `⚖️ <b>เวรชี้ประจำวันที่ ${day}/${month}/${yearTH}</b>\n` +
                      `--------------------------------\n` +
                      `👨‍⚖️ <b>${judgeName}</b>`;
        }

        // 6. ส่งเข้า Telegram
        if (telegram && telegram.token && telegram.chatId) {
            await axios.post(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
                chat_id: telegram.chatId,
                text: message,
                parse_mode: 'HTML'
            });
            console.log('✅ Telegram sent.');
        }

        res.json({ 
            success: true, 
            date: targetDateStr, 
            data: foundData || 'No Schedule' 
        });

    } catch (error) {
        console.error('Judge Schedule Error:', error.message);
        
        // แจ้งเตือน Error เข้า Telegram ด้วย (Optional)
        const telegram = await getTelegramConfig();
        if (telegram && telegram.token && telegram.chatId) {
             await axios.post(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
                chat_id: telegram.chatId,
                text: `⚠️ <b>Error เช็คเวรชี้:</b>\n${error.message}`,
                parse_mode: 'HTML'
            }).catch(() => {});
        }

        res.status(500).json({ error: 'Failed to fetch judge schedule' });
    }
});

// Handler: Sync Logic
const handleSyncCases = async (req, res) => {
    let daysToFetch = parseInt(req.params.days) || 7;
    if (daysToFetch > 90) daysToFetch = 90;
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };
    
    const telegram = await getTelegramConfig(); // ดึง Telegram Config

    try {
        console.log(`--- Syncing Daily Summary (${daysToFetch} days) ---`);

        for (let i = 0; i < daysToFetch; i++) {
            const currentDate = new Date();
            currentDate.setDate(currentDate.getDate() + i); 
            const dateForApi = getBuddhistDateString(currentDate); 
            
            const yyyyEN = currentDate.getFullYear();
            const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
            const dd = String(currentDate.getDate()).padStart(2, '0');
            const dateISO = `${yyyyEN}-${mm}-${dd}`;
            
            const nextDay = new Date(currentDate);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayISO = nextDay.toISOString().split('T')[0];

            const url = `${API_URL}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
            const postBody = { "version": 1, "appointDate": dateForApi, "offset": 0, "limit": 200 };
            
            try {
                const apiRes = await axios.post(url, postBody, { 
                    headers: { 'Authorization': `Bearer ${GLOBAL_TOKEN}`, 'Content-Type': 'application/json' } 
                });
                const data = apiRes.data;
                if (!data.success || !data.data || data.data.length === 0) continue;

                const cases = data.data;
                const totalCases = cases.length;
                cases.sort((a, b) => parseFloat(a.appointTime.replace(/:/g, '.')) - parseFloat(b.appointTime.replace(/:/g, '.')));

                let descriptionList = `สรุปรายการนัดหมายประจำวันที่ ${dateForApi}\n----------------------------\n`;
                cases.forEach((item, index) => {
                    const shortTime = item.appointTime ? item.appointTime.substring(0, 5) : 'ไม่ระบุ';
                    descriptionList += `${index + 1}. ${item.fullCaseId} (${item.reasonName})\n   ห้อง: ${item.roomName} | เวลา: ${shortTime} น.\n\n`;
                });
                descriptionList += `(Updated: ${new Date().toLocaleString('th-TH')})`;

                const eventResource = {
                    summary: `⚖️ คดีวันนี้ ${totalCases} คดี`,
                    description: descriptionList,
                    start: { date: dateISO },
                    end: { date: nextDayISO }
                };

                const existingEvents = await calendar.events.list({
                    calendarId: CALENDAR_ID,
                    timeMin: `${dateISO}T00:00:00Z`,
                    timeMax: `${dateISO}T23:59:59Z`,
                    q: 'คดีวันนี้',
                    singleEvents: true
                });

                if (existingEvents.data.items.length > 0) {
                    await calendar.events.update({ calendarId: CALENDAR_ID, eventId: existingEvents.data.items[0].id, resource: eventResource });
                    await logToSheet('DAILY-UPDATE', { id: existingEvents.data.items[0].id, summary: eventResource.summary }, 'Auto-Bot');
                    results.updated++;
                } else {
                    const response = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: eventResource });
                    await logToSheet('DAILY-CREATE', { id: response.data.id, summary: eventResource.summary }, 'Auto-Bot');
                    results.added++;
                }
            } catch (innerError) {
                if (innerError.response && innerError.response.data.success === false) continue;
                results.errors++;
            }
        } 

        // ส่งสรุปเข้า Telegram Admin
        if (telegram && telegram.tokenAdmin && telegram.chatIdAdmin) {
            try {
                const message = `🔄 <b>สรุปผลการซิงค์ข้อมูล (${daysToFetch} วัน)</b>\n` +
                                `--------------------------------\n` +
                                `✅ เพิ่ม: <b>${results.added}</b> วัน | ✏️ ปรับปรุง: <b>${results.updated}</b> วัน\n` +
                                `⚠️ Error: <b>${results.errors}</b>\n` +
                                `⏰ เวลา: ${new Date().toLocaleString('th-TH')}`;
                await axios.post(`https://api.telegram.org/bot${telegram.tokenAdmin}/sendMessage`, {
                    chat_id: telegram.chatIdAdmin,
                    text: message,
                    parse_mode: 'HTML'
                });
            } catch (tgError) { console.error('Telegram Admin Error:', tgError.message); }
        }

        res.json({ message: `Sync Completed for ${daysToFetch} days`, summary: results });
    } catch (error) {
        console.error('Fatal Sync Error:', error);
        res.status(500).json({ error: 'Sync Failed' });
    }
};

// Sync Routes
app.get('/sync-cases', checkToken, handleSyncCases);
app.get('/sync-cases/:days', checkToken, handleSyncCases);

// Start
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});