(() => {
  const fileInput = document.getElementById("recordedVideo");
  const videoPreview = document.getElementById("recordedVideoPreview");
  const fileStatus = document.getElementById("recordedVideoStatus");
  const cameraVideo = document.getElementById("liveCameraPreview");
  const cameraStatus = document.getElementById("liveCameraStatus");
  const startButton = document.getElementById("startCamera");
  const stopButton = document.getElementById("stopCamera");
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const accepted = ["video/mp4", "video/webm", "video/quicktime"];
  let fileUrl = null;
  let cameraStream = null;

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
    fileStatus.textContent = "Vídeo carregado apenas para pré-visualização neste navegador. O envio para processamento será ativado após conectar o serviço de face swap.";
  });

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
      cameraStatus.textContent = "Webcam ativa para pré-visualização local. A troca de rosto em tempo real ainda depende da conexão do motor Live Swap.";
      stopButton.disabled = false;
    } catch (error) {
      cameraStatus.textContent = "Não foi possível abrir a câmera: " + (error.message || "permissão negada.");
    } finally {
      startButton.disabled = false;
    }
  });
  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.hidden = true; }
    if (stopButton) stopButton.disabled = true;
    if (cameraStatus) cameraStatus.textContent = "Câmera desligada.";
  }
  stopButton?.addEventListener("click", stopCamera);
  window.addEventListener("beforeunload", () => {
    stopCamera();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  });
})();
