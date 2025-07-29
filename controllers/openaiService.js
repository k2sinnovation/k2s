const axios = require("axios");

exports.askOpenAI = async (prompt, userText, model = "gpt-4o") => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userText }
        ],
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Organization": process.env.OPENAI_ORG_ID,
          "OpenAI-Project": process.env.OPENAI_PROJECT_ID,
          "Content-Type": "application/json"
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Erreur appel OpenAI :", JSON.stringify(error.response?.data || error.message, null, 2));
    throw new Error("Erreur OpenAI");
  }
};
