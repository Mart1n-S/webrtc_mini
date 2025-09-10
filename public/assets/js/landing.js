/**
 * Landing — création de room & redirection
 */

document.addEventListener("DOMContentLoaded", () => {
  const cta = document.getElementById("ctaCreate");
  const status = document.getElementById("lpStatus");

  if (!cta) return;

  // Création de room côté serveur puis redirection
  cta.addEventListener("click", async () => {
    if (status) status.textContent = "Création de la room…";
    try {
      const res = await fetch("/api/rooms/new", { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const { url } = await res.json();
      window.location.assign(url);
    } catch (e) {
      if (status) status.textContent = "Impossible de créer la room.";
      if (window.Toastify) {
        Toastify({
          text: "Erreur : création de la room impossible.",
          duration: 4000,
          gravity: "top",
          position: "center",
          close: true,
          backgroundColor: "#f47174",
          stopOnFocus: true,
        }).showToast();
      }
      console.error(e);
    }
  });

  // Affichage d'un toast si redirigé avec ?error=room_not_found
  const params = new URLSearchParams(location.search);
  if (params.get("error") === "room_not_found") {
    if (status)
      status.textContent =
        "Room introuvable ou non autorisée. Crée une nouvelle room.";
    if (window.Toastify) {
      Toastify({
        text: "Room introuvable ou non autorisée.",
        duration: 4000,
        gravity: "top",
        position: "center",
        close: true,
        backgroundColor: "#f47174",
        stopOnFocus: true,
      }).showToast();
    }
    // Nettoie l'URL (retire le param d'erreur sans recharger)
    params.delete("error");
    const clean = params.toString();
    const newUrl = clean ? `${location.pathname}?${clean}` : location.pathname;
    history.replaceState({}, "", newUrl);
  }
});
