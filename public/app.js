/**
 * WebRTC P2P Client — app.js
 * --------------------------
 * - Gère la capture média locale (cam + micro)
 * - Établit la connexion P2P via RTCPeerConnection
 * - Échange la signalisation via WebSocket avec le serveur
 * - UI minimale : créer / rejoindre une room, raccrocher
 *
 * Le protocole WS utilise les types : joined, peer-joined, offer, answer, ice-candidate, peer-left.
 */

//////////////////////////////////////
// Sélecteurs DOM & éléments UI     //
//////////////////////////////////////

/** @type {HTMLParagraphElement} */
const statusEl = document.getElementById("status");
/** @type {HTMLVideoElement} */
const localVideo = document.getElementById("localVideo");
/** @type {HTMLButtonElement} */
const btnHangup = document.getElementById("btnHangup");

// Nouveaux contrôles (UI améliorée)
const btnMic = document.getElementById("btnMic");
const btnCam = document.getElementById("btnCam");
const localIndicators = document.getElementById("localIndicators");
const localCamOffOverlay = document.getElementById("localCamOffOverlay");

// Partage de lien
const btnShare = document.getElementById("btnShare");

// Conteneur où l'on ajoute les cartes vidéo distantes
const remotesContainer =
  document.getElementById("participants") || // sidebar whiteboard
  document.getElementById("remotes"); // ancienne page call

//////////////////////////////////////
// État applicatif                  //
//////////////////////////////////////

/** @type {WebSocket | null} */
let ws = null;
/** @type {MediaStream | null} */
let localStream = null;
/** @type {string | null} */
let roomId = null;
/** @type {boolean} Hôte = celui qui crée la room */
let isHost = false;

// États toggles (micro / caméra)
let isMicOn = true;
let isCamOn = true;

// États de la room et de la connexion
let inRoom = false; // vrai dès qu'on a rejoint (JOINED)
let joining = false; // anti double-clic pendant la tentative

// ---- Multi participants ----
/** Map<peerId, RTCPeerConnection> */
const pcByPeerId = new Map();
/** Map<peerId, {card:HTMLElement, video:HTMLVideoElement, indicators:HTMLElement, overlay:HTMLElement}> */
const uiByPeerId = new Map();
/** État média (mute/cam) par peer */
const remoteMediaByPeerId = new Map(); // peerId -> { mic:boolean, cam:boolean }

// ---- Perfect Negotiation (hérité 1:1, pas utilisé en mesh ciblé) ----
let localClientId = null;

//////////////////////////////////////
// Constantes & “enums”             //
//////////////////////////////////////

/** Serveurs STUN pour l’ICE */
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** Types de messages WS */
const MSG = {
  JOIN: "join",
  JOINED: "joined",
  PEER_JOINED: "peer-joined",
  PEER_LEFT: "peer-left",
  OFFER: "offer",
  ANSWER: "answer",
  ICE: "ice-candidate",
  ERROR: "error",
  MEDIA: "media-state",
};

//////////////////////////////////////
// Helpers                          //
//////////////////////////////////////

/**
 * Log + message d’état à l’écran.
 * @param {string} msg
 */
function log(msg) {
  console.log(msg);
  if (statusEl) statusEl.textContent = msg;
}

/**
 * Parse JSON en sécurité.
 * @param {string | Blob | ArrayBuffer} data
 * @returns {any | null}
 */
function safeJson(data) {
  try {
    if (typeof data === "string") return JSON.parse(data);
    if (data instanceof ArrayBuffer)
      return JSON.parse(new TextDecoder().decode(data));
    return null;
  } catch {
    return null;
  }
}

/**
 * Envoi d’un message de signalisation au serveur WS (si connecté).
 * @param {string} type
 * @param {object} [payload]
 */
function sendSignal(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!roomId) return;
  ws.send(JSON.stringify({ type, roomId, payload }));
}

/**
 * Envoi ciblé à un peer spécifique.
 * @param {string} type
 * @param {string} to
 * @param {object} payload
 */
function sendToPeer(type, to, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!roomId) return;
  ws.send(JSON.stringify({ type, roomId, payload: { ...payload, to } }));
}

/**
 * Ajoute un style "actif" aux boutons de toggle (utilisé pour montrer état spécial : MUTÉ / CAM OFF).
 * @param {HTMLElement|null} btn
 * @param {boolean} active
 */
