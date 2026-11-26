(() => {
  const fileInput = document.getElementById("recordedVideo");
  const videoPreview = document.getElementById("recordedVideoPreview");
  const fileStatus = document.getElementById("recordedVideoStatus");
  const cameraVideo = document.getElementById("liveCameraPreview");
  const cameraStatus = document.getElementById("liveCameraStatus");
  const startButton = document.getElementById("startCamera");
  const stopButton = document.getElementById("stopCamera");
  const backgroundButton = document.getElementById("enableVirtualBackground");
  const outputCanvas = document.getElementById("liveBackgroundCanvas");
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const accepted = ["video/mp4", "video/webm", "video/quicktime"];
  let fileUrl = null;
  let cameraStream = null;
  let segmenter = null;
  let processing = false;
  let backgroundImage = null;
  let backgroundUrl = null;
  let framePending = false;

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!accepted.includes(file.type) || file.size > MAX_VIDEO_BYTES) {
      fileInput.value = "";
      fileStatus.textContent = "Formato ou tamanho inválido. Use MP4, WebM ou MOV de até 250 MB.";
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    videoPreview.src = fileUrl;
    videoPreview.hidden = false;
    fileStatus.textContent = "Vídeo carregado para pré-visualização. O processamento do arquivo gravado ainda não está habilitado.";
  });

  async function loadBackground() {
    const url = window.FaceMagicBackground?.getSelectedUrl?.();
    if (!url) { backgroundImage = null; backgroundUrl = null; return; }
    if (url === backgroundUrl && backgroundImage?.complete) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Não foi possível carregar a imagem de fundo. Escolha outra imagem."));
    });
    backgroundImage = image;
    backgroundUrl = url;
  }

  async function startSegmentation() {
    if (!window.SelfieSegmentation) throw new Error("O módulo de segmentação não carregou. Atualize a página e tente novamente.");
    if (!segmenter) {
      segmenter = new SelfieSegmentation({ locateFile: file => "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.167/" + file });
      segmenter.setOptions({ modelSelection: 1, selfieMode: true });
      segmenter.onResults(results => {
        const width = results.image.width;
        const height = results.image.height;
        if (outputCanvas.width !== width || outputCanvas.height !== height) {
          outputCanvas.width = width;
          outputCanvas.height = height;
        }
        const ctx = outputCanvas.getContext("2d");
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(results.segmentationMask, 0, 0, width, height);
        ctx.globalCompositeOperation = "source-in";
        ctx.drawImage(results.image, 0, 0, width, height);
        ctx.globalCompositeOperation = "destination-over";
        if (backgroundImage?.complete) ctx.drawImage(backgroundImage, 0, 0, width, height);
        else { ctx.fillStyle = "#17251a"; ctx.fillRect(0, 0, width, height); }
        ctx.restore();
        framePending = false;
      });
    }
    processing = true;
    outputCanvas.hidden = false;
    cameraVideo.hidden = true;
    async function renderFrame() {
      if (!processing) return;
      if (!framePending && cameraVideo.readyState >= 2) {
        framePending = true;
        try {
          await loadBackground();
          await segmenter.send({ image: cameraVideo });
        } catch (error) {
          framePending = false;
          cameraStatus.textContent = "Falha ao aplicar o fundo: " + error.message;
          processing = false;
          return;
        }
      }
      requestAnimationFrame(renderFrame);
    }
    renderFrame();
    cameraStatus.textContent = "Fundo virtual ativo no navegador. A separação da pessoa é processada localmente; a qualidade depende da iluminação e do equipamento.";
  }

  startButton?.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraStatus.textContent = "Este navegador não disponibiliza câmera. Use HTTPS e permita o acesso à webcam.";
      return;
    }
    startButton.disabled = true;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      cameraVideo.srcObject = cameraStream;
      cameraVideo.hidden = false;
      await cameraVideo.play();
      backgroundButton.disabled = false;
      cameraStatus.textContent = "Webcam ativa. Escolha um cenário na galeria e clique em Ativar fundo virtual.";
      stopButton.disabled = false;
    } catch (error) {
      cameraStatus.textContent = "Não foi possível abrir a câmera: " + (error.message || "permissão negada.");
    } finally {
      startButton.disabled = false;
    }
  });

  backgroundButton?.addEventListener("click", async () => {
    backgroundButton.disabled = true;
    try { await startSegmentation(); }
    catch (error) { cameraStatus.textContent = error.message; }
    finally { backgroundButton.disabled = false; }
  });

  function stopCamera() {
    processing = false;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.hidden = true; }
    if (outputCanvas) {
      const ctx = outputCanvas.getContext("2d");
      ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      outputCanvas.hidden = true;
    }
    if (stopButton) stopButton.disabled = true;
    if (backgroundButton) backgroundButton.disabled = true;
    if (cameraStatus) cameraStatus.textContent = "Câmera desligada.";
  }
  stopButton?.addEventListener("click", stopCamera);
  window.addEventListener("beforeunload", () => {
    stopCamera();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (segmenter) segmenter.close();
  });
})();