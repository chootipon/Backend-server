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

// Serve static files (index.html, script.js, etc.) from current directory
app.use(express.static(__dirname));

// LIFF Auth Middleware
const liffAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) 
            return res.status(401).json({ error: 'Unauthorized: No token' });

        const accessToken = authHeader.split(' ')[1];

        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', {
            params: { access_token: accessToken }
        });

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

// TODO: เพิ่ม API อื่นๆ ที่จำเป็น

app.use('/api', apiRouter);

// --- 5. Catch-all Route for SPA ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 6. Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server on http://localhost:${PORT}`);
});
