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

/* Galeria de papéis de parede com fotografias reais.
   A imagem escolhida é usada na prévia; o pipeline de vídeo ainda precisa
   aplicar o cenário ao arquivo renderizado. */
(() => {
  const options = [...document.querySelectorAll(".background-option")];
  const customInput = document.getElementById("customBackground");
  const preview = document.getElementById("scenePreview");
  const status = document.getElementById("backgroundStatus");
  const clearButton = document.getElementById("clearBackground");
  if (!options.length || !preview || !customInput) return;
  const photos = {
    beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&h=900&fit=crop",
    office: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1600&h=900&fit=crop",
    market: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&h=900&fit=crop",
    salon: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1600&h=900&fit=crop",
    restaurant: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&h=900&fit=crop",
    kitchen: "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=1600&h=900&fit=crop",
    living: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1600&h=900&fit=crop",
    gym: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&h=900&fit=crop",
    hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&h=900&fit=crop",
    garden: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1600&h=900&fit=crop",
    city: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1600&h=900&fit=crop"
  };
  let customUrl = null;
  function choose(name) {
    options.forEach(button => {
      const active = button.dataset.background === name;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    preview.className = "scene-preview" + (name === "original" ? " wallpaper-original" : "");
    preview.style.backgroundImage = name === "original" ? "" : "url('" + photos[name] + "')";
    const label = options.find(button => button.dataset.background === name)?.innerText.trim() || "original";
    status.textContent = name === "original"
      ? "Sem fundo adicional: a gravação mantém o cenário original."
      : "Fotografia real de " + label + " selecionada para a prévia. A aplicação no vídeo final depende da ativação do processamento de vídeo.";
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
    status.textContent = "Sua fotografia personalizada está selecionada para a prévia do cenário.";
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
