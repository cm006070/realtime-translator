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
      message: "OPENAI_API_KEY is not set"
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

  let targetLanguage = "English";
  let responseInProgress = false;

  function sendToBrowser(obj) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify(obj));
    }
  }

  function sendToOpenAI(obj) {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify(obj));
    }
  }

  function createTranslationResponse() {
    if (responseInProgress) return;

    responseInProgress = true;

    sendToOpenAI({
      type: "response.create",
      response: {
        modalities: ["text"],
        instructions: `
Translate the latest completed user speech into ${targetLanguage}.

You are a professional conference interpreter.
Prioritize meaning and academic context over literal word order.

Rules:
- Output only the translation.
- Do not explain.
- Do not romanize Japanese words unless they are names.
- Translate technical terms naturally.
- If the source is Japanese, preserve implied context.
- 新結合 = new combination
- イノベーション = innovation
- シュンペーター = Schumpeter
`
      }
    });
  }

  openaiWs.on("open", () => {
    console.log("OpenAI Realtime connected");

    sendToOpenAI({
      type: "session.update",
      session: {
        type: "realtime",

        instructions: `
You are a professional real-time conference interpreter.
The user is listening to lectures, talks, and academic presentations.
Translate speech accurately and naturally.
`,

        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000
            },

            transcription: {
              model: "whisper-1"
            },

            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 900
            }
          }
        }
      }
    });

    sendToBrowser({ type: "proxy.connected" });
  });

  openaiWs.on("message", (data) => {
    let event;

    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (event.type === "error") {
      console.error("OpenAI error:", event);
      sendToBrowser({
        type: "error",
        message: event.error?.message || "OpenAI error"
      });
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      sendToBrowser({
        type: "transcript.completed",
        text: event.transcript || ""
      });
      return;
    }

    if (event.type === "response.text.delta") {
      sendToBrowser({
        type: "translation.delta",
        text: event.delta || ""
      });
      return;
    }

    if (event.type === "response.text.done") {
      sendToBrowser({
        type: "translation.done",
        text: event.text || ""
      });
      return;
    }

    if (event.type === "response.done") {
      responseInProgress = false;
      sendToBrowser({ type: "translation.finished" });
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      sendToBrowser({ type: "speech.started" });
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      sendToBrowser({ type: "speech.stopped" });

      setTimeout(() => {
        createTranslationResponse();
      }, 250);

      return;
    }
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI WS error:", err.message);
    sendToBrowser({
      type: "error",
      message: err.message
    });
  });

  openaiWs.on("close", () => {
    console.log("OpenAI WS closed");
    sendToBrowser({ type: "proxy.disconnected" });
  });

  browserWs.on("message", (data) => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "config") {
      targetLanguage = msg.targetLanguage || "English";
      return;
    }

    if (msg.type === "audio") {
      sendToOpenAI({
        type: "input_audio_buffer.append",
        audio: msg.audio
      });
      return;
    }

    if (msg.type === "close") {
      sendToOpenAI({ type: "session.close" });
      return;
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
  console.log(`Server running: http://localhost:${PORT}`);
});
