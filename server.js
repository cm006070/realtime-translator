const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

wss.on("connection", (browserWs) => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    safeSend(browserWs, {
      type: "error",
      message: "OPENAI_API_KEY is not set"
    });
    browserWs.close();
    return;
  }

  let outputLanguage = "en";          // ja-en => English output
  let audioMode = "meeting";          // meeting: online meeting speaker audio through mic
  let enableServerNoiseReduction = false;

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  );

  function safeSend(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function forwardToOpenAI(obj) {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify(obj));
    }
  }

  function updateSession() {
    if (openaiWs.readyState !== WebSocket.OPEN) return;

    const inputAudioConfig = {
      transcription: {
        model: "gpt-realtime-whisper"
      }
    };

    // Online meeting mode:
    // Do NOT force near_field noise reduction because the remote speaker is often
    // far-field / speaker-playback audio captured by the microphone.
    if (enableServerNoiseReduction && audioMode !== "meeting") {
      inputAudioConfig.noise_reduction = { type: "near_field" };
    }

    forwardToOpenAI({
      type: "session.update",
      session: {
        audio: {
          input: inputAudioConfig,
          output: {
            language: outputLanguage
          }
        }
      }
    });
  }

  openaiWs.on("open", () => {
    updateSession();
    safeSend(browserWs, { type: "proxy.connected" });
  });

  openaiWs.on("message", (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data.toString());
    }
  });

  openaiWs.on("error", (err) => {
    safeSend(browserWs, {
      type: "error",
      message: err.message
    });
  });

  openaiWs.on("close", () => {
    safeSend(browserWs, { type: "proxy.disconnected" });
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
      outputLanguage = event.direction === "en-ja" ? "ja" : "en";
      audioMode = event.audioMode === "myvoice" ? "myvoice" : "meeting";
      enableServerNoiseReduction = Boolean(event.enableServerNoiseReduction);
      updateSession();
      return;
    }

    // Reset stale audio buffer before starting a new local recording session.
    if (event.type === "client.reset_input_audio") {
      forwardToOpenAI({ type: "input_audio_buffer.clear" });
      // Some Realtime variants use the non-prefixed event name. Sending both is
      // intentionally avoided by default because unsupported events can error.
      return;
    }

    if (event.type === "session.input_audio_buffer.append") {
      forwardToOpenAI(event);
      return;
    }

    if (event.type === "session.close") {
      openaiWs.close();
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
