const axios = require("axios");

exports.filter = async (text) => {
  const response = await axios.post(`http://localhost:${process.env.MISTRAL_PORT}/v1/chat/completions`, {
    model: "mistral",
    messages: [
      {
        role: "user",
        content: `Analyse cette demande : ${text}. Est-ce un diagnostic ou un choix technique ? Sinon, répond "rejeté".`
      }
    ],
    temperature: 0.2
  });

  return response.data.choices[0].message.content;
};
