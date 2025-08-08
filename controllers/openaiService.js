// controllers/openaiService.js
const fs = require('fs');
const axios = require("axios");

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
    console.error("Erreur appel OpenAI :", error.response?.data || error.message);
    throw new Error("Erreur OpenAI");
  }
};

//POUR LA TRASNCRIBE AUDIO
exports.transcribeAudio = async (filePath) => {
  try {
    const fileStream = fs.createReadStream(filePath);

    const formData = new require('form-data')();
    formData.append('file', fileStream);
    formData.append('model', 'whisper-1');

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
    return response.data.text;
  } catch (error) {
    console.error("Erreur transcription Whisper :", error.response?.data || error.message);
    throw new Error("Erreur transcription Whisper");
  }
};





