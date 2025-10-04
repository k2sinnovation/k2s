const WebSocket = require("ws");

// Stocker les sockets GPT par deviceId pour streaming multiple
const gptSockets = new Map(); // Map<deviceId, WebSocket GPT temps réel>

/**
 * Envoie un chunk audio PCM à GPT et commit si demandé
 * @param {string} deviceId - ID du device Flutter
 * @param {string} audioBase64 - chunk audio PCM Base64
 * @param {Map} wsClients - Map<deviceId, { ws: WebSocket }>
 * @param {boolean} commit - true si c'est le dernier chunk du segment
 */
async function processAudioChunk(deviceId, audioBase64, wsClients, commit = false) {
  console.log(`[Assembly][${deviceId}] 📥 Réception chunk (longueur: ${audioBase64.length} chars, commit: ${commit})`);
  
  // Nettoyage du Base64
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");
  console.log(`[Assembly][${deviceId}] 🔄 Buffer créé: ${audioBuffer.length} bytes`);

  // Créer socket GPT si n'existe pas
  if (!gptSockets.has(deviceId)) {
    console.log(`[Assembly][${deviceId}] 🆕 Création nouvelle connexion GPT...`);
    
    const wsGPT = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      { 
        headers: { 
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        } 
      }
    );

    let responseText = "";

    wsGPT.on("open", () => {
      console.log(`[GPT][${deviceId}] ✅ Connexion WebSocket ouverte`);
      
      // Configuration de la session
      wsGPT.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: "Tu es un assistant vocal intelligent. Réponds de manière concise et naturelle.",
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1"
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      }));
      console.log(`[GPT][${deviceId}] ⚙️ Session configurée`);
    });

    wsGPT.on("message", (data) => {
      let msg;
      try { 
        msg = JSON.parse(data.toString()); 
      } catch (e) { 
        console.warn(`[GPT][${deviceId}] ⚠️ Erreur parsing message:`, e.message); 
        return; 
      }

      // Log de tous les messages pour debug
      console.log(`[GPT][${deviceId}] 📨 Type reçu: ${msg.type}`);

      // Récupération du client Flutter
      const clientData = wsClients.get(deviceId);
      if (!clientData || !clientData.ws) {
        console.warn(`[GPT][${deviceId}] ⚠️ Client Flutter non trouvé ou déconnecté`);
        return;
      }
      const wsClient = clientData.ws;

      if (wsClient.readyState !== WebSocket.OPEN) {
        console.warn(`[GPT][${deviceId}] ⚠️ WebSocket Flutter pas ouvert (state: ${wsClient.readyState})`);
        return;
      }

      // === Gestion Transcription Audio Input ===
      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        console.log(`[GPT][${deviceId}] 🎤 Transcription: "${msg.transcript}"`);
        wsClient.send(JSON.stringify({
          type: 'input_transcription',
          deviceId,
          transcript: msg.transcript,
          index: Date.now(),
        }));
      }

      // === Gestion Texte Incrémental ===
      if (msg.type === "response.text.delta") {
        const delta = msg.delta || '';
        responseText += delta;
        console.log(`[GPT][${deviceId}] 📝 Texte delta: "${delta}"`);
        
        wsClient.send(JSON.stringify({
          type: 'response.output_audio_transcript.delta',
          deviceId,
          delta: delta,
          index: Date.now(),
        }));
      }

      // === Gestion Audio PCM Incrémental ===
      if (msg.type === "response.audio.delta") {
        const audioChunk = msg.delta;
        console.log(`[GPT][${deviceId}] 🔊 Audio delta reçu: ${audioChunk ? audioChunk.length : 0} chars`);
        
        wsClient.send(JSON.stringify({
          type: 'response.output_audio.delta',
          deviceId,
          delta: audioChunk,
          index: Date.now(),
        }));
      }

      // === Gestion Audio Transcript ===
      if (msg.type === "response.audio_transcript.delta") {
        console.log(`[GPT][${deviceId}] 📢 Audio transcript: "${msg.delta}"`);
        wsClient.send(JSON.stringify({
          type: 'response.output_audio_transcript.delta',
          deviceId,
          delta: msg.delta,
          index: Date.now(),
        }));
      }

      // === Fin de Réponse ===
      if (msg.type === "response.done") {
        console.log(`[GPT][${deviceId}] ✅ Réponse complète (texte: "${responseText}")`);
        
        wsClient.send(JSON.stringify({
          type: 'response.completed',
          deviceId,
          fullText: responseText,
          index: Date.now(),
        }));
        
        responseText = ""; // Reset pour prochaine réponse
      }

      // === Erreurs ===
      if (msg.type === "error") {
        console.error(`[GPT][${deviceId}] ❌ Erreur GPT:`, msg.error?.message || JSON.stringify(msg));
        wsClient.send(JSON.stringify({
          type: 'gpt_error',
          deviceId,
          error: msg.error?.message || 'Erreur inconnue',
          index: Date.now(),
        }));
      }

      // === Session Update ===
      if (msg.type === "session.created" || msg.type === "session.updated") {
        console.log(`[GPT][${deviceId}] ⚙️ Session: ${msg.type}`);
      }
    });

    wsGPT.on("close", () => {
      console.log(`[GPT][${deviceId}] 🔌 Connexion WebSocket fermée`);
      gptSockets.delete(deviceId);
    });

    wsGPT.on("error", (err) => {
      console.error(`[GPT][${deviceId}] ❌ Erreur WebSocket:`, err.message);
      gptSockets.delete(deviceId);
    });

    gptSockets.set(deviceId, wsGPT);
    
    // Attendre que la connexion soit établie avant d'envoyer
    await new Promise((resolve) => {
      if (wsGPT.readyState === WebSocket.OPEN) {
        resolve();
      } else {
        wsGPT.once('open', resolve);
      }
    });
  }

  // Envoyer chunk audio à GPT
  const wsGPT = gptSockets.get(deviceId);
  
  if (!wsGPT || wsGPT.readyState !== WebSocket.OPEN) {
    console.error(`[Assembly][${deviceId}] ❌ Socket GPT non disponible ou fermé`);
    return;
  }

  const audioPayload = {
    type: "input_audio_buffer.append",
    audio: audioBuffer.toString("base64"),
  };
  
  wsGPT.send(JSON.stringify(audioPayload));
  console.log(`[Assembly][${deviceId}] 📤 Chunk envoyé à GPT (${audioBuffer.length} bytes)`);

  // Commit + création réponse si c'est le dernier chunk
  if (commit) {
    console.log(`[Assembly][${deviceId}] 🏁 Commit du buffer audio...`);
    
    wsGPT.send(JSON.stringify({ 
      type: "input_audio_buffer.commit" 
    }));
    
    console.log(`[Assembly][${deviceId}] 🎯 Création de la réponse...`);
    
    wsGPT.send(JSON.stringify({ 
      type: "response.create",
      response: {
        modalities: ["text", "audio"],
        instructions: "Réponds de manière naturelle et concise à ce qui vient d'être dit."
      }
    }));
    
    console.log(`[Assembly][${deviceId}] ✅ Réponse créée, en attente de la génération GPT...`);
  }
}

module.exports = { processAudioChunk };
