const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const FormData = require("form-data");
const axios = require("axios");
const path = require("path");
const { promptTTSVocal } = require("../utils/promptsTTSVocal"); // nouveau fichier prompts

// generateTTS vocal (OK avec SDK, on garde)
async function generateTTS(text) {
  try {
    // 1️⃣ Transformer le texte avec GPT pour style Lydia
    const styledTextResponse = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [
        { role: "system", content: promptTTSVocal }, // prompt vocal Lydia
        { role: "user", content: text },
      ],
    });
    const styledText = styledTextResponse.choices[0].message.content;

    // 2️⃣ Générer TTS à partir du texte stylisé
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "shimmer",
      input: styledText, // texte stylisé
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

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "fr",
    });
    console.log("✅ Transcription reçue :", transcription.text);
    return transcription.text;
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
    // supprimer fichier même en cas d’erreur
    try {
      await fs.promises.unlink(tmpFile);
    } catch {}
    throw new Error("Erreur transcription Whisper");
  }
}

module.exports = { generateTTS, askOpenAI, transcribeAudio, transcribeAudioBuffer };
