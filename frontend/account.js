(() => {
  const api = (window.FACEMAGIC_API_URL || "").replace(/\/$/, "");
  const status = document.getElementById("accountStatus");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const dashboard = document.getElementById("accountDashboard");
  if (!loginForm || !registerForm) return;
  const tokenKey = "facemagic_session_token";
  const token = () => sessionStorage.getItem(tokenKey);
  const setStatus = (message, isError=false) => {
    status.textContent = message;
    status.style.borderColor = isError ? "#ef444466" : "";
    status.style.color = isError ? "#fca5a5" : "";
  };
  async function request(path, options={}) {
    if (!api) throw new Error("Endereço da API não configurado.");
    const response = await fetch(api + path, {
      ...options,
      headers: {"Content-Type":"application/json", ...(token()?{"Authorization":"Bearer "+token()}:{}), ...(options.headers||{})}
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.detail || "Não foi possível concluir a solicitação.");
    return data;
  }
  async function refreshSystemStatus() {
    if (!api) { setStatus("API não configurada. O serviço de conta não pode ser consultado.", true); return; }
    try {
      const health = await request("/api/health");
      if (typeof health.auth_configured !== "boolean" || typeof health.registration_enabled !== "boolean") {
        setStatus("A API está online, mas o Render ainda está atualizando o diagnóstico de Neon e autenticação. Tente novamente em instantes.");
        return;
      }
      const db = health.database === "connected" ? "Neon conectado" :
        health.database === "not_configured" ? "DATABASE_URL não configurada no Render" : "Neon configurado, mas indisponível";
      const auth = health.auth_configured ? "autenticação configurada" : "JWT_SECRET ausente no Render";
      const registration = health.registration_enabled ? "Cadastro e login disponíveis." : "Cadastro e login bloqueados até corrigir os itens acima.";
      setStatus(db + " · " + auth + ". " + registration, !health.registration_enabled);
    } catch (error) {
      setStatus("Não foi possível consultar o estado real da API: " + error.message, true);
    }
  }
  async function loadAccount() {
    if (!token()) { dashboard.hidden = true; return; }
    try {
      const me = await request("/api/me");
      document.getElementById("accountWelcome").textContent = "Olá, " + (me.user.display_name || "bem-vindo(a)") + "!";
      document.getElementById("accountEmail").textContent = me.user.email;
      dashboard.hidden = false;
      const payPanel = document.getElementById("paymentOptions");
      const balance = document.getElementById("creditBalance");
      if (me.user.approval_status !== "approved") {
        payPanel.hidden = false;
        balance.textContent = "—";
        const paymentConfig = await request("/api/payments/config");
        const payInfo = document.getElementById("paymentInfo");
        payInfo.textContent = (paymentConfig.amount ? "Valor: R$ " + Number(paymentConfig.amount).toFixed(2).replace(".", ",") + ". " : "Valor do plano ainda não configurado. ") +
          (paymentConfig.pix_key ? "Chave Pix: " + paymentConfig.pix_key : "Chave Pix ainda não configurada no servidor.");
        setStatus("Cadastro recebido. Acesso aguardando aprovação. Escolha Pix ou cartão SumUp abaixo.");
      } else {
        payPanel.hidden = true;
        const credits = await request("/api/credits");
        balance.textContent = credits.balance;
        setStatus("Acesso aprovado. Sua sessão está ativa.");
      }
    } catch (error) {
      sessionStorage.removeItem(tokenKey);
      dashboard.hidden = true;
      setStatus(error.message, true);
      await refreshSystemStatus();
    }
  }
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = loginForm.querySelector("button");
    button.disabled = true;
    try {
      const data = await request("/api/auth/login", {method:"POST", body:JSON.stringify({
        email:document.getElementById("loginEmail").value,
        password:document.getElementById("loginPassword").value
      })});
      sessionStorage.setItem(tokenKey, data.access_token);
      loginForm.reset();
      await loadAccount();
    } catch(error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  registerForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = registerForm.querySelector("button");
    button.disabled = true;
    try {
      const data = await request("/api/auth/register", {method:"POST", body:JSON.stringify({
        display_name:document.getElementById("registerName").value,
        email:document.getElementById("registerEmail").value,
        password:document.getElementById("registerPassword").value
      })});
      sessionStorage.setItem(tokenKey, data.access_token);
      registerForm.reset();
      setStatus(data.message || "Cadastro recebido. Aguarde a aprovação.");
      await loadAccount();
    } catch(error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  document.getElementById("payPix").addEventListener("click", () => choosePayment("pix"));
  document.getElementById("paySumUp").addEventListener("click", () => choosePayment("sumup_card"));
  async function choosePayment(method) {
    try {
      if (method === "sumup_card") {
        setStatus("Abrindo checkout seguro do SumUp…");
        const result = await request("/api/payments/sumup/create", {method:"POST", body:"{}"});
        if (!result.checkout_url) throw new Error("O SumUp não retornou o endereço de pagamento.");
        window.location.assign(result.checkout_url);
        return;
      }
      const proof = document.getElementById("pixProofReference").value.trim();
      const result = await request("/api/payments/select", {method:"POST", body:JSON.stringify({method, proof_reference:proof || null})});
      setStatus(result.message || "Pix registrado. Envie o comprovante e aguarde a confirmação manual.");
    } catch (error) { setStatus(error.message, true); }
  }
  document.getElementById("refreshCredits").addEventListener("click", loadAccount);
  document.getElementById("logoutButton").addEventListener("click", () => {
    sessionStorage.removeItem(tokenKey);
    dashboard.hidden = true;
    refreshSystemStatus();
  });
  refreshSystemStatus();
  loadAccount();
})();
