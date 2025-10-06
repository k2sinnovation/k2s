const WebSocket = require("ws");
const { promptTTSVocal } = require("../utils/promptsTTSVocal");

// Stocker les sockets GPT par deviceId
const gptSockets = new Map();

/**
 * Traite les chunks audio et les envoie à GPT Realtime API
 */
async function processAudioChunk(deviceId, audioBase64, wsClients, commit = false) {
  console.log(`[Assembly][${deviceId}] 📥 Chunk reçu (${audioBase64.length} chars, commit: ${commit})`);
  
  // ✅ Garder le base64 tel quel
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const estimatedBytes = (base64Data.length * 3) / 4;
  console.log(`[Assembly][${deviceId}] 🔄 Taille estimée: ${estimatedBytes} bytes`);

  // Créer socket GPT si nécessaire
  if (!gptSockets.has(deviceId)) {
    console.log(`[Assembly][${deviceId}] 🆕 Création connexion GPT...`);
    
    const wsGPT = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      { 
        headers: { 
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        } 
      }
    );

    let isSessionReady = false;
    let audioChunkCount = 0;

    wsGPT.on("open", () => {
      console.log(`[GPT][${deviceId}] ✅ Connexion ouverte`);
      
      // Configuration optimisée pour qualité audio
      wsGPT.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: promptTTSVocal,  // ✅ Utilise votre prompt personnalisé
          voice: "shimmer",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: null,  // ✅ Désactivé - VAD géré côté Flutter
          max_response_output_tokens: 260,  // ✅ Limite selon votre prompt
          temperature: 0.8
        }
      }));
      
      console.log(`[GPT][${deviceId}] ⚙️ Session configurée`);
    });

    wsGPT.on("message", (data) => {
      let msg;
      try { 
        msg = JSON.parse(data.toString()); 
      } catch (e) { 
        console.warn(`[GPT][${deviceId}] ⚠️ Parse error:`, e.message); 
        return; 
      }

      // Log réduit pour performance
      if (msg.type !== "response.audio.delta") {
        console.log(`[GPT][${deviceId}] 📨 ${msg.type}`);
      }

      // Session ready
      if (msg.type === "session.created" || msg.type === "session.updated") {
        isSessionReady = true;
        console.log(`[GPT][${deviceId}] ✅ Session prête`);
      }

      const clientData = wsClients.get(deviceId);
      if (!clientData?.ws || clientData.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const wsClient = clientData.ws;

      // Transcription input - Succès
      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        console.log(`[GPT][${deviceId}] 🎤 Transcription: "${msg.transcript}"`);
        wsClient.send(JSON.stringify({
          type: 'input_transcription',
          deviceId,
          transcript: msg.transcript,
          index: Date.now(),
        }));
      }

      // ✅ Transcription input - Échec (debug)
      if (msg.type === "conversation.item.input_audio_transcription.failed") {
        console.error(`[GPT][${deviceId}] ❌ Transcription failed:`, JSON.stringify(msg));
      }

      // Audio delta - streaming
      if (msg.type === "response.audio.delta") {
        audioChunkCount++;
        const audioChunk = msg.delta;
        
        if (audioChunk && audioChunk.length > 0) {
          // Log tous les 10 chunks
          if (audioChunkCount % 10 === 0) {
            console.log(`[GPT][${deviceId}] 🔊 ${audioChunkCount} chunks (${audioChunk.length} chars)`);
          }
          
          // Envoi immédiat
          wsClient.send(JSON.stringify({
            type: 'response.output_audio.delta',
            deviceId,
            delta: audioChunk,
            index: audioChunkCount,
          }));
        }
      }

      // Transcript delta
      if (msg.type === "response.audio_transcript.delta") {
        wsClient.send(JSON.stringify({
          type: 'response.output_audio_transcript.delta',
          deviceId,
          delta: msg.delta,
          index: Date.now(),
        }));
      }

      // Réponse complète
      if (msg.type === "response.done") {
        console.log(`[GPT][${deviceId}] ✅ Réponse complète (${audioChunkCount} chunks audio)`);
        
        // ✅ Log détaillé si pas d'audio
        if (audioChunkCount === 0) {
          console.warn(`[GPT][${deviceId}] ⚠️ AUCUN audio généré! Response:`, JSON.stringify(msg));
        }
        
        audioChunkCount = 0;
        
        wsClient.send(JSON.stringify({
          type: 'response.completed',
          deviceId,
          index: Date.now(),
        }));
      }

      // Erreurs
      if (msg.type === "error") {
        console.error(`[GPT][${deviceId}] ❌ Erreur:`, msg.error?.message || JSON.stringify(msg));
        wsClient.send(JSON.stringify({
          type: 'gpt_error',
          deviceId,
          error: msg.error?.message || 'Erreur GPT',
          index: Date.now(),
        }));
      }
    });

    wsGPT.on("close", (code, reason) => {
      console.log(`[GPT][${deviceId}] 🔌 Fermé (${code}): ${reason}`);
      gptSockets.delete(deviceId);
    });

    wsGPT.on("error", (err) => {
      console.error(`[GPT][${deviceId}] ❌ Erreur:`, err.message);
      gptSockets.delete(deviceId);
    });

    gptSockets.set(deviceId, { ws: wsGPT, isReady: false });
    
    // Attendre session ready
    console.log(`[GPT][${deviceId}] ⏳ Attente session...`);
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        if (isSessionReady) {
          clearInterval(checkReady);
          const socketData = gptSockets.get(deviceId);
          if (socketData) socketData.isReady = true;
          console.log(`[GPT][${deviceId}] ✅ Session ready`);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkReady);
        console.warn(`[GPT][${deviceId}] ⚠️ Timeout session`);
        resolve();
      }, 5000);
    });
  }

  // Envoyer chunk
  const socketData = gptSockets.get(deviceId);
  if (!socketData?.ws || socketData.ws.readyState !== WebSocket.OPEN) {
    console.error(`[Assembly][${deviceId}] ❌ Socket non disponible`);
    return;
  }

  const wsGPT = socketData.ws;

  if (!socketData.isReady) {
    console.log(`[Assembly][${deviceId}] ⏳ Attente ready...`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // ✅ Envoi audio direct (pas de décodage/ré-encodage)
  wsGPT.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: base64Data,
  }));
  
  console.log(`[Assembly][${deviceId}] 📤 Chunk envoyé (${base64Data.length} chars base64)`);

  // ✅ Commit + response CORRIGÉ
  if (commit) {
    console.log(`[Assembly][${deviceId}] 🏁 Commit...`);
    
    wsGPT.send(JSON.stringify({ 
      type: "input_audio_buffer.commit" 
    }));
    
    // ✅ Attendre plus longtemps pour que l'audio soit bien traité
    await new Promise(resolve => setTimeout(resolve, 300));
    
    console.log(`[Assembly][${deviceId}] 🎯 Création réponse...`);
    
    // ✅ CORRECTION: Pas d'instructions ici, utiliser celles de la session
    wsGPT.send(JSON.stringify({ 
      type: "response.create"
    }));
    
    console.log(`[Assembly][${deviceId}] ✅ Réponse créée`);
  }
}

// Nettoyage
setInterval(() => {
  let cleaned = 0;
  gptSockets.forEach((data, deviceId) => {
    if (data.ws.readyState === WebSocket.CLOSED) {
      console.log(`[Assembly][${deviceId}] 🧹 Nettoyage`);
      gptSockets.delete(deviceId);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`[Assembly] 🧹 ${cleaned} socket(s) nettoyé(s)`);
  }
}, 60000);

module.exports = { processAudioChunk };
