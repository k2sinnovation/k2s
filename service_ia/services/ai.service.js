const axios = require('axios');

class AIService {
  
  /**
   * 🔍 Analyser un message (avec historique optionnel)
   */
  async analyzeMessage(message, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante');
    }

    // ✅ Construire le contexte de conversation
    let conversationContext = '';
    if (conversationHistory.length > 0) {
      conversationContext = '\n\nHISTORIQUE DE LA CONVERSATION:\n';
      conversationHistory.slice(-3).forEach((msg, index) => {
        conversationContext += `[Message ${index + 1}]\n`;
        conversationContext += `De: ${msg.from}\n`;
        conversationContext += `Corps: ${msg.body}\n\n`;
      });
    }

    const systemPrompt = `Tu es un assistant qui analyse les emails pour "${settings.salonName || user.businessName}".

Activité: ${settings.role}

Un message est PERTINENT s'il concerne:
- Demande d'informations sur les services/tarifs/horaires
- Prise, modification ou annulation de rendez-vous
- Questions sur les prestations

Un message est NON PERTINENT s'il concerne:
- Spam ou publicité
- Questions personnelles sans lien avec l'activité
- Offres commerciales
- Messages génériques

${conversationHistory.length > 0 ? 'IMPORTANT: Tiens compte de l\'historique de conversation pour comprendre le contexte.' : ''}

Analyse avec précision.`;

    const userMessage = `${conversationContext}

MESSAGE À ANALYSER:
De: ${message.from}
Objet: ${message.subject || 'Aucun'}
Corps: ${message.body}

Réponds UNIQUEMENT au format JSON:
{
  "is_relevant": true/false,
  "confidence": 0.0-1.0,
  "intent": "demande_info|prise_rdv|modification_rdv|annulation_rdv|autre",
  "reason": "explication courte"
}`;

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 150
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);

      return analysis;

    } catch (error) {
      console.error('❌ Erreur appel OpenAI:', error.message);
      if (error.response) {
        console.error('Détails:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * 🤖 Générer une réponse (avec historique conversation)
   */
  async generateResponse(message, analysis, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante');
    }

    if (!analysis.is_relevant) {
      return this._generateOutOfScopeResponse(settings, user);
    }

    const fullContext = await user.buildAIContext();

    // ✅ Construire l'historique complet de la conversation
    let conversationContext = '';
    if (conversationHistory.length > 0) {
      conversationContext = '\n\nHISTORIQUE DE LA CONVERSATION:\n';
      
      // Garder les 5 derniers messages pour économiser tokens
      conversationHistory.slice(-5).forEach((msg, index) => {
        const isFromClient = !msg.from.includes(settings.ownerEmail || user.email);
        conversationContext += `[${isFromClient ? 'CLIENT' : 'VOUS'}]\n`;
        conversationContext += `${msg.body}\n\n`;
      });
      
      conversationContext += '---\n\n';
    }

    let specificInstructions = '';

    switch (analysis.intent) {
      case 'prise_rdv':
        specificInstructions = `Le client souhaite prendre rendez-vous. Tu dois:
1. ${conversationHistory.length > 0 ? 'Continuer la conversation naturellement en tenant compte de ce qui a déjà été dit' : 'Confirmer la prestation souhaitée'}
2. ${conversationHistory.length > 0 ? 'Ne PAS répéter les questions déjà posées' : 'Proposer 3 créneaux disponibles dans les 7-14 prochains jours'}
3. Demander SEULEMENT les informations manquantes
4. Préciser que le RDV sera confirmé sous 24h`;
        break;

      case 'modification_rdv':
        specificInstructions = `Le client souhaite modifier un rendez-vous. Tu dois:
1. ${conversationHistory.length > 0 ? 'Continuer la conversation en tenant compte du contexte' : 'Demander la date/heure du RDV actuel'}
2. Proposer de nouveaux créneaux disponibles
3. Confirmer que la modification sera validée`;
        break;

      case 'annulation_rdv':
        specificInstructions = `Le client souhaite annuler un rendez-vous. Tu dois:
1. ${conversationHistory.length > 0 ? 'Traiter l\'annulation en tenant compte du contexte' : 'Demander la date/heure du RDV'}
2. Confirmer l'annulation avec empathie
3. Proposer de reprendre RDV ultérieurement`;
        break;

      case 'demande_info':
        specificInstructions = `Le client demande des informations. Tu dois:
1. ${conversationHistory.length > 0 ? 'Continuer naturellement la conversation' : 'Répondre avec précision en te basant UNIQUEMENT sur le contexte'}
2. Ne PAS inventer d'informations
3. Ne PAS répéter ce qui a déjà été dit
4. Proposer un RDV si pertinent
5. Rester concis et clair`;
        break;
    }

    const systemPrompt = `${fullContext}

${conversationContext}

${specificInstructions}

RÈGLES CRITIQUES:
- Tu es dans une CONVERSATION CONTINUE, pas un premier contact
- NE RÉPÈTE JAMAIS les informations déjà échangées
- NE REPOSE PAS les questions déjà posées
- Fais référence aux messages précédents si pertinent
- Réponds UNIQUEMENT aux questions liées à "${settings.salonName || user.businessName}"
- Vérifie TOUJOURS les créneaux avant de les proposer
- Ne confirme JAMAIS automatiquement un RDV
- Utilise un ton ${settings.tone || 'professionnel'}
- Sois précis avec horaires et tarifs
- Si tu ne sais pas, dis-le et propose de contacter directement`;

    const userMessage = `MESSAGE DU CLIENT:
De: ${message.from}
Objet: ${message.subject || 'Aucun'}
Corps: ${message.body}

Génère une réponse professionnelle qui CONTINUE la conversation naturellement.`;

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: settings.aiModel || 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: settings.temperature || 0.7,
          max_tokens: settings.maxTokens || 500
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.choices[0].message.content;

    } catch (error) {
      console.error('❌ Erreur génération réponse:', error.message);
      if (error.response) {
        console.error('Détails:', error.response.data);
      }
      throw error;
    }
  }

  _generateOutOfScopeResponse(settings, user) {
    return `Bonjour,

Merci pour votre message.

Je suis un assistant automatique dédié uniquement aux demandes concernant ${settings.salonName || user.businessName} (rendez-vous, prestations, horaires).

Pour toute autre demande, contactez :
📧 ${settings.ownerEmail || user.email}
📞 ${settings.ownerPhone || 'Nous contacter'}

Cordialement,
Assistant ${settings.salonName || user.businessName}`;
  }
}

module.exports = new AIService();
