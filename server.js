'use strict';

// --- 1. Imports ---
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const line = require('@line/bot-sdk');


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
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // เสิร์ฟไฟล์หน้าบ้านจาก Root Directory

const liffAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized: No token' });
        const accessToken = authHeader.split(' ')[1];
        
        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', { params: { access_token: accessToken } });
        
        if (response.data.client_id !== process.env.LINE_LIFF_CHANNEL_ID) {
             console.error(`LIFF ID Mismatch. Expected: ${process.env.LINE_LIFF_CHANNEL_ID}, Got: ${response.data.client_id}`);
             return res.status(401).json({ error: 'Unauthorized: Invalid LIFF Channel ID' });
        }
        
        req.userId = response.data.sub;
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized: User ID not found in token' });
        
        next();
    } catch (error) {
        console.error('LIFF Auth Error:', error.response ? error.response.data : error.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }
};

// --- 4. API Routes ---
const apiRouter = express.Router();
apiRouter.use(liffAuthMiddleware);

// ดึงรายการผู้ช่วยทั้งหมด
apiRouter.get('/assistants', async (req, res) => {
    try {
        const snapshot = await firestore.collection('assistants').where('ownerId', '==', req.userId).get();
        if (snapshot.empty) return res.status(200).json([]);
        
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        assistants.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
            const timeB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
            return timeB - timeA;
        });
        
        res.status(200).json(assistants);
    } catch (error) {
        console.error('Error fetching assistants:', error);
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

// สร้างผู้ช่วยใหม่
apiRouter.post('/assistants', async (req, res) => {
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
        console.error('Error creating assistant:', error);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

// เพิ่มความรู้ให้ AI
apiRouter.post('/add-knowledge', async (req, res) => {
    try {
        const { title, content, assistantId } = req.body;
        if (!title || !content || !assistantId) return res.status(400).json({ message: 'Missing required fields.' });

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        const knowledgeRef = assistantRef.collection('knowledge').doc();
        await knowledgeRef.set({ title, content, createdAt: FieldValue.serverTimestamp() });
        
        res.status(200).json({ message: 'บันทึกข้อมูลความรู้สำเร็จ!' });
    } catch (error) {
        console.error('Add Knowledge Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
});

// ห้องแชททดลอง
apiRouter.post('/test-chat', async (req, res) => {
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

// เชื่อมต่อกับ LINE OA ของลูกค้า
apiRouter.post('/connect-assistant', async (req, res) => {
    try {
        const { assistantId, accessToken, channelSecret } = req.body;
        if (!assistantId || !accessToken || !channelSecret) return res.status(400).json({ error: 'Missing required fields.' });

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        // !!สำคัญ: ในระบบจริงต้องเข้ารหัสข้อมูลนี้ก่อนบันทึกเสมอ!!
        const encryptedAccessToken = accessToken;
        const encryptedChannelSecret = channelSecret;

        await assistantRef.set({
            productionConfig: {
                isDeployed: true,
                customerLineAccessToken: encryptedAccessToken,
                customerLineChannelSecret: encryptedChannelSecret
            }
        }, { merge: true });

        const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook/${assistantId}`;
        res.status(200).json({ message: 'Connection successful!', webhookUrl: webhookUrl });
    } catch (error) {
        console.error('Connect Assistant Error:', error);
        res.status(500).json({ error: 'Failed to connect assistant.' });
    }
});

app.use('/api', apiRouter);

// --- 5. Production Webhook ---
app.post('/webhook/:assistantId', express.raw({ type: 'application/json' }), async (req, res) => {
    const assistantId = req.params.assistantId;
    const signature = req.headers['x-line-signature'];
    if (!assistantId || !signature) return res.status(400).send('Bad Request');

    try {
        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || !doc.data().productionConfig) throw new Error('Assistant not found or not configured for production.');

        const config = doc.data().productionConfig;
        const channelSecret = config.customerLineChannelSecret; 
        const channelAccessToken = config.customerLineAccessToken;

        if (!line.validateSignature(req.body, channelSecret, signature)) throw new Error('Invalid signature');

        const customerClient = new line.Client({ channelAccessToken });
        const events = JSON.parse(req.body.toString()).events;
        await Promise.all(events.map(event => handleProductionEvent(event, customerClient, assistantId)));
        
        res.status(200).send('OK');
    } catch (error) {
        console.error(`Webhook Error for ${assistantId}:`, error.message);
        res.status(500).send('Error');
    }
});

// --- 6. Helper Functions ---
async function handleProductionEvent(event, client, assistantId) {
    if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);
    try {
        const aiReply = await getAiResponse(event.message.text, assistantId);
        return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });
    } catch (error) {
        console.error('AI Processing Error:', error);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยค่ะ ระบบกำลังมีปัญหา โปรดลองอีกครั้งในภายหลัง' });
    }
}

async function getAiResponse(userInput, assistantId) {
    const knowledgeSnapshot = await firestore.collection('assistants').doc(assistantId).collection('knowledge').get();
    if (knowledgeSnapshot.empty) {
        return "ขออภัยค่ะ ยังไม่มีข้อมูลความรู้สำหรับผู้ช่วยคนนี้ กรุณาสอนข้อมูลก่อนค่ะ";
    }
    let context = "ข้อมูลความรู้:\n";
    knowledgeSnapshot.forEach(doc => {
        const data = doc.data();
        context += `- หัวข้อ: ${data.title}, เนื้อหา: ${data.content}\n`;
    });
    const prompt = `จากข้อมูลต่อไปนี้: \n---\n${context}\n---\n\nจงตอบคำถามนี้ให้ดีที่สุด โดยอ้างอิงจากข้อมูลที่ให้มาเท่านั้น: "${userInput}"\n\nคำตอบของคุณคือ:`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
}

// --- 7. Route สำหรับแสดงหน้าเว็บ Mini App ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 8. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
