const express = require("express");
const axios = require("axios");
const fs = require("fs");
const speech = require("@google-cloud/speech");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔥 Setup ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// 🔽 Google STT client
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

// 🔽 Convert MP4 → WAV
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat("wav")
      .audioChannels(1)
      .audioFrequency(16000)
      .on("end", resolve)
      .on("error", reject)
      .save(output);
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

      // 🔽 Get recording details
      const response = await axios.get(
        `https://ap-northeast-1.recall.ai/api/v1/recording/${recordingId}/`,
        {
          headers: {
            Authorization: `Token ${process.env.RECALL_API_KEY}`,
          },
        }
      );

      console.log("📦 FULL RESPONSE:", JSON.stringify(response.data, null, 2));

      const recording =
        response.data.recording ||
        response.data.recordings?.[0] ||
        response.data;

      const media = recording?.media_shortcuts;

      console.log("📦 MEDIA:", JSON.stringify(media, null, 2));

      // 🔥 FINAL fallback (includes video_mixed)
      const fileUrl =
        media?.audio?.data?.download_url ||
        media?.mixed_audio?.data?.download_url ||
        media?.video_mixed?.data?.download_url ||
        recording?.audio_url ||
        recording?.video_url;

      console.log("🎧 File URL:", fileUrl);

      if (!fileUrl) {
        console.log("❌ No media found");
        return res.send("No media");
      }

      const videoPath = "./meeting.mp4";
      const audioPath = "./meeting.wav";

      // 🔽 Download video
      console.log("⬇️ Downloading video...");
      await downloadFile(fileUrl, videoPath);

      // 🔽 Convert to WAV
      console.log("🎧 Converting to WAV...");
      await convertToWav(videoPath, audioPath);

      // 🔽 Transcribe
      console.log("🧠 Transcribing...");
      const text = await transcribe(audioPath);

      console.log("🧠 FINAL TRANSCRIPT:", text);

      // 🔽 Cleanup
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);

    } catch (error) {
      console.error("❌ ERROR:", error.response?.data || error.message);
    }
  }

  res.send("OK");
});

// health check
app.get("/", (req, res) => {
  res.send("STT backend running 🚀");
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});