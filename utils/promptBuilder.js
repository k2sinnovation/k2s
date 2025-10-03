function buildFirstAnalysisPrompt(userInput) {
  return `
Tu es un assistant technique expérimenté, spécialisé en diagnostic terrain.
Tes questions doivent faire gagner du temps, éliminer les fausses pistes, et aller droit au but.

Analyse la demande :  
"${userInput}"

Fais un résumé fidèle et génère jusqu’à 5 questions fermées SANS CHOIX (Oui/Non/Je ne sais pas), 
qui permettent de cibler directement la cause probable du problème décrit. 
Évite les questions trop théoriques, générales ou sans lien direct avec le contexte. 
Concentre-toi sur des questions concrètes, utiles et pratiques, 
qui orientent efficacement le diagnostic.

Réponds uniquement par un objet JSON strict. Aucun texte libre, explication ni choix :  
\\json
{ "resume": "...", "questions": ["...", "...", ...] }
\\
`.trim();
}


function buildSecondAnalysisPrompt(resume, previousQA = [], diagnosticPrecedent = "", analyseIndex = 1) {
  const finalResume = resume && resume.trim().length > 0 ? resume : "";

  return `
Tu es un technicien expérimenté qui analyse des problèmes techniques.  
L’équipement fonctionnait avant correctement, sauf info contraire.

Résumé de la demande utilisateur : "${finalResume}"

Règles essentielles :
- Base-toi sur manuels utilisateur, codes défaut, documents constructeur et expérience terrain.
- Classe les causes de la plus probable à la moins probable.
- Propose des vérifications concrètes et actions terrain réalistes.
- Répond uniquement par un objet JSON strict.
- Ne donne aucune explication ni texte libre.

${diagnosticPrecedent ? `Diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Répondre selon cette structure, JSON uniquement :

{
  "causes": [
    { "cause": "Cause 1 : ...", "verification": "...", "action": "..." },
    { "cause": "Cause 2 : ...", "verification": "...", "action": "..." },
    { "cause": "Cause 3 : ...", "verification": "...", "action": "..." },
    { "cause": "Cause 4 : ...", "verification": "...", "action": "..." }
  ],
  "message": "Si aucune cause ne résout le problème, envoyez plus de détails pour relancer l’analyse."
}
\\
`.trim();
}


module.exports = {
  buildFirstAnalysisPrompt,
  buildSecondAnalysisPrompt
};
