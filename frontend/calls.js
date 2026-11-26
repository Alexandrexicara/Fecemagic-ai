(() => {
  const api = (window.FACEMAGIC_API_URL || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const createButton = $("createCallRoom");
  const joinButton = $("joinCallRoom");
  const leaveButton = $("leaveCallRoom");
  const roomInput = $("callRoomInput");
  const localVideo = $("callLocalVideo");
  const remoteVideo = $("callRemoteVideo");
  const status = $("callStatus");
  if (!createButton || !joinButton || !leaveButton || !localVideo || !remoteVideo) return;

  let roomId = null;
  let socket = null;
  let stream = null;
  let peer = null;
  let remotePeerId = null;
  let pendingCandidates = [];

  function setStatus(message) { status.textContent = message; }
  function getRoomId(value) {
    const raw = (value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.href);
      return url.searchParams.get("room") || url.pathname.match(/\/call\/([^/]+)/)?.[1] || raw;
    } catch { return raw; }
  }
  function send(type, payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, to: remotePeerId, payload }));
  }
  async function ensureMedia() {
    if (stream) return stream;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera e microfone exigem HTTPS e permissão do navegador.");
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    await localVideo.play();
    return stream;
  }
  function makePeer() {
    if (peer) return peer;
    peer = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
    });
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.ontrack = event => {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(() => {});
      setStatus("Chamada conectada. Áudio e vídeo estão ativos entre os navegadores.");
    };
    peer.onicecandidate = event => {
      if (event.candidate) send("ice-candidate", event.candidate);
    };
    peer.onconnectionstatechange = () => {
      if (peer && ["failed", "disconnected"].includes(peer.connectionState)) {
        setStatus("A conexão caiu ou não atravessou a rede. Tente novamente; redes restritivas podem exigir um servidor TURN.");
      }
    };
    return peer;
  }
  async function connect(room) {
    if (!api) throw new Error("A URL da API do Render não está configurada.");
    if (socket || peer) await leave(false);
    roomId = room;
    await ensureMedia();
    const wsBase = api.replace(/^http/, "ws");
    socket = new WebSocket(wsBase + "/ws/calls/" + encodeURIComponent(room));
    socket.onmessage = async event => {
      const message = JSON.parse(event.data);
      try {
        if (message.type === "room-error") { setStatus(message.message); await leave(false); return; }
        if (message.type === "joined") {
          remotePeerId = message.peers?.[0] || null;
          setStatus(message.peers?.length ? "Pessoa encontrada. Negociando áudio e vídeo…" : "Sala criada. Aguardando a outra pessoa entrar pelo link.");
          return;
        }
        if (message.type === "peer-joined") {
          remotePeerId = message.peer_id;
          const pc = makePeer();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send("offer", pc.localDescription);
          setStatus("Enviando convite de conexão para a outra pessoa…");
          return;
        }
        if (message.type === "offer") {
          remotePeerId = message.from;
          const pc = makePeer();
          await pc.setRemoteDescription(message.payload);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send("answer", pc.localDescription);
          for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
          pendingCandidates = [];
          return;
        }
        if (message.type === "answer" && peer) {
          await peer.setRemoteDescription(message.payload);
          for (const candidate of pendingCandidates) await peer.addIceCandidate(candidate);
          pendingCandidates = [];
          return;
        }
        if (message.type === "ice-candidate" && peer) {
          if (peer.remoteDescription) await peer.addIceCandidate(message.payload);
          else pendingCandidates.push(message.payload);
          return;
        }
        if (message.type === "peer-left") {
          remoteVideo.srcObject = null;
          setStatus("A outra pessoa saiu da chamada. Você continua na sala e pode aguardar uma nova conexão.");
          if (peer) { peer.close(); peer = null; }
          remotePeerId = null;
        }
      } catch (error) {
        setStatus("Falha ao negociar a chamada: " + error.message);
      }
    };
    socket.onopen = () => {
      leaveButton.disabled = false;
      createButton.disabled = true;
      joinButton.disabled = true;
      setStatus("Conectado à sala. Aguardando sinalização…");
    };
    socket.onerror = () => setStatus("Não foi possível conectar à sala. Verifique se o Render terminou a implantação.");
    socket.onclose = () => {
      if (roomId) setStatus("Conexão com a sala encerrada.");
    };
  }
  async function leave(updateStatus = true) {
    send("hangup", null);
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
    if (peer) { peer.close(); peer = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    roomId = null;
    remotePeerId = null;
    pendingCandidates = [];
    createButton.disabled = false;
    joinButton.disabled = false;
    leaveButton.disabled = true;
    if (updateStatus) setStatus("Chamada encerrada. Câmera e microfone desligados.");
  }
  createButton.addEventListener("click", async () => {
    createButton.disabled = true;
    try {
      const response = await fetch(api + "/api/calls/rooms", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Não foi possível criar a sala.");
      const invite = new URL(window.location.href);
      invite.searchParams.set("room", data.room_id);
      roomInput.value = invite.toString();
      try { await navigator.clipboard.writeText(invite.toString()); } catch {}
      await connect(data.room_id);
      setStatus("Sala criada e convite preparado. Compartilhe o link para a outra pessoa entrar.");
    } catch (error) {
      createButton.disabled = false;
      setStatus("Não foi possível iniciar a chamada: " + error.message);
    }
  });
  joinButton.addEventListener("click", async () => {
    const room = getRoomId(roomInput.value || new URLSearchParams(location.search).get("room"));
    if (!room) { setStatus("Cole o link ou código da sala primeiro."); return; }
    try { await connect(room); }
    catch (error) { setStatus("Não foi possível entrar: " + error.message); }
  });
  leaveButton.addEventListener("click", () => leave(true));
  const invitedRoom = new URLSearchParams(location.search).get("room");
  if (invitedRoom) { roomInput.value = invitedRoom; setStatus("Convite recebido. Clique em Entrar na sala para aceitar câmera e microfone."); }
  window.addEventListener("beforeunload", () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (socket) socket.close();
    if (peer) peer.close();
  });
})();