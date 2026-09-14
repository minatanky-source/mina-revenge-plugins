"use strict";

(() => {
  const title = document.getElementById("title");
  const status = document.getElementById("status");
  const section = document.getElementById("authorization");
  const value = document.getElementById("value");
  const button = document.getElementById("copy");
  const incoming = new URL(window.location.href);
  const base = incoming.origin + incoming.pathname;
  // O retorno fica somente em memória, sem analytics, fetch ou localStorage.
  // Retira os parâmetros da barra de endereço antes de qualquer ação da pessoa.
  window.history.replaceState(null, "", base);
  if (incoming.searchParams.has("error")) {
    title.textContent = "Conexão não autorizada";
    status.textContent = "Volte ao Discord para tentar novamente. Sua conta não foi conectada.";
    return;
  }
  const code = incoming.searchParams.get("code");
  const state = incoming.searchParams.get("state");
  if (!code && !state) return;
  if (!code || !state || code.length > 2048 || state.length > 128
      || incoming.searchParams.getAll("code").length !== 1
      || incoming.searchParams.getAll("state").length !== 1) {
    title.textContent = "Autorização incompleta";
    status.textContent = "Abra /ro-mesh conta no Discord e inicie uma nova conexão.";
    return;
  }
  const clean = new URL(base);
  clean.searchParams.set("code", code);
  clean.searchParams.set("state", state);
  const expiresAt = Date.now() + 60_000;
  let expired = false;
  const expire = () => {
    expired = true;
    value.value = "";
    button.disabled = true;
    section.hidden = true;
    title.textContent = "Abra o Discord";
    status.textContent = "Se você já concluiu, veja a confirmação da Sha. Caso contrário, inicie uma nova conexão.";
  };
  title.textContent = "Só falta concluir";
  status.textContent = "A Roblox retornou a autorização. Agora confirme no Discord.";
  value.value = clean.href;
  section.hidden = false;
  button.addEventListener("click", async () => {
    if (expired || Date.now() >= expiresAt) { expire(); return; }
    try {
      await navigator.clipboard.writeText(value.value);
      if (!expired) button.textContent = "Copiado · volte ao Discord";
    } catch {
      value.focus();
      value.select();
      button.textContent = "Segure o texto selecionado e copie";
    }
  });
  window.setTimeout(expire, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (Date.now() >= expiresAt) expire();
  });
  // Evita reexpor uma autorização pelo cache de navegação do celular.
  window.addEventListener("pagehide", expire);
})();
