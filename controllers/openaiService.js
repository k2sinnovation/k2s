const axios = require("axios");

exports.askOpenAI = async (prompt, userText) => {
  try {
    console.log("🟡 Prompt system envoyé à OpenAI :\n", prompt);
    console.log("🟢 Message user envoyé à OpenAI :\n", userText);
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1", // plus rapide 
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

    let content = response.data.choices[0].message.content;
    console.log("✅ Réponse OpenAI brute reçue :\n", content);

    // Nettoyage du contenu brut
    let cleanedContent = content.trim();

    // Supprimer les balises de code Markdown ```json ou ```
    if (cleanedContent.startsWith("```json") || cleanedContent.startsWith("```")) {
      cleanedContent = cleanedContent.replace(/^```(?:json)?\s*/i, ""); // Enlève le début
      cleanedContent = cleanedContent.replace(/```$/, ""); // Enlève la fin
    }

    // Supprimer \json au début s'il existe
    if (cleanedContent.startsWith("\\json")) {
      cleanedContent = cleanedContent.replace(/^\\json\s*/i, "");
    }

    // Remplacer les guillemets typographiques par des guillemets simples ASCII
    cleanedContent = cleanedContent.replace(/[«»]/g, '"');

    let parsedContent;
    try {
      parsedContent = JSON.parse(cleanedContent); // Parse le JSON propre
    } catch (err) {
      console.error("Erreur JSON.parse :", err.message);
      // Si erreur de parsing, retourner le contenu brut
      parsedContent = content;
    }

    return parsedContent;

  } catch (error) {
    console.error("Erreur appel OpenAI :", error.response?.data || error.message);
    throw new Error("Erreur OpenAI");
  }
};
