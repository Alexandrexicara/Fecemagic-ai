(() => {
  const api = (window.FACEMAGIC_API_URL || "").replace(/\/$/, "");
  const status = document.getElementById("accountStatus");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const dashboard = document.getElementById("accountDashboard");
  const accountPanel = document.getElementById("conta");
  const platformContent = document.getElementById("platformContent");
  const accessGate = document.getElementById("accessGate");
  function showForm(which) { loginForm.hidden = which !== "login"; registerForm.hidden = which !== "register"; }
  document.getElementById("accountToggle")?.addEventListener("click", () => { accountPanel.hidden = !accountPanel.hidden; if (!accountPanel.hidden) accountPanel.scrollIntoView({behavior:"smooth",block:"start"}); });
  document.getElementById("gateRegister")?.addEventListener("click", () => { accountPanel.hidden=false; showForm("register"); accountPanel.scrollIntoView({behavior:"smooth",block:"start"}); });
  document.getElementById("showRegister")?.addEventListener("click", () => showForm("register"));
  document.getElementById("showLogin")?.addEventListener("click", () => showForm("login"));
  function updateAccess(approved) { if (platformContent) platformContent.hidden = !approved; if (accessGate) accessGate.hidden = approved; }
  showForm("register");
  updateAccess(false);
  if (!loginForm || !registerForm) return;
  const tokenKey = "facemagic_session_token";
  const token = () => sessionStorage.getItem(tokenKey);
  const setStatus = (message, isError=false) => {
    status.textContent = message;
    status.style.borderColor = isError ? "#ef444466" : "";
    status.style.color = isError ? "#fca5a5" : "";
  };
  async function request(path, options={}) {
    if (!api) throw new Error("Não foi possível concluir agora. Tente novamente mais tarde.");
    const response = await fetch(api + path, {
      ...options,
      headers: {"Content-Type":"application/json", ...(token()?{"Authorization":"Bearer "+token()}:{}), ...(options.headers||{})}
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.detail || "Não foi possível concluir a solicitação.");
    return data;
  }
  async function refreshSystemStatus() { setStatus("Entre ou cadastre-se para continuar."); }
  async function loadAccount() {
    if (!token()) { dashboard.hidden = true; return; }
    try {
      const me = await request("/api/me");
      document.getElementById("accountWelcome").textContent = "Olá, " + (me.user.display_name || "bem-vindo(a)") + "!";
      document.getElementById("accountEmail").textContent = me.user.email;
      dashboard.hidden = false;
      const payPanel = document.getElementById("paymentOptions");
      const balance = document.getElementById("creditBalance");
      const approved = me.user.approval_status === "approved";
      updateAccess(approved);
      document.getElementById("accountToggle").textContent = approved ? "Minha conta" : "Conta / Pagamento";
      if (!approved) {
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
      updateAccess(false);
      setStatus("Não foi possível concluir agora. Confira os dados e tente novamente.", true);
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
      showForm(null);
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
      showForm(null);
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
        setStatus("Abrindo pagamento seguro…");
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
    updateAccess(false);
    document.getElementById("accountToggle").textContent = "Cadastrar / Entrar";
    accountPanel.hidden = true;
    refreshSystemStatus();
  });
  refreshSystemStatus();
  loadAccount();
})();
