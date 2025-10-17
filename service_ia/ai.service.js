const OpenAI = require('openai');
const User = require('../models/User');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateResponse(messageText, user) {
  // Charger le contexte utilisateur
  const settings = await user.getAISettings();
  const recentMessages = await user.getRecentMessages(10);
  
  const systemPrompt = `
Tu es l'assistant virtuel de ${user.businessName}.

Contexte métier :
${settings.businessContext}

Horaires d'ouverture :
${JSON.stringify(settings.schedule)}

Instructions spécifiques :
${settings.promptInstructions}

Historique récent :
${recentMessages.map(m => `Client: ${m.text}\nVous: ${m.response}`).join('\n')}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: messageText }
    ],
    temperature: 0.7,
  });
  
  return completion.choices[0].message.content;
}

module.exports = { generateResponse };
