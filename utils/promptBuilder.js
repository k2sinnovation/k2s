// utils/promptBuilder.js

function buildFirstAnalysisPrompt(userInput) {
  return `
Tu es Lydia, une IA spécialisée en diagnostic technique. L'utilisateur t'a décrit un problème :

"${userInput}"

Ta mission est de :
1. **Résumer** le problème en une seule phrase simple.
2. **Générer 5 questions fermées** (réponse : Oui / Non / Je ne sais pas) pour affiner la recherche du problème.

Réponds uniquement au format JSON suivant :

{
  "resume": "Résumé clair du problème",
  "questions": [
    "Question 1 ?",
    "Question 2 ?",
    "Question 3 ?",
    "Question 4 ?",
    "Question 5 ?"
  ]
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
Tu es LYDIA, une intelligence spécialisée en diagnostic terrain dans le domaine suivant : ${domaine}.

Voici le résumé actuel de la demande utilisateur :
"${resume}"

${diagnosticPrecedent ? `Résumé du diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Voici les questions posées et leurs réponses :
${qaFormatted}

Ta tâche est maintenant de fournir un **diagnostic structuré**, comprenant :
1. Une **hypothèse principale** de la panne
2. D'autres **causes possibles**
3. Les **vérifications techniques** à faire (claires et simples)

Écris de façon synthétique, structurée et facile à lire pour un technicien terrain.
  `.trim();
}


function buildFinalDiagnosisPrompt(resume, questions, answers, previousDiagnosis) {
  return `
Tu es Lydia, IA experte en diagnostic technique.

Résumé global :
"${resume}"

Questions et réponses utilisateur :
1. ${questions[0]} → ${answers[0]}
2. ${questions[1]} → ${answers[1]}
3. ${questions[2]} → ${answers[2]}
4. ${questions[3]} → ${answers[3]}
5. ${questions[4]} → ${answers[4]}

Diagnostic précédent :
${previousDiagnosis || 'Non spécifié'}

⚠️ Malgré deux analyses, la panne persiste.

Propose un dernier diagnostic avec 4 causes possibles maximum, sous ce format :

{
  "diagnostics": [
    { "cause": "Cause possible 1", "verification": "Action à faire" },
    ...
  ],
  "message": "Si vous n’avez toujours pas trouvé la solution, contactez le fabricant ou le fournisseur."
}

Pas de commentaires, pas de répétition des questions. Réponds strictement en JSON.
`;
}
module.exports = {
  buildFirstAnalysisPrompt,
  buildAnswerPrompt,
  buildFinalDiagnosisPrompt
};
