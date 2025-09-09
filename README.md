# ⚠️ DOC TEMPORAIRE ⚠️
# Commandes

Lancer le serveur :

```bash
npm start
```


Lancer le tunnel ngrok (si besoin) :
```bash
ngrok http 3000
```

# Mini-doc WebRTC — notions clés (à mettre dans ton README)

## 1) Vue d’ensemble

Ce projet établit des appels vidéo **P2P** via **WebRTC**.
On utilise un petit **serveur de signalisation** (WebSocket) pour s’échanger des messages techniques (pas les médias) : *offer*, *answer*, candidats **ICE**, état micro/cam, etc.
Ensuite, les flux **audio/vidéo** passent directement entre navigateurs (ou via **TURN** si nécessaire).

---

## 2) Concepts WebRTC essentiels

### Offer / Answer (SDP)

* **Offer** = proposition de session (codecs, pistes, crypto, etc.).
* **Answer** = réponse compatible à l’offre.
* Ces deux messages contiennent une **description SDP**.
* Ils s’échangent via la **signalisation** (ici, WebSocket), pas dans le média.

#### Cycle simplifié

1. **A** → `createOffer()` → `setLocalDescription(offer)` → envoie l’offer à **B**
2. **B** → `setRemoteDescription(offer)` → `createAnswer()` → `setLocalDescription(answer)` → renvoie l’answer
3. **A** → `setRemoteDescription(answer)`
4. En parallèle, **A** et **B** s’envoient des **candidats ICE** (voir ci-dessous).

### ICE, STUN, TURN

* **ICE** (*Interactive Connectivity Establishment*) cherche un chemin réseau joignable entre 2 pairs (derrière NAT/pare-feu).
* **Candidats ICE** = adresses potentielles (IP\:port) par lesquelles on peut communiquer :

  * `host` (IP locale)
  * `srflx` (IP publique découverte via **STUN**)
  * `relay` (IP/port d’un serveur **TURN** qui relaie le trafic)
* **STUN** : “voici ton IP publique”.
* **TURN** : relaie les médias quand le P2P direct est impossible (NAT symétriques, réseaux d’entreprise, CGNAT…).

#### Configuration typique

```js
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" }, // STUN public
  // Recommandé en prod : ajouter un TURN
  { urls: "turn:turn.example.com:3478", username: "webrtc", credential: "secret" },
  { urls: "turns:turn.example.com:5349?transport=tcp", username: "webrtc", credential: "secret" },
];
```

### `pc = RTCPeerConnection`

Dans le code, `pc` est l’abréviation de **PeerConnection** (pas “ordinateur”).
C’est l’objet qui gère : **ICE** (STUN/TURN), **DTLS-SRTP**, pistes audio/vidéo (`addTrack`/`ontrack`), **datachannels**, négociation **SDP**, **états/metrics**.

---

## 3) Topologies : full-mesh vs SFU

* **Full-mesh (P2P maillé)** : chaque participant ouvre un `RTCPeerConnection` par autre participant (**multi-pc**).
  Simple à coder, OK jusqu’à \~3–4 personnes (bande passante uplink ↑).
* **SFU (Selective Forwarding Unit)** : un serveur (mediasoup/Janus/LiveKit/Jitsi) reçoit et relaie tous les flux.
  Scalable (10+), une seule `pc` par client (vers le SFU), meilleure perf.

> **Ce projet implémente le full-mesh.**

---

## 4) Comment ça marche dans ce repo

### Signalisation (serveur WebSocket)

* Sert les fichiers statiques `/public`.
* Gère des rooms (`Map<roomId, clients>`).
* Messages principaux :

  * `join` / `joined` (avec la liste `peers` déjà présents),
  * `peer-joined` / `peer-left`,
  * `offer`, `answer`, `ice-candidate` (ciblés via `payload.to`),
  * `media-state` (mute/cam on/off).

### Flux d’un `join` en multi-participants

1. Client **C** envoie `join(roomId)`.
2. Serveur répond `joined` avec `peers = [A, B, …]` (déjà dans la room).
3. **C** crée un `RTCPeerConnection` par peer (**A**, **B**…) et envoie une **offer** ciblée à chacun.
4. **A/B** répondent avec **answer** ciblée, puis échanges **ICE** ciblés.
5. Dès qu’un couple de candidats fonctionne, les médias s’écoulent.

> Si deux participants (**B↔C**) ne se voient pas mais voient **A**, c’est souvent le **TURN** manquant.
> **Ajouter un TURN (UDP 3478 + TLS 5349/TCP)** résout la plupart des cas.

---

## 5) Pourquoi on voit “multi-pc” dans le code

