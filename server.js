'use strict';

// --- 1. Imports ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// --- 2. Configurations & Initializations ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- 3. Middleware ---
const corsOptions = { origin: '*' }; // เปิดให้ทุกคนเข้าถึงชั่วคราวเพื่อ Debug
app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, 'public'))); // เสิร์ฟไฟล์หน้าบ้าน
app.use('/api', express.json()); // ใช้ JSON parser สำหรับ API

// --- 4. ## API Endpoint ใหม่สำหรับ Debug ## ---
app.get('/api/debug-auth', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided in Authorization header' });
        }
        const accessToken = authHeader.split(' ')[1];

        // ดึงค่า Channel ID ที่เซิร์ฟเวอร์เห็นจาก Environment
        const serverLiffChannelId = process.env.LINE_LIFF_CHANNEL_ID;

        // ตรวจสอบ Token กับ LINE
        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', {
            params: { access_token: accessToken }
        });
        
        const clientIdFromLine = response.data.client_id;
        const isMatch = clientIdFromLine === serverLiffChannelId;

        // ส่งผลการวินิจฉัยกลับไป
        res.status(200).json({
            message: "Auth Debug Information",
            isMatch: isMatch,
            clientIdFromLine: clientIdFromLine,
            channelIdFromServerEnv: serverLiffChannelId || "NOT SET or NOT FOUND"
        });

    } catch (error) {
        res.status(500).json({
            error: "Token verification failed on LINE's side",
            details: error.response ? error.response.data : error.message
        });
    }
});

// --- 5. Route สำหรับแสดงหน้าเว็บ Mini App ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- 6. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
