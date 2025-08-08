const fs = require('fs');
const axios = require("axios");
const FormData = require('form-data');  // instancier ici pour éviter répétition

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

    console.log("📤 Envoi du fichier à OpenAI Whisper avec headers :", formData.getHeaders());

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
