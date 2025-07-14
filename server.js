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
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { createStuffDocumentsChain } = require("langchain/chains/combine_documents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { createRetrievalChain } = require("langchain/chains/retrieval");

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
const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GOOGLE_API_KEY });

const knowledgeBase = new Map();

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

// GET /api/assistants
app.get('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const assistantsRef = firestore.collection('assistants');
        
        // ## ส่วนที่แก้ไข: เอา .orderBy() ออกไปก่อนเพื่อป้องกัน Error ##
        const snapshot = await assistantsRef.where('ownerId', '==', userId).get();

        if (snapshot.empty) return res.status(200).json([]);
        
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // เรียงลำดับด้วย JavaScript แทนชั่วคราว
        assistants.sort((a, b) => (b.createdAt.toDate() - a.createdAt.toDate()));
        
        res.status(200).json(assistants);
    } catch (error) {
        console.error('Error fetching assistants:', error);
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
        console.error('Error creating assistant:', error);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

// POST /api/add-knowledge
app.post('/api/add-knowledge', liffAuthMiddleware, async (req, res) => {
    try {
        const { title, content, assistantId } = req.body;
        if (!title || !content || !assistantId) return res.status(400).json({ message: 'Missing required fields.' });

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const docSnapshot = await assistantRef.get();
        if (!docSnapshot.exists || docSnapshot.data().ownerId !== req.userId) return res.status(403).json({ message: 'Forbidden' });

        const textToEmbed = `หัวข้อ: ${title}\nเนื้อหา: ${content}`;
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 0 });
        const docs = await splitter.createDocuments([textToEmbed]);
        
        let vectorStore = knowledgeBase.get(assistantId);
        if (!vectorStore) {
            vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
            knowledgeBase.set(assistantId, vectorStore);
        } else {
            await vectorStore.addDocuments(docs);
        }
        
        res.status(200).json({ message: 'บันทึกข้อมูลความรู้สำเร็จ! (เก็บในหน่วยความจำชั่วคราว)' });
    } catch (error) {
        console.error('Add Knowledge Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
});

// POST /api/test-chat
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

// --- 5. Helper Function `getAiResponse` ---
async function getAiResponse(userInput, assistantId) {
    const vectorStore = knowledgeBase.get(assistantId);
    if (!vectorStore) {
        return "ขออภัยค่ะ ยังไม่มีข้อมูลความรู้สำหรับผู้ช่วยคนนี้ กรุณาสอนข้อมูลก่อนค่ะ";
    }

    const retriever = vectorStore.asRetriever();
    const prompt = ChatPromptTemplate.fromTemplate(`คุณคือผู้ช่วย AI ที่เชี่ยวชาญ จงตอบคำถามให้กระชับและสุภาพโดยอ้างอิงจากบริบทที่ให้มาเท่านั้น หากไม่พบคำตอบในบริบท ให้ตอบว่า "ขออภัยค่ะ ฉันไม่พบข้อมูลเกี่ยวกับเรื่องนี้"
<context>{context}</context>
คำถาม: {input}`);
    
    const documentChain = await createStuffDocumentsChain({ llm: model, prompt });
    const retrievalChain = await createRetrievalChain({ combineDocsChain: documentChain, retriever });
    const result = await retrievalChain.invoke({ input: userInput });
    return result.answer;
}

// --- 6. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