function setBtnActive(btn, active) {
  if (!btn) return;
  btn.classList.toggle("active", active);
  btn.setAttribute("aria-pressed", String(active));
}

/**
 * Rendu des indicateurs (texte) sous le titre "Moi (local)"
 * Affiche 🔇 Micro coupé · 📷 Caméra off
 */
function renderLocalIndicators() {
  if (!localIndicators) return;
  const items = [];
  if (!isMicOn) items.push("🔇 Micro coupé");
  localIndicators.innerHTML = items.join(" · ");
}

/**
 * Affiche/masque l’overlay “Caméra coupée” sur la vidéo locale.
 * @param {boolean} show
 */
function showCamOverlay(show) {
  if (!localCamOffOverlay) return;
  localCamOffOverlay.classList.toggle("show", show);
}

/**
 * Construit l'URL partageable de la room courante.
 * @returns {string|null}
 */
function buildShareUrl() {
  const rid = roomId || (typeof window !== "undefined" ? window.ROOM_ID : null);
  if (!rid) return null;
  const url = new URL(`${location.origin}/room/${rid}`);
  url.searchParams.set("autojoin", "1");
  return url.toString();
}

/**
 * Copie une chaîne dans le presse-papiers (avec fallback).
 * @param {string} text
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

//////////////////////////////////////
// UI cartes remote (par peer)      //
//////////////////////////////////////

/**
 * Crée (si besoin) une carte vidéo complète pour un peer distant via le <template>.
 * @param {string} peerId
 * @returns {{card:HTMLElement, video:HTMLVideoElement, indicators:HTMLElement, overlay:HTMLElement}}
 */
function createRemoteCard(peerId) {
  if (uiByPeerId.has(peerId)) return uiByPeerId.get(peerId);

  const tpl = /** @type {HTMLTemplateElement|null} */ (
    document.getElementById("remote-template")
  );
  let card;

  if (tpl && tpl.content && tpl.content.firstElementChild) {
    // Clone le modèle
    card = tpl.content.firstElementChild.cloneNode(true);
  }

  // Récupère les éléments utiles
  const cardEl = /** @type {HTMLElement} */ (card);
  cardEl.dataset.peer = peerId;

  const video = /** @type {HTMLVideoElement} */ (cardEl.querySelector("video"));
  const indicators = /** @type {HTMLElement} */ (
    cardEl.querySelector(".indicators")
  );
  const overlay = /** @type {HTMLElement} */ (cardEl.querySelector(".overlay"));
  const labelEl = /** @type {HTMLElement} */ (
    cardEl.querySelector(".peer-label")
  );

  if (labelEl) labelEl.textContent = `Remote (${peerId.slice(0, 6)})`;

  remotesContainer?.appendChild(cardEl);

  const ui = { card: cardEl, video, indicators, overlay };
  uiByPeerId.set(peerId, ui);

  // Applique l'état connu si déjà reçu
  renderRemoteMedia(peerId);

  return ui;
}

/**
 * Met à jour le badge et l’overlay d’un peer donné
 * @param {string} peerId
 */
function renderRemoteMedia(peerId) {
  const state = remoteMediaByPeerId.get(peerId) || { mic: true, cam: true };
  const ui = uiByPeerId.get(peerId);
  if (!ui) return;
  const parts = [];
  if (!state.mic) parts.push("🔇 Micro (remote)");
  ui.indicators.textContent = parts.join(" · ");
  ui.overlay.classList.toggle("show", !state.cam);
}

/**
 * Supprime la carte vidéo d’un peer
 * @param {string} peerId
 */
function removeRemoteCard(peerId) {
  const ui = uiByPeerId.get(peerId);
  if (!ui) return;
  try {
    ui.video.srcObject = null;
  } catch {}
  if (ui.card && ui.card.parentNode) ui.card.parentNode.removeChild(ui.card);
  uiByPeerId.delete(peerId);
  remoteMediaByPeerId.delete(peerId);
}

//////////////////////////////////////
// Multi-PC & signalisation ciblée  //
//////////////////////////////////////

/**
 * Crée (ou retourne) le RTCPeerConnection d’un peer.
 * @param {string} peerId
 * @returns {RTCPeerConnection}
 */
