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
    console.error('Failed to load or parse Firebase service account key.', e);
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
const liffAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized: No token provided' });
    const accessToken = authHeader.split(' ')[1];
    try {
        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', { params: { access_token: accessToken } });
        if (response.data.client_id !== process.env.LINE_LIFF_CHANNEL_ID) return res.status(401).json({ error: 'Unauthorized: Invalid LIFF Channel ID' });
        req.userId = response.data.sub;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }
};
app.use('/api', express.json());

// --- 4. API Endpoints ---

// POST /api/add-knowledge - เพิ่มความรู้ (เก็บใน Firestore แบบง่าย)
app.post('/api/add-knowledge', liffAuthMiddleware, async (req, res) => {
    try {
        const { title, content, assistantId } = req.body;
        if (!title || !content || !assistantId) return res.status(400).json({ message: 'Missing required fields.' });

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        // สร้าง Collection ย่อยเพื่อเก็บความรู้
        const knowledgeRef = assistantRef.collection('knowledge').doc();
        await knowledgeRef.set({
            title: title,
            content: content,
            createdAt: FieldValue.serverTimestamp()
        });
        
        res.status(200).json({ message: 'บันทึกข้อมูลความรู้สำเร็จ!' });
    } catch (error) {
        console.error('Add Knowledge Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
});

// POST /api/test-chat - ห้องแชททดลอง
app.post('/api/test-chat', liffAuthMiddleware, async (req, res) => {
    const { message, assistantId } = req.body;
    if (!message || !assistantId) return res.status(400).json({ error: 'Message and Assistant ID are required' });

    try {
        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        const aiReply = await getAiResponse(message, assistantId);
        res.status(200).json({ reply: aiReply });
    } catch (error) {
        console.error('Test Chat Error:', error);
        res.status(500).json({ error: 'An error occurred.' });
    }
});

// (Endpoints อื่นๆ เช่น GET/POST /api/assistants, POST /api/connect-assistant เหมือนเดิม)
// GET /api/assistants
app.get('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const snapshot = await firestore.collection('assistants').where('ownerId', '==', req.userId).orderBy('createdAt', 'desc').get();
        if (snapshot.empty) return res.status(200).json([]);
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(assistants);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

// POST /api/assistants
app.post('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Assistant name is required' });
        const newAssistant = {
            assistantName: name,
            ownerId: req.userId,
            createdAt: FieldValue.serverTimestamp(),
        };
        const docRef = await firestore.collection('assistants').add(newAssistant);
        res.status(201).json({ id: docRef.id, ...newAssistant });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});


// --- 5. Helper Function `getAiResponse` ---
async function getAiResponse(userInput, assistantId) {
    // 1. ดึงข้อมูลความรู้ทั้งหมดของ Assistant คนนี้จาก Firestore
    const knowledgeSnapshot = await firestore.collection('assistants').doc(assistantId).collection('knowledge').get();
    if (knowledgeSnapshot.empty) {
        return "ขออภัยค่ะ ยังไม่มีข้อมูลความรู้สำหรับผู้ช่วยคนนี้ กรุณาสอนข้อมูลก่อนค่ะ";
    }

    // 2. นำข้อมูลทั้งหมดมาสร้างเป็น Context
    let context = "ข้อมูลความรู้:\n";
    knowledgeSnapshot.forEach(doc => {
        const data = doc.data();
        context += `- หัวข้อ: ${data.title}, เนื้อหา: ${data.content}\n`;
    });

    // 3. สร้าง Prompt ที่สมบูรณ์
    const prompt = `จากข้อมูลต่อไปนี้: \n---\n${context}\n---\n\nจงตอบคำถามนี้ให้ดีที่สุด: "${userInput}"\n\nคำตอบของคุณคือ:`;

    // 4. เรียก Gemini API โดยตรง
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
}

// --- 6. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
