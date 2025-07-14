'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Init Firebase Admin
let serviceAccount;
try {
    serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : require('./serviceAccountKey.json');
} catch (e) {
    console.error('Firebase Service Account Error', e);
    process.exit(1);
}
initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore();

// Express App Setup
const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Auth Middleware
const liffAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decoded = jwt.decode(idToken);
        if (!decoded || !decoded.sub) {
            return res.status(401).json({ error: 'Unauthorized: Invalid ID Token' });
        }
        if (decoded.aud !== process.env.LINE_LIFF_CHANNEL_ID) {
            return res.status(401).json({ error: 'Unauthorized: LIFF ID mismatch' });
        }
        req.userId = decoded.sub;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Failed to decode token' });
    }
};

// API Router
const apiRouter = express.Router();
apiRouter.use(liffAuthMiddleware);

apiRouter.get('/assistants', async (req, res) => {
    try {
        const snapshot = await firestore.collection('assistants').where('ownerId', '==', req.userId).get();
        const assistants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(assistants);
    } catch (e) {
        console.error('Fetch Assistants Error:', e);
        res.status(500).json({ error: 'Failed to fetch assistants' });
    }
});

apiRouter.post('/assistants', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Assistant name required' });
    try {
        const newAssistant = {
            assistantName: name,
            ownerId: req.userId,
            createdAt: FieldValue.serverTimestamp()
        };
        const ref = await firestore.collection('assistants').add(newAssistant);
        res.status(201).json({ id: ref.id, ...newAssistant });
    } catch (e) {
        console.error('Create Assistant Error:', e);
        res.status(500).json({ error: 'Failed to create assistant' });
    }
});

app.use('/api', apiRouter);

// Frontend route fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
