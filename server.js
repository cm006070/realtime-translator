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

  let outputLanguage = "en"; // 初期値: 日本語 → 英語

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

  function updateSession() {
    if (openaiWs.readyState !== WebSocket.OPEN) return;

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
            language: outputLanguage
          }
        }
      }
    }));
  }

  openaiWs.on("open", () => {
    updateSession();
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

    if (event.type === "config") {
      if (event.direction === "ja-en") {
        outputLanguage = "en";
      }

      if (event.direction === "en-ja") {
        outputLanguage = "ja";
      }

      updateSession();
      return;
    }

    if (event.type === "session.input_audio_buffer.append") {
      openaiWs.send(JSON.stringify(event));
      return;
    }

    // stop時は閉じない
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
