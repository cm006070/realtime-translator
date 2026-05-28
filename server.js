const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (browserWs) => {
  console.log("Browser connected");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    browserWs.send(JSON.stringify({
      type: "error",
      message: "OPENAI_API_KEY not set"
    }));
    browserWs.close();
    return;
  }

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-realtime",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  );

  openaiWs.on("open", () => {
    console.log("OpenAI Realtime connected");

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions:
          "You are a live voice translator. Translate all user speech into English. Return only the English translation.",
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000
            },
            turn_detection: {
              type: "server_vad"
            }
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: 24000
            },
            voice: "alloy"
          }
        }
      }
    }));

    browserWs.send(JSON.stringify({ type: "proxy.connected" }));
  });

  openaiWs.on("message", (data) => {
    const text = data.toString();

    try {
      const event = JSON.parse(text);

      if (event.type === "error") {
        console.error("OpenAI error:", event.error || event);
      }

      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(text);
      }
    } catch {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(text);
      }
    }
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI WS error:", err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({
        type: "error",
        message: err.message
      }));
    }
  });

  openaiWs.on("close", (code, reason) => {
    console.log("OpenAI WS closed:", code, reason.toString());
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "proxy.disconnected" }));
    }
  });

  browserWs.on("message", (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data.toString());
    }
  });

  browserWs.on("close", () => {
    console.log("Browser disconnected");
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
