const express = require("express");
const axios = require("axios");
const fs = require("fs");
const speech = require("@google-cloud/speech");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔽 Google STT client (Render-compatible)
const client = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
});

// 🔽 Download file
async function downloadFile(url, path) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  const writer = fs.createWriteStream(path);
  res.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// 🔽 Transcribe (Google STT)
async function transcribe(filePath) {
  const file = fs.readFileSync(filePath);
  const audioBytes = file.toString("base64");

  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "en-IN",
      alternativeLanguageCodes: ["hi-IN"],
      enableAutomaticPunctuation: true
    },
  };

  const [response] = await client.recognize(request);

  const transcript = response.results
    .map(r => r.alternatives[0].transcript)
    .join("\n");

  return transcript;
}

// 🔽 WEBHOOK
app.post("/webhook", async (req, res) => {
  const { event, data } = req.body;

  const recordingId = data?.recording?.id;

  console.log("📩 Event:", event);
  console.log("📦 RAW WEBHOOK:", JSON.stringify(req.body, null, 2));

  if (event === "recording.done") {
    try {
      console.log("🎯 Processing recording:", recordingId);

      // 🔽 Get recording details from Recall
      const response = await axios.get(
        `https://ap-northeast-1.recall.ai/api/v1/recording/${recordingId}/`,
        {
          headers: {
            Authorization: `Token ${process.env.RECALL_API_KEY}`,
          },
        }
      );

      console.log("📦 FULL RESPONSE:", JSON.stringify(response.data, null, 2));

      // 🔥 FIXED parsing
      const recording =
        response.data.recording ||
        response.data.recordings?.[0] ||
        response.data;

      const media = recording?.media_shortcuts;

      console.log("📦 MEDIA:", JSON.stringify(media, null, 2));

      // 🔥 SMART FALLBACK (handles all Recall cases)
      const fileUrl =
        media?.audio?.data?.download_url ||
        media?.mixed_audio?.data?.download_url ||
        media?.video_mixed?.data?.download_url ||
        recording?.audio_url ||
        recording?.video_url;

      console.log("🎧 File URL:", fileUrl);

      if (!fileUrl) {
        console.log("❌ No audio/video found in response");
        return res.send("No media");
      }

      const filePath = "./meeting.wav";

      // 🔽 Download file
      console.log("⬇️ Downloading...");
      await downloadFile(fileUrl, filePath);

      // 🔽 Transcribe
      console.log("🧠 Transcribing...");
      const text = await transcribe(filePath);

      console.log("🧠 FINAL TRANSCRIPT:", text);

      fs.unlinkSync(filePath);

    } catch (error) {
      console.error("❌ ERROR:", error.response?.data || error.message);
    }
  }

  res.send("OK");
});

// health check
app.get("/", (req, res) => {
  res.send("Google STT backend running 🚀");
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});