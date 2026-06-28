const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let state = null;
let currentVoiceAudio = null;
let currentVoiceButton = null;
let selectedLlmCatalogProvider = null;
let llmModal = null;
let llmModelTestState = {};
let selectedJobIds = new Set();
let writerBusy = false;
let manualScriptFresh = false;
let manualScriptEditing = false;
let lastWriterPreview = null;
let llmScanOptions = {
  freeOnly: false,
  workingOnly: true
};
let ttsPollTimer = null;

const WRITING_STYLES = {
  random: { name: "Random phù hợp", type: "Tự chọn", description: "Tự chọn một kiểu hợp với combo và nguồn.", pattern: "Mỗi lần viết có thể đổi góc kể, CTA và kết cấu." },
  "source-proof": { name: "Dẫn chứng trước", type: "Bằng chứng", description: "Mở bằng chi tiết có thể kiểm tra, ít quảng bá, tăng độ tin.", pattern: "Nguồn kiểm chứng -> tín hiệu đáng tin -> lợi ích -> giới hạn -> lời kêu gọi." },
  "problem-first": { name: "Vấn đề trước", type: "Nỗi đau", description: "Nêu nỗi đau rồi mới đưa công cụ vào.", pattern: "Nỗi đau -> nguyên nhân -> công cụ -> kết quả -> phản biện." },
  "question-open": { name: "Câu hỏi gây tò mò", type: "Hook", description: "Mở bằng câu hỏi sát nhu cầu người xem.", pattern: "Câu hỏi -> câu trả lời bất ngờ -> bằng chứng -> cách thử." },
  "outcome-first": { name: "Kết quả trước", type: "Lợi ích", description: "Bắt đầu từ lợi ích cuối cùng người xem muốn.", pattern: "Kết quả -> cách đạt được -> bằng chứng -> điều kiện dùng." },
  "quick-compare": { name: "So sánh nhanh", type: "So sánh", description: "Trước/sau, khác biệt, nên thử khi nào.", pattern: "Trước đây -> bây giờ -> khác biệt -> nên/không nên dùng." },
  "anti-hype": { name: "Phản quảng bá", type: "Phản biện", description: "Nói tỉnh táo, có phản biện và giới hạn.", pattern: "Đừng tin lời quảng bá -> kiểm tra bằng chứng -> kết luận cân bằng." },
  "step-by-step": { name: "Từng bước", type: "Hướng dẫn", description: "Hướng dẫn rõ, ít thuật ngữ, có kết quả từng bước.", pattern: "Bước 1 -> bước 2 -> kết quả -> lỗi cần tránh." },
  "creator-story": { name: "Câu chuyện creator", type: "Kể chuyện", description: "Kể theo vấn đề, chuyển biến, kết quả.", pattern: "Bối cảnh -> vướng mắc -> khoảnh khắc chuyển hướng -> kết quả." },
  "data-led": { name: "Số liệu dẫn dắt", type: "Số liệu", description: "Dùng con số/metric làm điểm neo.", pattern: "Con số -> ý nghĩa -> ứng dụng -> kiểm chứng." },
  "trust-review": { name: "Review niềm tin", type: "Niềm tin", description: "Quyền riêng tư, dữ liệu, rủi ro và điều kiện dùng.", pattern: "Dữ liệu ở đâu -> lợi ích -> rủi ro -> điều kiện nên thử." },
  "direct-cta": { name: "Chốt hành động", type: "CTA", description: "Ngắn, mạnh, hướng người xem làm việc tiếp theo.", pattern: "Giá trị chính -> bằng chứng nhanh -> hành động cụ thể." },
  "myth-buster": { name: "Đập hiểu lầm", type: "Phá định kiến", description: "Mở bằng một hiểu lầm phổ biến rồi sửa lại bằng bằng chứng.", pattern: "Hiểu lầm -> sự thật -> ví dụ -> nên thử khi nào." },
  "risk-first": { name: "Rủi ro trước", type: "Cân nhắc", description: "Nêu điểm cần cẩn trọng trước khi nói lợi ích.", pattern: "Rủi ro -> điều kiện dùng -> lợi ích thật -> cách kiểm tra." },
  checklist: { name: "Checklist nhanh", type: "Checklist", description: "Biến nội dung thành các tiêu chí dễ quét.", pattern: "Tiêu chí 1 -> tiêu chí 2 -> tiêu chí 3 -> kết luận." },
  "use-case": { name: "Tình huống sử dụng", type: "Use case", description: "Kể theo một trường hợp dùng cụ thể.", pattern: "Ai cần -> dùng khi nào -> làm ra sao -> kết quả." },
  "demo-narrative": { name: "Demo theo cảnh", type: "Demo", description: "Mỗi cảnh trả lời một thao tác hoặc kết quả.", pattern: "Cảnh mở -> thao tác -> kết quả -> kiểm tra." },
  "why-now": { name: "Vì sao lúc này", type: "Thời điểm", description: "Giải thích vì sao công cụ đáng chú ý ở thời điểm hiện tại.", pattern: "Bối cảnh -> thay đổi mới -> lợi ích -> hành động." },
  "beginner-friendly": { name: "Dành cho người mới", type: "Dễ hiểu", description: "Ít thuật ngữ, giải thích từ nhu cầu thực tế.", pattern: "Nhu cầu -> cách hiểu đơn giản -> thử nhỏ -> lưu ý." },
  "technical-proof": { name: "Bằng chứng kỹ thuật", type: "Kỹ thuật", description: "Dùng chi tiết nguồn nhưng diễn đạt bằng ngôn ngữ người dùng.", pattern: "Chi tiết nguồn -> ý nghĩa -> tác động -> giới hạn." },
  "local-first": { name: "Local-first", type: "Riêng tư", description: "Nhấn vào dữ liệu, quyền riêng tư và chạy trên máy.", pattern: "Dữ liệu ở đâu -> kiểm soát gì -> đổi lại gì -> nên thử." },
  "decision-guide": { name: "Có nên dùng không", type: "Quyết định", description: "Giúp người xem ra quyết định thay vì chỉ nghe giới thiệu.", pattern: "Nên dùng khi -> không nên dùng khi -> cách thử." },
  "short-review": { name: "Review ngắn", type: "Review", description: "Đánh giá cân bằng, có điểm mạnh và điểm yếu.", pattern: "Điểm mạnh -> điểm yếu -> ai phù hợp -> kết luận." },
  "story-contrast": { name: "Tương phản câu chuyện", type: "Trước/Sau", description: "Đặt trước/sau thành một mạch kể tự nhiên.", pattern: "Trước đây -> bước ngoặt -> sau đó -> bài học." }
};

const WRITING_COMBO_GUIDANCE = {
  "repo-launch-dynamic": "Dạng giới thiệu repo/app: nên mở nhanh, có điểm khác biệt, có bằng chứng nguồn và CTA thử ngay.",
  "evidence-explainer": "Dạng giải thích có dẫn chứng: nên dùng lối viết tỉnh táo, dẫn nguồn trước, hạn chế phóng đại.",
  "infographic-cta": "Dạng infographic/CTA: nên đi bằng số liệu, checklist, kết luận ngắn và lời kêu gọi rõ.",
  "app-demo-flow": "Dạng demo ứng dụng: nên viết theo cảnh thao tác, kết quả, kiểm tra, rồi mới CTA.",
  "privacy-trust-review": "Dạng review niềm tin: nên ưu tiên dữ liệu ở đâu, quyền kiểm soát, rủi ro và điều kiện nên dùng.",
  "quick-compare": "Dạng so sánh nhanh: nên viết theo trước/sau, khác biệt thật, điểm nên thử và điểm không nên kỳ vọng.",
  "tutorial-steps": "Dạng hướng dẫn: nên viết từng bước, câu ngắn, có kết quả sau mỗi bước.",
  "creator-story": "Dạng câu chuyện creator: nên có bối cảnh, vấn đề, chuyển biến, kết quả và lời kết mềm."
};

const WRITING_STYLE_BY_COMBO = {
  "repo-launch-dynamic": ["random", "question-open", "source-proof", "why-now", "outcome-first", "problem-first", "direct-cta"],
  "evidence-explainer": ["random", "source-proof", "technical-proof", "anti-hype", "trust-review", "question-open", "myth-buster"],
  "infographic-cta": ["random", "data-led", "checklist", "outcome-first", "quick-compare", "direct-cta"],
  "app-demo-flow": ["random", "demo-narrative", "step-by-step", "use-case", "outcome-first", "source-proof", "question-open"],
  "privacy-trust-review": ["random", "local-first", "trust-review", "risk-first", "anti-hype", "source-proof", "quick-compare"],
  "quick-compare": ["random", "quick-compare", "story-contrast", "decision-guide", "anti-hype", "outcome-first", "direct-cta"],
  "tutorial-steps": ["random", "step-by-step", "beginner-friendly", "checklist", "problem-first", "question-open", "source-proof"],
  "creator-story": ["random", "creator-story", "story-contrast", "problem-first", "outcome-first", "anti-hype", "short-review"]
};

