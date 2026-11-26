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
  const recordButton = document.getElementById("startRecording");
  const stopRecordButton = document.getElementById("stopRecording");
  const downloadButton = document.getElementById("downloadRecording");
  const recordingStatus = document.getElementById("recordingStatus");
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const accepted = ["video/mp4", "video/webm", "video/quicktime"];
  let fileUrl = null, cameraStream = null, segmenter = null, processing = false;
  let backgroundImage = null, backgroundUrl = null, framePending = false;
  let recorder = null, recordedChunks = [], recordedBlob = null, recordedUrl = null;

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
    fileStatus.textContent = "Vídeo carregado para pré-visualização. A troca de rosto em arquivo ainda depende de um motor compatível.";
  });

  async function loadBackground() {
    const url = window.FaceMagicBackground?.getSelectedUrl?.();
    if (!url) { backgroundImage = null; backgroundUrl = null; return; }
    if (url === backgroundUrl && backgroundImage?.complete) return;
    const image = new Image(); image.crossOrigin = "anonymous"; image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Não foi possível carregar a imagem de fundo. Escolha outra imagem."));
    });
    backgroundImage = image; backgroundUrl = url;
  }

  async function startSegmentation() {
    if (!window.SelfieSegmentation) throw new Error("O módulo de segmentação não carregou. Atualize a página e tente novamente.");
    if (!segmenter) {
      segmenter = new SelfieSegmentation({ locateFile: file => "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/" + file });
      segmenter.setOptions({ modelSelection: 1, selfieMode: true });
      segmenter.onResults(results => {
        const width = results.image.width, height = results.image.height;
        if (outputCanvas.width !== width || outputCanvas.height !== height) { outputCanvas.width = width; outputCanvas.height = height; }
        const ctx = outputCanvas.getContext("2d");
        ctx.save(); ctx.clearRect(0, 0, width, height);
        ctx.drawImage(results.segmentationMask, 0, 0, width, height);
        ctx.globalCompositeOperation = "source-in"; ctx.drawImage(results.image, 0, 0, width, height);
        ctx.globalCompositeOperation = "destination-over";
        if (backgroundImage?.complete) ctx.drawImage(backgroundImage, 0, 0, width, height);
        else { ctx.fillStyle = "#17251a"; ctx.fillRect(0, 0, width, height); }
        ctx.restore(); framePending = false;
      });
    }
    processing = true; outputCanvas.hidden = false; cameraVideo.hidden = true;
    async function renderFrame() {
      if (!processing) return;
      if (!framePending && cameraVideo.readyState >= 2) {
        framePending = true;
        try { await loadBackground(); await segmenter.send({ image: cameraVideo }); }
        catch (error) { framePending = false; cameraStatus.textContent = "Falha ao aplicar o fundo: " + error.message; processing = false; return; }
      }
      requestAnimationFrame(renderFrame);
    }
    renderFrame();
    cameraStatus.textContent = "Fundo virtual ativo. A gravação usará a imagem processada no canvas.";
  }

  startButton?.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) { cameraStatus.textContent = "Este navegador não disponibiliza câmera. Use HTTPS e permita o acesso à webcam."; return; }
    startButton.disabled = true;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true
      });
      cameraVideo.srcObject = cameraStream; cameraVideo.hidden = false; await cameraVideo.play();
      backgroundButton.disabled = false; recordButton.disabled = false;
      cameraStatus.textContent = "Webcam e microfone ativos. Você pode gravar a câmera ou ativar o fundo virtual.";
      stopButton.disabled = false;
    } catch (error) { cameraStatus.textContent = "Não foi possível abrir câmera/microfone: " + (error.message || "permissão negada."); }
    finally { startButton.disabled = false; }
  });

  backgroundButton?.addEventListener("click", async () => {
    backgroundButton.disabled = true;
    try { await startSegmentation(); }
    catch (error) { cameraStatus.textContent = error.message; }
    finally { backgroundButton.disabled = false; }
  });

  recordButton?.addEventListener("click", () => {
    if (!cameraStream) return;
    try {
      const videoSource = !outputCanvas.hidden && outputCanvas.captureStream
        ? outputCanvas.captureStream(30) : cameraVideo.captureStream(30);
      const tracks = [...videoSource.getVideoTracks(), ...cameraStream.getAudioTracks()];
      const recordingStream = new MediaStream(tracks);
      const mimeType = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"]
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Este navegador não oferece formato de gravação compatível. Use Chrome ou Edge atualizado.");
      recordedChunks = []; recordedBlob = null;
      if (recordedUrl) { URL.revokeObjectURL(recordedUrl); recordedUrl = null; }
      downloadButton.disabled = true;
      recorder = new MediaRecorder(recordingStream, { mimeType });
      recorder.ondataavailable = event => { if (event.data?.size) recordedChunks.push(event.data); };
      recorder.onerror = event => { recordingStatus.textContent = "Erro na gravação: " + (event.error?.message || "falha desconhecida."); };
      recorder.onstop = () => {
        recordedBlob = new Blob(recordedChunks, { type: recorder.mimeType || "video/webm" });
        recordedUrl = URL.createObjectURL(recordedBlob);
        downloadButton.disabled = false;
        recordingStatus.textContent = "Gravação pronta (" + (recordedBlob.size / (1024 * 1024)).toFixed(1) + " MB). Clique em Baixar vídeo para salvar no computador.";
        recordingStream.getTracks().forEach(track => track.stop());
      };
      recorder.start(1000);
      recordButton.disabled = true; stopRecordButton.disabled = false;
      recordingStatus.textContent = "Gravando vídeo e áudio…";
    } catch (error) { recordingStatus.textContent = error.message; }
  });

  stopRecordButton?.addEventListener("click", () => {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopRecordButton.disabled = true; recordButton.disabled = !cameraStream;
  });
  downloadButton?.addEventListener("click", () => {
    if (!recordedUrl) return;
    const link = document.createElement("a");
    link.href = recordedUrl; link.download = "facemagic-gravacao-" + new Date().toISOString().replace(/[:.]/g,"-") + ".webm";
    document.body.appendChild(link); link.click(); link.remove();
  });

  function stopCamera() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    processing = false;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.hidden = true; }
    if (outputCanvas) { const ctx = outputCanvas.getContext("2d"); ctx.clearRect(0,0,outputCanvas.width,outputCanvas.height); outputCanvas.hidden = true; }
    if (stopButton) stopButton.disabled = true;
    if (backgroundButton) backgroundButton.disabled = true;
    if (recordButton) recordButton.disabled = true;
    if (stopRecordButton) stopRecordButton.disabled = true;
    if (cameraStatus) cameraStatus.textContent = "Câmera desligada.";
  }
  stopButton?.addEventListener("click", stopCamera);
  window.addEventListener("beforeunload", () => {
    stopCamera();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    if (segmenter) segmenter.close();
  });
})();