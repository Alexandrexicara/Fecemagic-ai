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