function fileUrl(filePath) {
  if (!filePath) return "#";
  const encoded = btoa(unescape(encodeURIComponent(filePath))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/api/file/${encoded}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load() {
  state = await api("/api/state");
  renderSelects();
  renderComboCards();
  renderQueue();
  renderHistory();
  renderVoices();
  renderLlmProviders();
  renderLlmProviderDetail();
  if (!llmModal) renderLlmModal();
  renderCatalog();
  updateScriptStats();
  updateHealth();
  scheduleTtsPoll();
}

function optionLabel(item) {
  return item.name || item.id;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSelects() {
  $$("select[data-catalog]").forEach((select) => {
    const key = select.dataset.catalog;
    const current = select.value;
    select.innerHTML = (state.catalogs[key] || [])
      .map((item) => `<option value="${item.id}">${optionLabel(item)}</option>`)
      .join("");
    if (current) select.value = current;
    if (key === "voices" && !current && state.catalogs.voices.some((item) => item.id === "vieneu-demo")) {
      select.value = "vieneu-demo";
    }
  });
  renderLlmProviderSelects();
  fillVoicePath();
  applyCombo(false);
  renderWritingStyleOptions();
  renderSelectedVoice();
}

function renderComboCards() {
  const root = $("#combo-picker");
  const form = $("#create-form");
  if (!root || !form || !state) return;
  const selected = form.elements.templateCombo?.value || state.catalogs.templateCombos?.[0]?.id || "";
  root.innerHTML = (state.catalogs.templateCombos || []).map((combo) => {
    const tags = [
      combo.template,
      combo.effect,
      combo.palette,
      combo.mediaStrategy
    ].filter(Boolean).slice(0, 4);
    return `
      <button type="button" class="combo-card ${combo.id === selected ? "active" : ""}" data-combo-id="${escapeHtml(combo.id)}">
        <strong>${escapeHtml(combo.name || combo.id)}</strong>
        <p>${escapeHtml(combo.description || "Combo video")}</p>
        <div class="combo-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      </button>
    `;
  }).join("");
}

function enabledLlmProviders() {
  return (state?.catalogs.llmProviders || [])
    .filter((item) => item.enabled)
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
}

function normalizeProviderModels(provider) {
  return (provider?.models || []).map((item) => typeof item === "string" ? { id: item, name: item } : item);
}

function modelIsFree(model) {
  if (model?.isFree) return true;
  const raw = model?.raw || {};
  if (raw.free === true || raw.is_free === true || raw.free_tier === true) return true;
  const text = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  return /(^|[:/\s._-])free($|[:/\s._-])/.test(text);
}

function modelTestKey(providerId, modelId) {
  return `${providerId || ""}::${modelId || ""}`;
}

function setLlmStatus(text) {
  const status = $("#llm-provider-status");
  if (status) status.textContent = text;
  const modelStatus = $("[data-llm-model-scan-status]");
  if (modelStatus) modelStatus.textContent = text;
}

function syncLlmScanOptionsFromUi() {
  const freeToggle = $("[data-llm-scan-free-only]");
  const workingToggle = $("[data-llm-scan-working-only]");
  if (freeToggle) llmScanOptions.freeOnly = !!freeToggle.checked;
  if (workingToggle) llmScanOptions.workingOnly = !!workingToggle.checked;
}

function disabledModelSet(provider) {
  return new Set((provider?.disabledModels || []).map(String));
}

function modelErrorMap(provider) {
  return provider?.modelErrors && typeof provider.modelErrors === "object" ? provider.modelErrors : {};
}

function activeProviderModels(provider) {
  const disabled = disabledModelSet(provider);
  return normalizeProviderModels(provider).filter((model) => !disabled.has(model.id));
}

function modelCapability(model) {
  const id = String(model?.id || "").toLowerCase();
  const name = String(model?.name || "").toLowerCase();
  const text = `${id} ${name}`;
  if (/(embed|embedding|rerank|rank|retriever|bge|arctic-embed|nv-embed)/.test(text)) {
    return { icon: "🔎", label: "Embedding", kind: "utility", goodWriter: false };
  }
  if (/(vision|vl|image|ocr|deplot|kosmos|fuyu|vila|multimodal)/.test(text)) {
    return { icon: "👁", label: "Vision", kind: "vision", goodWriter: false };
  }
  if (/(guard|safety|moderation|reward|parse|translate|tts|audio)/.test(text)) {
    return { icon: "🧰", label: "Utility", kind: "utility", goodWriter: false };
  }
  if (/(reason|r1|thinking|deepseek|nemotron|qwen3|gpt-oss-120b)/.test(text)) {
    return { icon: "🧠", label: "Reasoning", kind: "reasoning", goodWriter: true };
  }
  if (/(flash|mini|nano|lite|turbo|instant|8b|7b|4b|3b|2b|1b)/.test(text)) {
    return { icon: "⚡", label: "Nhanh", kind: "fast", goodWriter: true };
  }
  if (/(instruct|chat|gpt|claude|sonnet|opus|haiku|gemini|llama|mistral|qwen|glm|kimi|command|cohere)/.test(text)) {
    return { icon: "✍", label: "Viết tốt", kind: "writer", goodWriter: true };
  }
  return { icon: "🤖", label: "Model", kind: "general", goodWriter: false };
}

function renderModelChip(model, runnableConnection, disabled = false) {
  const id = model.id;
  const name = model.name || model.id;
  const capability = modelCapability(model);
  const testState = llmModelTestState[modelTestKey(runnableConnection?.id, id)] || null;
  const scanError = modelErrorMap(runnableConnection)[id] || "";
  return `
    <article class="llm-model-chip ${disabled ? "disabled" : ""} ${capability.goodWriter ? "writer" : ""} ${testState?.status === "ok" ? "ok" : testState?.status === "error" ? "failed" : ""}">
      <span class="llm-model-icon" title="${escapeHtml(capability.label)}">${capability.icon}</span>
      <div class="llm-model-copy">
        <div class="llm-model-title">
          <code>${escapeHtml(id)}</code>
          ${modelIsFree(model) ? `<b class="llm-free-badge">free</b>` : ""}
          ${capability.goodWriter ? `<b class="llm-model-role ${escapeHtml(capability.kind)}">${escapeHtml(capability.label)}</b>` : `<b class="llm-model-role muted-role">${escapeHtml(capability.label)}</b>`}
        </div>
        <small>${escapeHtml(name || id)}</small>
        ${testState?.status === "testing" ? `<em class="llm-model-status testing">Đang testing...</em>` : ""}
        ${testState?.status === "ok" ? `<em class="llm-model-status ok">Model OK</em>` : ""}
        ${testState?.status === "error" ? `<em class="llm-model-status error">${escapeHtml(testState.message || "Test model thất bại")}</em>` : ""}
        ${disabled && scanError ? `<em class="llm-model-status error">${escapeHtml(scanError)}</em>` : ""}
      </div>
      ${!disabled && runnableConnection ? `<button class="llm-model-test-button" title="Test model" data-llm-test-model="${escapeHtml(id)}" data-llm-test-provider="${escapeHtml(runnableConnection.id)}" ${testState?.status === "testing" ? "disabled" : ""}>${testState?.status === "testing" ? "..." : "⚗"}</button>` : ""}
      <button title="${disabled ? "Enable model" : "Disable model"}" data-llm-model-toggle="${escapeHtml(id)}" data-llm-model-provider="${escapeHtml(runnableConnection?.id || model.sourceProviderId || "")}" data-llm-model-enabled="${disabled ? "true" : "false"}">${disabled ? "+" : "×"}</button>
      <button title="Copy model id" data-copy-model="${escapeHtml(id)}">⧉</button>
    </article>
  `;
}

function providerHealthLines(provider) {
  return (provider?.healthHistory || []).slice(0, 4);
}

function providerTypeDefaults(type) {
  const defaults = {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      authType: "api-key",
      compatibleMode: "openai"
    },
    "openai-compatible": {
      authType: "api-key",
      compatibleMode: "openai"
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api-key",
      compatibleMode: "openai"
    },
    anthropic: {
      baseUrl: "https://api.anthropic.com/v1",
      authType: "api-key",
      compatibleMode: "anthropic",
      anthropicVersion: "2023-06-01"
    },
    "anthropic-compatible": {
      authType: "api-key",
      compatibleMode: "anthropic",
      anthropicVersion: "2023-06-01"
    },
    gemini: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authType: "oauth",
      compatibleMode: "google",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/generative-language",
      redirectUri: "http://localhost:8787/api/llm/oauth/callback"
    }
  };
  return defaults[type] || {};
}

function providerOAuthDefaults(providerId) {
  const redirectUri = "http://localhost:8787/api/llm/oauth/callback";
  const codexRedirectUri = "http://localhost:8787/auth/callback";
  const defaults = {
    "claude-code": {
      authUrl: "https://claude.ai/oauth/authorize",
      tokenUrl: "https://api.anthropic.com/v1/oauth/token",
      clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      scopes: "",
      redirectUri
    },
    "openai-codex": {
      authUrl: "https://auth.openai.com/oauth/authorize",
      tokenUrl: "https://auth.openai.com/oauth/token",
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      scopes: "openid profile email offline_access",
      redirectUri: codexRedirectUri
    },
    "github-copilot": {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "Iv1.b507a08c87ecfe98",
      scopes: "read:user user:email",
      redirectUri
    },
    "antigravity": {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "",
      clientSecret: "",
      scopes: "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language",
      redirectUri
    },
    "gemini-cli": {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "",
      clientSecret: "",
      scopes: "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language",
      redirectUri
    },
    "vertex-ai": {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: "",
      clientSecret: "",
      scopes: "openid email profile https://www.googleapis.com/auth/cloud-platform",
      redirectUri
    },
    "xai-grok": {
      authUrl: "https://auth.x.ai/oauth2/auth",
      tokenUrl: "https://auth.x.ai/oauth2/token",
      clientId: "b1a00492-073a-47ea-816f-4c329264a828",
      scopes: "openid profile email offline_access",
      redirectUri
    },
    "cline": {
      authUrl: "https://app.cline.bot/oauth/authorize",
      tokenUrl: "https://api.cline.bot/api/v1/auth/token",
      scopes: "openid profile email offline_access",
      redirectUri
    }
  };
  return defaults[providerId] || {};
}

const LLM_PROVIDER_CATALOG = [
  {
    title: "Custom Providers (OpenAI/Anthropic Compatible)",
    kind: "custom",
    actions: true,
    providers: []
  },
  {
    title: "OAuth Providers",
    kind: "oauth",
    providers: [
      { id: "claude-code", name: "Claude Code", icon: "✴", type: "anthropic", authType: "oauth" },
      { id: "antigravity", name: "Antigravity", icon: "∧", type: "gemini", authType: "oauth" },
      { id: "openai-codex", name: "OpenAI Codex", icon: "◎", type: "openai", authType: "oauth" },
      { id: "github-copilot", name: "GitHub Copilot", icon: "🤖", type: "openai-compatible", authType: "oauth" },
      { id: "cursor-ide", name: "Cursor IDE", icon: "◈", type: "openai-compatible", authType: "oauth" },
      { id: "xai-grok", name: "xAI (Grok)", icon: "∅", type: "openai-compatible", authType: "oauth" },
      { id: "kilo-code", name: "Kilo Code", icon: "▣", type: "openai-compatible", authType: "oauth" },
      { id: "cline", name: "Cline", icon: "♟", type: "openai-compatible", authType: "oauth" }
    ]
  },
  {
    title: "Free Tier Providers",
    kind: "free",
    providers: [
      { id: "kiro-ai", name: "Kiro AI", icon: "♟", type: "openai-compatible", authType: "oauth" },
      { id: "gemini-cli", name: "Gemini CLI", icon: ">", type: "gemini", authType: "oauth" },
      { id: "qoder", name: "Qoder", icon: "◐", type: "openai-compatible", authType: "api-key", baseUrl: "https://api3.qoder.sh/algo/api/v2/service/pro" },
      { id: "opencode-free", name: "OpenCode Free", icon: "▣", type: "openai-compatible", authType: "api-key", noAuth: true },
      { id: "openrouter", name: "OpenRouter", icon: "↔", type: "openai-compatible", authType: "api-key", baseUrl: "https://openrouter.ai/api/v1" },
      { id: "nvidia-nim", name: "NVIDIA NIM", icon: "◎", type: "openai-compatible", authType: "api-key", baseUrl: "https://integrate.api.nvidia.com/v1" },
      { id: "ollama-cloud", name: "Ollama Cloud", icon: "☁", type: "openai-compatible", authType: "api-key", baseUrl: "https://ollama.com/api" },
      { id: "vertex-ai", name: "Vertex AI", icon: "⌬", type: "gemini", authType: "oauth" },
      { id: "gemini", name: "Gemini", icon: "✦", type: "gemini", authType: "api-key", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
      { id: "cloudflare", name: "Cloudflare", icon: "☁", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.cloudflare.com/client/v4/accounts" },
      { id: "byteplus-modelark", name: "BytePlus ModelArk", icon: "M", type: "openai-compatible", authType: "api-key", baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3" }
    ]
  },
  {
    title: "API Key Providers",
    kind: "apikey",
    providers: [
      { id: "deepseek", name: "DeepSeek", icon: "◔", type: "deepseek", authType: "api-key", baseUrl: "https://api.deepseek.com/v1" },
      { id: "alibaba", name: "Alibaba", icon: "□", type: "openai-compatible", authType: "api-key", baseUrl: "https://coding.dashscope.aliyuncs.com/v1" },
      { id: "alibaba-intl", name: "Alibaba Intl", icon: "□", type: "openai-compatible", authType: "api-key", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1" },
      { id: "anthropic", name: "Anthropic", icon: "AI", type: "anthropic", authType: "api-key", baseUrl: "https://api.anthropic.com/v1" },
      { id: "azure-openai", name: "Azure OpenAI", icon: "A", type: "openai-compatible", authType: "api-key" },
      { id: "blackbox-ai", name: "Blackbox AI", icon: "◇", type: "openai-compatible", authType: "api-key" },
      { id: "cerebras", name: "Cerebras", icon: "▦", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.cerebras.ai/v1" },
      { id: "chutes-ai", name: "Chutes AI", icon: "◒", type: "openai-compatible", authType: "api-key", baseUrl: "https://llm.chutes.ai/v1" },
      { id: "cohere", name: "Cohere", icon: "●", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.cohere.ai/v1" },
      { id: "command-code", name: "Command Code", icon: "⌘", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.commandcode.ai/alpha" },
      { id: "fireworks-ai", name: "Fireworks AI", icon: "▦", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.fireworks.ai/inference/v1" },
      { id: "glm-china", name: "GLM (China)", icon: "Z", type: "openai-compatible", authType: "api-key", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" },
      { id: "glm-coding", name: "GLM Coding", icon: "Z", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.z.ai/api/anthropic/v1" },
      { id: "groq", name: "Groq", icon: "⚡", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.groq.com/openai/v1" },
      { id: "hyperbolic", name: "Hyperbolic", icon: "↔", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.hyperbolic.xyz/v1" },
      { id: "kimi", name: "Kimi", icon: "K", type: "openai-compatible", authType: "api-key", baseUrl: "https://api.kimi.com/coding/v1" },
      { id: "openai", name: "OpenAI", icon: "◎", type: "openai", authType: "api-key", baseUrl: "https://api.openai.com/v1" }
    ]
  }
];

function allProviderCatalogItems() {
  return LLM_PROVIDER_CATALOG.flatMap((group) => group.providers.map((provider) => ({ ...provider, groupKind: group.kind })));
}

function providerCatalogById(providerId) {
  return allProviderCatalogItems().find((item) => item.id === providerId)
    || customProviderCatalogItems().find((item) => item.id === providerId);
}

function providerAuthGroup(provider) {
  const auth = normalizeAuthType(provider?.authType);
  if (auth === "oauth") return "oauth";
  if (provider?.groupKind === "custom" || provider?.custom) return "compatible";
  return "api-key";
}

function providerNeedsOnlyApiKey(provider) {
  return providerAuthGroup(provider) === "api-key" && !provider?.custom;
}

function providerConnectionActionLabel(provider) {
  const group = providerAuthGroup(provider);
  if (group === "oauth") return "+ Add OAuth Connection";
  if (group === "compatible") return "+ Add Compatible Connection";
  return "+ Add API Key";
}

function providerConnectionEmptyLabel(provider) {
  const group = providerAuthGroup(provider);
  if (group === "oauth") return "No OAuth sessions yet";
  if (group === "compatible") return "No endpoint connections yet";
  return "No API keys yet";
}

function providerGroupLabel(kind) {
  return {
    custom: "Custom provider",
    oauth: "OAuth",
    free: "Free tier",
    apikey: "API key"
  }[kind] || kind || "Provider";
}

function providerAuthLabel(authType) {
  return normalizeAuthType(authType) === "oauth" ? "OAuth/session" : "API key";
}

function providerTypeLabel(type) {
  return {
    openai: "OpenAI",
    "openai-compatible": "OpenAI compatible",
    gemini: "Gemini",
    deepseek: "DeepSeek",
    anthropic: "Anthropic",
    "anthropic-compatible": "Anthropic compatible"
  }[type] || type || "OpenAI compatible";
}

function providerInitials(provider) {
  const type = provider?.type || "openai-compatible";
  return {
    openai: "OA",
    "openai-compatible": "OC",
    gemini: "GE",
    deepseek: "DS",
    anthropic: "AN",
    "anthropic-compatible": "AC"
  }[type] || String(provider?.name || provider?.id || "AI").slice(0, 2).toUpperCase();
}

function normalizeAuthType(value) {
  return String(value || "api-key").replace("_", "-").toLowerCase() === "apikey" ? "api-key" : String(value || "api-key").replace("_", "-").toLowerCase();
}

function effectiveConnectionProvider(connection) {
  if (connection.provider) return connection.provider;
  if (connection.providerSpecificData?.catalogId) return connection.providerSpecificData.catalogId;
  if (connection.providerSpecificData?.nodeId) return connection.providerSpecificData.nodeId;
  const idValue = String(connection.id || "").replace(/-main$/, "");
  const directIds = new Set(allProviderCatalogItems().map((item) => item.id));
  if (directIds.has(idValue)) return idValue;
  if (connection.type === "openai") return "openai";
  if (connection.type === "gemini") return "gemini";
  if (connection.type === "deepseek") return "deepseek";
  if (connection.type === "anthropic") return "anthropic";
  return "";
}

function providerAccent(provider) {
  const key = provider?.id || provider?.type || "";
  const colors = {
    openai: "#111827",
    "openai-codex": "#111827",
    anthropic: "#d97757",
    "claude-code": "#f97316",
    gemini: "#4285f4",
    "gemini-cli": "#4285f4",
    antigravity: "#6366f1",
    deepseek: "#315df6",
    openrouter: "#7c3aed",
    "nvidia-nim": "#76b900",
    "ollama-cloud": "#111827",
    cloudflare: "#f6821f",
    groq: "#f55036",
    kimi: "#111827",
    cohere: "#39b980",
    "azure-openai": "#0078d4",
    "github-copilot": "#8b5cf6",
    "cursor-ide": "#111827",
    "xai-grok": "#334155",
    "kilo-code": "#facc15",
    cline: "#7c3aed"
  };
  return colors[key] || (String(provider?.type || "").includes("anthropic") ? "#d97757" : String(provider?.type || "").includes("gemini") ? "#4285f4" : "#2563eb");
}

function providerBuiltinModels(provider) {
  const idValue = provider?.id || "";
  const sets = {
    "claude-code": [
      ["cc/claude-opus-4-8", "Claude Opus 4.8"],
      ["cc/claude-opus-4-7", "Claude Opus 4.7"],
      ["cc/claude-opus-4-6", "Claude Opus 4.6"],
      ["cc/claude-sonnet-4-6", "Claude Sonnet 4.6"],
      ["cc/claude-opus-4-5-20251101", "Claude 4.5 Opus"],
      ["cc/claude-sonnet-4-5-20250929", "Claude 4.5 Sonnet"],
      ["cc/claude-haiku-4-5-20251001", "Claude 4.5 Haiku"]
    ],
    anthropic: [
      ["anthropic/claude-opus-4-1", "Claude Opus"],
      ["anthropic/claude-sonnet-4", "Claude Sonnet"],
      ["anthropic/claude-haiku-3-5", "Claude Haiku"]
    ],
    openrouter: [
      ["openrouter/auto", "Auto route"],
      ["openrouter/openai/gpt-4o-mini", "GPT 4o mini"],
      ["openrouter/anthropic/claude-sonnet-4", "Claude Sonnet"],
      ["openrouter/google/gemini-2.5-flash", "Gemini Flash"]
    ],
    alibaba: [
      ["alibaba/qwen-plus", "Qwen Plus"],
      ["alibaba/qwen-max", "Qwen Max"],
      ["alibaba/qwen-turbo", "Qwen Turbo"],
      ["alibaba/qwen3-coder-plus", "Qwen3 Coder"]
    ],
    deepseek: [
      ["deepseek/deepseek-chat", "DeepSeek Chat"],
      ["deepseek/deepseek-reasoner", "DeepSeek Reasoner"]
    ],
    gemini: [
      ["gemini/gemini-2.5-pro", "Gemini 2.5 Pro"],
      ["gemini/gemini-2.5-flash", "Gemini 2.5 Flash"],
      ["gemini/gemini-2.0-flash", "Gemini 2.0 Flash"]
    ],
    openai: [
      ["openai/gpt-4.1", "GPT 4.1"],
      ["openai/gpt-4.1-mini", "GPT 4.1 mini"],
      ["openai/gpt-4o-mini", "GPT 4o mini"]
    ]
  };
  return sets[idValue] || sets[provider?.type] || [
    [`${idValue || "provider"}/default-model`, "Default model"]
  ];
}

function providerNotice(provider) {
  if (["claude-code", "openai-codex", "github-copilot", "cursor-ide", "kiro-ai"].includes(provider?.id)) {
    return { kind: "risk", text: "Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk." };
  }
  if (provider?.id === "openrouter") {
    return { kind: "info", text: "Free tier: some models are routed via shared providers. Add API key to use paid/private routing." };
  }
  return null;
}

function catalogProviderConnections(catalogProvider, connections = []) {
  return connections.filter((connection) => {
    const connectionProvider = effectiveConnectionProvider(connection);
    if (connection.catalogId && connection.catalogId === catalogProvider.id) return true;
    if (connection.providerId && connection.providerId === catalogProvider.id) return true;
    if (connectionProvider && connectionProvider === catalogProvider.id) return true;
    if (connection.type !== catalogProvider.type) return false;
    if (catalogProvider.type && String(catalogProvider.type).includes("compatible")) {
      return connection.catalogId === catalogProvider.id || connection.name === catalogProvider.name || connection.id === `${catalogProvider.id}-main`;
    }
    return normalizeAuthType(connection.authType) === normalizeAuthType(catalogProvider.authType) || !catalogProvider.authType;
  });
}

function catalogProviderStatus(connections) {
  if (!connections.length) return { label: "No connections", cls: "" };
  const enabled = connections.filter((item) => item.enabled);
  const failed = connections.filter((item) => item.lastError || item.lastTestStatus === "failed");
  if (failed.length) return { label: `${failed.length} Error`, cls: "failed" };
  if (enabled.length) return { label: `${enabled.length} Connected`, cls: "done" };
  return { label: "Disabled", cls: "queued" };
}

function connectionCanRunModel(connection, catalogProvider = null) {
  if (!connection) return false;
  const catalog = catalogProvider || providerCatalogById(effectiveConnectionProvider(connection));
  if (catalog?.noAuth) return true;
  if (normalizeAuthType(connection.authType) === "oauth") return Boolean(connection.accessToken || connection.refreshToken);
  return Boolean(connection.apiKey);
}

function selectProviderCatalog(catalogProvider) {
  const form = $("#llm-provider-form");
  if (!form) return;
  const existing = catalogProviderConnections(catalogProvider, state?.catalogs.llmProviders || [])[0];
  if (existing) {
    fillLlmProviderForm(existing);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  form.reset();
  form.elements.type.value = catalogProvider.type || "openai-compatible";
  form.elements.authType.value = catalogProvider.authType || "api-key";
  form.elements.id.value = `${catalogProvider.id}-main`;
  form.elements.name.value = catalogProvider.name;
  form.elements.baseUrl.value = catalogProvider.baseUrl || providerTypeDefaults(catalogProvider.type).baseUrl || "";
  form.elements.compatibleMode.value = providerTypeDefaults(catalogProvider.type).compatibleMode || "";
  form.elements.enabled.checked = !catalogProvider.noAuth;
  form.elements.modelsText.value = "";
  form.elements.healthHistoryText.value = "";
  form.elements.providerSpecificDataText.value = JSON.stringify({ catalogId: catalogProvider.id }, null, 2);
  $("#llm-provider-status").textContent = `Đang tạo connection cho ${catalogProvider.name}.`;
  applyProviderTypeDefaults(catalogProvider.type || "openai-compatible", false);
  syncProviderFormVisibility();
  renderLlmProviders();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function customProviderCatalogItems() {
  const existing = state?.catalogs.llmProviders || [];
  const fromConnections = existing
    .filter((item) => String(item.type || "").includes("compatible"))
    .map((item) => ({
      id: item.providerSpecificData?.nodeId || item.providerSpecificData?.catalogId || item.id.replace(/-main$/, ""),
      name: item.providerSpecificData?.nodeName || item.name,
      icon: item.type === "anthropic-compatible" ? "AC" : "OC",
      type: item.type,
      authType: item.authType || "api-key",
      baseUrl: item.baseUrl,
      custom: true
    }));
  const seen = new Set();
  return fromConnections.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function syncLlmProviderViewMode() {
  const isDetail = !!selectedLlmCatalogProvider;
  $(".llm-workbench")?.classList.toggle("detail-open", isDetail);
  $("#tab-llm")?.classList.toggle("llm-detail-mode", isDetail);
}

function openLlmProviderDetail(provider) {
  selectedLlmCatalogProvider = provider;
  fillLlmProviderForm(catalogProviderConnections(provider, state?.catalogs.llmProviders || [])[0] || {
    id: `${provider.id}-main`,
    name: provider.name,
    provider: provider.id,
    type: provider.type,
    authType: provider.authType,
    baseUrl: provider.baseUrl || providerTypeDefaults(provider.type).baseUrl || "",
    compatibleMode: providerTypeDefaults(provider.type).compatibleMode || "",
    enabled: false,
    providerSpecificData: { catalogId: provider.id }
  });
  renderLlmProviders();
  renderLlmProviderDetail();
  $("#tab-llm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLlmProviderDetail() {
  const root = $("#llm-provider-detail");
  if (!root) return;
  if (!selectedLlmCatalogProvider) {
    root.classList.add("hidden");
    root.innerHTML = "";
    syncLlmProviderViewMode();
    return;
  }
  const provider = selectedLlmCatalogProvider;
  const connections = catalogProviderConnections(provider, state.catalogs.llmProviders || []);
  const runnableConnection = connections.find((connection) => connection.enabled && connectionCanRunModel(connection, provider))
    || connections.find((connection) => connectionCanRunModel(connection, provider))
    || null;
  const notice = providerNotice(provider);
  const scannedModels = connections.flatMap((connection) => normalizeProviderModels(connection).map((model) => ({
    ...model,
    sourceProviderId: connection.id,
    sourceProviderName: connection.name
  })));
  const builtinModels = providerBuiltinModels(provider).map(([id, name]) => ({ id, name, builtin: true }));
  const models = scannedModels.length ? scannedModels : builtinModels;
  const dedupedModels = models.filter((model, index, arr) => arr.findIndex((item) => item.id === model.id) === index);
  const disabledModels = disabledModelSet(runnableConnection || connections[0] || {});
  const scanErrors = modelErrorMap(runnableConnection || connections[0] || {});
  const activeModels = dedupedModels.filter((model) => !disabledModels.has(model.id));
  const inactiveModels = dedupedModels.filter((model) => disabledModels.has(model.id) && !scanErrors[model.id]);
  root.classList.remove("hidden");
  syncLlmProviderViewMode();
  root.innerHTML = `
    <div class="llm-detail-breadcrumb">
      <span data-llm-back-to-catalog>Providers</span>
      <b>›</b>
      <span class="llm-breadcrumb-current"><i style="background:${escapeHtml(providerAccent(provider))}">${escapeHtml(provider.icon || providerInitials(provider))}</i>${escapeHtml(provider.name)}</span>
    </div>
    <div class="llm-detail-back" data-llm-back-to-catalog>← Back to Providers</div>
    <section class="llm-detail-hero">
      <span class="llm-detail-logo" style="background:${escapeHtml(providerAccent(provider))}">${escapeHtml(provider.icon || providerInitials(provider))}</span>
      <div>
        <h3>${escapeHtml(provider.name)}</h3>
        <p>${connections.length} connection${connections.length === 1 ? "" : "s"}</p>
      </div>
      ${provider.signupUrl ? `<a href="${escapeHtml(provider.signupUrl)}" target="_blank">Sign up / Learn more</a>` : `<span class="llm-learn-link">Sign up / Learn more</span>`}
    </section>
    ${notice ? `<div class="llm-provider-notice ${escapeHtml(notice.kind)}">${escapeHtml(notice.text)}</div>` : ""}
    <section class="llm-detail-card">
      <div class="llm-detail-card-head">
        <h3>Connections</h3>
        <label class="llm-switch"><span>Round Robin</span><input type="checkbox" data-llm-round-robin><i></i></label>
      </div>
      ${connections.length ? `
        <div class="llm-connection-list">
          ${connections.map((connection, index) => `
            <article class="llm-connection-row">
              <div>
                <strong>${escapeHtml(connection.name || connection.id)}</strong>
                <p>${escapeHtml(normalizeAuthType(connection.authType))} · priority #${escapeHtml(connection.priority || index + 1)} · ${connection.enabled ? "active" : "disabled"}</p>
                ${connection.lastError ? `<span>${escapeHtml(connection.lastError)}</span>` : ""}
              </div>
              <div class="actions">
                <button class="ghost" data-llm-provider-test="${escapeHtml(connection.id)}">Test</button>
                <button class="ghost" data-llm-provider-scan="${escapeHtml(connection.id)}">Scan</button>
                <button class="danger" data-llm-provider-delete="${escapeHtml(connection.id)}">Delete</button>
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<div class="llm-empty-connection"><span>🔒</span><p>${escapeHtml(providerConnectionEmptyLabel(provider))}</p></div>`}
      <button class="llm-primary-action" data-llm-open-add-connection="${escapeHtml(provider.id)}">${escapeHtml(providerConnectionActionLabel(provider))}</button>
    </section>
    <section class="llm-detail-card">
      <div class="llm-detail-card-head">
        <h3>Available Models</h3>
        <div class="llm-model-toolbar">
          <label class="llm-switch"><span>Chỉ scan free models</span><input type="checkbox" data-llm-scan-free-only ${llmScanOptions.freeOnly ? "checked" : ""}><i></i></label>
          <label class="llm-switch"><span>Chỉ model hoạt động</span><input type="checkbox" data-llm-scan-working-only ${llmScanOptions.workingOnly ? "checked" : ""}><i></i></label>
          ${runnableConnection ? `<button class="ghost" data-llm-provider-scan="${escapeHtml(runnableConnection.id)}">Scan all</button>` : ""}
          ${runnableConnection ? `<button class="ghost" data-llm-models-status="${escapeHtml(runnableConnection.id)}" data-llm-models-enabled="true">Active All</button>` : ""}
          ${runnableConnection ? `<button class="ghost" data-llm-models-status="${escapeHtml(runnableConnection.id)}" data-llm-models-enabled="false">Disable All</button>` : ""}
        </div>
      </div>
      <div class="llm-model-panel-status" data-llm-model-scan-status>${escapeHtml(runnableConnection?.lastScannedAt ? `Scan gần nhất: ${runnableConnection.lastScannedAt}` : "Chưa scan trong phiên này.")}</div>
      ${runnableConnection ? "" : `<p class="muted">Nhập và lưu API key/session trước, sau đó mới có thể test model.</p>`}
      <div class="llm-model-section-head">
        <strong>Models đang dùng</strong>
        <span>${activeModels.length} active</span>
      </div>
      <div class="llm-model-grid">
        ${activeModels.length ? activeModels.map((model) => renderModelChip(model, runnableConnection, false)).join("") : `<p class="muted">Chưa có model active. Bấm Active All hoặc bật từng model ở vùng disabled.</p>`}
        <button class="llm-add-model" data-llm-open-add-model>+ Add Model</button>
      </div>
      <div class="llm-model-section-head disabled">
        <strong>Disabled models</strong>
        <span>${inactiveModels.length} disabled</span>
      </div>
      <div class="llm-model-grid disabled">
        ${inactiveModels.length ? inactiveModels.map((model) => renderModelChip(model, runnableConnection, true)).join("") : `<p class="muted">Không có model bị loại bỏ.</p>`}
      </div>
    </section>
  `;
}

function openLlmAddConnectionModal(provider) {
  llmModal = { kind: "connection", provider, bulk: false, checked: false };
  renderLlmModal();
}

function openLlmCompatibleModal(type) {
  llmModal = { kind: "compatible", type, checked: false };
  renderLlmModal();
}

function closeLlmModal() {
  llmModal = null;
  renderLlmModal();
}

async function handleLlmOAuthComplete(payload) {
  if (!payload?.providerId) return;
  await load();
  const connection = (state.catalogs.llmProviders || []).find((item) => item.id === payload.providerId);
  const catalogId = connection ? effectiveConnectionProvider(connection) : "";
  const provider = providerCatalogById(catalogId) || selectedLlmCatalogProvider;
  if (provider) openLlmProviderDetail(provider);
}

async function startLlmOAuthFlow(provider, data = {}) {
  const defaults = providerTypeDefaults(provider.type);
  const oauthDefaults = providerOAuthDefaults(provider.id);
  const pendingId = `${provider.id}-${Date.now().toString(36)}`;
  const popup = window.open("about:blank", "_blank");
  try {
    await api("/api/llm/providers", {
      method: "POST",
      body: {
        id: pendingId,
        provider: provider.id,
        name: data.name || provider.name,
        type: provider.type,
        authType: "oauth",
        baseUrl: provider.baseUrl || defaults.baseUrl || "",
        clientId: data.clientId || provider.clientId || oauthDefaults.clientId || defaults.clientId || "",
        clientSecret: data.clientSecret || provider.clientSecret || oauthDefaults.clientSecret || defaults.clientSecret || "",
        authUrl: data.authUrl || provider.authUrl || oauthDefaults.authUrl || defaults.authUrl || "",
        tokenUrl: data.tokenUrl || provider.tokenUrl || oauthDefaults.tokenUrl || defaults.tokenUrl || "",
        scopes: data.scopes || provider.scopes || oauthDefaults.scopes || defaults.scopes || "",
        redirectUri: data.redirectUri || provider.redirectUri || oauthDefaults.redirectUri || defaults.redirectUri || "http://localhost:8787/api/llm/oauth/callback",
        compatibleMode: defaults.compatibleMode || "",
        priority: data.priority ? Number(data.priority) : 1,
        enabled: false,
        providerSpecificData: { catalogId: provider.id, authGroup: "oauth", proxyPoolId: data.proxyPoolId || null, oauthStatus: "pending" }
      }
    });
    const result = await api(`/api/llm/providers/${pendingId}/oauth-start`, { method: "POST" });
    if (popup) popup.location.href = result.url;
    else window.open(result.url, "_blank");
    await load();
    openLlmProviderDetail(provider);
  } catch (error) {
    if (popup) popup.close();
    await api(`/api/llm/providers/${pendingId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

function renderLlmModal(message = "") {
  const root = $("#llm-modal-root");
  if (!root) return;
  if (!llmModal) {
    root.innerHTML = "";
    return;
  }
  const provider = llmModal.provider;
  const authGroup = providerAuthGroup(provider);
  if (llmModal.kind === "compatible") {
    const isAnthropic = llmModal.type === "anthropic-compatible";
    root.innerHTML = `
      <div class="llm-modal-backdrop" data-llm-modal-close>
        <form class="llm-modal-card" id="llm-compatible-modal" data-modal-kind="compatible" data-compatible-type="${escapeHtml(llmModal.type)}" autocomplete="off">
          <div class="llm-window-dots"><i></i><i></i><i></i></div>
          <h3>Add ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible</h3>
          <label>Name <input name="name" placeholder="${isAnthropic ? "Anthropic Compatible" : "OpenAI Compatible"} (Prod)" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          <label>Prefix <input name="prefix" placeholder="${isAnthropic ? "ac-prod" : "oc-prod"}" required><small>Required. Used as the provider prefix for model IDs.</small></label>
          ${isAnthropic ? "" : `<label>API Type <select name="apiType"><option value="chat">Chat Completions</option><option value="responses">Responses API</option></select></label>`}
          <label>Base URL <input name="baseUrl" value="${isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}" required><small>Use the base URL ending in /v1.</small></label>
          <label>API Key (for Check) <input name="checkKey" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"></label>
          <label>Model ID (optional) <input name="modelId" placeholder="e.g. gpt-4, claude-3-opus"></label>
          ${message ? `<p class="llm-modal-message">${escapeHtml(message)}</p>` : ""}
          <div class="actions"><button type="button" class="ghost" data-llm-compatible-check>Check</button><button type="submit">Create</button><button type="button" class="ghost" data-llm-modal-close>Cancel</button></div>
        </form>
      </div>`;
    return;
  }
  if (authGroup === "oauth") {
    const defaults = providerTypeDefaults(provider.type);
    const oauthDefaults = providerOAuthDefaults(provider.id);
    const oauthReady = Boolean((provider.clientId || oauthDefaults.clientId || defaults.clientId) && (provider.authUrl || oauthDefaults.authUrl || defaults.authUrl));
    root.innerHTML = `
      <div class="llm-modal-backdrop" data-llm-modal-close>
        <form class="llm-modal-card" id="llm-connection-modal" data-modal-kind="connection" data-auth-group="oauth">
          <div class="llm-window-dots"><i></i><i></i><i></i></div>
          <h3>Add ${escapeHtml(provider.name)} OAuth Connection</h3>
          <div class="llm-oauth-panel">
            <strong>OAuth/session provider</strong>
            <p>${oauthReady ? "Bấm Start OAuth để mở tab đăng nhập. Callback sẽ tự lưu access/refresh token vào connection, không cần dán code thủ công." : "Provider này trong 9router dùng adapter session/device riêng. Hypervideo chưa mở OAuth web callback chuẩn cho provider này, nên sẽ không tạo connection rỗng."}</p>
          </div>
          <label>Name <input name="name" placeholder="Production Session" required></label>
          <details class="llm-connection-options">
            <summary>OAuth app settings</summary>
            <label>Client ID <input name="clientId" value="${escapeHtml(provider.clientId || oauthDefaults.clientId || "")}" placeholder="OAuth client id"></label>
            <label>Client Secret <input name="clientSecret" type="password" placeholder="OAuth client secret"></label>
            <label>Auth URL <input name="authUrl" value="${escapeHtml(provider.authUrl || oauthDefaults.authUrl || defaults.authUrl || "")}" placeholder="https://accounts.google.com/o/oauth2/v2/auth"></label>
            <label>Token URL <input name="tokenUrl" value="${escapeHtml(provider.tokenUrl || oauthDefaults.tokenUrl || defaults.tokenUrl || "")}" placeholder="https://oauth2.googleapis.com/token"></label>
            <label>Scopes <input name="scopes" value="${escapeHtml(provider.scopes || oauthDefaults.scopes || defaults.scopes || "")}" placeholder="scope1 scope2"></label>
            <label>Redirect URI <input name="redirectUri" value="${escapeHtml(provider.redirectUri || oauthDefaults.redirectUri || defaults.redirectUri || "http://localhost:8787/api/llm/oauth/callback")}"></label>
            <label>Priority <input name="priority" type="number" min="1" value="1"></label>
            <label>Proxy Pool <select name="proxyPoolId"><option value="">None</option></select><small>No active proxy pools available. Create one in Proxy Pools page first.</small></label>
          </details>
          ${message ? `<p class="llm-modal-message">${escapeHtml(message)}</p>` : ""}
          <div class="actions"><button type="button" data-llm-oauth-start ${oauthReady ? "" : "disabled"}>Start OAuth</button><button type="button" class="ghost" data-llm-modal-close>Cancel</button></div>
        </form>
      </div>`;
    return;
  }
  root.innerHTML = `
    <div class="llm-modal-backdrop" data-llm-modal-close>
      <form class="llm-modal-card" id="llm-connection-modal" data-modal-kind="connection" data-auth-group="api-key" autocomplete="off">
        <div class="llm-window-dots"><i></i><i></i><i></i></div>
        <h3>Add ${escapeHtml(provider.name)} ${provider.noAuth ? "Connection" : "API Key"}</h3>
        ${provider.noAuth ? "" : `<div class="llm-modal-tabs"><button type="button" class="active" data-llm-single-tab>Single</button><button type="button" data-llm-bulk-tab>Bulk Add</button></div>`}
        <div data-single-fields>
          <label>Name <input name="name" placeholder="Production Key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          ${provider.noAuth ? `<div class="llm-oauth-panel"><strong>Free/no-auth provider</strong><p>Provider này có thể tạo connection không cần API key. Có thể đặt tên connection rồi Save.</p></div>` : `<label>API Key <div class="llm-check-row"><input name="apiKey" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true"><button type="button" class="ghost" data-llm-connection-check>Check</button></div></label>`}
          <details class="llm-connection-options">
            <summary>Connection options</summary>
            <label>Priority <input name="priority" type="number" min="1" value="1"></label>
            <label>Proxy Pool <select name="proxyPoolId"><option value="">None</option></select><small>No active proxy pools available. Create one in Proxy Pools page first.</small></label>
          </details>
        </div>
        <div data-bulk-fields class="hidden">
          <label>Bulk API keys <textarea name="bulkKeys" rows="6" placeholder="Một API key mỗi dòng"></textarea></label>
          <label>Tên prefix <input name="bulkName" placeholder="${escapeHtml(provider.name)} key"></label>
          <details class="llm-connection-options">
            <summary>Connection options</summary>
            <label>Priority start <input name="bulkPriority" type="number" min="1" value="1"></label>
            <label>Proxy Pool <select name="bulkProxyPoolId"><option value="">None</option></select></label>
          </details>
        </div>
        ${message ? `<p class="llm-modal-message">${escapeHtml(message)}</p>` : ""}
        <div class="actions"><button type="submit">Save</button><button type="button" class="ghost" data-llm-modal-close>Cancel</button></div>
      </form>
    </div>`;
}

function setActiveProviderPreset(type) {
  $$("[data-provider-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.providerPreset === type);
  });
}

function syncProviderFormVisibility() {
  const form = $("#llm-provider-form");
  if (!form) return;
  const authType = form.elements.authType.value || "api-key";
  const type = form.elements.type.value || "openai-compatible";
  $$("[data-auth-field]", form).forEach((field) => {
    field.classList.toggle("hidden", field.dataset.authField !== authType);
  });
  setActiveProviderPreset(type);
}

function renderLlmProviderSelects() {
  const providerSelect = $("#llm-provider-select");
  const modelSelect = $("#llm-model-select");
  if (!providerSelect || !modelSelect) return;
  const providers = enabledLlmProviders();
  const current = providerSelect.value;
  const preferred = providers.find((item) => activeProviderModels(item).length || item.defaultModel) || providers[0];
  providerSelect.innerHTML = providers.length
    ? providers.map((item) => `<option value="${item.id}">${escapeHtml(item.name || item.id)}</option>`).join("")
    : `<option value="">Chưa có provider enable</option>`;
  if (current && providers.some((item) => item.id === current)) providerSelect.value = current;
  else if (preferred) providerSelect.value = preferred.id;
  syncLlmModelSelect(false);
}

function selectedLlmProvider() {
  const providerId = $("#llm-provider-select")?.value;
  return (state?.catalogs.llmProviders || []).find((item) => item.id === providerId);
}

function syncLlmModelSelect(force = false) {
  const provider = selectedLlmProvider();
  const modelSelect = $("#llm-model-select");
  if (!modelSelect) return;
  const models = activeProviderModels(provider);
  const hasDefaultOnly = provider?.defaultModel && !models.some((item) => item.id === provider.defaultModel);
  const options = hasDefaultOnly
    ? [{ id: provider.defaultModel, name: `${provider.defaultModel} (mặc định)` }, ...models]
    : models;
  const current = modelSelect.value;
  modelSelect.innerHTML = options.length
    ? options.map((item) => `<option value="${item.id}">${escapeHtml(item.name || item.id)}</option>`).join("")
    : `<option value="">Chưa scan models</option>`;
  if (!force && current && options.some((item) => item.id === current)) modelSelect.value = current;
  else if (provider?.defaultModel && options.some((item) => item.id === provider.defaultModel)) modelSelect.value = provider.defaultModel;
  else if (options[0]) modelSelect.value = options[0].id;
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function renderQueue() {
  const root = $("#queue-list");
  const jobs = [...state.jobs].reverse();
  if (!jobs.length) {
    root.innerHTML = `<div class="panel muted">Chưa có job nào.</div>`;
    return;
  }
  const deletableJobs = jobs.filter((job) => job.status !== "running");
  selectedJobIds = new Set([...selectedJobIds].filter((jobId) => jobs.some((job) => job.id === jobId)));
  root.innerHTML = `
    <div class="queue-toolbar">
      <label class="check-row"><input type="checkbox" id="queue-select-all" ${deletableJobs.length && deletableJobs.every((job) => selectedJobIds.has(job.id)) ? "checked" : ""}> <span>Chọn tất cả job có thể xoá</span></label>
      <div class="queue-toolbar-actions">
        <button class="ghost" data-queue-bulk="delete-selected" ${selectedJobIds.size ? "" : "disabled"}>Xoá đã chọn + file</button>
        <button class="danger" data-queue-bulk="delete-done" ${deletableJobs.length ? "" : "disabled"}>Xoá tất cả job đã xong + file</button>
      </div>
    </div>
    ${jobs.map((job) => `
    <article class="job">
      <div class="job-head">
        <div class="job-title-row">
          <input type="checkbox" data-job-select="${escapeHtml(job.id)}" ${selectedJobIds.has(job.id) ? "checked" : ""} ${job.status === "running" ? "disabled" : ""}>
          <div>
            <strong>${job.title || job.topic}</strong>
            <div class="muted">${job.id} · ${job.createdAt || ""}</div>
          </div>
        </div>
        ${statusBadge(job.status)}
      </div>
      <div class="links">${(job.links || []).join("<br>")}</div>
      <div class="progress-row"><div style="width:${Math.max(0, Math.min(100, job.progress || 0))}%"></div></div>
      <div class="file-actions">
        ${job.outputPath ? `<a href="${fileUrl(job.outputPath)}" target="_blank">Mở MP4</a>` : ""}
        ${job.previewPath ? `<a href="${fileUrl(job.previewPath)}" target="_blank">Preview HTML</a>` : ""}
        ${job.outputPath ? `<button class="ghost" data-open-job="${job.id}" data-open-target="video">Open video</button>` : ""}
        ${(job.workspace || job.outputPath || job.previewPath) ? `<button class="ghost" data-open-job="${job.id}" data-open-target="folder">Open folder</button>` : ""}
        <button class="ghost" data-action="clone" data-id="${job.id}">Clone</button>
        <button class="ghost" data-action="retry" data-id="${job.id}">Retry</button>
        ${job.status !== "running" ? `<button class="danger" data-action="cancel" data-id="${job.id}">Cancel</button>` : ""}
        ${job.status !== "running" ? `<button class="danger" data-action="delete" data-id="${job.id}">Xoá + file</button>` : ""}
      </div>
      ${job.error ? `<p class="muted">Lỗi: ${job.error}</p>` : ""}
      <div class="logs">${(job.logs || []).slice(-8).map((line) => line.text).join("<br>")}</div>
    </article>
  `).join("")}`;
}

function renderHistory() {
  const root = $("#history-list");
  if (!state.history.length) {
    root.innerHTML = `<div class="panel muted">Chưa có video hoàn tất.</div>`;
    return;
  }
  root.innerHTML = state.history.map((item) => `
    <article class="job">
      <div class="job-head">
        <div>
          <strong>${item.title}</strong>
          <div class="muted">${item.finishedAt}</div>
        </div>
        <span class="badge done">done</span>
      </div>
      <div class="file-actions">
        ${item.outputPath ? `<a href="${fileUrl(item.outputPath)}" target="_blank">Mở MP4</a>` : ""}
        ${item.previewPath ? `<a href="${fileUrl(item.previewPath)}" target="_blank">Preview HTML</a>` : ""}
      </div>
    </article>
  `).join("");
}

function renderVoices() {
  const root = $("#voice-list");
  if (!root) return;
  const query = ($("#voice-search")?.value || "").trim().toLowerCase();
  const filter = $("#voice-filter")?.value || "all";
  const sort = $("#voice-sort")?.value || "favorite";
  let voices = [...(state.catalogs.voices || [])];
  voices = voices.filter((voice) => {
    const tags = Array.isArray(voice.tags) ? voice.tags.join(" ") : (voice.tags || "");
    const haystack = `${voice.id} ${voice.name || ""} ${voice.provider || ""} ${voice.language || ""} ${voice.gender || ""} ${voice.pitch || ""} ${tags} ${voice.description || ""}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filter === "favorite" && !voice.favorite) return false;
    if (filter === "vi" && voice.language !== "vi") return false;
    if (filter === "local" && voice.provider !== "local") return false;
    if (filter === "tts" && !String(voice.provider || "").toLowerCase().includes("tts")) return false;
    return true;
  });
  voices.sort((a, b) => {
    if (sort === "name") return String(a.name || a.id).localeCompare(String(b.name || b.id));
    if (sort === "quality") return Number(b.qualityScore || b.quality_score || 0) - Number(a.qualityScore || a.quality_score || 0);
    if (sort === "usage") return Number(b.usageCount || b.usage_count || 0) - Number(a.usageCount || a.usage_count || 0);
    if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
  if ($("#voice-count")) $("#voice-count").textContent = String(voices.length);
  root.innerHTML = voices.map((voice) => `
    <article class="voice-card" data-voice-id="${escapeHtml(voice.id)}">
      <div class="voice-card-top">
        <div class="voice-avatar">${escapeHtml((voice.language || "vi").slice(0, 2).toUpperCase())}</div>
        <div class="voice-title">
          <strong>${escapeHtml(voice.name || voice.id)}</strong>
          <span>${escapeHtml(voice.id)} · ${escapeHtml(voice.provider || "local")}</span>
        </div>
        <button class="voice-icon ${voice.favorite ? "active" : ""}" data-voice-favorite="${escapeHtml(voice.id)}" title="Yêu thích">★</button>
      </div>
      <div class="voice-meta-grid">
        <div><span>Ngôn ngữ</span><b>${escapeHtml(voice.language || "vi")}</b></div>
        <div><span>Giới tính</span><b>${escapeHtml(voice.gender || "N/A")}</b></div>
        <div><span>Giọng</span><b>${escapeHtml(voice.pitch || "N/A")}</b></div>
        <div><span>Đã dùng</span><b>${Number(voice.usageCount || voice.usage_count || 0)}</b></div>
      </div>
      <div class="voice-quality-row">
        <span>Chất lượng</span>
        <div class="voice-quality-bar"><i style="width:${Math.max(0, Math.min(100, Number(voice.qualityScore || voice.quality_score || 0)))}%"></i></div>
        <b>${Number(voice.qualityScore || voice.quality_score || 0) || 0}/100</b>
      </div>
      <p>${escapeHtml(voice.description || voice.notes || "Chưa có mô tả.")}</p>
      <div class="voice-tags">${normalizeTags(voice.tags).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      ${voice.path ? `<div class="path-line">${escapeHtml(voice.path)}</div>` : `<div class="path-line muted">Chưa có path/API URL.</div>`}
      <div class="voice-card-actions">
        <button class="ghost" data-voice-play="${escapeHtml(voice.id)}">Play</button>
        <button data-voice-use="${escapeHtml(voice.id)}">Dùng</button>
        <button class="ghost" data-voice-edit="${escapeHtml(voice.id)}">Sửa</button>
        <button class="ghost" data-voice-clone="${escapeHtml(voice.id)}">Clone</button>
        ${voice.id !== "none" ? `<button class="danger" data-voice-delete="${escapeHtml(voice.id)}">Xoá</button>` : ""}
      </div>
    </article>
  `).join("");
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return String(tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function renderCatalog() {
  const type = $("#catalog-type").value;
  const items = state.catalogs[type] || [];
  $("#catalog-list").innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-head">
        <div>
          <strong>${item.name || item.id}</strong>
          <div class="muted">${item.id}</div>
        </div>
      </div>
      <p>${item.description || item.notes || ""}</p>
      <div class="actions">
        <button class="ghost" data-catalog-edit="${item.id}">Sửa</button>
        <button class="ghost" data-catalog-clone="${item.id}">Clone</button>
        <button class="danger" data-catalog-delete="${item.id}">Xoá</button>
      </div>
    </div>
  `).join("");
}

function fillLlmProviderForm(provider) {
  const form = $("#llm-provider-form");
  if (!form || !provider) return;
  form.elements.id.value = provider.id || "";
  form.elements.name.value = provider.name || "";
  form.elements.type.value = provider.type || "openai-compatible";
  form.elements.authType.value = provider.authType || "api-key";
  form.elements.baseUrl.value = provider.baseUrl || "";
  form.elements.compatibleMode.value = provider.compatibleMode || "";
  form.elements.defaultModel.value = provider.defaultModel || "";
  form.elements.priority.value = provider.priority || "";
  form.elements.apiKey.value = "";
  form.elements.accessToken.value = "";
  form.elements.refreshToken.value = "";
  form.elements.clientId.value = provider.clientId || "";
  form.elements.clientSecret.value = "";
  form.elements.authUrl.value = provider.authUrl || "";
  form.elements.tokenUrl.value = provider.tokenUrl || "";
  form.elements.scopes.value = provider.scopes || "";
  form.elements.redirectUri.value = provider.redirectUri || "http://localhost:8787/api/llm/oauth/callback";
  form.elements.oauthUrl.value = "";
  form.elements.oauthCode.value = "";
  form.elements.anthropicVersion.value = provider.anthropicVersion || "";
  form.elements.temperature.value = provider.temperature ?? "";
  form.elements.maxTokens.value = provider.maxTokens ?? "";
  form.elements.enabled.checked = !!provider.enabled;
  form.elements.notes.value = provider.notes || "";
  form.elements.providerSpecificDataText.value = provider.providerSpecificData
    ? JSON.stringify(provider.providerSpecificData, null, 2)
    : "";
  form.elements.modelsText.value = normalizeProviderModels(provider).map((item) => item.id).join("\n");
  form.elements.healthHistoryText.value = providerHealthLines(provider)
    .map((item) => `[${item.kind}] ${item.ok ? "OK" : "FAIL"} · ${item.at}\n${item.detail}`)
    .join("\n\n");
  $("#llm-provider-status").textContent = provider.lastError
    ? `Lỗi gần nhất: ${provider.lastError}`
    : provider.lastTestAt
      ? `Test gần nhất: ${provider.lastTestAt}`
      : provider.lastScannedAt
        ? `Đã scan: ${provider.lastScannedAt}`
      : "Chưa test.";
  syncProviderFormVisibility();
}

function applyProviderTypeDefaults(type, force = false) {
  const form = $("#llm-provider-form");
  if (!form) return;
  const defaults = providerTypeDefaults(type);
  Object.entries(defaults).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (force || !form.elements[key].value) form.elements[key].value = value;
  });
  syncProviderFormVisibility();
}

function renderLlmProviders() {
  const root = $("#llm-provider-list");
  if (!root) return;
  const search = ($("#llm-provider-search")?.value || "").trim().toLowerCase();
  const authFilter = $("#llm-provider-auth-filter")?.value || "all";
  const statusFilter = $("#llm-provider-status-filter")?.value || "all";
  const selectedId = $("#llm-provider-form")?.elements.id.value || "";
  const connections = state.catalogs.llmProviders || [];
  const catalogGroups = LLM_PROVIDER_CATALOG.map((group) => ({
    ...group,
    providers: group.kind === "custom" ? customProviderCatalogItems() : group.providers
  }));
  const totalConnections = connections.length;
  if ($("#llm-provider-count")) $("#llm-provider-count").textContent = String(totalConnections);
  const cardHtml = (provider, groupKind) => {
    const linked = catalogProviderConnections(provider, connections);
    const enabled = linked.filter((item) => item.enabled);
    const failed = linked.filter((item) => item.lastError || item.lastTestStatus === "failed");
    const status = catalogProviderStatus(linked);
    const active = selectedId && linked.some((item) => item.id === selectedId);
    const latest = linked.find((item) => item.lastError) || linked[0];
    const modelCount = linked.reduce((sum, item) => sum + normalizeProviderModels(item).length, 0);
    const secondary = linked.length
      ? `${linked.length} connection${linked.length > 1 ? "s" : ""}`
      : provider.noAuth ? "Ready" : "No connections";
    return `
      <article class="llm-provider-card llm-catalog-card ${active ? "active" : ""}" data-llm-catalog-provider="${escapeHtml(provider.id)}">
        <div class="llm-provider-main">
          <span class="llm-provider-icon" style="background:${escapeHtml(providerAccent(provider))}">${escapeHtml(provider.icon || providerInitials(provider))}</span>
          <div class="llm-provider-copy">
            <strong>${escapeHtml(provider.name || provider.id)}</strong>
            <span>${escapeHtml(secondary)}</span>
          </div>
        </div>
        <div class="llm-card-status ${escapeHtml(status.cls)}">${escapeHtml(status.label)}</div>
        <div class="meta-line llm-card-meta">
          <span>${escapeHtml(providerGroupLabel(groupKind))}</span>
          ${groupKind !== normalizeAuthType(provider.authType) ? `<span>${escapeHtml(providerAuthLabel(provider.authType))}</span>` : ""}
          ${modelCount ? `<span>${modelCount} models</span>` : ""}
          ${enabled.length ? `<span>${enabled.length} enabled</span>` : ""}
          ${failed.length ? `<span>${failed.length} lỗi</span>` : ""}
        </div>
        ${latest?.lastError ? `<p class="llm-card-error">${escapeHtml(latest.lastError)}</p>` : ""}
        <div class="actions llm-card-actions">
          ${linked.length ? `<button class="ghost" data-llm-provider-test="${escapeHtml(linked[0].id)}">Test</button>
          <button class="ghost" data-llm-provider-scan="${escapeHtml(linked[0].id)}">Scan</button>
          <button class="ghost" data-llm-provider-clone="${escapeHtml(linked[0].id)}">Clone</button>
          <button class="danger" data-llm-provider-delete="${escapeHtml(linked[0].id)}">Xoá</button>` : `<button class="ghost" data-llm-catalog-add="${escapeHtml(provider.id)}">Add connection</button>`}
        </div>
      </article>
    `;
  };
  const visibleGroups = catalogGroups.map((group) => {
    const providers = group.providers.filter((provider) => {
      const linked = catalogProviderConnections(provider, connections);
      const status = catalogProviderStatus(linked);
      const haystack = `${group.title} ${provider.id} ${provider.name} ${provider.type} ${provider.authType} ${linked.map((item) => `${item.name} ${item.defaultModel} ${item.notes}`).join(" ")}`.toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (authFilter !== "all" && provider.authType !== authFilter) return false;
      if (statusFilter === "enabled" && !linked.some((item) => item.enabled)) return false;
      if (statusFilter === "disabled" && !(linked.length && linked.every((item) => !item.enabled))) return false;
      if (statusFilter === "error" && status.cls !== "failed") return false;
      return true;
    });
    return { ...group, providers };
  }).filter((group) => group.providers.length || group.kind === "custom");
  root.innerHTML = visibleGroups.length
    ? visibleGroups.map((group) => `
      <section class="llm-provider-group">
        <div class="llm-provider-group-head">
          <strong>${escapeHtml(group.title)}</strong>
          <span>${group.providers.length}${group.kind === "custom" ? " custom" : ""}</span>
        </div>
        ${group.kind === "custom" ? `<div class="llm-custom-actions"><button type="button" class="ghost" data-llm-open-compatible="anthropic-compatible">+ Add Anthropic Compatible</button><button type="button" class="ghost" data-llm-open-compatible="openai-compatible">+ Add OpenAI Compatible</button></div>` : ""}
        ${group.providers.length ? `<div class="llm-provider-card-grid">${group.providers.map((provider) => cardHtml(provider, group.kind)).join("")}</div>` : `<div class="llm-empty-provider">No custom providers - use buttons above to add OpenAI/Anthropic compatible endpoints</div>`}
      </section>
    `).join("")
    : `<div class="item"><strong>Không có provider phù hợp</strong><p class="muted">Đổi bộ lọc hoặc thêm provider mới.</p></div>`;
}

async function updateHealth() {
  const data = await api("/api/health");
  $("#health-dot").classList.toggle("ok", data.ok);
  $("#health-text").textContent = data.active ? `Đang chạy: ${data.currentJobId}` : "Sẵn sàng";
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function selectedCombo() {
  const comboId = $("#create-form")?.elements.templateCombo?.value;
  return (state?.catalogs.templateCombos || []).find((combo) => combo.id === comboId);
}

function renderWritingStyleOptions() {
  const select = $("#writing-style-select");
  const suggestions = $("#writing-style-suggestions");
  const guidance = $("#writing-style-guidance");
  const form = $("#create-form");
  if (!select || !form) return;
  const current = select.value || "random";
  const comboId = form.elements.templateCombo?.value || "";
  const styleIds = WRITING_STYLE_BY_COMBO[comboId] || ["random", "problem-first", "source-proof", "question-open", "anti-hype"];
  select.innerHTML = styleIds.map((id) => {
    const item = WRITING_STYLES[id] || WRITING_STYLES.random;
    return `<option value="${escapeHtml(id)}">${escapeHtml(item.name)} · ${escapeHtml(item.description)}</option>`;
  }).join("");
  select.value = styleIds.includes(current) ? current : "random";
  if (guidance) {
    const concreteStyles = styleIds.filter((id) => id !== "random").map((id) => WRITING_STYLES[id]?.name).filter(Boolean);
    guidance.innerHTML = `
      <strong>${escapeHtml(WRITING_COMBO_GUIDANCE[comboId] || "Dạng bài hiện tại sẽ dùng nhóm style phù hợp với combo đã chọn.")}</strong>
      <span>Random sẽ chọn trong nhóm: ${escapeHtml(concreteStyles.slice(0, 5).join(", "))}${concreteStyles.length > 5 ? "..." : ""}</span>
    `;
  }
  if (suggestions) {
    suggestions.innerHTML = styleIds.map((id, index) => {
      const item = WRITING_STYLES[id] || WRITING_STYLES.random;
      const active = id === select.value ? "active" : "";
      const recommended = id === "random" ? `<span>random</span>` : index === 1 ? `<span>gợi ý</span>` : "";
      return `
        <button type="button" class="writing-style-chip ${active}" data-writing-style-id="${escapeHtml(id)}">
          <strong>${escapeHtml(item.name)}</strong>
          ${recommended}
          <em>${escapeHtml(item.type || "Style")}</em>
          <small>${escapeHtml(item.pattern || item.description)}</small>
        </button>
      `;
    }).join("");
  }
}

function writingStyleMetaText(data) {
  const combo = selectedCombo();
  const selectedId = $("#create-form")?.elements.writingStyle?.value || "random";
  const selected = WRITING_STYLES[selectedId] || WRITING_STYLES.random;
  const resolved = data?.contentPlan?.writingStyleLabel || data?.writingStyleLabel || data?.styleLabel || selected.name;
  const comboName = combo?.name || "combo hiện tại";
  const prefix = selectedId === "random" ? "Random đã chọn" : "Cách hành văn";
  return `${prefix}: ${resolved} · Combo: ${comboName}`;
}

function applyCombo(force = true) {
  const form = $("#create-form");
  if (!form || !state) return;
  const combo = selectedCombo();
  if (!combo) return;
  const pairs = {
    template: combo.template,
    effect: combo.effect,
    palette: combo.palette,
    titleStyle: combo.titleStyle,
    mediaStrategy: combo.mediaStrategy,
    infographic: combo.infographic
  };
  Object.entries(pairs).forEach(([key, value]) => {
    if (value && form.elements[key] && (force || !form.elements[key].value)) {
      form.elements[key].value = value;
    }
  });
}

function selectedVoice() {
  const voiceId = $("#create-form")?.elements.voice?.value;
  return (state?.catalogs.voices || []).find((voice) => voice.id === voiceId);
}

function selectedVoiceRequiresTts() {
  const voice = selectedVoice();
  return !!voice && voice.id !== "none";
}

function ttsReadyStatus() {
  return state?.tts || { ready: false, status: "loading", detail: "Đang load VieNeu TTS offline..." };
}

function ttsStatusText() {
  const tts = ttsReadyStatus();
  if (tts.ready) return "VieNeu TTS offline đã sẵn sàng";
  if (tts.status === "failed") return `VieNeu TTS offline lỗi: ${tts.error || "chưa load được"}`;
  return tts.detail || `Đang load VieNeu TTS offline (${tts.status || "loading"})`;
}

function scheduleTtsPoll() {
  if (!selectedVoiceRequiresTts()) return;
  if (ttsReadyStatus().ready) return;
  if (ttsPollTimer) return;
  ttsPollTimer = setInterval(async () => {
    try {
      const tts = await api("/api/tts/status");
      state = { ...(state || {}), tts };
      renderSelectedVoice();
      updateQueueSubmitState();
      if (tts.ready || tts.status === "failed") {
        clearInterval(ttsPollTimer);
        ttsPollTimer = null;
      }
    } catch (error) {
      console.error(error);
    }
  }, 1500);
}

function renderSelectedVoice() {
  const root = $("#selected-voice-display");
  if (!root) return;
  const voice = selectedVoice();
  if (!voice || voice.id === "none") {
    root.classList.add("hidden");
    root.innerHTML = "";
    return;
  }
  root.classList.remove("hidden");
  root.innerHTML = `
    <div>
      <span>Đang sử dụng voice</span>
      <strong>${escapeHtml(voice.name || voice.id)}</strong>
      <small>${escapeHtml(voice.provider || "local")} · ${escapeHtml(voice.language || "vi")} · ${escapeHtml(voice.gender || "N/A")} · ${escapeHtml(voice.pitch || "N/A")}</small>
      <small>${escapeHtml(ttsStatusText())}</small>
    </div>
    <div class="selected-voice-actions">
      ${voice.path ? `<button type="button" class="ghost" data-voice-play="${escapeHtml(voice.id)}">Play</button>` : ""}
      <button type="button" class="ghost" data-voice-clear>Bỏ chọn</button>
    </div>
  `;
}

function fillVoicePath(force = false) {
  const form = $("#create-form");
  if (!form || !state) return;
  const voice = selectedVoice();
  const input = form.elements.voicePath;
  if (!input) return;
  if (voice?.id === "none") {
    input.value = "";
    input.dataset.auto = "true";
    return;
  }
  if (voice?.path && (force || !input.value || input.dataset.auto === "true")) {
    input.value = voice.path;
    input.dataset.auto = "true";
  }
  renderSelectedVoice();
}

function normalizeJobPayload(payload, options = {}) {
  const includeManual = options.includeManual !== false;
  const combo = (state.catalogs.templateCombos || []).find((item) => item.id === payload.templateCombo);
  if (combo) {
    payload.template ||= combo.template;
    payload.effect ||= combo.effect;
    payload.palette ||= combo.palette;
    payload.titleStyle ||= combo.titleStyle;
    payload.mediaStrategy ||= combo.mediaStrategy;
    payload.evidenceStyle ||= combo.evidenceStyle;
    payload.iconSet = combo.iconSet || [];
    payload.infographic ||= combo.infographic;
    payload.motion ||= combo.motion;
    payload.fallbackVisuals = combo.fallbackVisuals !== false;
  }
  const voice = (state.catalogs.voices || []).find((item) => item.id === payload.voice);
  if (!payload.voiceName && voice?.voiceName) payload.voiceName = voice.voiceName;
  if (!payload.voicePath && voice?.provider === "local" && voice?.path) payload.voicePath = voice.path;
  ["durationSeconds", "fps", "workers", "crf"].forEach((key) => {
    if (payload[key] !== "") payload[key] = Number(payload[key]);
  });
  payload.llmEnabled = !!payload.llmEnabled;
  payload.writingStyle = payload.writingStyle || "random";
  if (!payload.llmEnabled) {
    payload.writerMode = "local";
    payload.llmProviderId = "";
    payload.llmModel = "";
  } else {
    payload.writerMode ||= "llm";
  }
  const manualScript = includeManual && (manualScriptFresh || manualScriptEditing) ? $("#manual-script")?.value.trim() : "";
  if (manualScript) {
    payload.script = parseManualScript(manualScript);
    payload.llmEnabled = false;
    payload.writerMode = "manual";
    if (lastWriterPreview && manualScriptFresh && !manualScriptEditing) {
      payload.contentPlan = lastWriterPreview.contentPlan || null;
      payload.sourceContext = lastWriterPreview.sourceContext || null;
      payload.mediaAssets = Array.isArray(lastWriterPreview.mediaAssets) ? lastWriterPreview.mediaAssets : [];
      payload.writerPreviewId = lastWriterPreview.previewId || "";
    }
  }
  return payload;
}

function markManualScriptStale() {
  const editor = $("#manual-script");
  if (!editor || !editor.value.trim()) return;
  manualScriptFresh = false;
  lastWriterPreview = null;
  if (manualScriptEditing) return;
  editor.dataset.stale = "true";
  const status = $("#script-stats");
  if (status) status.textContent = `${status.textContent.replace(/\s·\sNội dung cũ.*$/, "")} · Nội dung cũ, bấm Write content để dùng cho link hiện tại`;
  updateQueueSubmitState();
}

function setManualScriptFresh(text) {
  const editor = $("#manual-script");
  if (!editor) return;
  editor.value = text;
  editor.dataset.stale = "false";
  manualScriptFresh = true;
  manualScriptEditing = false;
  updateScriptStats();
}

function parseManualScript(text) {
  return uniqueScriptLines(String(text || "")
    .split(/\n{2,}|\n(?=\s*(?:\d+[\.\)]|-|\*)\s+)/)
    .map((line) => line.replace(/^\s*(?:\d+[\.\)]|-|\*)\s*/, "").trim())
    .filter(Boolean));
}

function normalizeScriptKey(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateLine(line, previousLines) {
  const key = normalizeScriptKey(line);
  if (!key) return true;
  const compact = key.split(" ").filter((word) => word.length > 2).join(" ");
  return previousLines.some((prev) => {
    const prevKey = normalizeScriptKey(prev);
    if (!prevKey) return false;
    if (prevKey === key) return true;
    if (compact.length > 28 && (prevKey.includes(compact) || compact.includes(prevKey))) return true;
    const words = new Set(compact.split(" ").filter(Boolean));
    const prevWords = prevKey.split(" ").filter(Boolean);
    const overlap = prevWords.filter((word) => words.has(word)).length;
    return words.size >= 6 && overlap / Math.max(words.size, prevWords.length) > 0.72;
  });
}

function uniqueScriptLines(lines) {
  const output = [];
  for (const line of lines.map((item) => String(item || "").trim()).filter(Boolean)) {
    const key = normalizeScriptKey(line);
    const ctaSignals = ["luu lai", "thu ngay", "chia se", "link", "mo ta", "repo"];
    const isCtaLike = ctaSignals.filter((signal) => key.includes(signal)).length >= 2;
    if (isCtaLike && output.some((prev) => {
      const prevKey = normalizeScriptKey(prev);
      return ctaSignals.filter((signal) => prevKey.includes(signal)).length >= 2;
    })) continue;
    if (!isNearDuplicateLine(line, output)) output.push(line);
  }
  return output;
}

function naturalPreviewText(data) {
  if (data.mode === "llm") {
    const lines = [];
    const scenes = Array.isArray(data.scenes) ? data.scenes : [];
    for (const scene of scenes) {
      const voice = String(scene.voice || "").trim();
      if (voice) lines.push(voice);
    }
    const cta = String(data.cta || "").trim();
    if (cta && !lines.some((line) => normalizeScriptKey(line).includes(normalizeScriptKey(cta)))) lines.push(cta);
    return uniqueScriptLines(lines).join("\n\n");
  }
  const lines = [];
  for (const line of data.script || []) {
    if (line) lines.push(line);
  }
  return uniqueScriptLines(lines).join("\n\n");
}

function contentPlanFromPreview(data, text) {
  if (data.contentPlan) return data.contentPlan;
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  if (!scenes.length) return null;
  return {
    kind: "llm",
    styleId: data.styleId || "llm",
    styleLabel: data.styleLabel || "LLM",
    titles: scenes.map((scene) => String(scene.title || scene.label || "").trim()).filter(Boolean),
    labels: scenes.map((scene) => String(scene.label || scene.title || "").trim()).filter(Boolean),
    subtitles: scenes.map((scene) => String(scene.subtitle || scene.subtext || "").trim()).filter(Boolean),
    previewText: text
  };
}

function setWriterProgress(percent, text = "Đang viết nội dung...") {
  const root = $("#writer-progress");
  if (!root) return;
  root.classList.remove("hidden");
  $("span", root).textContent = text;
  $("b", root).textContent = `${percent}%`;
  $(".progress-row div", root).style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideWriterProgress() {
  $("#writer-progress")?.classList.add("hidden");
}

function countScriptWords(text) {
  return (String(text || "").match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || []).length;
}

function formatSeconds(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function parseDurationSeconds(text) {
  const value = String(text || "");
  const match = value.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function jobAudioDuration(job) {
  const probes = [job.probe, job.outputProbe, job.mediaInfo, job.metadata].filter(Boolean);
  for (const probe of probes) {
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const audio = streams.find((stream) => stream.codec_type === "audio");
    const duration = Number(audio?.duration || probe?.format?.duration || probe?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  const logs = Array.isArray(job.logs) ? job.logs : [];
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const duration = parseDurationSeconds(logs[index]?.text);
    if (duration > 0 && /Input #1|voice\.wav|Audio:/i.test(logs[index]?.text || "")) return duration;
  }
  return 0;
}

function recentVoiceWordsPerSecond() {
  const selected = $("#create-form")?.elements.voice?.value || "";
  const selectedName = $("#create-form")?.elements.voiceName?.value || "";
  const jobs = [...(state?.jobs || [])].reverse();
  const matching = jobs.find((job) => {
    if (job.status !== "done") return false;
    if (!Array.isArray(job.script) || !job.script.length) return false;
    const duration = jobAudioDuration(job);
    if (!duration) return false;
    return !selected || job.options?.voice === selected || (selectedName && job.options?.voiceName === selectedName);
  }) || jobs.find((job) => job.status === "done" && Array.isArray(job.script) && job.script.length && jobAudioDuration(job));
  if (!matching) return { value: 2.45, source: "mặc định tiếng Việt" };
  const words = countScriptWords(matching.script.join(" "));
  const duration = jobAudioDuration(matching);
  if (!words || !duration) return { value: 2.45, source: "mặc định tiếng Việt" };
  return {
    value: Math.max(1.2, Math.min(4.2, words / duration)),
    source: matching.options?.voiceName || matching.options?.voice || "voice gần nhất"
  };
}

function updateScriptStats() {
  const editor = $("#manual-script");
  const root = $("#script-stats");
  if (!editor || !root) return;
  const text = editor.value || "";
  const chars = [...text].length;
  const words = countScriptWords(text);
  const rate = recentVoiceWordsPerSecond();
  const estimated = words / rate.value;
  const stale = editor.dataset.stale === "true" && !manualScriptEditing ? " · Nội dung cũ, bấm Write content để dùng cho link hiện tại" : "";
  root.textContent = `${chars.toLocaleString("vi-VN")} ký tự · ${words.toLocaleString("vi-VN")} từ · Ước tính ${formatSeconds(estimated)} · theo ${rate.source}${stale}`;
  updateQueueSubmitState();
}

function currentScriptReady() {
  if (selectedVoiceRequiresTts() && !ttsReadyStatus().ready) {
    return { ok: false, reason: ttsStatusText() };
  }
  const editor = $("#manual-script");
  const text = editor?.value.trim() || "";
  if (writerBusy) return { ok: false, reason: "Đang viết nội dung, chờ writer hoàn tất rồi mới tạo video." };
  if (!text) return { ok: false, reason: "Cần Write content hoặc dán nội dung trước khi tạo video." };
  if (editor?.dataset.stale === "true" && !manualScriptEditing) {
    return { ok: false, reason: "Nội dung đang là bản cũ. Bấm Write content/Rewrite để viết lại theo link và combo hiện tại." };
  }
  const words = countScriptWords(text);
  if (words < 20) return { ok: false, reason: "Nội dung quá ngắn để render video. Hãy viết hoặc dán nội dung đầy đủ hơn." };
  return { ok: true, reason: "Nội dung đã sẵn sàng, có thể tạo video." };
}

function updateQueueSubmitState() {
  const button = $("#queue-submit");
  const hint = $("#queue-submit-hint");
  if (!button || !hint) return;
  const status = currentScriptReady();
  button.disabled = !status.ok;
  hint.textContent = status.reason;
  hint.classList.toggle("ok", status.ok);
  hint.classList.toggle("warning", !status.ok);
}

async function runWriterPreview(button, idleLabel = "Write content", loadingLabel = "Đang viết...") {
  const root = $("#writer-preview");
  const editor = $("#manual-script");
  const meta = $("#writer-style-meta");
  let timer = null;
  try {
    writerBusy = true;
    manualScriptFresh = false;
    manualScriptEditing = false;
    if (editor) editor.dataset.stale = "true";
    updateQueueSubmitState();
    button.disabled = true;
    button.textContent = loadingLabel;
    setWriterProgress(8, loadingLabel === "Đang rewrite..." ? "Đang rewrite nội dung..." : "Đang chuẩn bị dữ liệu nguồn và dẫn chứng...");
    let progress = 8;
    const startedAt = Date.now();
    timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      progress = Math.min(82, progress + (progress < 40 ? 6 : progress < 70 ? 3 : 1));
      const label = progress < 40
        ? "Đang đọc link, gom ý chính và tải dẫn chứng..."
        : progress < 70
          ? "Đang gửi yêu cầu tới writer..."
          : `Đang chờ model phản hồi (${elapsed}s)...`;
      setWriterProgress(progress, label);
    }, 500);
    const payload = normalizeJobPayload(formData($("#create-form")), { includeManual: false });
    const data = await api("/api/write/preview", { method: "POST", body: payload });
    clearInterval(timer);
    timer = null;
    setWriterProgress(100, loadingLabel === "Đang rewrite..." ? "Rewrite đã sẵn sàng." : "Preview đã sẵn sàng.");
    const text = naturalPreviewText(data);
    lastWriterPreview = {
      previewId: `${Date.now()}`,
      contentPlan: contentPlanFromPreview(data, text),
      sourceContext: data.sourceContext || null,
      mediaAssets: Array.isArray(data.mediaAssets) ? data.mediaAssets : []
    };
    root?.classList.remove("hidden");
    if (root) root.textContent = text;
    if (meta) {
      meta.classList.remove("hidden");
      meta.textContent = writingStyleMetaText(data);
    }
    if (editor) setManualScriptFresh(text);
    setTimeout(hideWriterProgress, 700);
  } catch (error) {
    if (timer) clearInterval(timer);
    setWriterProgress(100, "Không tạo được nội dung.");
    root?.classList.remove("hidden");
    if (root) root.textContent = error.message || "Writer thất bại.";
    if (meta) {
      meta.classList.remove("hidden");
      meta.textContent = "Writer chưa tạo được nội dung mới.";
    }
  } finally {
    writerBusy = false;
    updateQueueSubmitState();
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

function normalizeLlmProviderFormPayload(form) {
  const payload = formData(form);
  payload.enabled = !!form.elements.enabled.checked;
  payload.temperature = payload.temperature !== "" ? Number(payload.temperature) : "";
  payload.maxTokens = payload.maxTokens !== "" ? Number(payload.maxTokens) : "";
  payload.priority = payload.priority !== "" ? Number(payload.priority) : "";
  if (payload.providerSpecificDataText?.trim()) {
    payload.providerSpecificData = JSON.parse(payload.providerSpecificDataText);
  }
  return payload;
}

function applyDraft() {
  const draft = state.drafts?.create?.value;
  if (!draft) return;
  const form = $("#create-form");
  Object.entries(draft).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  applyCombo(false);
  renderWritingStyleOptions();
  syncLlmModelSelect(false);
  fillVoicePath();
  renderComboCards();
  updateQueueSubmitState();
}

function bindEvents() {
  $$(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav").forEach((item) => item.classList.remove("active"));
      $$(".tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#tab-${button.dataset.tab}`).classList.add("active");
    });
  });

  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const scriptStatus = currentScriptReady();
    if (!scriptStatus.ok) {
      updateQueueSubmitState();
      alert(scriptStatus.reason);
      return;
    }
    const payload = normalizeJobPayload(formData(event.currentTarget));
    if (!Array.isArray(payload.script) || !payload.script.length) {
      alert("Chưa có nội dung cho video. Hãy Write content, Rewrite hoặc dán nội dung trước.");
      return;
    }
    await api("/api/jobs", { method: "POST", body: payload });
    await load();
    document.querySelector('[data-tab="queue"]').click();
  });

  $("#save-draft").addEventListener("click", async () => {
    await api("/api/draft", { method: "POST", body: { key: "create", value: formData($("#create-form")) } });
    await load();
  });

  $("#create-form").addEventListener("input", (event) => {
    if (!event.target.closest(".advanced-options") || ["links", "templateCombo", "writingStyle", "duration", "durationSeconds", "aspect", "voice", "llmEnabled", "llmProviderId", "llmModel"].includes(event.target.name)) {
      markManualScriptStale();
    }
    clearTimeout(window.__draftTimer);
    window.__draftTimer = setTimeout(() => {
      api("/api/draft", { method: "POST", body: { key: "create", value: formData($("#create-form")) } }).catch(console.error);
    }, 500);
    updateQueueSubmitState();
  });
  $("#create-form").elements.voice.addEventListener("change", () => {
    fillVoicePath(true);
    scheduleTtsPoll();
    updateScriptStats();
  });
  $("#create-form").elements.templateCombo.addEventListener("change", () => {
    applyCombo(true);
    renderComboCards();
    renderWritingStyleOptions();
    markManualScriptStale();
    updateQueueSubmitState();
  });
  $("#create-form").elements.writingStyle.addEventListener("change", () => {
    renderWritingStyleOptions();
    markManualScriptStale();
    updateQueueSubmitState();
  });
  $("#create-form").elements.llmProviderId.addEventListener("change", () => {
    syncLlmModelSelect(true);
    markManualScriptStale();
    updateQueueSubmitState();
  });
  $("#create-form").elements.llmEnabled.addEventListener("change", (event) => {
    $("#create-form").elements.writerMode.value = event.currentTarget.checked ? "llm" : "local";
    markManualScriptStale();
    updateQueueSubmitState();
  });
  $("#create-form").elements.voicePath.addEventListener("input", (event) => {
    event.currentTarget.dataset.auto = "false";
  });
  $("#preview-writer").addEventListener("click", (event) => runWriterPreview(event.currentTarget, "Write content", "Đang viết..."));
  $("#rewrite-writer-script").addEventListener("click", (event) => runWriterPreview(event.currentTarget, "Rewrite", "Đang rewrite..."));

  $("#edit-writer-script").addEventListener("click", () => {
    const editor = $("#manual-script");
    manualScriptEditing = true;
    manualScriptFresh = true;
    if (editor) editor.dataset.stale = "false";
    updateScriptStats();
    editor?.focus();
    editor?.select();
  });
  $("#manual-script").addEventListener("input", () => {
    manualScriptEditing = true;
    manualScriptFresh = true;
    $("#manual-script").dataset.stale = "false";
    updateScriptStats();
  });
  $("#combo-picker").addEventListener("click", (event) => {
    const card = event.target.closest("[data-combo-id]");
    if (!card) return;
    const form = $("#create-form");
    form.elements.templateCombo.value = card.dataset.comboId;
    applyCombo(true);
    renderComboCards();
    renderWritingStyleOptions();
    markManualScriptStale();
    api("/api/draft", { method: "POST", body: { key: "create", value: formData(form) } }).catch(console.error);
  });
  $("#writing-style-suggestions")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-writing-style-id]");
    if (!chip) return;
    const form = $("#create-form");
    form.elements.writingStyle.value = chip.dataset.writingStyleId;
    renderWritingStyleOptions();
    markManualScriptStale();
    updateQueueSubmitState();
    api("/api/draft", { method: "POST", body: { key: "create", value: formData(form) } }).catch(console.error);
  });

  $("#start-queue").addEventListener("click", () => api("/api/queue/start", { method: "POST" }).then(load));
  $("#sync-hf").addEventListener("click", async () => {
    $("#sync-hf").textContent = "Đang sync...";
    try {
      await api("/api/hyperframes/catalog/sync", { method: "POST" });
      await load();
    } finally {
      $("#sync-hf").textContent = "Sync HyperFrames";
    }
  });
  $$(".refresh").forEach((button) => button.addEventListener("click", load));

  document.body.addEventListener("change", (event) => {
    const jobSelect = event.target.closest("[data-job-select]");
    if (jobSelect) {
      if (jobSelect.checked) selectedJobIds.add(jobSelect.dataset.jobSelect);
      else selectedJobIds.delete(jobSelect.dataset.jobSelect);
      renderQueue();
      return;
    }
    if (event.target.matches("#queue-select-all")) {
      const deletableIds = (state.jobs || []).filter((job) => job.status !== "running").map((job) => job.id);
      selectedJobIds = event.target.checked ? new Set(deletableIds) : new Set();
      renderQueue();
      return;
    }
    if (event.target.matches("[data-llm-scan-free-only], [data-llm-scan-working-only]")) {
      syncLlmScanOptionsFromUi();
      setLlmStatus(`Scan options: ${llmScanOptions.freeOnly ? "free only" : "all models"} · ${llmScanOptions.workingOnly ? "working only" : "không validate hoạt động"}`);
    }
  });

  document.body.addEventListener("click", async (event) => {
    const insideLlmModal = event.target.closest(".llm-modal-card");
    const clearVoiceButton = event.target.closest("[data-voice-clear]");
    if (clearVoiceButton) {
      const form = $("#create-form");
      form.elements.voice.value = "none";
      fillVoicePath(true);
      return;
    }
    const voicePlayButton = event.target.closest("[data-voice-play]");
    if (voicePlayButton) {
      playVoice(voicePlayButton.dataset.voicePlay, voicePlayButton);
      return;
    }
    const voiceFavoriteButton = event.target.closest("[data-voice-favorite]");
    if (voiceFavoriteButton) {
      const voice = state.catalogs.voices.find((entry) => entry.id === voiceFavoriteButton.dataset.voiceFavorite);
      await api("/api/catalog/voices", { method: "POST", body: { ...voice, favorite: !voice.favorite } });
      await load();
      return;
    }
    const providerPresetButton = event.target.closest("[data-provider-preset]");
    if (providerPresetButton) {
      const form = $("#llm-provider-form");
      const type = providerPresetButton.dataset.providerPreset;
      form.elements.type.value = type;
      if (!form.elements.id.value) form.elements.id.value = `${type.replace(/[^a-z0-9]+/g, "-")}-main`;
      if (!form.elements.name.value) form.elements.name.value = providerTypeLabel(type);
      applyProviderTypeDefaults(type, true);
      document.querySelector('[data-tab="llm"]').click();
      return;
    }
    const backToCatalog = event.target.closest("[data-llm-back-to-catalog]");
    if (backToCatalog) {
      selectedLlmCatalogProvider = null;
      renderLlmProviderDetail();
      renderLlmProviders();
      $("#tab-llm")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const copyModelButton = event.target.closest("[data-copy-model]");
    if (copyModelButton) {
      await navigator.clipboard?.writeText(copyModelButton.dataset.copyModel);
      copyModelButton.textContent = "✓";
      return;
    }
    const compatibleButton = event.target.closest("[data-llm-open-compatible]");
    if (compatibleButton) {
      openLlmCompatibleModal(compatibleButton.dataset.llmOpenCompatible);
      return;
    }
    const modalClose = event.target.closest("[data-llm-modal-close]");
    if (modalClose && (modalClose.tagName === "BUTTON" || (!insideLlmModal && event.target === modalClose))) {
      closeLlmModal();
      return;
    }
    if (insideLlmModal && !event.target.closest("button, a, summary, [data-llm-modal-close]")) {
      return;
    }
    const addConnectionButton = event.target.closest("[data-llm-open-add-connection]");
    if (addConnectionButton) {
      const provider = allProviderCatalogItems().find((item) => item.id === addConnectionButton.dataset.llmOpenAddConnection)
        || customProviderCatalogItems().find((item) => item.id === addConnectionButton.dataset.llmOpenAddConnection)
        || selectedLlmCatalogProvider;
      if (provider) {
        if (providerAuthGroup(provider) === "oauth") {
          try {
            $("#llm-provider-status").textContent = `Đang mở đăng nhập OAuth cho ${provider.name}...`;
            await startLlmOAuthFlow(provider);
            $("#llm-provider-status").textContent = `Đã mở tab đăng nhập OAuth cho ${provider.name}.`;
          } catch (error) {
            $("#llm-provider-status").textContent = error.message || "Không mở được OAuth.";
          }
        } else {
          openLlmAddConnectionModal(provider);
        }
      }
      return;
    }
    const bulkTabButton = event.target.closest("[data-llm-bulk-tab]");
    if (bulkTabButton) {
      const form = $("#llm-connection-modal");
      if (form) {
        form.querySelector("[data-single-fields]").classList.add("hidden");
        form.querySelector("[data-bulk-fields]").classList.remove("hidden");
        form.querySelector("[data-llm-single-tab]")?.classList.remove("active");
        bulkTabButton.classList.add("active");
      }
      return;
    }
    const singleTabButton = event.target.closest("[data-llm-single-tab]");
    if (singleTabButton) {
      const form = $("#llm-connection-modal");
      if (form) {
        form.querySelector("[data-single-fields]").classList.remove("hidden");
        form.querySelector("[data-bulk-fields]").classList.add("hidden");
        form.querySelector("[data-llm-bulk-tab]")?.classList.remove("active");
        singleTabButton.classList.add("active");
      }
      return;
    }
    const oauthStartButton = event.target.closest("[data-llm-oauth-start]");
    if (oauthStartButton && llmModal?.kind === "connection") {
      const form = $("#llm-connection-modal");
      const provider = llmModal.provider;
      const data = formData(form);
      const defaults = providerTypeDefaults(provider.type);
      const pendingId = `${provider.id}-${Date.now().toString(36)}`;
      const popup = window.open("about:blank", "_blank");
      try {
        await api("/api/llm/providers", {
          method: "POST",
          body: {
            id: pendingId,
            provider: provider.id,
            name: data.name || provider.name,
            type: provider.type,
            authType: "oauth",
            baseUrl: provider.baseUrl || defaults.baseUrl || "",
            clientId: data.clientId || provider.clientId || providerOAuthDefaults(provider.id).clientId || defaults.clientId || "",
            clientSecret: data.clientSecret || provider.clientSecret || providerOAuthDefaults(provider.id).clientSecret || defaults.clientSecret || "",
            authUrl: data.authUrl || provider.authUrl || providerOAuthDefaults(provider.id).authUrl || defaults.authUrl || "",
            tokenUrl: data.tokenUrl || provider.tokenUrl || providerOAuthDefaults(provider.id).tokenUrl || defaults.tokenUrl || "",
            scopes: data.scopes || provider.scopes || providerOAuthDefaults(provider.id).scopes || defaults.scopes || "",
            redirectUri: data.redirectUri || provider.redirectUri || providerOAuthDefaults(provider.id).redirectUri || defaults.redirectUri || "http://localhost:8787/api/llm/oauth/callback",
            compatibleMode: defaults.compatibleMode || "",
            priority: data.priority ? Number(data.priority) : 1,
            enabled: false,
            providerSpecificData: { catalogId: provider.id, authGroup: "oauth", proxyPoolId: data.proxyPoolId || null, oauthStatus: "pending" }
          }
        });
        const result = await api(`/api/llm/providers/${pendingId}/oauth-start`, { method: "POST" });
        if (popup) popup.location.href = result.url;
        else window.open(result.url, "_blank");
        renderLlmModal("Đã mở tab đăng nhập OAuth. Sau khi đăng nhập xong, connection sẽ tự cập nhật.");
      } catch (error) {
        if (popup) popup.close();
        await api(`/api/llm/providers/${pendingId}`, { method: "DELETE" }).catch(() => {});
        renderLlmModal(error.message || "Không tạo được OAuth URL. Kiểm tra OAuth app settings.");
      }
      return;
    }
    const checkConnectionButton = event.target.closest("[data-llm-connection-check]");
    if (checkConnectionButton && llmModal?.kind === "connection") {
      renderLlmModal("Check cục bộ: cấu hình có thể lưu. Test thật sẽ chạy sau khi Save.");
      return;
    }
    const checkCompatibleButton = event.target.closest("[data-llm-compatible-check]");
    if (checkCompatibleButton && llmModal?.kind === "compatible") {
      renderLlmModal("Check cục bộ: endpoint/model đã được ghi nhận. Create để thêm custom provider.");
      return;
    }
    const llmTestButton = event.target.closest("[data-llm-provider-test]");
    if (llmTestButton) {
      try {
        setLlmStatus("Đang test API/provider...");
        const result = await api(`/api/llm/providers/${llmTestButton.dataset.llmProviderTest}/test`, { method: "POST" });
        setLlmStatus(`Provider OK · ${result.modelCount} models`);
        await load();
      } catch (error) {
        setLlmStatus(error.message || "Test provider thất bại.");
      }
      return;
    }
    const llmTestModelButton = event.target.closest("[data-llm-test-model]");
    if (llmTestModelButton) {
      const testKey = modelTestKey(llmTestModelButton.dataset.llmTestProvider, llmTestModelButton.dataset.llmTestModel);
      try {
        llmModelTestState[testKey] = { status: "testing", message: "" };
        renderLlmProviderDetail();
        setLlmStatus(`Đang test model ${llmTestModelButton.dataset.llmTestModel}...`);
        const result = await api(`/api/llm/providers/${llmTestModelButton.dataset.llmTestProvider}/test-model`, {
          method: "POST",
          body: { model: llmTestModelButton.dataset.llmTestModel }
        });
        llmModelTestState[testKey] = { status: "ok", message: `OK · ${result.model}` };
        setLlmStatus(`Model OK · ${result.model}`);
        await load();
      } catch (error) {
        llmModelTestState[testKey] = { status: "error", message: error.message || "Test model thất bại." };
        setLlmStatus(error.message || "Test model thất bại.");
        renderLlmProviderDetail();
      }
      return;
    }
    const llmScanButton = event.target.closest("[data-llm-provider-scan]");
    if (llmScanButton) {
      syncLlmScanOptionsFromUi();
      const freeOnly = llmScanOptions.freeOnly;
      const workingOnly = llmScanOptions.workingOnly;
      const scanLabel = workingOnly
        ? `Đang scan${freeOnly ? " free" : ""} và test model hoạt động...`
        : `Đang scan${freeOnly ? " free" : ""} models...`;
      try {
        llmScanButton.disabled = true;
        llmScanButton.dataset.originalText = llmScanButton.textContent;
        llmScanButton.textContent = "Scanning...";
        setLlmStatus(scanLabel);
        const result = await api(`/api/llm/providers/${llmScanButton.dataset.llmProviderScan}/scan-models`, { method: "POST", body: { freeOnly, workingOnly } });
        await load();
        const provider = (state.catalogs.llmProviders || []).find((entry) => entry.id === llmScanButton.dataset.llmProviderScan);
        fillLlmProviderForm(provider);
        renderLlmProviderDetail();
        const activeCount = normalizeProviderModels(result).filter((model) => !(result.disabledModels || []).includes(model.id)).length;
        setLlmStatus(workingOnly ? `Scan xong: ${activeCount}/${normalizeProviderModels(result).length} model hoạt động.` : (freeOnly ? "Scan free models xong." : "Scan models xong."));
      } catch (error) {
        setLlmStatus(error.message || "Scan models thất bại.");
        llmScanButton.disabled = false;
        llmScanButton.textContent = llmScanButton.dataset.originalText || "Scan";
      }
      return;
    }
    const llmModelToggle = event.target.closest("[data-llm-model-toggle]");
    if (llmModelToggle) {
      const providerId = llmModelToggle.dataset.llmModelProvider;
      if (!providerId) return;
      await api(`/api/llm/providers/${providerId}/model-status`, {
        method: "POST",
        body: {
          model: llmModelToggle.dataset.llmModelToggle,
          enabled: llmModelToggle.dataset.llmModelEnabled === "true"
        }
      });
      await load();
      setLlmStatus(llmModelToggle.dataset.llmModelEnabled === "true" ? "Đã bật model." : "Đã disable model.");
      return;
    }
    const llmModelsStatus = event.target.closest("[data-llm-models-status]");
    if (llmModelsStatus) {
      await api(`/api/llm/providers/${llmModelsStatus.dataset.llmModelsStatus}/models-status`, {
        method: "POST",
        body: { enabled: llmModelsStatus.dataset.llmModelsEnabled === "true" }
      });
      await load();
      setLlmStatus(llmModelsStatus.dataset.llmModelsEnabled === "true" ? "Đã active tất cả models hoạt động." : "Đã disable tất cả models.");
      return;
    }
    const llmCloneButton = event.target.closest("[data-llm-provider-clone]");
    if (llmCloneButton) {
      await api(`/api/llm/providers/${llmCloneButton.dataset.llmProviderClone}/clone`, { method: "POST" });
      await load();
      return;
    }
    const llmDeleteButton = event.target.closest("[data-llm-provider-delete]");
    if (llmDeleteButton && confirm("Xoá LLM provider này?")) {
      await api(`/api/llm/providers/${llmDeleteButton.dataset.llmProviderDelete}`, { method: "DELETE" });
      await load();
      renderLlmProviderDetail();
      return;
    }
    const catalogAddButton = event.target.closest("[data-llm-catalog-add]");
    if (catalogAddButton) {
      const provider = allProviderCatalogItems().find((item) => item.id === catalogAddButton.dataset.llmCatalogAdd)
        || customProviderCatalogItems().find((item) => item.id === catalogAddButton.dataset.llmCatalogAdd);
      if (provider) openLlmProviderDetail(provider);
      return;
    }
    const catalogCard = event.target.closest("[data-llm-catalog-provider]");
    if (catalogCard) {
      const provider = allProviderCatalogItems().find((item) => item.id === catalogCard.dataset.llmCatalogProvider)
        || customProviderCatalogItems().find((item) => item.id === catalogCard.dataset.llmCatalogProvider);
      if (provider) openLlmProviderDetail(provider);
      document.querySelector('[data-tab="llm"]').click();
      return;
    }
    const llmEditButton = event.target.closest("[data-llm-provider-edit]");
    if (llmEditButton) {
      const provider = (state.catalogs.llmProviders || []).find((entry) => entry.id === llmEditButton.dataset.llmProviderEdit);
      fillLlmProviderForm(provider);
      renderLlmProviders();
      document.querySelector('[data-tab="llm"]').click();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      if (actionButton.dataset.action === "delete" && !confirm("Xoá job này và toàn bộ file output trong thư mục projects?")) return;
      await api(`/api/jobs/${actionButton.dataset.id}/${actionButton.dataset.action}`, { method: "POST" });
      if (actionButton.dataset.action === "delete") selectedJobIds.delete(actionButton.dataset.id);
      await load();
      return;
    }
    const openJobButton = event.target.closest("[data-open-job]");
    if (openJobButton) {
      await api(`/api/jobs/${openJobButton.dataset.openJob}/open`, {
        method: "POST",
        body: { target: openJobButton.dataset.openTarget || "folder" }
      });
      return;
    }
    const queueBulkButton = event.target.closest("[data-queue-bulk]");
    if (queueBulkButton) {
      const jobs = state.jobs || [];
      const ids = queueBulkButton.dataset.queueBulk === "delete-done"
        ? jobs.filter((job) => job.status !== "running").map((job) => job.id)
        : [...selectedJobIds];
      if (!ids.length) return;
      if (!confirm(`Xoá ${ids.length} job và toàn bộ file output tương ứng?`)) return;
      const result = await api("/api/jobs/delete", { method: "POST", body: { ids, deleteFiles: true } });
      selectedJobIds = new Set([...selectedJobIds].filter((jobId) => !result.deleted.includes(jobId)));
      if (result.blocked?.length) alert(`Có ${result.blocked.length} job đang chạy nên chưa xoá. Hãy Cancel trước.`);
      await load();
      return;
    }
    const editButton = event.target.closest("[data-catalog-edit]");
    if (editButton) {
      const type = $("#catalog-type").value;
      const item = state.catalogs[type].find((entry) => entry.id === editButton.dataset.catalogEdit);
      const form = $("#catalog-form");
      ["id", "name", "description", "provider", "path", "notes"].forEach((key) => {
        form.elements[key].value = item[key] || item.baseUrl || "";
      });
      return;
    }
    const voiceUseButton = event.target.closest("[data-voice-use]");
    if (voiceUseButton) {
      const form = $("#create-form");
      form.elements.voice.value = voiceUseButton.dataset.voiceUse;
      fillVoicePath(true);
      document.querySelector('[data-tab="create"]').click();
      return;
    }
    const voiceEditButton = event.target.closest("[data-voice-edit]");
    if (voiceEditButton) {
      const voice = state.catalogs.voices.find((entry) => entry.id === voiceEditButton.dataset.voiceEdit);
      const form = $("#voice-form");
      ["id", "name", "provider", "language", "gender", "pitch", "tags", "qualityScore", "path", "description"].forEach((key) => {
        form.elements[key].value = Array.isArray(voice[key]) ? voice[key].join(", ") : (voice[key] || "");
      });
      return;
    }
    const voiceCloneButton = event.target.closest("[data-voice-clone]");
    if (voiceCloneButton) {
      await api(`/api/catalog/voices/${voiceCloneButton.dataset.voiceClone}/clone`, { method: "POST" });
      await load();
      return;
    }
    const voiceDeleteButton = event.target.closest("[data-voice-delete]");
    if (voiceDeleteButton && confirm("Xoá voice này?")) {
      await api(`/api/catalog/voices/${voiceDeleteButton.dataset.voiceDelete}`, { method: "DELETE" });
      await load();
      return;
    }
    const cloneButton = event.target.closest("[data-catalog-clone]");
    if (cloneButton) {
      const type = $("#catalog-type").value;
      await api(`/api/catalog/${type}/${cloneButton.dataset.catalogClone}/clone`, { method: "POST" });
      await load();
      return;
    }
    const deleteButton = event.target.closest("[data-catalog-delete]");
    if (deleteButton && confirm("Xoá item này?")) {
      const type = $("#catalog-type").value;
      await api(`/api/catalog/${type}/${deleteButton.dataset.catalogDelete}`, { method: "DELETE" });
      await load();
    }
  });

  $("#catalog-type").addEventListener("change", renderCatalog);
  $("#clear-catalog-form").addEventListener("click", () => $("#catalog-form").reset());
  $("#catalog-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formData(event.currentTarget);
    payload.baseUrl = payload.path;
    await api(`/api/catalog/${$("#catalog-type").value}`, { method: "POST", body: payload });
    event.currentTarget.reset();
    await load();
  });
  $("#voice-search").addEventListener("input", renderVoices);
  $("#voice-filter").addEventListener("change", renderVoices);
  $("#voice-sort").addEventListener("change", renderVoices);
  $("#new-voice-btn").addEventListener("click", () => {
    $("#voice-form").reset();
    document.querySelector('[data-tab="voices"]').click();
  });
  $("#clear-voice-form").addEventListener("click", () => $("#voice-form").reset());
  $("#voice-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formData(event.currentTarget);
    payload.tags = normalizeTags(payload.tags);
    if (payload.qualityScore !== "") payload.qualityScore = Number(payload.qualityScore);
    await api("/api/catalog/voices", { method: "POST", body: payload });
    event.currentTarget.reset();
    await load();
  });
  $("#new-llm-provider").addEventListener("click", () => {
    const form = $("#llm-provider-form");
    form.reset();
    $("#llm-provider-status").textContent = "Chưa test.";
    form.elements.modelsText.value = "";
    form.elements.healthHistoryText.value = "";
    form.elements.providerSpecificDataText.value = "";
    applyProviderTypeDefaults(form.elements.type.value || "openai", true);
    renderLlmProviders();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#clear-llm-provider-form").addEventListener("click", () => {
    $("#llm-provider-form").reset();
    $("#llm-provider-status").textContent = "Chưa test.";
    $("#llm-provider-form").elements.modelsText.value = "";
    $("#llm-provider-form").elements.healthHistoryText.value = "";
    $("#llm-provider-form").elements.providerSpecificDataText.value = "";
    applyProviderTypeDefaults($("#llm-provider-form").elements.type.value || "openai", true);
    renderLlmProviders();
  });
  $("#llm-provider-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = normalizeLlmProviderFormPayload(event.currentTarget);
    await api("/api/llm/providers", { method: "POST", body: payload });
    await load();
  });
  $("#llm-modal-root").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.modalKind === "compatible" && llmModal?.kind === "compatible") {
      const data = formData(form);
      const type = form.dataset.compatibleType;
      const providerId = String(data.prefix || data.name || type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await api("/api/llm/providers", {
        method: "POST",
        body: {
          id: `${providerId}-main`,
          provider: providerId,
          name: data.name,
          type,
          authType: "api-key",
          baseUrl: data.baseUrl,
          apiKey: data.checkKey,
          compatibleMode: type === "anthropic-compatible" ? "anthropic" : "openai",
          enabled: false,
          providerSpecificData: { catalogId: providerId, nodeId: providerId, nodeName: data.name, prefix: data.prefix, apiType: data.apiType || "messages" }
        }
      });
      closeLlmModal();
      await load();
      openLlmProviderDetail({ id: providerId, name: data.name, icon: type === "anthropic-compatible" ? "AC" : "OC", type, authType: "api-key", baseUrl: data.baseUrl, custom: true });
      return;
    }
    if (form.dataset.modalKind === "connection" && llmModal?.kind === "connection") {
      const provider = llmModal.provider;
      const data = formData(form);
      const authGroup = providerAuthGroup(provider);
      const defaults = providerTypeDefaults(provider.type);
      const baseProviderPayload = {
        provider: provider.id,
        type: provider.type,
        baseUrl: provider.baseUrl || defaults.baseUrl || "",
        compatibleMode: defaults.compatibleMode || "",
        providerSpecificData: {
          catalogId: provider.id,
          authGroup,
          proxyPoolId: data.proxyPoolId || data.bulkProxyPoolId || null
        }
      };
      if (authGroup === "oauth") {
        const token = String(data.accessToken || "").trim();
        if (!token) {
          renderLlmModal("OAuth/session token đang trống. Hãy Start OAuth hoặc dán token/session trước khi lưu.");
          return;
        }
        await api("/api/llm/providers", {
          method: "POST",
          body: {
            ...baseProviderPayload,
            id: `${provider.id}-${Date.now().toString(36)}`,
            name: data.name || provider.name,
            authType: "oauth",
            apiKey: "",
            accessToken: token,
            refreshToken: data.refreshToken || "",
            priority: data.priority ? Number(data.priority) : 1,
            enabled: true
          }
        });
      } else {
        const usingBulk = !form.querySelector("[data-bulk-fields]")?.classList.contains("hidden");
        const bulkKeys = usingBulk ? String(data.bulkKeys || "").split("\n").map((line) => line.trim()).filter(Boolean) : [];
        const keys = bulkKeys.length ? bulkKeys : [String(data.apiKey || "").trim()].filter(Boolean);
        if (!keys.length && !provider.noAuth) {
          renderLlmModal("API key đang trống. Nhập key hoặc dùng Bulk Add trước khi lưu.");
          return;
        }
        const keyList = keys.length ? keys : [""];
        const priorityStart = Number(usingBulk ? (data.bulkPriority || 1) : (data.priority || 1));
        for (let index = 0; index < keyList.length; index += 1) {
          const key = keyList[index];
          await api("/api/llm/providers", {
            method: "POST",
            body: {
              ...baseProviderPayload,
              id: `${provider.id}-${Date.now().toString(36)}${keyList.length > 1 ? `-${index + 1}` : ""}`,
              name: keyList.length > 1 ? `${data.bulkName || provider.name} ${index + 1}` : (data.name || provider.name),
              authType: "api-key",
              apiKey: key,
              accessToken: "",
              refreshToken: "",
              priority: priorityStart + index,
              enabled: true
            }
          });
        }
      }
      closeLlmModal();
      await load();
      openLlmProviderDetail(provider);
    }
  });
  $("#llm-provider-validate").addEventListener("click", async () => {
    const form = $("#llm-provider-form");
    $("#llm-provider-status").textContent = "Đang validate...";
    const result = await api("/api/llm/providers/validate", { method: "POST", body: normalizeLlmProviderFormPayload(form) });
    $("#llm-provider-status").textContent = result.ok ? "Provider hợp lệ." : result.errors.join("; ");
  });
  $("#llm-provider-test-batch").addEventListener("click", async () => {
    $("#llm-provider-status").textContent = "Đang test các provider enabled...";
    const result = await api("/api/llm/providers/test-batch", { method: "POST", body: {} });
    const okCount = result.results.filter((item) => item.ok).length;
    $("#llm-provider-status").textContent = `Test batch xong: ${okCount}/${result.results.length} OK`;
    await load();
  });
  $("#llm-provider-test").addEventListener("click", async () => {
    const providerId = $("#llm-provider-form").elements.id.value.trim();
    if (!providerId) return;
    $("#llm-provider-status").textContent = "Đang test...";
    const result = await api(`/api/llm/providers/${providerId}/test`, { method: "POST" });
    $("#llm-provider-status").textContent = `OK · ${result.modelCount} models`;
  });
  $("#llm-provider-scan").addEventListener("click", async () => {
    const providerId = $("#llm-provider-form").elements.id.value.trim();
    if (!providerId) return;
    syncLlmScanOptionsFromUi();
    const freeOnly = llmScanOptions.freeOnly;
    const workingOnly = llmScanOptions.workingOnly;
    $("#llm-provider-status").textContent = workingOnly ? "Đang scan và test model hoạt động..." : "Đang scan models...";
    await api(`/api/llm/providers/${providerId}/scan-models`, { method: "POST", body: { freeOnly, workingOnly } });
    await load();
    const provider = (state.catalogs.llmProviders || []).find((entry) => entry.id === providerId);
    fillLlmProviderForm(provider);
    $("#llm-provider-status").textContent = workingOnly ? "Scan xong, chỉ giữ model hoạt động." : (freeOnly ? "Scan free models xong." : "Scan models xong.");
  });
  $("#llm-provider-oauth-start").addEventListener("click", async () => {
    const providerId = $("#llm-provider-form").elements.id.value.trim();
    if (!providerId) return;
    const result = await api(`/api/llm/providers/${providerId}/oauth-start`, { method: "POST" });
    $("#llm-provider-form").elements.oauthUrl.value = result.url;
    $("#llm-provider-status").textContent = `Đã tạo URL OAuth cho ${providerId}`;
  });
  $("#llm-provider-oauth-exchange").addEventListener("click", async () => {
    const form = $("#llm-provider-form");
    const providerId = form.elements.id.value.trim();
    const code = form.elements.oauthCode.value.trim();
    if (!providerId || !code) return;
    $("#llm-provider-status").textContent = "Đang đổi code lấy token...";
    await api(`/api/llm/providers/${providerId}/oauth-exchange`, { method: "POST", body: { code } });
    await load();
    const provider = (state.catalogs.llmProviders || []).find((entry) => entry.id === providerId);
    fillLlmProviderForm(provider);
    $("#llm-provider-status").textContent = "Đã lưu access token / refresh token.";
  });
  $("#llm-provider-form").elements.type.addEventListener("change", (event) => {
    applyProviderTypeDefaults(event.currentTarget.value, false);
  });
  $("#llm-provider-form").elements.authType.addEventListener("change", syncProviderFormVisibility);
  $$("#llm-provider-search, #llm-provider-auth-filter, #llm-provider-status-filter").forEach((control) => {
    control.addEventListener("input", renderLlmProviders);
    control.addEventListener("change", renderLlmProviders);
  });
  $$("[data-provider-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = $("#llm-provider-form");
      const type = button.dataset.providerPreset;
      form.elements.type.value = type;
      if (!form.elements.id.value) form.elements.id.value = `${type.replace(/[^a-z0-9]+/g, "-")}-main`;
      if (!form.elements.name.value) form.elements.name.value = providerTypeLabel(type);
      applyProviderTypeDefaults(type, true);
    });
  });
  syncProviderFormVisibility();
}

function playVoice(voiceId, button) {
  const voice = (state.catalogs.voices || []).find((item) => item.id === voiceId);
  if (!voice?.path) return;
  if (currentVoiceAudio && currentVoiceButton === button && !currentVoiceAudio.paused) {
    currentVoiceAudio.pause();
    currentVoiceAudio.currentTime = 0;
    button.textContent = "Play";
    currentVoiceAudio = null;
    currentVoiceButton = null;
    return;
  }
  if (currentVoiceAudio) {
    currentVoiceAudio.pause();
    currentVoiceAudio.currentTime = 0;
    if (currentVoiceButton) currentVoiceButton.textContent = "Play";
  }
  currentVoiceAudio = new Audio(fileUrl(voice.path));
  currentVoiceButton = button;
  button.textContent = "Stop";
  currentVoiceAudio.onended = () => {
    button.textContent = "Play";
    currentVoiceAudio = null;
    currentVoiceButton = null;
  };
  currentVoiceAudio.onerror = () => {
    button.textContent = "Lỗi";
    currentVoiceAudio = null;
    currentVoiceButton = null;
  };
  currentVoiceAudio.play().catch(() => { button.textContent = "Lỗi"; });
}

bindEvents();
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "hypervideo:llm-oauth") {
    handleLlmOAuthComplete(event.data.payload).catch(console.error);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== "hypervideo:llm-oauth" || !event.newValue) return;
  try {
    handleLlmOAuthComplete(JSON.parse(event.newValue)).catch(console.error);
  } catch (error) {
    console.error(error);
  }
});
load().then(applyDraft).catch((error) => {
  $("#health-text").textContent = error.message;
  console.error(error);
});

setInterval(() => {
  const activeTag = document.activeElement?.tagName;
  if (llmModal || ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;
  load().catch(console.error);
}, 5000);
