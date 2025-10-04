const WebSocket = require("ws");

// Stocker les sockets GPT par deviceId
const gptSockets = new Map(); // Map<deviceId, { ws, isReady }>

/**
 * Envoie un chunk audio PCM à GPT et commit si demandé
 * @param {string} deviceId - ID du device Flutter
 * @param {string} audioBase64 - chunk audio PCM Base64
 * @param {Map} wsClients - Map<deviceId, { ws: WebSocket }>
 * @param {boolean} commit - true si c'est le dernier chunk du segment
 */
async function processAudioChunk(deviceId, audioBase64, wsClients, commit = false) {
  console.log(`[Assembly][${deviceId}] 📥 Chunk reçu (${audioBase64.length} chars, commit: ${commit})`);
  
  // Nettoyage du Base64
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");
  console.log(`[Assembly][${deviceId}] 🔄 Buffer: ${audioBuffer.length} bytes`);

  // Créer socket GPT si n'existe pas
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

    // Variables pour suivre l'état
    let isSessionReady = false;
    let audioChunkCount = 0;

    wsGPT.on("open", () => {
      console.log(`[GPT][${deviceId}] ✅ Connexion ouverte`);
      
      // Configuration optimale pour streaming
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
            silence_duration_ms: 700
          },
          max_response_output_tokens: 4096,
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
        console.warn(`[GPT][${deviceId}] ⚠️ Erreur parsing message:`, e.message); 
        return; 
      }

      // Log minimal pour éviter spam
      if (msg.type !== "response.audio.delta") {
        console.log(`[GPT][${deviceId}] 📨 Type: ${msg.type}`);
      }

      // Marquer session comme prête
      if (msg.type === "session.created" || msg.type === "session.updated") {
        isSessionReady = true;
        console.log(`[GPT][${deviceId}] ⚙️ Session prête`);
      }

      // Récupération du client Flutter
      const clientData = wsClients.get(deviceId);
      if (!clientData || !clientData.ws) {
        console.warn(`[GPT][${deviceId}] ⚠️ Client Flutter non trouvé`);
        return;
      }
      const wsClient = clientData.ws;

      if (wsClient.readyState !== WebSocket.OPEN) {
        console.warn(`[GPT][${deviceId}] ⚠️ WebSocket Flutter fermé`);
        return;
      }

      // === Transcription Audio Input ===
      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        console.log(`[GPT][${deviceId}] 🎤 Transcription: "${msg.transcript}"`);
        wsClient.send(JSON.stringify({
          type: 'input_transcription',
          deviceId,
          transcript: msg.transcript,
          index: Date.now(),
        }));
      }

      // === Audio Delta - STREAMING IMMÉDIAT ===
      if (msg.type === "response.audio.delta") {
        audioChunkCount++;
        const audioChunk = msg.delta;
        
        if (audioChunk && audioChunk.length > 0) {
          // Log tous les 10 chunks pour éviter spam
          if (audioChunkCount % 10 === 0) {
            console.log(`[GPT][${deviceId}] 🔊 Audio chunks: ${audioChunkCount} (dernier: ${audioChunk.length} chars)`);
          }
          
          // Envoi immédiat au client Flutter
          wsClient.send(JSON.stringify({
            type: 'response.output_audio.delta',
            deviceId,
            delta: audioChunk,
            index: audioChunkCount,
          }));
        }
      }

      // === Transcript Delta ===
      if (msg.type === "response.audio_transcript.delta") {
        console.log(`[GPT][${deviceId}] 📢 Transcript: "${msg.delta}"`);
        wsClient.send(JSON.stringify({
          type: 'response.output_audio_transcript.delta',
          deviceId,
          delta: msg.delta,
          index: Date.now(),
        }));
      }

      // === Fin de Réponse ===
      if (msg.type === "response.done") {
        console.log(`[GPT][${deviceId}] ✅ Réponse complète (${audioChunkCount} chunks audio)`);
        audioChunkCount = 0;
        
        wsClient.send(JSON.stringify({
          type: 'response.completed',
          deviceId,
          index: Date.now(),
        }));
      }

      // === Erreurs ===
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
      console.log(`[GPT][${deviceId}] 🔌 Connexion fermée (code: ${code}, reason: ${reason})`);
      gptSockets.delete(deviceId);
    });

    wsGPT.on("error", (err) => {
      console.error(`[GPT][${deviceId}] ❌ Erreur WebSocket:`, err.message);
      gptSockets.delete(deviceId);
    });

    gptSockets.set(deviceId, { ws: wsGPT, isReady: false });
    
    // Attendre que la session soit configurée
    console.log(`[GPT][${deviceId}] ⏳ Attente session ready...`);
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        if (isSessionReady) {
          clearInterval(checkReady);
          const socketData = gptSockets.get(deviceId);
          if (socketData) socketData.isReady = true;
          console.log(`[GPT][${deviceId}] ✅ Session ready confirmée`);
          resolve();
        }
      }, 100);
      
      // Timeout 5s
      setTimeout(() => {
        clearInterval(checkReady);
        console.warn(`[GPT][${deviceId}] ⚠️ Timeout session ready`);
        resolve();
      }, 5000);
    });
  }

  // Envoyer chunk à GPT
  const socketData = gptSockets.get(deviceId);
  if (!socketData?.ws || socketData.ws.readyState !== WebSocket.OPEN) {
    console.error(`[Assembly][${deviceId}] ❌ Socket GPT non disponible (state: ${socketData?.ws?.readyState})`);
    return;
  }

  const wsGPT = socketData.ws;

  // Attendre que la session soit prête
  if (!socketData.isReady) {
    console.log(`[Assembly][${deviceId}] ⏳ Attente session prête...`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Envoyer audio
  const audioPayload = {
    type: "input_audio_buffer.append",
    audio: audioBuffer.toString("base64"),
  };
  
  wsGPT.send(JSON.stringify(audioPayload));
  console.log(`[Assembly][${deviceId}] 📤 Chunk envoyé à GPT (${audioBuffer.length} bytes)`);

  // Si commit, déclencher la réponse
  if (commit) {
    console.log(`[Assembly][${deviceId}] 🏁 Commit du buffer audio...`);
    
    wsGPT.send(JSON.stringify({ 
      type: "input_audio_buffer.commit" 
    }));
    
    // Petit délai avant de créer la réponse
    await new Promise(resolve => setTimeout(resolve, 100));
    
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

// Nettoyage périodique des sockets inactifs
setInterval(() => {
  let cleaned = 0;
  gptSockets.forEach((data, deviceId) => {
    if (data.ws.readyState === WebSocket.CLOSED) {
      console.log(`[Assembly][${deviceId}] 🧹 Nettoyage socket fermé`);
      gptSockets.delete(deviceId);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`[Assembly] 🧹 ${cleaned} socket(s) nettoyé(s)`);
  }
}, 60000); // Toutes les 60s

module.exports = { processAudioChunk };
