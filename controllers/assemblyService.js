const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { promptTTSVocal } = require('../utils/promptsTTSVocal');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation de Google TTS
// Nouvelle version compatible clé API simple (REST)
fonction asynchrone generateGoogleTTSMP3(texte) {
  essayer {
    const apiKey = process.env.K2S_IQ_Speech_API ; // même nom que dans Render

    console.log("[Google TTS] Texte envoyé :", text);
    const réponse = await axios.post(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
    entrée : { texte },
    voix: {
      Code de langue : 'fr-FR',
      nom : 'fr-FR-Chirp3-HD-Leda', // Voix féminine naturelle et douce
      ssmlGender : « FEMME »
    },
    audioConfig: { audioEncoding: "LINEAR16" } // reste identique
  }
);
    console.log("[Google TTS] Réponse reçue. Taille Base64 :", réponse.data.audioContent.length);

    // La réponse contient maintenant le TTS en Base64 wav
    renvoyer response.data.audioContent;
  } catch (erreur) {
    console.error("Erreur TTS Google :", erreur);
    renvoie null;
  }
}





// ------------------------
// Assemblage de transcription AI
// ------------------------

// ------------------------
// AJOUT : décodage Base64 → Buffer
// ------------------------

fonction decodeBase64Audio(base64String) {
  // Supprime le préfixe si présent (ex: "data:audio/mp3;base64,")
  const base64Data = base64String.replace(/^data:audio\/\w+;base64,/, '');
  renvoie Buffer.from(base64Data, 'base64');
}

fonction asynchrone transcribeWithAssembly(audioInput, isBase64 = false) {
  essayer {
    console.log("[AssemblyAI] Préparation de l'audio...");
    const fileData = isBase64 ? decodeBase64Audio(audioInput) : fs.readFileSync(audioInput);

    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fichierData,
      {
        en-têtes : {
          autorisation : process.env.ASSEMBLYAI_API_KEY,
          'type-de-contenu' : 'application/octet-stream',
        },
      }
    );

    const uploadUrl = uploadResponse.data.upload_url;
    console.log(`[AssemblyAI] Audio uploadé : ${uploadUrl}`);

    console.log("[AssemblyAI] Création de la transcription...");
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
      { en-têtes : { autorisation : process.env.ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log(`[AssemblyAI] ID transcription : ${transcriptId}`);
    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    // --- Polling pour récupérer la transcription ---
    tandis que (vrai) {
      const résultat = await axios.get(pollingEndpoint, {
        en-têtes : { autorisation : process.env.ASSEMBLYAI_API_KEY },
      });

      si (result.data.status === 'terminé') {
        console.log(`[AssemblyAI] Transcription terminée : ${result.data.text}`);
        renvoyer result.data.text;
      } sinon si (result.data.status === 'erreur') {
        throw new Error(`Transcription échouée : ${result.data.error}`);
      } autre {
        console.log("[AssemblyAI] Transcription en cours...");
        attendre une nouvelle promesse (résolution => setTimeout (résolution, 3000));
      }
    }

  } attraper (err) {
    console.error("[AssemblyAI] Erreur lors du polling :", err.message);
    lancer une erreur;
  }
}


// ------------------------
// Processus complet Audio → AssemblyAI → GPT → TTS
// ------------------------
fonction asynchrone processAudioAndReturnJSON(fileOrBase64, isBase64 = false) {
  laissez tempfilePath = fileOrBase64;

  si (isBase64) {
    // Création d'un fichier temporaire à partir du Base64
    tempfilePath = `./temp_${Date.now()}.mp3`;
    fs.writeFileSync(tempfilePath , decodeBase64Audio(fileOrBase64));
    console.log(`[ProcessAudio] Fichier temporaire créé à partir du Base64 : ${tempfilePath }`);
  }
  laissez texteTranscrit = "";
  laissez gptResponse = "";
  laissez audioBase64 = null;

  console.log(`[ProcessAudio] Début traitement du fichier : ${tempfilePath }`);

  // 1️⃣ Transcription AssemblyAI
  essayer {
    texteTranscrit = await transcribeWithAssembly(tempfilePath );
    console.log(`[ProcessAudio] Texte transcrit : ${texteTranscrit}`);
  } catch (assemblyError) {
    console.error("Erreur AssemblyAI :", assemblyError.message);
    // on continue malgré l'erreur pour renvoyer ce qu'on a pu récupérer
  }

  // 2️⃣ GPT
// 2️⃣ GPT
essayer {
  const completion = await openai.chat.completions.create({
    modèle : "chatgpt-4o-latest",
    messages : [
      { rôle : « système », contenu : promptTTSVocal },
      { rôle : « utilisateur », contenu : texteTranscrit },
    ],
  });

  gptResponse = completion.choices[0].message.content;
  console.log(`[ProcessAudio] Réponse GPT : ${gptResponse}`);
} catch (gptError) {
  console.error("Erreur GPT (à la poursuite) :", gptError.message);
  gptResponse = "";
}


// 3️⃣ TTS
si (gptResponse) {
  essayer {
    // Nettoyage optionnel du texte GPT
    const cleanedText = gptResponse.trim();

    console.log(`[ProcessAudio] Texte envoyé à Google TTS : "${cleanedText}"`);
    audioBase64 = await generateGoogleTTSMP3(cleanedText);
    console.log(`[ProcessAudio] Audio Base64 généré. Taille : ${audioBase64.length}`);

  } catch (ttsError) {
    console.error("Erreur Google TTS (à la suite) :", ttsError.message);
    audioBase64 = null;
  }
}




  // Suppression du fichier temporaire
  essayer {
    si (fs.existsSync(tempfilePath )) fs.unlinkSync(tempfilePath );
    console.log(`[ProcessAudio] Fichier temporaire supprimé : ${tempfilePath }`);
  } catch (fsError) {
    console.error("Erreur suppression fichier :", fsError.message);
  }

  retour { transcription: texteTranscrit, gptResponse, audioBase64 };
}




// ------------------------
// Exporter
// ------------------------
module.exports = {
  transcrireAvecAssembly,
  générerGoogleTTSMP3,
  processAudioAndReturnJSON,
};
