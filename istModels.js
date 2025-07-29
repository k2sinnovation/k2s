require('dotenv').config();
const axios = require('axios');

async function listModels() {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });
    console.log("Modèles accessibles :");
    response.data.data.forEach(model => {
      console.log(`- ${model.id}`);
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des modèles :", error.response?.data || error.message);
  }
}

listModels();
