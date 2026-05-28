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

  function sendToBrowser(obj) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify(obj));
    }
  }

  openaiWs.on("open", () => {
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: `
You are a professional real-time interpreter.

Rules:
- If the speaker talks in Japanese, translate into natural English.
- If the speaker talks in English, translate into natural Japanese.
- Detect the source language automatically.
- Output only the translation.
- Do not repeat the original text.
- Do not explain.
- Do not romanize Japanese unless it is a proper noun.
- Remove filler words naturally.
- Preserve academic and technical meaning.
`,
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper"
            },
            noise_reduction: {
              type: "near_field"
            }
          }
        }
      }
    }));

    sendToBrowser({ type: "proxy.connected" });
  });

  openaiWs.on("message", (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data.toString());
    }
  });

  openaiWs.on("error", (err) => {
    sendToBrowser({
      type: "error",
      message: err.message
    });
  });

  openaiWs.on("close", () => {
    sendToBrowser({ type: "proxy.disconnected" });
  });

  browserWs.on("message", (data) => {
    if (openaiWs.readyState !== WebSocket.OPEN) return;

    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (event.type === "session.input_audio_buffer.append") {
      openaiWs.send(JSON.stringify(event));
    }

    // stop時には閉じない。2回目以降も使うため。
    if (event.type === "session.close") {
      return;
    }
  });

  browserWs.on("close", () => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
