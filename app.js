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

// 1. ตั้งค่าให้รู้จัก EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    // Render ไฟล์ index.ejs พร้อมส่งตัวแปร googleClientId ไปให้
    res.render('index', { 
        googleClientId: process.env.GOOGLE_CLIENT_ID ,
        apiUrl: process.env.APP_URL || 'http://localhost:3000'
    });
});

// รับค่า Config จาก .env
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // ค่าใหม่ที่ได้จากข้อ 1
const ALLOWED_EMAILS = ['e29ckg@gmail.com', 'admin@court.go.th']; 

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- Global Variables ---
let TOKEN = process.env.TOKEN || null; // เก็บ Token ใน Memory
const BASE_URL = process.env.BASE_URL;
const USER = process.env.USER;
const PASS = process.env.PASS;

// --- Config Google ---
// const KEY_FILE_PATH = process.env.GOOGLE_KEY_FILE;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets'
];

// --- Config Telegram ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// --- Google Auth ---
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: SCOPES,
});
const calendar = google.calendar({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// ==========================================
// Middleware: ตรวจสอบ Token ก่อนยิง API นอก
// ==========================================
const checkToken = async (req, res, next) => {
    // ถ้าไม่มี Token หรือ Token เป็นค่าว่าง ให้ไปขอใหม่
    if (!TOKEN) {
        console.log('Token not found, fetching new one...');
        await get_Token();
    }
    
    // ลองยิง Test ดูว่า Token ใช้ได้ไหม (Optional: ถ้า API ไว เช็คทุกครั้งก็ได้)
    // แต่เพื่อความเร็ว อาจจะข้ามไปก่อน ถ้า Error 401 ค่อยขอใหม่ใน logic หลักก็ได้
    // ในที่นี้ผมจะให้ผ่านไปก่อนเพื่อให้ flow ไม่ช้า
    next();
};

// API Login ด้วย Google
app.post('/api/google-login', async (req, res) => {
    const { token } = req.body;
    try {
        // ให้ Google ช่วยเช็คว่า Token นี้ของจริงไหม
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;

        // เช็คว่าอีเมลนี้ได้รับอนุญาตไหม (Whitelist)
        if (ALLOWED_EMAILS.includes(email)) {
            console.log(`User logged in: ${email}`);
            // ส่งข้อมูลกลับไปบอก Frontend ว่าผ่าน
            res.json({ 
                success: true, 
                user: { name: payload.name, email: email, picture: payload.picture } 
            });
        } else {
            console.log(`Unauthorized login attempt: ${email}`);
            res.status(403).json({ success: false, message: 'อีเมลนี้ไม่มีสิทธิ์เข้าใช้งานระบบ' });
        }
    } catch (error) {
        console.error('Login Error:', error);
        res.status(401).json({ success: false, message: 'Invalid Token' });
    }
});

// API สำหรับ Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === APP_USER && password === APP_PASS) {
        res.json({ success: true, token: 'mock-token-session' });
    } else {
        res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }
});

