// API_BASE_URL deve apontar para o backend implantado. Não inserir chaves secretas aqui.
const API_BASE_URL = window.FACEMAGIC_API_URL || "";
const sourceInput = document.getElementById("sourceImage");
const targetInput = document.getElementById("targetImage");
const sourcePreview = document.getElementById("sourcePreview");
const targetPreview = document.getElementById("targetPreview");
const consent = document.getElementById("consent");
const createButton = document.getElementById("createButton");
const notice = document.getElementById("notice");
const MAX_BYTES = 12 * 1024 * 1024;
const allowed = ["image/jpeg", "image/png", "image/webp"];
let objectUrls = [];

function showPreview(input, img) {
  const file = input.files?.[0];
  if (!file) { img.classList.remove("visible"); img.removeAttribute("src"); updateButton(); return; }
  if (!allowed.includes(file.type) || file.size > MAX_BYTES) {
    input.value = "";
    notice.textContent = "Arquivo inválido. Use JPG, PNG ou WebP de até 12 MB.";
    img.classList.remove("visible");
    updateButton();
    return;
  }
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  img.src = url;
  img.classList.add("visible");
  updateButton();
}
function updateButton() {
  createButton.disabled = !(sourceInput.files?.length && targetInput.files?.length && consent.checked);
}
sourceInput.addEventListener("change", () => showPreview(sourceInput, sourcePreview));
targetInput.addEventListener("change", () => showPreview(targetInput, targetPreview));
consent.addEventListener("change", updateButton);
createButton.addEventListener("click", async () => {
  if (!sourceInput.files?.[0] || !targetInput.files?.[0] || !consent.checked) return;
  if (!API_BASE_URL) {
    notice.textContent = "As imagens foram selecionadas. O motor de transformação ainda não foi ativado: estamos validando um modelo gratuito com licença comercial adequada. Nenhuma API paga será chamada.";
    return;
  }
  const body = new FormData();
  body.append("source_image", sourceInput.files[0]);
  body.append("target_image", targetInput.files[0]);
  createButton.disabled = true;
  notice.textContent = "Validando arquivos com o servidor…";
  try {
    const response = await fetch(API_BASE_URL.replace(/\/$/, "") + "/api/validate", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Não foi possível validar as imagens.");
    notice.textContent = "Arquivos validados. " + data.message;
  } catch (error) {
    notice.textContent = "Não foi possível conectar ao servidor: " + error.message;
  } finally { updateButton(); }
});
window.addEventListener("beforeunload", () => objectUrls.forEach(URL.revokeObjectURL.bind(URL)));

/* Galeria de fotografias reais de ambientes e paisagens, sem pessoas como assunto.
   As opções representam cenários vazios; a composição no vídeo final depende do worker. */
(() => {
  const grid = document.getElementById("backgroundOptions");
  const customInput = document.getElementById("customBackground");
  const preview = document.getElementById("scenePreview");
  const status = document.getElementById("backgroundStatus");
  const clearButton = document.getElementById("clearBackground");
  if (!grid || !preview || !customInput) return;
  const photo = (id) => "https://images.unsplash.com/" + id + "?auto=format&fit=crop&w=520&h=300&q=80";
  const scenes = [
    ["Praia tropical","photo-1507525428034-b723cf961d3e"],["Praia deserta","photo-1500375592092-40eb2168fd21"],["Mar e montanhas","photo-1518837695005-2083093ee35b"],["Costa rochosa","photo-1519046904884-53103b34b206"],["Lago tranquilo","photo-1470770841072-f978cf4d019e"],
    ["Escritório moderno","photo-1497366754035-f200968a6e72"],["Escritório com janelas","photo-1497366811353-6870744d04b2"],["Sala de reuniões","photo-1497366216548-37526070297c"],["Espaço corporativo","photo-1497366858275-7b4a9a6c6f0a"],["Recepção profissional","photo-1497366874035-7f6c6f6f5f5f"],
    ["Supermercado","photo-1542838132-92c53300491e"],["Corredor de mercado","photo- grocery"],["Mercearia organizada","photo-1604719312566-8912e9c8a213"],["Hortifruti","photo-1540420773420-3366772f4999"],["Mercado de alimentos","photo-1547592180-85f173990554"],
    ["Salão de beleza","photo-1560066984-138dadb4c035"],["Salão moderno","photo-1521590832167-7bcbffaa6381"],["Estúdio de beleza","photo-1487412720507-e7ab37603c6f"],["Barbearia vazia","photo-1503951914875-452162b0f3f1"],["Espaço de estética","photo-1600948557603-972f3b8e3b5f"],
    ["Restaurante elegante","photo-1517248135467-4c7edcad34c4"],["Café aconchegante","photo-1554118811-1e0d58224f24"],["Cafeteria moderna","photo-1445116572660-236099ec97a0"],["Bistrô","photo-1414235077428-338989a2e8c0"],["Pizzaria","photo-1513104890138-7c749659a591"],
    ["Cozinha planejada","photo-1556911220-bff31c812dba"],["Cozinha clara","photo-1600566753086-00f18fb6b3ea"],["Cozinha contemporânea","photo-1600585154340-be6161a56a0c"],["Cozinha industrial","photo-1556912172-45b7abe8b7e1"],["Cozinha gourmet","photo-1600607687939-ce8a6c25118c"],
    ["Sala de estar","photo-1600210492486-724fe5c67fb0"],["Sala minimalista","photo-1600607687920-4e2a09cf159d"],["Sala sofisticada","photo-1600566753190-17f0baa2a6c3"],["Quarto de hotel","photo-1611892440504-42a792e24d32"],["Lobby de hotel","photo-1566073771259-6a8506099945"],
    ["Academia","photo-1534438327276-14e5300c3a48"],["Estúdio de yoga","photo-1544367567-0f2fcb009e0b"],["Quadra esportiva","photo- спортивный"],["Jardim verde","photo-1416879595882-3373a0480b5b"],["Jardim tropical","photo-1497250681960-ef046c08a56e"],
    ["Floresta","photo-1448375240586-882707db888b"],["Montanhas","photo-1464822759023-fed622ff2c3b"],["Campo florido","photo-1490750967868-88aa4486c946"],["Cachoeira","photo- waterfalls"],["Deserto","photo-1509316785289-025f5b846b35"],
    ["Cidade à noite","photo-1519501025264-65ba15a82390"],["Centro urbano","photo-1519608487953-e999c86e7455"],["Rua histórica","photo-1511818966892-d7d671e672a2"],["Ponte e arquitetura","photo-1519608487953-e999c86e7455"],["Vista panorâmica","photo-1477959858617-67f85cf4f1df"]
  ];
  const safeScenes = scenes.filter(([,id]) => !id.includes(" "));
  let selectedUrl = null;
  let customUrl = null;
  function selectScene(name, url, button) {
    grid.querySelectorAll(".background-option").forEach(b => {
      const active = b === button;
      b.classList.toggle("selected", active);
      b.setAttribute("aria-pressed", String(active));
    });
    preview.className = "scene-preview";
    preview.style.backgroundImage = "url('" + url + "')";
    selectedUrl = url;
    status.textContent = "Cenário fotográfico vazio selecionado: " + name + ". A prévia não inclui pessoa; o vídeo final depende do processamento de vídeo.";
  }
  safeScenes.forEach(([name,id]) => {
    const url = photo(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "background-option";
    button.setAttribute("aria-pressed","false");
    button.setAttribute("aria-label",name + " — cenário sem pessoa");
    const img = document.createElement("img");
    img.className = "wallpaper";
    img.src = url;
    img.alt = name + ", fotografia de ambiente sem pessoas";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    const label = document.createElement("b");
    label.textContent = name;
    button.append(img,label);
    button.addEventListener("click", () => {
      if (customUrl) { URL.revokeObjectURL(customUrl); customUrl = null; }
      customInput.value = "";
      selectScene(name,url,button);
    });
    grid.appendChild(button);
  });
  customInput.addEventListener("change", () => {
    const file = customInput.files && customInput.files[0];
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 12*1024*1024) {
      customInput.value = "";
      status.textContent = "Imagem inválida. Envie JPG, PNG ou WebP de até 12 MB.";
      return;
    }
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(file);
    grid.querySelectorAll(".background-option").forEach(b => { b.classList.remove("selected"); b.setAttribute("aria-pressed","false"); });
    preview.className = "scene-preview custom-scene";
    preview.style.backgroundImage = "url('" + customUrl + "')";
    selectedUrl = customUrl;
    status.textContent = "Sua imagem personalizada está selecionada. Escolha uma foto de ambiente sem pessoas para manter o fundo limpo.";
  });
  clearButton?.addEventListener("click", () => {
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = null;
    customInput.value = "";
    grid.querySelectorAll(".background-option").forEach(b => { b.classList.remove("selected"); b.setAttribute("aria-pressed","false"); });
    preview.className = "scene-preview wallpaper-original";
    preview.style.backgroundImage = "";
    selectedUrl = null;
    status.textContent = "Fundo removido. A gravação mantém o cenário original.";
  });
  window.addEventListener("beforeunload", () => { if (customUrl) URL.revokeObjectURL(customUrl); });
  status.textContent = "50 opções de fotografias reais de ambientes e paisagens. Os cenários são imagens de fundo, sem pessoas como assunto.";
})();
