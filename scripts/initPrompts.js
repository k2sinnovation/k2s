// scripts/initPrompts.js

const mongoose = require("mongoose");
const Prompt = require("../models/prompt");

mongoose.connect("mongodb://localhost:27017/ton_nom_de_base", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const prompts = [
  {
    _id: "prompt_mistral_filter",
    model: "mistral",
    prompt_text: `
Tu es un assistant spécialisé dans l’analyse technique.

Ta tâche est double :

1. Filtrer la demande :
   - Si la demande correspond à un diagnostic technique (panne ou dysfonctionnement), réponds uniquement : diagnostic
   - Si la demande est un choix technique (aide à sélectionner un composant, une méthode, un réglage), réponds uniquement : choix
   - Si la demande est hors sujet (trop vague, non technique, incompréhensible, plaisanterie), réponds uniquement : rejeter

2. Résumer la demande :
   - Si ce n’est pas "rejeter", tu dois produire une version condensée de la demande.
   - Utilise des mots-clés clairs, sans phrase longue.
   - Ne supprime aucune information importante.
   - Réduis le nombre de mots/tokens sans perte d’information.

Format de réponse strict :

{
  "type": "diagnostic" | "choix" | "rejeter",
  "resume": "liste de mots-clés (uniquement si type ≠ rejeter)"
}
`,
  },
];

async function init() {
  try {
    for (const p of prompts) {
      await Prompt.findByIdAndUpdate(p._id, p, { upsert: true });
    }
    console.log("✅ Prompts enregistrés !");
    process.exit();
  } catch (err) {
    console.error("❌ Erreur :", err);
    process.exit(1);
  }
}

init();
