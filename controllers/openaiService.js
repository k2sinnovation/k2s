const fs = require("fs");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const FormData = require("form-data");
const axios = require("axios");
const path = require("path");

// generateTTS vocal (OK avec SDK, on garde)
async function generateTTS(text) {
  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "adam"",
      input: text,
      format: "mp3",
    });
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.error("Erreur génération TTS :", error);
    throw error;
  }
}

// Fonction askOpenAI optimisée : remplacer axios par SDK officielle
async function askOpenAI(prompt, userText) {
  try {
    console.log("🟡 Prompt system envoyé à OpenAI :\n", prompt);
    console.log("🟢 Message user envoyé à OpenAI :\n", userText);

    // Limiter userText pour éviter surcharge
    if (userText.length > 3000) {
      userText = userText.substring(0, 3000);
    }

    const completion = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userText },
      ],
    });

    console.log("✅ Réponse OpenAI reçue :\n", completion.choices[0].message.content);
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("❌ Erreur appel OpenAI :", error.response?.data || error.message);
    throw new Error("Erreur OpenAI");
  }
}

// transcription audio fichier (garde axios + formData si tu veux, sinon SDK)
// Ici tu peux garder ta version axios si ça marche bien (pas critique à changer)
async function transcribeAudio(filePath) {
  try {
    console.log("🟡 Début transcription audio, fichier :", filePath);
    let ext = path.extname(filePath);
    if (!ext) {
      const newFilePath = filePath + ".m4a";
      fs.renameSync(filePath, newFilePath);
      filePath = newFilePath;
      console.log("ℹ️ Fichier renommé avec extension :", filePath);
    } else {
      console.log("ℹ️ Extension fichier détectée :", ext);
    }
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append("file", fileStream);
    formData.append("model", "whisper-1");
    formData.append("language", "fr");
    console.log("📤 Envoi du fichier à OpenAI Whisper...");
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    console.log("✅ Transcription reçue :", response.data.text);
    return response.data.text;
  } catch (error) {
    console.error("❌ Erreur transcription Whisper :", error.response?.data || error.message);
    throw new Error("Erreur transcription Whisper");
  }
}

// transcription audio buffer : remplacer axios + formData par SDK + fichier temporaire
async function transcribeAudioBuffer(audioBuffer) {
  const tmpFile = path.join(__dirname, "temp_audio.wav");
  try {
    // écrire le buffer dans un fichier temporaire
    await fs.promises.writeFile(tmpFile, audioBuffer);

    // appel SDK OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      language: "fr",
    });

    await fs.promises.unlink(tmpFile);

    console.log("✅ Transcription reçue :", transcription.text);
    return transcription.text;
  } catch (error) {
    console.error("❌ Erreur transcription Whisper buffer :", error.response?.data || error.message);
    // supprimer fichier même en cas d'erreur
    try { await fs.promises.unlink(tmpFile); } catch {}
    throw new Error("Erreur transcription Whisper");
  }
}

module.exports = {
  generateTTS,
  askOpenAI,
  transcribeAudio,
  transcribeAudioBuffer,
};




