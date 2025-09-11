/**
 * Landing — création de room & redirection / rejoindre une room
 */

document.addEventListener("DOMContentLoaded", () => {
  const cta = document.getElementById("ctaCreate");
  const status = document.getElementById("lpStatus");

  const inpRoom = document.getElementById("inpRoom");
  const btnJoin = document.getElementById("btnJoin");

  // --- util ---
  function toast(msg, danger = false) {
    if (!window.Toastify) return;
    Toastify({
      text: msg,
      duration: 4000,
      gravity: "top",
      position: "center",
      close: true,
      backgroundColor: danger ? "#f47174" : "#2b6cff",
      stopOnFocus: true,
    }).showToast();
  }

  function extractRoomId(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    // ID numérique à 6 chiffres
    if (/^\d{6}$/.test(s)) return s;

    // URL complète → /room/:id
    try {
      const u = new URL(s);
      const m = u.pathname.match(/\/room\/([^/]+)/i);
      if (m && m[1]) return m[1];
    } catch {
      // pas une URL, on continue
    }

    // Dernier token alphanumérique “propre”
    const m2 = s.match(/([A-Za-z0-9_-]{4,})$/);
    if (m2 && m2[1]) return m2[1];

    return null;
  }

  // --- Créer une room ---
  if (cta) {
    cta.addEventListener("click", async () => {
      if (status) status.textContent = "Création de la room…";
      try {
        const res = await fetch("/api/rooms/new", { method: "POST" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const { url } = await res.json();
        window.location.assign(url);
      } catch (e) {
        if (status) status.textContent = "Impossible de créer la room.";
        toast("Erreur : création de la room impossible.", true);
        console.error(e);
      }
    });
  }

  // --- Rejoindre une room existante ---
  async function handleJoin() {
    const val = inpRoom ? inpRoom.value : "";
    const rid = extractRoomId(val);
    if (!rid) {
      if (status) status.textContent = "ID invalide.";
      toast(
        "ID de room invalide. Exemple : 123456 ou colle un lien complet.",
        true
      );
      return;
    }
    if (status) status.textContent = `Ouverture de la room ${rid}…`;
    window.location.assign(`/room/${rid}?autojoin=1`);
  }

  if (btnJoin && inpRoom) {
    btnJoin.addEventListener("click", handleJoin);
    inpRoom.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleJoin();
      }
    });
  }

  // --- Gestion d'erreur via query param ---
  const params = new URLSearchParams(location.search);
  if (params.get("error") === "room_not_found") {
    if (status)
      status.textContent =
        "Room introuvable ou non autorisée. Crée une nouvelle room ou saisis un ID.";
    toast("Room introuvable ou non autorisée.", true);

    // Nettoie l'URL (retire le param d'erreur sans recharger)
    params.delete("error");
    const clean = params.toString();
    const newUrl = clean ? `${location.pathname}?${clean}` : location.pathname;
    history.replaceState({}, "", newUrl);
  }
});
