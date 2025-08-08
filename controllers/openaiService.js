const fs = require('fs');
const axios = require("axios");
const FormData = require('form-data');  // instancier ici pour éviter répétition

exports.askOpenAI = async (prompt, userText) => {
  try {
    console.log("🟡 Prompt system envoyé à OpenAI :\n", prompt);
    console.log("🟢 Message user envoyé à OpenAI :\n", userText);
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "chatgpt-4o-latest",
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
    console.error("Erreur appel OpenAI :", error.response?.data || error.message);
    throw new Error("Erreur OpenAI");
  }
};

// POUR LA TRANSCRIBE AUDIO avec logs améliorés
exports.transcribeAudio = async (filePath) => {
  try {
    console.log("🟡 Début transcription audio, fichier :", filePath);

    const fileExtension = filePath.split('.').pop();
    console.log("ℹ️ Extension fichier :", fileExtension);

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