Parce qu’en **full-mesh**, `N` participants ⇒ **N-1 `PeerConnections` par client**.

```js
const pcByPeerId = new Map(); // un RTCPeerConnection par peer distant
```

…et la création dynamique des **cartes vidéo** (une par peer).

---

## 6) Débogage & bonnes pratiques

### Vérifier ICE

* **Chrome** : `chrome://webrtc-internals` → “Selected candidate pair” (`host`/`srflx`/`relay`).

### Ajouter des logs

```js
pc.oniceconnectionstatechange = () => console.log('ice', pc.iceConnectionState);
pc.onconnectionstatechange   = () => console.log('pc',  pc.connectionState);
```

### Recommandations

* **HTTPS/WSS** recommandé (getUserMedia/permissions/TURN TLS).
* Limiter la **résolution/bitrate** en full-mesh si 4+ (ex. `640×360`).
* **TURN indispensable en prod.** Ouvrir les ports, prévoir **5349/TCP** pour réseaux stricts.

---

## 7) Limites & évolutions possibles

* **Full-mesh** : uplink multiplié par `(N-1)`. Pour `> 4`, envisager un **SFU**.
* Partage d’écran, enregistrement, chat/whiteboard : ajouter **DataChannels** et/ou une **CRDT (Yjs)** si état collaboratif persistant.

---

## TL;DR

* **Offer/Answer** : on s’accorde *comment parler*.
* **ICE/STUN/TURN** : on découvre *par où parler*.
* `pc = RTCPeerConnection`. En **full-mesh** → **multi-pc** (un par peer).
* Pour **3+ personnes**, ajoute un **TURN** (et idéalement un **SFU** si tu veux scaler).


# Pourquoi on parle d’« offre » (*offer*) ?

Parce que WebRTC utilise le modèle **SDP Offer/Answer** (RFC 3264) pour négocier une session multimédia.

* **Offer (offre)** : une description de session (SDP) proposée par le premier pair. Elle liste ce que j’aimerais envoyer/recevoir (pistes audio/vidéo, codecs, paramètres réseau, fingerprints DTLS, etc.).
* **Answer (réponse)** : l’autre pair accepte et renvoie sa propre description compatible.

> Le transport réel (paquets audio/vidéo) ne passe pas dans l’offre/réponse : ce sont juste des **métadonnées**.
> L’échange d’offre/réponse se fait via la **signalisation** (ici WebSocket).

Ensuite, on continue d’échanger des **candidats ICE** (voir ci-dessous) pour trouver un chemin réseau utilisable. C’est ce qu’on appelle **Trickle ICE** (on envoie les candidats au fil de l’eau sans attendre d’avoir toute la liste).

# Schéma ultra-court

1. **A** crée un `RTCPeerConnection` → `createOffer()` → `setLocalDescription(offer)` → envoie l’**offer** à **B**.
2. **B** fait `setRemoteDescription(offer)` → `createAnswer()` → `setLocalDescription(answer)` → renvoie l’**answer** à **A**.
3. **A** fait `setRemoteDescription(answer)`.

En parallèle, **A** et **B** s’échangent des **ICE candidates** jusqu’à ce qu’un couple (pair) fonctionne.

# C’est quoi ICE et `ICE_SERVERS` ?

**ICE** = *Interactive Connectivity Establishment* (RFC 8445).
C’est l’algorithme qui permet à deux machines derrière des NAT/pare-feu de découvrir un chemin réseau viable pour envoyer les flux audio/vidéo.

Un **candidat ICE** = une « coordonnée réseau » potentielle (**IP\:port + transport**) par laquelle on pourrait se joindre.

## Types de candidats

* **host** : IPs locales (ex. `192.168.x.x`).
* **srflx** (*server-reflexive*) : IP publique vue via un serveur **STUN**.
* **relay** : IP/port d’un serveur **TURN** qui relaie le trafic si rien d’autre ne marche.

## `ICE_SERVERS` : liste STUN/TURN

```js
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" }, // STUN public : donne des candidats srflx
  // TURN = relais (à ajouter si NAT stricts / réseaux d’entreprise)
  // { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
  // { urls: "turns:turn.example.com:5349?transport=tcp", username: "user", credential: "pass" },
];
```

# STUN vs TURN

* **STUN** (*Session Traversal Utilities for NAT*) : « Quel est mon IP/port publics ? » → produit des candidats **srflx**.
* **TURN** (*Traversal Using Relays around NAT*) : « Relaye mes médias si on ne peut pas percer le NAT » → produit des candidats **relay**.
  Indispensable quand deux pairs ne peuvent pas se joindre directement (NAT symétriques, réseaux d’entreprise, CGNAT mobile, etc.).
