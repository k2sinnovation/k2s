const axios = require('axios');

class AIService {
  
  /**
   * 🔍 Analyser un message
   */
  async analyzeMessage(message, user) {
    const settings = user.aiSettings;

    // ✅ CORRECTION : Utiliser la clé d'environnement
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante dans les variables d\'environnement');
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

Analyse avec précision.`;

    const userMessage = `Analyse ce message et détermine s'il concerne l'activité professionnelle:

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
          model: settings.aiModel || 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: settings.temperature || 0.7,
          max_tokens: 150
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`, // ✅ Clé d'environnement
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
   * 🤖 Générer une réponse
   */
  async generateResponse(message, analysis, user) {
    const settings = user.aiSettings;

    // ✅ CORRECTION : Utiliser la clé d'environnement
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante dans les variables d\'environnement');
    }

    if (!analysis.is_relevant) {
      return this._generateOutOfScopeResponse(settings, user);
    }

    // Construire le contexte complet
    const fullContext = await user.buildAIContext();

    let specificInstructions = '';

    switch (analysis.intent) {
      case 'prise_rdv':
        specificInstructions = `Le client souhaite prendre rendez-vous. Tu dois:
1. Confirmer la prestation souhaitée
2. Proposer 3 créneaux disponibles dans les 7-14 prochains jours
3. Vérifier la disponibilité dans le planning
4. Demander les coordonnées si manquantes (nom, téléphone, email)
5. Préciser que le RDV sera confirmé sous 24h`;
        break;

      case 'modification_rdv':
        specificInstructions = `Le client souhaite modifier un rendez-vous. Tu dois:
1. Demander la date/heure du RDV actuel
2. Proposer de nouveaux créneaux disponibles
3. Confirmer que la modification sera validée`;
        break;

      case 'annulation_rdv':
        specificInstructions = `Le client souhaite annuler un rendez-vous. Tu dois:
1. Demander la date/heure du RDV
2. Confirmer l'annulation avec empathie
3. Proposer de reprendre RDV ultérieurement`;
        break;

      case 'demande_info':
        specificInstructions = `Le client demande des informations. Tu dois:
1. Répondre avec précision en te basant UNIQUEMENT sur le contexte
2. Ne PAS inventer d'informations
3. Proposer un RDV si pertinent
4. Rester concis et clair`;
        break;
    }

    const systemPrompt = `${fullContext}

${specificInstructions}

RÈGLES CRITIQUES:
- Réponds UNIQUEMENT aux questions liées à "${settings.salonName || user.businessName}"
- Vérifie TOUJOURS les créneaux avant de les proposer
- Ne confirme JAMAIS automatiquement un RDV
- Utilise un ton ${settings.tone || 'professionnel'}
- Sois précis avec horaires et tarifs
- Si tu ne sais pas, dis-le et propose de contacter directement`;

    const userMessage = `Message du client:
De: ${message.from}
Objet: ${message.subject || 'Aucun'}
Corps: ${message.body}

Génère une réponse professionnelle et complète.`;

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
            'Authorization': `Bearer ${apiKey}`, // ✅ Clé d'environnement
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

  /**
   * Réponse hors-cadre
   */
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
