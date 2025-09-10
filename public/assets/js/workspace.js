/**
 * Workspace — expose les infos de room au client (app.js)
 * - Pas de logique WebRTC ici : on se contente de définir les flags globaux
 *   utilisés par app.js pour l’auto-join.
 */

(function () {
  const root = document.getElementById("workspaceRoot");
  if (!root) return;

  // Passe l'ID via data-attribute (défini dans workspace.twig)
  const rid = root.dataset.roomId || null;

  // Flags d'URL
  const params = new URLSearchParams(location.search);
  const isHost = params.get("host") === "1";
  const autojoin = params.get("autojoin") === "1";

  // Expose proprement pour app.js (qui écoute DOMContentLoaded)
  window.ROOM_ID = rid;
  window.IS_HOST_FROM_URL = isHost;
  window.AUTOJOIN = autojoin;
})();
