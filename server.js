'use strict';

// --- 1. Imports ---
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// Firebase Admin SDK
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// LangChain & Google AI
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { FirestoreVectorStore } = require("@langchain/community/vectorstores/firestore");
const { createStuffDocumentsChain } = require("langchain/chains/combine_documents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { createRetrievalChain } = require("langchain/chains/retrieval");

// --- 2. Configurations & Initializations ---

// ## วิธีการเชื่อมต่อ Firebase ที่ปลอดภัยสำหรับ Render ##
let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // สำหรับ Render: อ่านค่าจาก Environment Variable แล้วแปลงกลับเป็น JSON
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // สำหรับการพัฒนาบนเครื่อง: อ่านจากไฟล์โดยตรง
        serviceAccount = require('./serviceAccountKey.json');
    }
} catch (e) {
    console.error('Failed to load or parse Firebase service account key.', e);
    process.exit(1); // ออกจากโปรแกรมถ้าไม่สามารถเชื่อมต่อ Firebase ได้
}

initializeApp({
  credential: cert(serviceAccount)
});
const firestore = getFirestore();

// Express
const app = express();
const PORT = process.env.PORT || 3000;

// LangChain & Google AI
const model = new ChatGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, modelName: "gemini-1.5-flash" });
const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GOOGLE_API_KEY });


// --- 3. Middleware ---

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
};
app.use(cors(corsOptions));

const liffAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const accessToken = authHeader.split(' ')[1];
    try {
        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', {
            params: { access_token: accessToken }
        });
        if (response.data.client_id !== process.env.LINE_LIFF_CHANNEL_ID) {
            return res.status(401).json({ error: 'Unauthorized: Invalid LIFF Channel ID' });
        }
        req.userId = response.data.sub;
        next();
    } catch (error) {
        console.error('LIFF token verification failed:', error.response ? error.response.data : error.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }
};

app.use('/api', express.json());


// --- 4. API Endpoints สำหรับ Mini App ---

// GET /api/assistants - ดึงรายการผู้ช่วยทั้งหมดของผู้ใช้
app.get('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const snapshot = await firestore.collection('assistants').where('ownerId', '==', req.userId).orderBy('createdAt', 'desc').get();
        if (snapshot.empty) return res.status(200).json([]);
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(assistants);
    } catch (error) {
        console.error('Error fetching assistants:', error);
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

// POST /api/assistants - สร้างผู้ช่วย AI ใหม่
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
        console.error('Error creating assistant:', error);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

// POST /api/add-knowledge - เพิ่มความรู้ให้ AI
app.post('/api/add-knowledge', liffAuthMiddleware, async (req, res) => {
    try {
        const { title, content, assistantId } = req.body;
        if (!title || !content || !assistantId) return res.status(400).json({ message: 'Missing required fields.' });

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        const textToEmbed = `หัวข้อ: ${title}\nเนื้อหา: ${content}`;
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 0 });
        const docs = await splitter.createDocuments([textToEmbed]);
        
        docs.forEach(doc => {
            doc.metadata = { ownerId: req.userId, assistantId, sourceTitle: title };
        });

        await FirestoreVectorStore.fromDocuments(docs, embeddings, { firestore, collectionName: 'vector_embeddings' });
        
        res.status(200).json({ message: 'บันทึกข้อมูลความรู้สำเร็จ!' });
    } catch (error) {
        console.error('Add Knowledge Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
});

// POST /api/connect-assistant - เชื่อมต่อกับ LINE OA ของลูกค้า
app.post('/api/connect-assistant', liffAuthMiddleware, async (req, res) => {
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

// POST /api/test-chat - ห้องแชททดลอง
app.post('/api/test-chat', liffAuthMiddleware, async (req, res) => {
    const { message, assistantId } = req.body;
    if (!message || !assistantId) return res.status(400).json({ error: 'Message and Assistant ID are required' });

    try {
        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        const aiReply = await getAiResponse(message, req.userId, assistantId);
        res.status(200).json({ reply: aiReply });
    } catch (error) {
        console.error('Test Chat Error:', error);
        res.status(500).json({ error: 'An error occurred while processing your message.' });
    }
});


// --- 5. Production Webhook สำหรับ LINE OA ของลูกค้า ---
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
        await Promise.all(events.map(event => handleProductionEvent(event, customerClient, assistantId, doc.data().ownerId)));
        
        res.status(200).send('OK');
    } catch (error) {
        console.error(`Webhook Error for ${assistantId}:`, error.message);
        res.status(500).send('Error');
    }
});

// --- 6. Helper Functions ---
async function handleProductionEvent(event, client, assistantId, ownerId) {
    if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);
    try {
        const aiReply = await getAiResponse(event.message.text, ownerId, assistantId);
        return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });
    } catch (error) {
        console.error('AI Processing Error:', error);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยค่ะ ระบบกำลังมีปัญหา โปรดลองอีกครั้งในภายหลัง' });
    }
}

async function getAiResponse(userInput, ownerId, assistantId) {
    const vectorStore = new FirestoreVectorStore(embeddings, { firestore, collectionName: 'vector_embeddings' });
    const retriever = vectorStore.asRetriever({
        filter: {
            "composite": {
                "operator": "AND",
                "filters": [
                    { "operator": "EQUAL", "name": "ownerId", "value": ownerId },
                    { "operator": "EQUAL", "name": "assistantId", "value": assistantId }
                ]
            }
        }
    });
    
    const prompt = ChatPromptTemplate.fromTemplate(`คุณคือผู้ช่วย AI ที่เชี่ยวชาญ จงตอบคำถามให้กระชับและสุภาพโดยอ้างอิงจากบริบทที่ให้มาเท่านั้น หากไม่พบคำตอบในบริบท ให้ตอบว่า "ขออภัยค่ะ ฉันไม่พบข้อมูลเกี่ยวกับเรื่องนี้"
<context>{context}</context>
คำถาม: {input}`);
    
    const documentChain = await createStuffDocumentsChain({ llm: model, prompt });
    const retrievalChain = await createRetrievalChain({ combineDocsChain: documentChain, retriever });
    const result = await retrievalChain.invoke({ input: userInput });
    return result.answer;
}

// --- 7. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
