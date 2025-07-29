const axios = require("axios");

async function callOpenAI(prompt, userText, model) {
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
}

exports.askOpenAI = async (prompt, userText) => {
  const preferredModel = "gpt-4o";
  const fallbackModel = "gpt-4";

  try {
    return await callOpenAI(prompt, userText, preferredModel);
  } catch (error) {
    if (error.response?.data?.error?.code === "model_not_found" || 
        error.response?.data?.error?.message.includes("does not have access")) {
      console.warn(`Modèle ${preferredModel} non accessible, fallback vers ${fallbackModel}`);
      return await callOpenAI(prompt, userText, fallbackModel);
    }
    throw error;
  }
};