function getOrCreatePC(peerId) {
  let pc = pcByPeerId.get(peerId);
  if (pc) return pc;

  // UI pour ce peer
  const { video } = createRemoteCard(peerId);

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Ajoute nos pistes locales (caméra + micro)
  if (localStream)
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  // Lorsqu'on reçoit des pistes distantes
  pc.ontrack = (e) => {
    // Chaque peer = un stream distinct
    video.srcObject = e.streams[0];
    // Certaines plateformes nécessitent play()
    video.play?.().catch(() => {});
  };

  // ICE sortant (ciblé)
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendToPeer(MSG.ICE, peerId, { candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[${peerId}] state:`, pc.connectionState);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      try {
        pc.close();
      } catch {}
      pcByPeerId.delete(peerId);
    }
  };

  pcByPeerId.set(peerId, pc);
  return pc;
}

/**
 * Crée et envoie une offre ciblée vers un peer.
 * @param {string} peerId
 */
async function createOfferToPeer(peerId) {
  const pc = getOrCreatePC(peerId);
  try {
    const offer = await pc.createOffer(); // offre initiale simple
    await pc.setLocalDescription(offer);
    sendToPeer(MSG.OFFER, peerId, { sdp: pc.localDescription });
  } catch (err) {
    console.error(`[${peerId}] createOffer error`, err);
    log("Erreur lors de la création de l'offre.");
  }
}

//////////////////////////////////////
// Nettoyage complet                //
//////////////////////////////////////

/**
 * Nettoyage complet (PC, médias, UI, WS optionnel).
 * @param {object} [opts]
 * @param {boolean} [opts.closeWs] fermer aussi la socket WS
 */
function cleanup(opts = {}) {
  const { closeWs = false } = opts;

  // Désactive le bouton hangup
  if (btnHangup) btnHangup.disabled = true;

  // Ferme tous les PC
  for (const [peerId, pc] of pcByPeerId) {
    try {
      pc.getSenders().forEach((s) => s.track && s.track.stop());
    } catch {}
    try {
      pc.close();
    } catch {}
  }
  pcByPeerId.clear();

  // Stoppe les médias locaux
  if (localStream) {
    try {
      localStream.getTracks().forEach((t) => t.stop());
    } catch {}
    localStream = null;
  }

  // Nettoie UI remote
  for (const peerId of Array.from(uiByPeerId.keys())) removeRemoteCard(peerId);

  // Reset des états UI des toggles (local)
  isMicOn = true;
  isCamOn = true;

  inRoom = false;
  joining = false;
  setBtnActive(btnMic, false);
  setBtnActive(btnCam, false);
  showCamOverlay(false);
  renderLocalIndicators();

  // Ferme éventuellement la WS
  if (closeWs && ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }

  log("Session nettoyée.");
}

//////////////////////////////////////
// WebSocket (signalisation)        //
//////////////////////////////////////

/**
 * Ouvre la connexion WebSocket au serveur de signalisation.
 * @returns {Promise<void>}
 */
function connectWS() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
    ws.onclose = () => console.warn("[WS] closed");
    ws.onmessage = onSignalMessage;
  });
}

/**
 * Gestion des messages de signalisation reçus du serveur.
 * @param {MessageEvent<string>} ev
 */
async function onSignalMessage(ev) {
  const data = safeJson(ev.data);
  if (!data || typeof data.type !== "string") {
    return console.warn("Message WS invalide.");
  }

  const { type, payload } = data;

  // --- Accusé de réception du JOIN ---
  if (type === MSG.JOINED) {
    const { roomSize, clientId, peers = [] } = payload || {};
    localClientId = clientId;

    inRoom = true;
    joining = false;

    if (btnHangup) btnHangup.disabled = false;

    // Affiche un message précis selon la taille
    const created = roomSize === 1;
    log(
      created
        ? `Room ${roomId} créée. En attente de participants…`
        : `Rejoint la room ${roomId}. Participants: ${roomSize}`
    );

    // Synchronise ton état (utile si tu étais déjà mute/cam off)
    if (Array.isArray(peers) && peers.length) {
      for (const pid of peers) {
        if (pid && pid !== localClientId) {
          sendToPeer(MSG.MEDIA, pid, { mic: isMicOn, cam: isCamOn });
        }
      }
    } else {
      // fallback broadcast si pas de routing ciblé
      sendSignal(MSG.MEDIA, { mic: isMicOn, cam: isCamOn });
    }

    // Crée des offres vers tous les peers déjà présents (full-mesh)
    for (const pid of peers) {
      if (!pid || pid === localClientId) continue;
      await createOfferToPeer(pid);
    }
    return;
  }

  // --- Un pair vient d'arriver (prépare son PC ; il offrira) ---
  if (type === MSG.PEER_JOINED) {
    const joinedId = payload?.clientId || null;
    if (!joinedId || joinedId === localClientId) return;

    // Crée la carte + le PC, mais ne propose PAS (le nouveau initie)
    createRemoteCard(joinedId);
    getOrCreatePC(joinedId);

    // Synchronise ton état média vers le nouveau venu
    sendToPeer(MSG.MEDIA, joinedId, { mic: isMicOn, cam: isCamOn });

    log(`Un pair (${joinedId}) a rejoint. En attente de son offre...`);
    return;
  }

  // --- Offre ciblée reçue : répondre ---
  if (type === MSG.OFFER) {
    const from = payload?.from;
    const to = payload?.to;
    if (to && to !== localClientId) return;

    log("Offre reçue. Réponse en cours...");

    createRemoteCard(from);
    const pc = getOrCreatePC(from);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (from) {
        sendToPeer(MSG.ANSWER, from, { sdp: pc.localDescription });
      } else {
        sendSignal(MSG.ANSWER, { sdp: pc.localDescription });
      }
    } catch (err) {
      console.error(`[${from || "peer"}] Erreur traitement OFFER`, err);
      log("Erreur lors du traitement de l'offre.");
    }
    return;
  }

  // --- Answer ciblée : finaliser ---
  if (type === MSG.ANSWER) {
    const from = payload?.from;
    const to = payload?.to;
    if (to && to !== localClientId) return;

    log("Réponse reçue. Finalisation de la connexion...");
    const pc = from ? pcByPeerId.get(from) : null;

    try {
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else {
        console.warn("Answer reçue pour un peer inconnu (ignorée).");
      }
    } catch (err) {
      console.error(
        `[${from || "peer"}] Erreur setRemoteDescription(ANSWER)`,
        err
      );
      log("Erreur lors de l'application de la réponse.");
    }
    return;
  }

  // --- ICE candidate ciblée ---
  if (type === MSG.ICE) {
    const from = payload?.from;
    const to = payload?.to;
    if (to && to !== localClientId) return;

    try {
      const pc = from ? pcByPeerId.get(from) : null;
      if (pc && payload?.candidate) {
        await pc.addIceCandidate(payload.candidate);
      }
    } catch (err) {
      console.error(`[${from || "peer"}] Erreur ICE`, err);
    }
    return;
  }

  // --- Le pair a quitté ---
  if (type === MSG.PEER_LEFT) {
    const leftId = payload?.clientId;
    log(`Le pair ${leftId || ""} a quitté la room.`);
    const pc = leftId ? pcByPeerId.get(leftId) : null;
    if (pc) {
      try {
        pc.close();
      } catch {}
    }
    pcByPeerId.delete(leftId);
    removeRemoteCard(leftId);
    return;
  }

  // --- État média du pair (mute/cam off) ---
  if (type === MSG.MEDIA) {
    // payload: { mic: boolean, cam: boolean, from: clientId, to?: clientId }
    const from = payload?.from;
    const to = payload?.to;
    if (to && to !== localClientId) return;

    if (from) {
      remoteMediaByPeerId.set(from, { mic: !!payload.mic, cam: !!payload.cam });
      renderRemoteMedia(from);
    }
    return;
  }

  // --- Erreur serveur ---
  if (type === MSG.ERROR) {
    console.error("[WS ERROR]", payload?.message || payload);
    log(`Erreur: ${payload?.message ?? "inconnue"}`);
    return;
  }
}

//////////////////////////////////////
// WebRTC                           //
//////////////////////////////////////

/**
 * Initialise la capture média locale (caméra + micro).
 * @returns {Promise<void>}
 */
async function initLocalMedia() {
  // Astuce: demander l’audio + vidéo avant de négocier
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;

  // Applique l'état courant des toggles (utile si l’utilisateur relance un call)
  setMicEnabled(isMicOn);
  setCamEnabled(isCamOn);
  renderLocalIndicators();
  showCamOverlay(!isCamOn);
}

//////////////////////////////////////
// Démarrage de l'appel             //
//////////////////////////////////////

/**
 * Démarre un appel en tant qu'hôte (créateur de room).
 */
async function startCallAsHost() {
  isHost = true;
  await initLocalMedia();
  log(`Room créée: ${roomId}. En attente de pairs...`);
  if (btnHangup) btnHangup.disabled = false;
}

/**
 * Démarre un appel en tant qu'invité (rejoindre une room).
 */
async function startCallAsGuest() {
  isHost = false;
  await initLocalMedia();
  log(`Rejoint la room ${roomId}. Découverte des pairs...`);
  if (btnHangup) btnHangup.disabled = false;
}

//////////////////////////////////////
// Muting / Camera toggles          //
//////////////////////////////////////

/**
 * Envoie l’état média courant à TOUS les peers connus (ciblé si possible).
 */
function broadcastLocalMediaState() {
  const peerIds = Array.from(pcByPeerId.keys());
  if (peerIds.length === 0) {
    sendSignal(MSG.MEDIA, { mic: isMicOn, cam: isCamOn });
    return;
  }
  for (const pid of peerIds) {
    sendToPeer(MSG.MEDIA, pid, { mic: isMicOn, cam: isCamOn });
  }
}

/**
 * Met à jour les titres (tooltips) des boutons mic/cam selon l’état.
 */
function updateBtnTitles() {
  if (btnMic) btnMic.title = isMicOn ? "Micro (M)" : "Micro coupé (M)";
  if (btnCam) btnCam.title = isCamOn ? "Caméra (V)" : "Caméra coupée (V)";
}

/**
 * Active/Désactive le micro (audio tracks).
 * @param {boolean} enabled
 */
function setMicEnabled(enabled) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
  isMicOn = enabled;
  setBtnActive(btnMic, !enabled);
  renderLocalIndicators();
  broadcastLocalMediaState();
  updateBtnTitles();
}

/**
 * Active/Désactive la caméra (video tracks).
 * @param {boolean} enabled
 */
function setCamEnabled(enabled) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
  isCamOn = enabled;
  setBtnActive(btnCam, !enabled);
  showCamOverlay(!enabled);
  renderLocalIndicators();
  broadcastLocalMediaState();
  updateBtnTitles();
}

/** Bascule micro ON/OFF */
function toggleMic() {
  setMicEnabled(!isMicOn);
  log(isMicOn ? "Micro activé" : "Micro coupé");
}

/** Bascule caméra ON/OFF */
function toggleCam() {
  setCamEnabled(!isCamOn);
  log(isCamOn ? "Caméra activée" : "Caméra coupée");
}

//////////////////////////////////////
// Handlers UI                      //
//////////////////////////////////////

// Raccrocher
btnHangup &&
  btnHangup.addEventListener("click", () => {
    cleanup({ closeWs: true });
    log("Raccroché.");

    // Redirection vers la landing
    // (petit délai facultatif pour laisser le cleanup finir proprement)
    setTimeout(() => {
      window.location.assign("/");
    }, 50);
  });

// Boutons Mute/Cam
btnMic && btnMic.addEventListener("click", toggleMic);
btnCam && btnCam.addEventListener("click", toggleCam);

// Bouton Partager le lien
btnShare &&
  btnShare.addEventListener("click", async () => {
    const url = buildShareUrl();
    if (!url) {
      alert("Aucune room active à partager.");
      return;
    }
    const ok = await copyToClipboard(url);
    log(
      ok
        ? "Lien copié dans le presse-papiers."
        : "Impossible de copier le lien."
    );
  });

// Raccourcis clavier: M (micro), V (caméra)
window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key.toLowerCase() === "m") toggleMic();
  if (e.key.toLowerCase() === "v") toggleCam();
});
// Auto-join sur /room/:roomId (robuste si DOMContentLoaded déjà passé)
async function __autoJoinInit() {
  // Injecté par workspace.js
  const injectedRoomId = typeof window !== "undefined" ? window.ROOM_ID : null;
  const params = new URLSearchParams(location.search);
  const rid = injectedRoomId || params.get("room");
  const isHostFromUrl =
    (typeof window !== "undefined" && window.IS_HOST_FROM_URL === true) ||
    params.get("host") === "1";

  if (!rid) return;

  roomId = rid;
  joining = true;
  // uiSetBusy(true);

  try {
    await connectWS();
    if (isHostFromUrl) {
      await startCallAsHost();
    } else {
      await startCallAsGuest();
    }
    sendSignal(MSG.JOIN);
  } catch (err) {
    joining = false;
    console.error("Auto-join error", err);
    log("Impossible de démarrer l’appel.");
    cleanup({ closeWs: true });
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", __autoJoinInit);
} else {
  // DOM déjà prêt → lance tout de suite
  __autoJoinInit();
}
