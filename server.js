const express = require('express');
const http = require('http'); // 追加
const { Server } = require("socket.io"); // 追加
const path = require('path');
const fs = require('fs');
require('dotenv').config();



const app = express();
const server = http.createServer(app); // serverを作成
const io = new Server(server); // socket.ioを紐付け

const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// --- Socket.io 通信ロジック ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 部屋に参加
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
        // 部屋にいる他の人に「コントローラーが来たよ」と伝える
        socket.to(roomId).emit('controller_joined');
    });

    // スマホからの操作コマンドを部屋全体に転送
    socket.on('send_command', (data) => {
        // data = { roomId, action: 'up' | 'down' | 'select' }
        socket.to(data.roomId).emit('receive_command', data.action);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// --- 以下、既存のAPI設定 ---
const PROVIDER = 'openai'; 
const MODEL = 'gpt-4o-mini';

let promptTemplate;
try {
    promptTemplate = fs.readFileSync('prompt.md', 'utf8');
} catch (error) {
    console.error('Error reading prompt.md:', error);
    process.exit(1);
}

const OPENAI_API_ENDPOINT = 'https://openai-api-proxy-746164391621.us-west1.run.app';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

app.post('/api/', async (req, res) => {
    try {
        const { prompt, title = 'Generated Content', ...variables } = req.body;
        let finalPrompt = prompt || promptTemplate;
        
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
            finalPrompt = finalPrompt.replace(regex, value);
        }

        let result;
        if (PROVIDER === 'openai') {
            result = await callOpenAI(finalPrompt);
        } else if (PROVIDER === 'gemini') {
            result = await callGemini(finalPrompt);
        } else {
            return res.status(400).json({ error: 'Invalid provider configuration' });
        }

        res.json({ title: title, data: result });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// OpenAI / Gemini 関数は変更なしのため省略
async function callOpenAI(prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    const response = await fetch(OPENAI_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: prompt }], response_format: { type: "json_object" } })
    });
    const data = await response.json();
    return Object.values(JSON.parse(data.choices[0].message.content)).find(Array.isArray);
}

async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(`${GEMINI_API_BASE_URL}${MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } })
    });
    const data = await response.json();
    return Object.values(JSON.parse(data.candidates[0].content.parts[0].text)).find(Array.isArray);
}

// app.listen ではなく server.listen に変更
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});