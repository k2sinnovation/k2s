// utils/promptBuilder.js

function buildFirstAnalysisPrompt(userInput) {
  return `
Tu es, une IA spécialisée en diagnostic technique. L'utilisateur t'a décrit un problème :

"${userInput}"

Ta mission est de :
1. **Résumer** le problème en une seule phrase simple.
2. **Générer 5 questions fermées sans choix** (réponse : Oui / Non / Je ne sais pas) pour affiner la recherche du problème.

Ne réponds que par un objet JSON strict, sans aucun texte avant ou après.
Format exact :
{
  "resume": "...",
  "questions": ["...", "...", "...", "...", "..."]
}


- Ne donne aucune explication ni texte en dehors du JSON.
- Chaque question doit être brève, pratique et adaptée à un technicien terrain.
- Ne jamais poser de question hors sujet (ex : météo, humeur).
- Utilise un langage simple et direct.
`;
}

module.exports = {
  buildFirstAnalysisPrompt
};

function buildSecondAnalysisPrompt(domaine, resume, previousQA, diagnosticPrecedent = "") {
  const qaFormatted = previousQA.map((item, idx) =>
    `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`
  ).join('\n\n');

  return `
Tu es, une intelligence spécialisée en diagnostic terrain.

Voici le résumé actuel de la demande utilisateur :
"${resume}"

${diagnosticPrecedent ? `Résumé du diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Voici les questions posées et leurs réponses :
${qaFormatted}

Ta tâche est maintenant de fournir 4 cause avec ça verification structuré, comprenant :
1. **Cause 1** 
    "..."
   **Vérification**
     "..."

2. **Cause 1** 
    "..."
   **Vérification**
     "..."

3. **Cause 1** 
    "..."
   **Vérification**
     "..."

4. **Cause 1** 
    "..."
   **Vérification**
     "..."

Écris de façon synthétique, structurée et facile à lire pour un technicien terrain.
  `.trim();
}

function buildFinalAnalysisPrompt(domaine, fullHistory, diagnosticPrecedent, questionsReponses) {
  const qaFormatted = questionsReponses.map((item, idx) =>
    `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`
  ).join('\n\n');

  return `
Tu es, une intelligence de diagnostic spécialisée dans le domaine suivant : ${domaine}.

🛑 Malgré les deux précédentes analyses, la panne n’est toujours pas résolue.

Voici l'historique complet des échanges avec l'utilisateur :
${fullHistory}

Résumé du diagnostic précédent :
${diagnosticPrecedent}

Voici les questions déjà posées et leurs réponses :
${qaFormatted}

Maintenant, ta tâche est de proposer une **liste finale de 4 causes probables maximum**, claires et concises.

Structure ta réponse comme suit :
1. Cause probable 1 : ...
2. Cause probable 2 : ...
3. Cause probable 3 : ...
4. Cause probable 4 : ...

Conclue avec ce message :
"Si vous n'avez toujours pas trouvé la solution, veuillez contacter le fabricant ou fournisseur."

Réponse structurée, directe et destinée à un technicien terrain.
`.trim();
}

module.exports = {
  buildFirstAnalysisPrompt,
  buildSecondAnalysisPrompt,
  buildFinalAnalysisPrompt
};
