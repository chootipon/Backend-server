'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

app.get('/api/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const accessToken = authHeader.split(' ')[1];
        const serverLiffChannelId = process.env.LINE_LIFF_CHANNEL_ID;
        const response = await axios.get('https://api.line.me/oauth2/v2.1/verify', { params: { access_token: accessToken } });
        const clientIdFromLine = response.data.client_id;
        const isMatch = clientIdFromLine === serverLiffChannelId;
        res.status(200).json({
            isMatch: isMatch,
            idFromLiffToken: clientIdFromLine,
            idFromServerEnv: serverLiffChannelId || "NOT SET"
        });
    } catch (error) {
        res.status(500).json({ error: 'Token verification failed', details: error.response ? error.response.data : error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
