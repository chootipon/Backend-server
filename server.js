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
// *** แก้ไขตรงนี้: ใช้ Environment Variable แทนการ require ไฟล์ ***
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

// LangChain & Google AI
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
// *** แก้ไขตรงนี้: ลองเปลี่ยนกลับไป import จาก @langchain/community โดยตรง (หากมีการ export ถูกต้องในเวอร์ชันล่าสุด) ***
// *** หรือถ้ายังไม่ได้ ให้ลองจาก 'langchain/vectorstores' หรือ 'langchain/community/vectorstores' ตามเอกสารจริง ***
const { FirestoreVectorStore } = require("@langchain/community"); // เปลี่ยนเป็น import จาก @langchain/community โดยตรง
const { createStuffDocumentsChain } = require("langchain/chains/combine_documents");
const { ChatPromptTemplate } = require("langchain/prompts");
const { createRetrievalChain } = require("langchain/chains/retrieval");


// --- 2. Configurations & Initializations ---
initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore();
const app = express();
const PORT = process.env.PORT || 3000;
const model = new ChatGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, modelName: "gemini-1.5-flash" });
const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GOOGLE_API_KEY });


// --- 3. Middleware ---
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000'
};
app.use(cors(corsOptions));

app.use('/api', express.json());

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


// --- 4. API Endpoints สำหรับ Mini App ---

app.get('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const assistantsRef = firestore.collection('assistants');
        const snapshot = await assistantsRef.where('ownerId', '==', userId).orderBy('createdAt', 'desc').get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(assistants);
    } catch (error) {
        console.error('Error fetching assistants:', error);
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

app.post('/api/assistants', liffAuthMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Assistant name is required' });
        }

        const newAssistant = {
            assistantName: name,
            ownerId: userId,
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await firestore.collection('assistants').add(newAssistant);
        res.status(201).json({ id: docRef.id, ...newAssistant });
    } catch (error) {
        console.error('Error creating assistant:', error);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

app.post('/api/add-knowledge', liffAuthMiddleware, async (req, res) => {
    try {
        const { title, content, assistantId } = req.body;
        if (!title || !content || !assistantId) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();
        if (!doc.exists || doc.data().ownerId !== req.userId) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const textToEmbed = `หัวข้อ: ${title}\nเนื้อหา: ${content}`;
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 0 });
        const docs = await splitter.createDocuments([textToEmbed]);

        docs.forEach(doc => {
            doc.metadata = { ownerId: req.userId, assistantId, sourceTitle: title };
        });

        await FirestoreVectorStore.fromDocuments(docs, embeddings, { firestore, collectionName: 'vector_embeddings' });

        console.log(`Knowledge added to assistant ${assistantId}: ${title}`);
        res.status(200).json({ message: 'บันทึกข้อมูลความรู้สำเร็จ!' });

    } catch (error) {
        console.error('Add Knowledge Error:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
});


// --- 5. Production Webhook สำหรับ LINE OA ของลูกค้า ---
app.post('/webhook/:assistantId', express.raw({ type: 'application/json' }), async (req, res) => {
    const assistantId = req.params.assistantId;
    const signature = req.headers['x-line-signature'];

    if (!assistantId || !signature) {
        return res.status(400).send('Bad Request');
    }

    try {
        const assistantRef = firestore.collection('assistants').doc(assistantId);
        const doc = await assistantRef.get();

        if (!doc.exists || !doc.data().productionConfig) {
            throw new Error('Assistant not found or not configured for production.');
        }

        const config = doc.data().productionConfig;
        const channelSecret = config.customerLineChannelSecret;
        const channelAccessToken = config.customerLineAccessToken;

        if (!line.validateSignature(req.body, channelSecret, signature)) {
            throw new Error('Invalid signature');
        }

        const customerClient = new line.Client({ channelAccessToken });
        const events = JSON.parse(req.body.toString()).events;
        await Promise.all(events.map(event => handleProductionEvent(event, customerClient, assistantId, doc.data().ownerId)));

        res.status(200).send('OK');

    } catch (error) {
        console.error(`Webhook Error for ${assistantId}:`, error.message);
        res.status(500).send('Error');
    }
});

async function handleProductionEvent(event, client, assistantId, ownerId) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    try {
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

        const result = await retrievalChain.invoke({ input: event.message.text });

        return client.replyMessage(event.replyToken, { type: 'text', text: result.answer });

    } catch (error) {
        console.error('AI Processing Error:', error);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยค่ะ ระบบกำลังมีปัญหา โปรดลองอีกครั้งในภายหลัง' });
    }
}


// --- 6. เริ่มการทำงานของเซิร์ฟเวอร์ ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
