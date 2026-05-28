const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (browserWs) => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    browserWs.send(JSON.stringify({
      type: "error",
      message: "OPENAI_API_KEY is not set"
    }));
    browserWs.close();
    return;
  }

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  );

  openaiWs.on("open", () => {
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper"
            },
            noise_reduction: {
              type: "near_field"
            }
          },
          output: {
            language: "en"
          }
        }
      }
    }));

    browserWs.send(JSON.stringify({
      type: "proxy.connected"
    }));
  });

  openaiWs.on("message", (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data.toString());
    }
  });

  openaiWs.on("error", (err) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({
        type: "error",
        message: err.message
      }));
    }
  });

  openaiWs.on("close", () => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({
        type: "proxy.disconnected"
      }));
    }
  });

  browserWs.on("message", (data) => {
    if (openaiWs.readyState !== WebSocket.OPEN) return;

    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }

    // browser側からは audio chunk だけ通す
    if (event.type === "session.input_audio_buffer.append") {
      openaiWs.send(JSON.stringify(event));
    }

    if (event.type === "session.close") {
      openaiWs.send(JSON.stringify({ type: "session.close" }));
    }
  });

  browserWs.on("close", () => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify({ type: "session.close" }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
