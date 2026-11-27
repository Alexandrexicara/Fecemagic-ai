(() => {
  const api = (window.FACEMAGIC_API_URL || "").replace(/\/$/, "");
  const status = document.getElementById("accountStatus");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const dashboard = document.getElementById("accountDashboard");
  const accountPanel = document.getElementById("conta");
  const platformContent = document.getElementById("platformContent");
  const accessGate = document.getElementById("accessGate");
  const payPanel = document.getElementById("paymentOptions");
  const payInfo = document.getElementById("paymentInfo");
  const pixButton = document.getElementById("payPix");
  const sumupButton = document.getElementById("paySumUp");
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
  async function loadPaymentOptions() {
    const config = await request("/api/payments/config");
    const amount = Number(config.amount || 4000).toLocaleString("pt-BR", {style:"currency",currency:"BRL"});
    payInfo.textContent = "Compra da plataforma (pagamento único): " + amount + ". " +
      (config.pix_key ? "Chave Pix: " + config.pix_key : "Pix: dados de pagamento serão informados pelo responsável.");
    pixButton.disabled = !config.pix_key;
    pixButton.title = config.pix_key ? "Pagar com Pix" : "Pix ainda indisponível";
    sumupButton.disabled = !config.sumup_ready;
    sumupButton.title = config.sumup_ready ? "Pagar com cartão pelo SumUp" : "Pagamento por cartão temporariamente indisponível";
  }
  async function loadAccount() {
    if (!token()) { dashboard.hidden = true; payPanel.hidden = true; return; }
    try {
      const me = await request("/api/me");
      document.getElementById("accountWelcome").textContent = "Olá, " + (me.user.display_name || "bem-vindo(a)") + "!";
      document.getElementById("accountEmail").textContent = me.user.email;
      dashboard.hidden = false;
      const approved = me.user.approval_status === "approved";
      const isAdmin = me.user.role === "admin";
      updateAccess(approved);
      document.getElementById("accountToggle").textContent = approved ? "Minha conta" : "Conta / Pagamento";
      payPanel.hidden = approved && !isAdmin;
      if (!approved || isAdmin) await loadPaymentOptions();
      if (isAdmin) setStatus("Conta administrativa liberada. Você também pode visualizar e testar as formas de pagamento.");
      else if (approved) setStatus("Compra confirmada. Seu acesso à plataforma está liberado.");
      else setStatus("Cadastro recebido. Escolha Pix ou cartão para concluir a compra e liberar o acesso.");
    } catch (error) {
      sessionStorage.removeItem(tokenKey);
      dashboard.hidden = true;
      payPanel.hidden = true;
      updateAccess(false);
      setStatus("Não foi possível concluir agora. Confira os dados e tente novamente.", true);
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
      await loadAccount();
    } catch(error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  pixButton.addEventListener("click", async () => {
    try {
      const proof = document.getElementById("pixProofReference").value.trim();
      const result = await request("/api/payments/select", {method:"POST", body:JSON.stringify({method:"pix", proof_reference:proof || null})});
      setStatus(result.message || "Pix selecionado. Envie o comprovante ao responsável para confirmação.");
    } catch (error) { setStatus(error.message, true); }
  });
  sumupButton.addEventListener("click", async () => {
    try {
      setStatus("Abrindo pagamento seguro…");
      const result = await request("/api/payments/sumup/create", {method:"POST", body:"{}"});
      if (!result.checkout_url) throw new Error("Não foi possível abrir o pagamento.");
      window.location.assign(result.checkout_url);
    } catch (error) { setStatus(error.message, true); }
  });
  document.getElementById("logoutButton").addEventListener("click", () => {
    sessionStorage.removeItem(tokenKey);
    dashboard.hidden = true;
    payPanel.hidden = true;
    updateAccess(false);
    document.getElementById("accountToggle").textContent = "Cadastrar / Entrar";
    accountPanel.hidden = true;
    setStatus("Você saiu da sua conta.");
  });
  setStatus("Entre ou cadastre-se para continuar.");
  loadAccount();
})();
