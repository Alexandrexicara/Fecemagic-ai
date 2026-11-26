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

/* Seletor de cenários para o futuro pipeline de vídeo. A seleção e a prévia
   funcionam no navegador; a composição no arquivo final aguarda o worker de vídeo. */
(() => {
  const options = [...document.querySelectorAll(".background-option")];
  const customInput = document.getElementById("customBackground");
  const preview = document.getElementById("scenePreview");
  const status = document.getElementById("backgroundStatus");
  const clearButton = document.getElementById("clearBackground");
  if (!options.length || !preview || !customInput) return;
  const presets = ["original","office","beach","studio","city","library","nature"];
  let customUrl = null;
  function choose(name) {
    options.forEach(button => {
      const active = button.dataset.background === name;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    preview.className = "scene-preview wallpaper-" + name;
    preview.style.backgroundImage = "";
    status.textContent = "Cenário " + (name === "original" ? "original" : name) + " selecionado. A prévia está pronta; a aplicação no vídeo final depende do processamento de vídeo.";
  }
  options.forEach(button => button.addEventListener("click", () => {
    if (customUrl) { URL.revokeObjectURL(customUrl); customUrl = null; }
    customInput.value = "";
    choose(button.dataset.background);
  }));
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
    options.forEach(button => { button.classList.remove("selected"); button.setAttribute("aria-pressed","false"); });
    preview.className = "scene-preview custom-scene";
    preview.style.backgroundImage = "url('" + customUrl + "')";
    status.textContent = "Sua imagem personalizada está selecionada para o cenário do vídeo.";
  });
  clearButton?.addEventListener("click", () => {
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = null;
    customInput.value = "";
    choose("original");
  });
  window.addEventListener("beforeunload", () => { if (customUrl) URL.revokeObjectURL(customUrl); });
  choose("original");
})();
