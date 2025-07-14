'use strict';

// --- 1. Imports ---
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const axios = require('axios');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- 2. Configurations & Initializations ---
let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        serviceAccount = require('./serviceAccountKey.json');
    }
} catch (e) {
    console.error('CRITICAL: Failed to load or parse Firebase service account key.', e);
    process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore();
const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- 3. Middleware ---
const corsOptions = { origin: process.env.FRONTEND_URL || 'http://localhost:3000' };
app.use(cors(corsOptions));
app.use('/api', express.json()); // ใช้ JSON parser สำหรับทุก route ที่ขึ้นต้นด้วย /api

// --- 4. API Endpoints ---

// GET /api/assistants - ดึงรายการผู้ช่วยทั้งหมดของผู้ใช้
app.get('/api/assistants', async (req, res) => {
    try {
        // --- ยืนยันตัวตนและดึง User ID ---
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized: No token' });
        const accessToken = authHeader.split(' ')[1];
        const verifyResponse = await axios.get('https://api.line.me/oauth2/v2.1/verify', { params: { access_token: accessToken } });
        if (verifyResponse.data.client_id !== process.env.LINE_LIFF_CHANNEL_ID) return res.status(401).json({ error: 'Unauthorized: Invalid LIFF ID' });
        const liffUserId = verifyResponse.data.sub;
        if (!liffUserId) return res.status(401).json({ error: 'Unauthorized: User ID not found' });
        // --- จบการยืนยันตัวตน ---

        const assistantsRef = firestore.collection('assistants');
        const snapshot = await assistantsRef.where('ownerId', '==', liffUserId).get();

        if (snapshot.empty) return res.status(200).json([]);
        
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        assistants.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
            const timeB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
            return timeB - timeA;
        });
        
        res.status(200).json(assistants);
    } catch (error) {
        console.error('Error fetching assistants:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

// POST /api/assistants - สร้างผู้ช่วย AI ใหม่
app.post('/api/assistants', async (req, res) => {
    try {
        // --- ยืนยันตัวตนและดึง User ID ---
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized: No token' });
        const accessToken = authHeader.split(' ')[1];
        const verifyResponse = await axios.get('https://api.line.me/oauth2/v2.1/verify', { params: { access_token: accessToken } });
        if (verifyResponse.data.client_id !== process.env.LINE_LIFF_CHANNEL_ID) return res.status(401).json({ error: 'Unauthorized: Invalid LIFF ID' });
        const liffUserId = verifyResponse.data.sub;
        if (!liffUserId) return res.status(401).json({ error: 'Unauthorized: User ID not found' });
        // --- จบการยืนยันตัวตน ---

        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Assistant name is required' });

        const newAssistant = {
            assistantName: name,
            ownerId: liffUserId, // ใช้ User ID ที่ยืนยันแล้ว
            createdAt: FieldValue.serverTimestamp(),
        };
        const docRef = await firestore.collection('assistants').add(newAssistant);
        res.status(201).json({ id: docRef.id, ...newAssistant });
    } catch (error) {
        console.error('Error creating assistant:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

// (Endpoints และ Helper Functions อื่นๆ ทั้งหมดจะใช้ Logic ที่คล้ายกัน)
// ...

// --- 5. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
