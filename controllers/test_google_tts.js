// test_google_tts.js

// Importer la bibliothèque Google Cloud Text-to-Speech
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');

// Crée un client
const client = new textToSpeech.TextToSpeechClient();

async function main() {
  try {
    const text = "Bonjour, comment ça va ? Ceci est un test de synthèse vocale.";

    // Construire la requête
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    // Exécuter la synthèse vocale
    const [response] = await client.synthesizeSpeech(request);

    // Écrire le fichier audio
    const writeFile = util.promisify(fs.writeFile);
    await writeFile('output.mp3', response.audioContent, 'binary');
    console.log('Fichier audio généré : output.mp3');
  } catch (error) {
    console.error('Erreur lors de la génération TTS :', error);
  }
}

// Lancer la fonction
main();
