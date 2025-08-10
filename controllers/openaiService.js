const axios = require("axios");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const FormData = require("form-data");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// generateTTS vocal 
async function generateTTS(text) {
  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",     // tu peux changer la voix si tu veux
      input: text,
      format: "wav"       // format mp3, tu peux aussi essayer wav
    });

    // Récupérer le buffer audio (la réponse est un ReadableStream ou Blob selon version)
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);

  } catch (error) {
    console.error("Erreur génération TTS :", error);
    throw error;
  }
}

module.exports = {
  // ... tes autres exports
  generateTTS,
};

// === Fonction pour appeler OpenAI Chat ===
exports.askOpenAI = async (prompt, userText) => {
  try {
    console.log("🟡 Prompt system envoyé à OpenAI :\n", prompt);
    console.log("🟢 Message user envoyé à OpenAI :\n", userText);

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "chatgpt-4o-latest", // plus rapide
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userText }
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    console.log("✅ Réponse OpenAI reçue :\n", response.data.choices[0].message.content);
    return response.data.choices[0].message.content;

  } catch (error) {
    console.error("❌ Erreur appel OpenAI :", error.response?.data || error.message);
    throw new Error("Erreur OpenAI");
  }
};

// === Fonction pour transcription audio avec Whisper ===
exports.transcribeAudio = async (filePath) => {
  try {
    console.log("🟡 Début transcription audio, fichier :", filePath);

    // Vérifier extension
    let ext = path.extname(filePath);
    if (!ext) {
      const newFilePath = filePath + '.wav'; // forcer extension .wav
      fs.renameSync(filePath, newFilePath);
      filePath = newFilePath;
      console.log("ℹ️ Fichier renommé avec extension :", filePath);
    } else {
      console.log("ℹ️ Extension fichier détectée :", ext);
    }

    const fileStream = fs.createReadStream(filePath);

    const formData = new FormData();
    formData.append('file', fileStream);
    formData.append('model', 'whisper-1');
    formData.append('language', 'fr'); // Forcer la langue française

    console.log("📤 Envoi du fichier à OpenAI Whisper...");

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
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
};