// ==========================================
// Routes: Google Calendar (เหมือนเดิม)
// ==========================================
app.get('/events', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const timeMin = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
        const timeMax = endDate ? new Date(endDate).toISOString() : undefined;

        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin,
            timeMax: timeMax,
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

app.post('/events', async (req, res) => {
    try {
        const { summary, description, start, end, isAllDay } = req.body;
        const event = {
            summary,
            description,
            start: isAllDay ? { date: start } : { dateTime: start, timeZone: 'Asia/Bangkok' },
            end: isAllDay ? { date: end } : { dateTime: end, timeZone: 'Asia/Bangkok' },
        };
        const response = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
        await logToSheet('CREATE', response.data);
        res.json({ message: 'สร้างสำเร็จ', eventId: response.data.id });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

app.put('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const { summary, description, start, end, isAllDay } = req.body;
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
        await logToSheet('UPDATE', response.data);
        res.json({ message: 'อัปเดตสำเร็จ', event: response.data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

app.delete('/events/:eventId', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const oldEvent = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
        await logToSheet('DELETE', oldEvent.data);
        res.json({ message: 'ลบนัดหมายสำเร็จแล้ว' });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'ไม่สามารถลบข้อมูลได้' });
    }
});

// ==========================================
// Route: Case Today (ดึงคดีวันนี้ + แจ้ง Telegram)
// ==========================================
app.get('/casetoday', checkToken, async (req, res) => {
    try {
        const date = new Date();
        const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
        // แปลงวันที่เป็น DD/MM/YYYY (ปีพุทธศักราช) เพื่อส่งให้ API
        const formattedDate = date.toLocaleDateString('th-TH', options); 
        // const formattedDate = "26/03/2567"; // สำหรับ Test

        const url = `${BASE_URL}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
        const postBody = { "version": 1, "appointDate": formattedDate, "offset": 0, "limit": 200 };
        const config = {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, postBody, config);
        let data = response.data;

        // เช็คกรณีไม่พบคดี
        if (data.success === false) {
            if (data.message === "SearchElectronicAppointDateByCase list not found in the database") {
                const msg = `คดีนัดวันนี้ ${formattedDate}\n--- ไม่พบคดี ---`;
                await sendTelegramMessage(CHAT_ID, msg);
                return res.json({ message: msg });
            }
            return res.send(data);
        }

        // Map ข้อมูล
        const jsonData = data.data.map(item => ({
            fullCaseId: item.fullCaseId,
            reasonName: item.reasonName,
            appointDate: item.appointDate,
            appointTime: item.appointTime,
            roomName: item.roomName
        }));

        // Sort เวลา
        const sortedData = jsonData.sort((a, b) => {
            return parseAppointTime(a.appointTime) - parseAppointTime(b.appointTime);
        });

        // Format ข้อมูลสำหรับแสดงผล
        const jsonDataWithFormattedDate = sortedData.map(item => ({
            fullCaseId: item.fullCaseId,
            reasonName: item.reasonName,
            appointDate: item.appointDate.split(' ')[0],
            appointTime: item.appointTime.split(' ')[0], // ตัดเอาแค่เวลา
            roomName: item.roomName
        }));

        // สร้างข้อความ Telegram
        const messageList = jsonDataWithFormattedDate.map(item => {
            // ตัดเลขวินาทีออกเพื่อให้สั้นลง (เช่น 09.00.00 -> 09.00)
            const shortTime = item.appointTime.substring(0, 5); 
            return `🏷 ${item.fullCaseId} -> ${item.reasonName} (${shortTime} น.)\n`;
        }).join('');

        const headerMsg = `📅 คดีนัดวันนี้ ${jsonDataWithFormattedDate[0].appointDate}`;
        const finalMessage = `${headerMsg}\n--------------------------\n${messageList}`;

        await sendTelegramMessage(CHAT_ID, finalMessage);
        
        console.log('Sent Telegram:', finalMessage);
        res.json(jsonDataWithFormattedDate);

    } catch (error) {
        console.error('Error in /casetoday:', error.message);
        // ถ้า Error เพราะ Token หมดอายุ (401) อาจจะสั่งให้ get_Token() ใหม่ตรงนี้ได้
        res.status(500).json({ error: 'Failed to process case today', details: error.message });
    }
});

// ==========================================
// Helper Functions
// ==========================================

async function get_Token() {
    const url = `${BASE_URL}/jvncUser/api/v1/users/login`;
    const postBody = { "version": 1, "name": USER, "passwords": PASS };
    try {
        console.log('Requesting new Token...');
        const response = await axios.post(url, postBody);
        const authHeader = response.headers.authorization;
        if (authHeader) {
            TOKEN = authHeader.replace("Bearer ", "");
            console.log('Token updated successfully.');
            return TOKEN;
        }
        return null;
    } catch (error) {
        console.error('Error getting token:', error.message);
        return null;
    }
}

// Helper: Parse เวลา "09.00.00" -> จำนวนนาที
function parseAppointTime(appointTime) {
    if (!appointTime) return 0;
    try {
        const timeParts = appointTime.split(' ')[0].split('.');
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);
        return (hours * 60) + minutes;
    } catch (e) {
        return 0;
    }
}

async function logToSheet(action, eventData) {
    try {
        const values = [[
            eventData.id || '-',
            action,
            eventData.summary || '-',
            eventData.start?.dateTime || eventData.start?.date || '-',
            eventData.end?.dateTime || eventData.end?.date || '-',
            new Date().toLocaleString('th-TH')
        ]];
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Logs!A:F',
            valueInputOption: 'USER_ENTERED',
            resource: { values: values },
        });
        console.log(`Log ${action} to Sheet success.`);
    } catch (error) {
        console.error('Error logging to sheet:', error);
    }
}

// แปลง Date Object เป็นรูปแบบที่ API คดีต้องการ (DD/MM/YYYY พ.ศ.)
function getBuddhistDateString(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() + 543; // แปลงเป็น พ.ศ.
    return `${day}/${month}/${year}`;
}

// แปลงวันที่และเวลาจาก API คดี ให้เป็น Google Calendar ISO String
// inputDate: 26/03/2567, inputTime: 09.00.00
function convertToISODateTime(inputDate, inputTime) {
    const [day, month, beYear] = inputDate.split('/');
    const adYear = parseInt(beYear) - 543;
    
    // แปลงเวลา 09.00.00 -> 09:00:00
    const timeClean = inputTime.replace(/\./g, ':');
    
    // สร้าง string มาตรฐาน: 2024-03-26T09:00:00
    return `${adYear}-${month}-${day}T${timeClean}`;
}

async function sendTelegramMessage(chatId, text) {
    try {
        if(!chatId || !text) return;
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: text });
        console.log('Telegram msg sent.');
    } catch (error) {
        console.error('Telegram Error:', error.message);
    }
}


// Route สำหรับ Manual Update Token/Test
app.get('/manual-token', async (req, res) => {
    const t = await get_Token();
    res.json({ message: 'Token updated', token_preview: t ? t.substring(0, 10) + '...' : 'failed' });
});

// ==========================================
// Sync Data: สรุปยอดคดีรายวัน (Daily Summary)
// GET /sync-cases
// ==========================================
app.get('/sync-cases', checkToken, async (req, res) => {
    const DAYS_TO_FETCH = 30;
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    try {
        console.log(`--- เริ่มต้น Sync ข้อมูลสรุปรายวัน ${DAYS_TO_FETCH} วัน ---`);

        for (let i = 0; i < DAYS_TO_FETCH; i++) {
            const currentDate = new Date();
            currentDate.setDate(currentDate.getDate() + i); 
            const dateForApi = getBuddhistDateString(currentDate); 

            console.log(`Processing: ${dateForApi}`);

            const url = `${BASE_URL}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
            const postBody = { "version": 1, "appointDate": dateForApi, "offset": 0, "limit": 200 };
            const config = { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };

            try {
                const apiRes = await axios.post(url, postBody, config);
                const data = apiRes.data;

                // ถ้าไม่มีข้อมูล หรือ Success = false ให้ข้าม
                if (!data.success || !data.data || data.data.length === 0) {
                     continue; 
                }

                // ======================================================
                // 1. เตรียมข้อมูลสรุป (Aggregation)
                // ======================================================
                const cases = data.data;
                const totalCases = cases.length;

                // เรียงลำดับตามเวลา (เช้า -> บ่าย) เพื่อความสวยงามใน List
                cases.sort((a, b) => {
                    const timeA = parseFloat(a.appointTime.replace(/:/g, '.'));
                    const timeB = parseFloat(b.appointTime.replace(/:/g, '.'));
                    return timeA - timeB;
                });

                // สร้าง Description List
                let descriptionList = `สรุปรายการนัดหมายประจำวันที่ ${dateForApi}\n----------------------------\n`;
                cases.forEach((item, index) => {
                    // ตัดเวลาให้สั้นลง (เช่น 09.00.00 -> 09.00)
                    const shortTime = item.appointTime ? item.appointTime.substring(0, 5) : 'ไม่ระบุ';
                    descriptionList += `${index + 1}. ${item.fullCaseId} (${item.reasonName})\n   ห้อง: ${item.roomName} | เวลา: ${shortTime} น.\n\n`;
                });
                
                descriptionList += `(ข้อมูลอัปเดตเมื่อ: ${new Date().toLocaleString('th-TH')})`;

                // ======================================================
                // 2. คำนวณวันที่สำหรับ All Day Event
                // ======================================================
                // แปลงวันที่ (DD/MM/YYYY พ.ศ. -> YYYY-MM-DD ค.ศ.)
                const [dd, mm, yyyyTH] = dateForApi.split('/');
                const yyyyEN = parseInt(yyyyTH) - 543;
                const dateISO = `${yyyyEN}-${mm}-${dd}`; // Start Date (เช่น 2025-12-19)

                const endDateObj = new Date(dateISO);
                endDateObj.setDate(endDateObj.getDate() + 1);
                const nextDayISO = endDateObj.toISOString().split('T')[0]; // End Date (เช่น 2025-12-20)

                // ======================================================
                // 3. สร้าง Resource (All Day)
                // ======================================================
                const eventResource = {
                    summary: `⚖️ คดีวันนี้ ${totalCases} คดี`, // Title: คดีวันนี้ X คดี
                    description: descriptionList,
                    start: { date: dateISO },     // เริ่มวันนี้
                    end: { date: nextDayISO }     // จบวันถัดไป (ตามกฎ Google All Day)
                };

                // ======================================================
                // 4. เช็คซ้ำ & บันทึก (Check & Save)
                // ======================================================
                // ค้นหา Event ในวันนั้น ที่มีชื่อขึ้นต้นว่า "⚖️ คดีวันนี้"
                const existingEvents = await calendar.events.list({
                    calendarId: CALENDAR_ID,
                    timeMin: `${dateISO}T00:00:00Z`,
                    timeMax: `${dateISO}T23:59:59Z`,
                    q: 'คดีวันนี้', // Keyword สำหรับค้นหา
                    singleEvents: true
                });

                if (existingEvents.data.items.length > 0) {
                    // --- UPDATE (มีอยู่แล้ว ให้อัปเดตยอดและรายชื่อ) ---
                    const eventIdToUpdate = existingEvents.data.items[0].id;
                    await calendar.events.update({
                        calendarId: CALENDAR_ID,
                        eventId: eventIdToUpdate,
                        resource: eventResource
                    });
                    
                    // Log แบบ Summary
                    await logToSheet('DAILY-UPDATE', { 
                        id: eventIdToUpdate, 
                        summary: eventResource.summary, 
                        start: eventResource.start, 
                        end: eventResource.end 
                    });
                    
                    results.updated++;
                    console.log(`~ Updated Summary: ${dateForApi} (${totalCases} คดี)`);

                } else {
                    // --- CREATE (ยังไม่มี ให้สร้างใหม่) ---
                    const response = await calendar.events.insert({
                        calendarId: CALENDAR_ID,
                        resource: eventResource,
                    });

                    await logToSheet('DAILY-CREATE', { 
                        id: response.data.id, 
                        summary: eventResource.summary, 
                        start: eventResource.start, 
                        end: eventResource.end 
                    });

                    results.added++;
                    console.log(`+ Created Summary: ${dateForApi} (${totalCases} คดี)`);
                }

            } catch (innerError) {
                // Error Handling (ข้ามกรณีไม่พบคดี)
                if (innerError.response) {
                    const resData = innerError.response.data;
                    if (resData.message === "SearchElectronicAppointDateByCase list not found in the database" ||
                        resData.success === false) {
                        // ไม่พบคดี ถือเป็นเรื่องปกติ ข้ามไป
                        continue; 
                    }
                    console.error(`Error วันที่ ${dateForApi}:`, resData);
                } else {
                    console.error(`Error processing date ${dateForApi}:`, innerError.message);
                }
                results.errors++;
            }
        }

        res.json({ message: 'Daily summary sync completed', summary: results });

    } catch (error) {
        console.error('Fatal Sync Error:', error);
        res.status(500).json({ error: 'Sync failed' });
    }
});


app.get('/casetoday', async (req, res) => {
    
  const date = new Date(); 
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const formattedDate = date.toLocaleDateString('th-TH', options);
  // const formattedDate = "26/03/2567";

  const url = `${BASE_URL}/jvncProceed/api/v1/proceed/searchElectronicAppointDateByCase/search?version=1`;
  const postBody = { "version":1, "appointDate": formattedDate, "offset":0, "limit":200 };
  const config = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  try {
    
      const response = await axios.post(url, postBody, config);  
      let data =  response.data;

      if(data.success == false){
        if(data.message === "SearchElectronicAppointDateByCase list not found in the database"){
          sendLineNotifyMessage('คดีนัดวันนี้ '+ formattedDate + '\n ---ไม่พบคดี---' );
          
        }
        res.send(data)
        return 
      }
      
      const jsonData = data.data.map(item => ({
          fullCaseId: item.fullCaseId,
          reasonName: item.reasonName,
          appointDate: item.appointDate,
          appointTime: item.appointTime,
          roomName: item.roomName
        }));

        // เรียงลำดับตาม appointTime จากน้อยไปหามาก
        const sortedData = jsonData.sort((a, b) => {
          const timeA = parseAppointTime(a.appointTime);
          const timeB = parseAppointTime(b.appointTime);

          return timeA - timeB;
        });

        console.log(sortedData);

        // ฟังก์ชันสำหรับแปลง appointTime เป็นเวลา (ในนี้ถือว่าเป็นเวลาเริ่มต้น)
        function parseAppointTime(appointTime) {
          const timeParts = appointTime.split(' ')[0].split('.');
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          
          return hours * 60 + minutes;
        }

        // แปลงรูปแบบวันที่และเปลี่ยนเป็นภาษาไทย
        const jsonDataWithFormattedDate = sortedData.map(item => {
        // ตัดเอาเฉพาะวันที่
          const appointDateOnly = item.appointDate.split(' ')[0];
          const appointTimeOnly = item.appointTime.split(' ')[0];
          return {
              fullCaseId: item.fullCaseId,
              reasonName: item.reasonName,
              appointDate: appointDateOnly,
              appointTime: appointTimeOnly,
              roomName: item.roomName
          };
        });

        const messageToSend = jsonDataWithFormattedDate.map(item => {
            return `🏷${item.fullCaseId}->${item.reasonName}(${item.appointTime})\n`;
          }).join('');
        
          sendLineNotifyMessage('คดีนัดวันนี้ '+ jsonDataWithFormattedDate[0].appointDate + '\n' + messageToSend);
          
          res.json(jsonDataWithFormattedDate)
        console.log(messageToSend)
      
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Failed to obtain token' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});