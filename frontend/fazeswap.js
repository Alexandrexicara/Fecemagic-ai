(() => {
  const api = (window.FACEMAGIC_API_URL || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const token = () => sessionStorage.getItem("facemagic_session_token") || "";
  const headers = () => ({ Authorization: "Bearer " + token() });
  const faceInput = $("sourceImage");
  const processVideoButton = $("processRecordedVideo");
  const videoInput = $("recordedVideo");
  const videoStatus = $("recordedVideoStatus");
  const videoResult = $("fazeSwapVideoResult");
  const videoDownload = $("fazeSwapVideoDownload");
  const prepareButton = $("prepareLiveSwap");
  const activateButton = $("activateLiveSwap");
  const stopButton = $("stopLiveSwap");
  const livePreview = $("liveFaceSwapPreview");
  const liveStatus = $("liveSwapStatus");
  let pending = null;
  let swap = null;
  let outputStream = null;

  window.FaceMagicLiveSwap = {
    getStream: () => outputStream,
    isActive: () => !!outputStream,
    stop: stopLiveSwap
  };

  async function request(path, options = {}) {
    const response = await fetch(api + path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Não foi possível concluir a operação.");
    return data;
  }

  async function pollJob(id, statusElement) {
    for (let i = 0; i < 180; i++) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const data = await request("/api/engine/jobs/" + encodeURIComponent(id));
      if (data.status === "succeeded" && data.output_url) return data;
      if (data.status === "failed") throw new Error(data.error?.message || "O mecanismo não conseguiu processar o arquivo.");
      if (statusElement) statusElement.textContent = "Processando seu arquivo… " + (i + 1);
    }
    throw new Error("O processamento ainda está em andamento. Consulte novamente em instantes.");
  }

  /* account/balance controls intentionally remain in the admin backend, not in the customer studio */
  balanceButton?.addEventListener("click", async () => {
    balanceButton.disabled = true;
    if (balanceStatus) balanceStatus.textContent = "Consultando saldo da FaceMagic AI…";
    try {
      const data = await request("/api/engine/account");
      const balance = Number(data.balance?.balance_usd);
      if (balanceStatus) balanceStatus.textContent = Number.isFinite(balance)
        ? "Saldo disponível: US$ " + balance.toFixed(2)
        : "Consulta concluída. Confira o painel da FaceMagic AI para ver os créditos.";
    } catch (error) {
      if (balanceStatus) balanceStatus.textContent = error.message;
    } finally { balanceButton.disabled = false; }
  });

  processVideoButton?.addEventListener("click", async () => {
    const video = videoInput?.files?.[0];
    const face = faceInput?.files?.[0];
    if (!video || !face) {
      if (videoStatus) videoStatus.textContent = "Selecione o vídeo gravado e a foto do rosto na seção de imagens.";
      return;
    }
    if (!token()) {
      if (videoStatus) videoStatus.textContent = "Entre em uma conta aprovada para processar o vídeo.";
      return;
    }
    processVideoButton.disabled = true;
    if (videoStatus) videoStatus.textContent = "Enviando vídeo e foto para processamento…";
    try {
      const form = new FormData();
      form.append("recorded_video", video);
      form.append("face_image", face);
      const started = await request("/api/engine/video", { method: "POST", body: form });
      if (!started.job_id) throw new Error("O mecanismo não retornou o ID do processamento.");
      const result = await pollJob(started.job_id, videoStatus);
      if (videoResult) { videoResult.src = result.output_url; videoResult.hidden = false; }
      if (videoDownload) { videoDownload.href = result.output_url; videoDownload.hidden = false; }
      if (videoStatus) videoStatus.textContent = "Vídeo transformado. Custo do processamento: US$ " + Number(result.charged_usd || 0).toFixed(4) + ".";
    } catch (error) {
      if (videoStatus) videoStatus.textContent = error.message;
    } finally { processVideoButton.disabled = false; }
  });

  window.addEventListener("facemagic-camera-started", () => {
    if (prepareButton) prepareButton.disabled = false;
    if (liveStatus) liveStatus.textContent = "Câmera ligada. Selecione a foto do rosto e prepare uma sessão de 1 minuto.";
  });
  window.addEventListener("facemagic-camera-stopped", () => {
    if (prepareButton) prepareButton.disabled = true;
    if (activateButton) activateButton.disabled = true;
  });

  prepareButton?.addEventListener("click", async () => {
    const face = faceInput?.files?.[0];
    if (!face) { if (liveStatus) liveStatus.textContent = "Selecione primeiro a foto do rosto na seção de imagens."; return; }
    if (!window.FaceMagicCameraStream) { if (liveStatus) liveStatus.textContent = "Ligue a câmera antes de preparar a transformação ao vivo."; return; }
    if (!token()) { if (liveStatus) liveStatus.textContent = "Entre em uma conta aprovada para usar o estúdio."; return; }
    prepareButton.disabled = true;
    if (liveStatus) liveStatus.textContent = "Preparando transformação ao vivo (1 minuto)…";
    try {
      const form = new FormData();
      form.append("face_image", face);
      form.append("duration_minutes", "1");
      pending = await request("/api/engine/live-session", { method: "POST", body: form });
      if (liveStatus) liveStatus.textContent = "Sessão preparada. Teto máximo informado: US$ " + Number(pending.max_cost_usd || 0).toFixed(2) + ". A cobrança efetiva é pelos segundos transmitidos. Clique em Ativar para começar.";
      if (activateButton) activateButton.disabled = false;
      prepareButton.disabled = true;
    } catch (error) {
      pending = null;
      if (liveStatus) liveStatus.textContent = error.message;
    } finally { prepareButton.disabled = false; }
  });

  activateButton?.addEventListener("click", async () => {
    const camera = window.FaceMagicCameraStream;
    if (!pending || !camera) return;
    activateButton.disabled = true;
    if (liveStatus) liveStatus.textContent = "Conectando a transformação ao vivo…";
    try {
      const sdk = await import(pending.sdk_url);
      const cameraInput = new MediaStream(camera.getVideoTracks());
      swap = await sdk.startRealtimeSwap({
        session: pending.session,
        referenceImage: pending.reference_image_url,
        prompt: pending.prompt,
        camera: () => cameraInput,
        onState: state => { if (liveStatus) liveStatus.textContent = "Status: " + String(state); }
      });
      outputStream = new MediaStream([...swap.stream.getVideoTracks(), ...camera.getAudioTracks()]);
      if (livePreview) {
        livePreview.srcObject = outputStream;
        livePreview.hidden = false;
        await livePreview.play();
      }
      const rawPreview = $("liveCameraPreview");
      if (rawPreview) rawPreview.hidden = true;
      if (stopButton) stopButton.disabled = false;
      if (liveStatus) liveStatus.textContent = "Troca facial ao vivo ativa. Agora entre na chamada FaceMagic para transmitir o vídeo transformado.";
      window.dispatchEvent(new Event("facemagic-live-swap-changed"));
    } catch (error) {
      if (liveStatus) liveStatus.textContent = "Não foi possível iniciar a troca ao vivo: " + (error.message || "falha de conexão");
      try { await request("/api/engine/live-session/" + encodeURIComponent(pending.session_id) + "/stop", { method: "POST" }); } catch {}
      pending = null;
      if (activateButton) activateButton.disabled = true;
      if (prepareButton) prepareButton.disabled = !window.FaceMagicCameraStream;
    }
  });

  async function stopLiveSwap() {
    const session = pending;
    pending = null;
    if (swap?.stream) transformação.stream.getTracks().forEach(track => track.stop());
    transformação = null;
    if (outputStream) outputStream.getVideoTracks().forEach(track => track.stop());
    outputStream = null;
    if (livePreview) { livePreview.pause(); livePreview.srcObject = null; livePreview.hidden = true; }
    const rawPreview = $("liveCameraPreview");
    if (rawPreview && window.FaceMagicCameraStream) {
      rawPreview.srcObject = window.FaceMagicCameraStream;
      rawPreview.hidden = false;
    }
    if (stopButton) stopButton.disabled = true;
    if (activateButton) activateButton.disabled = true;
    if (prepareButton) prepareButton.disabled = !window.FaceMagicCameraStream;
    if (session?.session_id && token()) {
      try { await request("/api/engine/live-session/" + encodeURIComponent(session.session_id) + "/stop", { method: "POST" }); } catch {}
    }
    if (liveStatus) liveStatus.textContent = "A transformação ao vivo foi encerrada. A câmera original continua disponível.";
    window.dispatchEvent(new Event("facemagic-live-transformação-changed"));
  }
  stopButton?.addEventListener("click", stopLiveSwap);
})();
