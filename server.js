const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Each browser connection gets its own OpenAI Realtime connection
wss.on('connection', (browserWs) => {
  console.log('Browser connected');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    browserWs.send(JSON.stringify({ type: 'error', message: 'OPENAI_API_KEY not set on server' }));
    browserWs.close();
    return;
  }

  // Connect to OpenAI Realtime API
  const openaiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    }
  );

  openaiWs.on('open', () => {
    console.log('OpenAI Realtime connected');
    browserWs.send(JSON.stringify({ type: 'proxy.connected' }));
  });

  // Forward OpenAI → Browser
  openaiWs.on('message', (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data.toString());
    }
  });

  openaiWs.on('error', (err) => {
    console.error('OpenAI WS error:', err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  openaiWs.on('close', () => {
    console.log('OpenAI WS closed');
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'proxy.disconnected' }));
    }
  });

  // Forward Browser → OpenAI
  browserWs.on('message', (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data.toString());
    }
  });

  browserWs.on('close', () => {
    console.log('Browser disconnected');
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
