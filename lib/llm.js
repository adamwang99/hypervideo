const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const DEFAULT_DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OAUTH_REDIRECT = "http://localhost:8787/api/llm/oauth/callback";
const crypto = require("crypto");

function providerId(value) {
  return value?.provider || value?.providerSpecificData?.catalogId || value?.id || "";
}

function providerDefaultBaseUrl(provider) {
  const id = providerId(provider);
  const defaults = {
    "openrouter": "https://openrouter.ai/api/v1",
    "nvidia-nim": "https://integrate.api.nvidia.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "xai-grok": "https://api.x.ai/v1",
    "fireworks-ai": "https://api.fireworks.ai/inference/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "cohere": "https://api.cohere.ai/v1",
    "hyperbolic": "https://api.hyperbolic.xyz/v1",
    "chutes-ai": "https://llm.chutes.ai/v1",
    "alibaba": "https://coding.dashscope.aliyuncs.com/v1",
    "alibaba-intl": "https://coding-intl.dashscope.aliyuncs.com/v1",
    "byteplus-modelark": "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    "cloudflare": "https://api.cloudflare.com/client/v4/accounts",
    "ollama-cloud": "https://ollama.com/api",
    "qoder": "https://api3.qoder.sh/algo/api/v2/service/pro",
    "glm-china": "https://open.bigmodel.cn/api/coding/paas/v4",
    "glm-coding": "https://api.z.ai/api/anthropic/v1",
    "kimi": "https://api.kimi.com/coding/v1",
    "command-code": "https://api.commandcode.ai/alpha"
  };
  return defaults[id] || "";
}

function providerBaseUrl(provider) {
  const base = provider.baseUrl || providerDefaultBaseUrl(provider);
  if (base) {
    return String(base)
      .replace(/\/chat\/completions\/?$/i, "")
      .replace(/\/messages\/?$/i, "")
      .replace(/\/generate\/?$/i, "")
      .replace(/\/+$/, "");
  }
  if (provider.type === "openai") return DEFAULT_OPENAI_BASE;
  if (provider.type === "deepseek") return DEFAULT_DEEPSEEK_BASE;
  if (provider.type === "anthropic") return DEFAULT_ANTHROPIC_BASE;
  if (provider.type === "gemini") return DEFAULT_GEMINI_BASE;
  return DEFAULT_OPENAI_BASE;
}

function authHeaders(provider) {
  const headers = {};
  if (provider.type === "anthropic" || provider.type === "anthropic-compatible") {
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = provider.anthropicVersion || "2023-06-01";
    return headers;
  }
  if (provider.type === "gemini") {
    if (provider.accessToken) headers.authorization = `Bearer ${provider.accessToken}`;
    return headers;
  }
  const token = provider.apiKey || provider.accessToken || "";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`);
  }
  return data;
}

async function requestForm(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString()
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`);
  }
  return data;
}

function normalizeModels(payload, providerType) {
  const enrichModel = (model) => {
    const freeInfo = detectFreeModel(model);
    return {
      ...model,
      isFree: freeInfo.isFree,
      freeReason: freeInfo.reason
    };
  };
  if (providerType === "gemini" && Array.isArray(payload?.models)) {
    return payload.models
      .filter((item) => !Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes("generateContent"))
      .map((item) => enrichModel({
        id: String(item.name || "").split("/").pop(),
        name: String(item.displayName || item.name || "").split("/").pop(),
        contextWindow: item.inputTokenLimit || null,
        raw: item
      }))
      .filter((item) => item.id);
  }
  if (Array.isArray(payload?.data)) {
    return payload.data
      .map((item) => enrichModel({
        id: item.id || item.name,
        name: item.name || item.id,
        contextWindow: item.context_window || item.input_token_limit || item.output_token_limit || null,
        raw: item
      }))
      .filter((item) => item.id);
  }
  if (Array.isArray(payload?.models)) {
    return payload.models
      .map((item) => enrichModel({
        id: item.name || item.id,
        name: item.display_name || item.name || item.id,
        contextWindow: item.inputTokenLimit || null,
        raw: item
      }))
      .filter((item) => item.id);
  }
  if (Array.isArray(payload?.result?.models)) {
    return payload.result.models
      .map((item) => enrichModel({
        id: item.name || item.id,
        name: item.name || item.id,
        contextWindow: item.context_length || null,
        raw: item
      }))
      .filter((item) => item.id);
  }
  return [];
}

function isZeroLike(value) {
  if (value === 0 || value === "0") return true;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

function detectFreeModel(model) {
  const raw = model.raw || {};
  const text = `${model.id || ""} ${model.name || ""} ${raw.id || ""} ${raw.name || ""}`.toLowerCase();
  if (/(^|[:/\s._-])free($|[:/\s._-])/.test(text)) {
    return { isFree: true, reason: "name" };
  }
  const pricing = raw.pricing || raw.price || raw.cost || {};
  const priceKeys = ["prompt", "completion", "request", "input", "output", "image", "web_search"];
  const presentKeys = priceKeys.filter((key) => pricing[key] !== undefined && pricing[key] !== null && pricing[key] !== "");
  if (presentKeys.length && presentKeys.every((key) => isZeroLike(pricing[key]))) {
    return { isFree: true, reason: "pricing" };
  }
  if (raw.free === true || raw.is_free === true || raw.free_tier === true) {
    return { isFree: true, reason: "metadata" };
  }
  return { isFree: false, reason: "" };
}

function targetWordsForDuration(seconds, contentMode) {
  const duration = Number(seconds || 60);
  const base = Math.round(duration * 2.3);
  if (contentMode === "strict-source") return Math.max(45, Math.round(base * 0.78));
  if (contentMode === "fill-to-duration") return Math.max(60, Math.round(base * 0.95));
  return Math.max(50, Math.round(base * 0.86));
}

function normalizeScriptKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[đĐ]/g, "d")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateText(line, previousLines) {
  const key = normalizeScriptKey(line);
  if (!key) return true;
  const words = key.split(" ").filter((word) => word.length > 2);
  if (words.length < 3) return false;
  return previousLines.some((prev) => {
    const prevKey = normalizeScriptKey(prev);
    if (!prevKey) return false;
    if (prevKey === key) return true;
    const prevWords = prevKey.split(" ").filter((word) => word.length > 2);
    const prevSet = new Set(prevWords);
    const overlap = words.filter((word) => prevSet.has(word)).length;
    return words.length >= 6 && overlap / Math.max(words.length, prevWords.length) > 0.68;
  });
}

function systemPrompt(contentMode, tone, writingStyle) {
  return [
    "Ban la bien tap vien viet script video ngan tieng Viet.",
    "Bat buoc viet hap dan, thuyet phuc, ro rang, khong khoa truong vo can cu.",
    "Bat buoc tra ve JSON hop le, khong markdown, khong giai thich.",
    "Hoc theo Hyper Framework: narration la xuong song cua video, noi ngan hon thoi luong de con khoang tho thi giac.",
    "Can co mach noi bo: mo dau gay to mo, cau chuyen/gia tri, bang chung, cach lam/use-case, phan bien, cta.",
    "Cac nhan hook/gia tri/bang chung/cach lam/phan bien/cta chi la cau truc noi bo; tuyet doi khong viet lo cac nhan nay trong voice, subtitle hoac title.",
    "Voice phai la loi ke tu nhien nhu mot video ngan, moi canh noi lien mach voi canh truoc, khong doc URL dai.",
    "Moi thong tin chi noi mot lan. Khong lap lai cung mot y bang cau ngan ngay sau cau dai. Khong viet CTA qua mot lan.",
    "Neu co so lieu nhu 49 agents, 72 skills, hay viet thanh cau doc tu nhien bang tieng Viet.",
    "Phan subtitle chi la cau tom tat rat ngan de hien tren man hinh; khong duoc copy lai voice.",
    "Script phai bam vao creativeProfile/template da chon truoc khi viet. Neu template la infographic thi uu tien con so, nhan dinh ngan va visual data. Neu template la evidence/proof thi uu tien dan chung va nguon. Neu template la app/demo thi uu tien workflow va buoc thao tac.",
    `Muc tieu do dai: ${contentMode || "auto-fit"}.`,
    `Tone uu tien: ${tone || "gon, ro, co nhip"}.`,
    `Writing style nguoi dung chon: ${writingStyle || "random"}. Neu la random, tu chon mot cach viet phu hop voi creativeProfile; neu la style cu the, phai bam theo style do.`,
    "Neu nguon thieu thong tin, duoc phep bo sung khung danh gia, use-case va phan bien an toan, nhung khong duoc bịa claim cu the."
  ].join(" ");
}

const WRITING_STYLE_GUIDES = {
  random: "Tu chon mot style phu hop voi creativeProfile va nguon. Moi lan co the doi goc ke, nhung khong duoc lap y.",
  "source-proof": "Dan chung truoc: mo bang nguon that, sau do noi y nghia, loi ich, gioi han, CTA. Khong hype.",
  "problem-first": "Van de truoc: neu noi dau/diem tac nghe, roi dua cong cu vao nhu cach giam diem nghen.",
  "question-open": "Cau hoi gay to mo: mo bang mot cau hoi sat nguoi xem, tra loi bang y bat ngo, roi dua bang chung.",
  "outcome-first": "Ket qua truoc: bat dau tu ket qua nguoi xem muon, sau do giai thich cach cong cu tao ra ket qua do.",
  "quick-compare": "So sanh nhanh: truoc day vs bay gio, khac biet chinh, khi nao nen dung va khi nao khong nen.",
  "anti-hype": "Phan hype: noi tinh tao, tranh loi hua lon, dua bang chung, gioi han va ket luan can bang.",
  "step-by-step": "Tung buoc: trinh bay nhu huong dan ngan, moi canh la mot buoc hoac mot ket qua de kiem tra.",
  "creator-story": "Cau chuyen creator: boi canh, vuong mac, chuyen bien, ket qua. Giong ke chuyen hon la liet ke tinh nang.",
  "data-led": "So lieu dan dat: dung con so/metric lam diem neo, giai thich y nghia, ung dung va cach kiem chung.",
  "trust-review": "Review niem tin: tap trung du lieu, quyen rieng tu, rui ro, dieu kien dung va quyen kiem soat cua nguoi dung.",
  "direct-cta": "CTA thang: ngan, ro, manh. Gia tri chinh, bang chung nhanh, hanh dong cu the. Khong ke dai.",
  "myth-buster": "Dap hieu lam: mo bang mot nham tuong pho bien, sua lai bang bang chung va vi du cu the.",
  "risk-first": "Rui ro truoc: noi dieu can can trong, dieu kien dung, loi ich that va cach kiem tra.",
  checklist: "Checklist nhanh: bien noi dung thanh cac tieu chi ngan, de quet, moi tieu chi phai co y nghia rieng.",
  "use-case": "Tinh huong su dung: dat cong cu vao mot ca dung cu the, ai can, dung luc nao, ket qua gi.",
  "demo-narrative": "Demo theo canh: moi canh la mot thao tac hoac ket qua, giong dang xem demo san pham.",
  "why-now": "Vi sao luc nay: noi boi canh, thay doi moi, ly do dang chu y tai thoi diem nay va hanh dong tiep theo.",
  "beginner-friendly": "Danh cho nguoi moi: giai thich it thuat ngu, cau ngan, di tu nhu cau thuc te den buoc thu nho.",
  "technical-proof": "Bang chung ky thuat: dung chi tiet nguon nhung dich thanh y nghia nguoi dung, tac dong va gioi han.",
  "local-first": "Local-first: nhan vao du lieu nam o dau, cai gi chay tren may, quyen kiem soat va danh doi ve toc do.",
  "decision-guide": "Co nen dung khong: giup nguoi xem ra quyet dinh, neu khi nao nen dung, khi nao khong nen.",
  "short-review": "Review ngan: can bang diem manh, diem yeu, ai phu hop va ket luan co dieu kien.",
  "story-contrast": "Tuong phan cau chuyen: dat truoc/sau thanh mach ke tu nhien, khong liet ke cung mot y."
};

const LLM_STYLE_LABELS = {
  random: "Random phù hợp",
  "source-proof": "Dẫn chứng trước",
  "problem-first": "Vấn đề trước",
  "question-open": "Câu hỏi gây tò mò",
  "outcome-first": "Kết quả trước",
  "quick-compare": "So sánh nhanh",
  "anti-hype": "Phản quảng bá",
  "step-by-step": "Từng bước",
  "creator-story": "Câu chuyện creator",
  "data-led": "Số liệu dẫn dắt",
  "trust-review": "Review niềm tin",
  "direct-cta": "Chốt hành động",
  "myth-buster": "Đập hiểu lầm",
  "risk-first": "Rủi ro trước",
  checklist: "Checklist nhanh",
  "use-case": "Tình huống sử dụng",
  "demo-narrative": "Demo theo cảnh",
  "why-now": "Vì sao lúc này",
  "beginner-friendly": "Dành cho người mới",
  "technical-proof": "Bằng chứng kỹ thuật",
  "local-first": "Local-first",
  "decision-guide": "Có nên dùng không",
  "short-review": "Review ngắn",
  "story-contrast": "Tương phản câu chuyện"
};

const LLM_COMBO_STYLE_IDS = {
  "repo-launch-dynamic": ["question-open", "source-proof", "why-now", "outcome-first", "problem-first", "direct-cta"],
  "evidence-explainer": ["source-proof", "technical-proof", "anti-hype", "trust-review", "question-open", "myth-buster"],
  "infographic-cta": ["data-led", "checklist", "outcome-first", "quick-compare", "direct-cta"],
  "app-demo-flow": ["demo-narrative", "step-by-step", "use-case", "outcome-first", "source-proof", "question-open"],
  "privacy-trust-review": ["local-first", "trust-review", "risk-first", "anti-hype", "source-proof", "quick-compare"],
  "quick-compare": ["quick-compare", "story-contrast", "decision-guide", "anti-hype", "outcome-first", "direct-cta"],
  "tutorial-steps": ["step-by-step", "beginner-friendly", "checklist", "problem-first", "question-open", "source-proof"],
  "creator-story": ["creator-story", "story-contrast", "problem-first", "outcome-first", "anti-hype", "short-review"]
};

function writingStyleGuide(style) {
  return WRITING_STYLE_GUIDES[style] || WRITING_STYLE_GUIDES.random;
}

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function resolveLlmWritingStyle(job, context) {
  const requested = String(job.options?.writingStyle || "random");
  if (requested !== "random" && WRITING_STYLE_GUIDES[requested]) {
    return {
      id: requested,
      label: LLM_STYLE_LABELS[requested] || requested,
      requested,
      randomPick: false
    };
  }
  const comboId = context.creativeProfile?.templateCombo || job.options?.templateCombo || "";
  const pool = LLM_COMBO_STYLE_IDS[comboId] || Object.keys(WRITING_STYLE_GUIDES).filter((id) => id !== "random");
  const seed = hashText(`${job.id}|${context.fullName}|${context.description}|${comboId}|${Date.now()}|${Math.random()}`);
  const id = pool[seed % pool.length] || "source-proof";
  return {
    id,
    label: LLM_STYLE_LABELS[id] || id,
    requested,
    randomPick: true
  };
}

function userPrompt(context) {
  const targetWords = targetWordsForDuration(context.durationSeconds, context.contentMode);
  return JSON.stringify({
    task: "Viet script video ngan tieng Viet cho mot repo/link.",
    requirements: {
      targetWords,
      speakingPace: "Khoang 2.3 tu/giay, de khoang nghi giua cau.",
      structure: ["opening", "story_value", "proof", "workflow_or_usecase", "counter", "cta"],
      writingRules: [
        "Viet nhu mot nguoi dang gioi thieu san pham/cong cu, khong nhu brochure.",
        "Cach hanh van phai khop voi writingStyle: source-proof = dan chung truoc; problem-first = noi dau truoc; question-open = cau hoi gay to mo; outcome-first = ket qua truoc; quick-compare = so sanh nhanh; anti-hype = tinh tao co gioi han; step-by-step = huong dan tung buoc; creator-story = ke chuyen; data-led = so lieu dan dat; trust-review = quyen rieng tu/rui ro; direct-cta = ngan, manh, chot hanh dong; local-first = du lieu/quyen rieng tu; decision-guide = nen/khong nen dung; short-review = diem manh/diem yeu; story-contrast = truoc/sau; demo-narrative = theo canh demo.",
        `Huong dan style cu the: ${context.writingStyleGuide || writingStyleGuide(context.writingStyle)}`,
        "Bam sat creativeProfile: templateCombo, titleStyle, mediaStrategy, evidenceStyle, infographic, motion va palette.",
        "Cau truc cau, subtitle va cach chon y phai phu hop voi template da chon truoc khi bam Preview.",
        "Mo dau phai tao cang thang, to mo hoac bat ngo trong 3 giay dau.",
        "Bien ngon ngu website/repo thanh loi ich nguoi xem hieu duoc.",
        "Moi y chi xuat hien mot lan.",
        "CTA chi nam o scene cuoi, khong lap lai trong counterArgument.",
        "counterArgument chi tra loi mot lo ngai moi, khong lap lai voice cua scene khac.",
        "Khong tao mot cau dai roi lap lai bang mot cau ngan cung y.",
        "subtitle phai ngan hon voice va khong duoc la ban rut gon lap lai y vua doc.",
        "Neu nguon thieu thong tin, noi ro theo goc use-case/nhan dinh an toan; khong bia claim, khong chen cau ky thuat ve backend writer."
      ],
      outputSchema: {
        title: "string",
        scenes: [{ title: "string", voice: "string", subtitle: "string", label: "string" }],
        cta: "string",
        counterArgument: "string",
        notes: ["string"]
      }
    },
    source: context
  });
}

function parseJsonResponse(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  return JSON.parse(body);
}

function normalizeLlmOutput(payload, fallbackTopic) {
  const cleanMeta = (value) => String(value || "")
    .replace(/^\s*\d+[\).:-]\s*/u, "")
    .replace(/^\s*(?:hook|cta|value|proof|evidence|workflow|counter|counterargument|mở đầu|giá trị|bằng chứng|cách làm|cách dùng|phản biện|kết luận)\s*[:：\-–—]\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  const titleLikeMeta = (value) => /^(?:hook|cta|value|proof|evidence|workflow|counter|counterargument|mở đầu|giá trị|bằng chứng|cách làm|cách dùng|phản biện|kết luận|ý\s*\d+|cảnh\s*\d+)$/iu.test(cleanMeta(value));
  const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
  const used = [];
  const normalizedScenes = scenes
    .map((scene, index) => ({
      title: titleLikeMeta(scene.title) ? "" : cleanMeta(scene.title || ""),
      voice: cleanMeta(scene.voice || scene.body || ""),
      subtitle: cleanMeta(scene.subtitle || scene.label || ""),
      label: titleLikeMeta(scene.label) ? "" : cleanMeta(scene.label || "")
    }))
    .filter((scene) => {
      if (!scene.voice || isNearDuplicateText(scene.voice, used)) return false;
      used.push(scene.voice);
      return true;
    });
  const cta = String(payload?.cta || "").trim();
  const ctaAlreadyInScenes = cta && normalizedScenes.some((scene) => isNearDuplicateText(cta, [scene.voice]));
  return {
    title: payload?.title || fallbackTopic || "Video moi",
    scenes: normalizedScenes,
    cta: ctaAlreadyInScenes ? "" : cta,
    counterArgument: payload?.counterArgument || "",
    notes: Array.isArray(payload?.notes) ? payload.notes : []
  };
}

function jobSourceContext(job) {
  const source = job.sourceContext || {};
  const context = {
    topic: job.topic,
    title: job.title,
    links: job.links || [],
    tone: job.options?.tone || "",
    writingStyle: job.options?.writingStyle || "random",
    writingStyleGuide: writingStyleGuide(job.options?.writingStyle || "random"),
    cta: job.options?.cta || "",
    hook: job.options?.hook || "",
    contentMode: job.options?.contentMode || "auto-fit",
    durationSeconds: Number(job.options?.durationSeconds || 60),
    creativeProfile: {
      templateCombo: job.options?.templateCombo || "",
      template: job.options?.template || "",
      titleStyle: job.options?.titleStyle || "",
      mediaStrategy: job.options?.mediaStrategy || "",
      evidenceStyle: job.options?.evidenceStyle || "",
      infographic: job.options?.infographic || "",
      motion: job.options?.motion || "",
      palette: job.options?.palette || "",
      aspect: job.options?.aspect || "",
      resolution: job.options?.resolution || ""
    },
    description: source.description || "",
    points: source.points || [],
    topics: source.topics || [],
    language: source.language || "",
    fullName: source.fullName || ""
  };
  const resolved = resolveLlmWritingStyle(job, context);
  context.requestedWritingStyle = context.writingStyle;
  context.writingStyle = resolved.id;
  context.writingStyleLabel = resolved.randomPick ? `Random: ${resolved.label}` : resolved.label;
  context.writingStyleGuide = writingStyleGuide(resolved.id);
  job.contentPlan = {
    ...(job.contentPlan || {}),
    writingStyleId: resolved.id,
    writingStyleLabel: context.writingStyleLabel,
    requestedWritingStyle: resolved.requested
  };
  return context;
}

function providerHistoryEvent(kind, ok, detail) {
  return {
    at: new Date().toISOString(),
    kind,
    ok: !!ok,
    detail: String(detail || "").slice(0, 500)
  };
}

function oauthConfig(provider) {
  return {
    authUrl: provider.authUrl || "",
    tokenUrl: provider.tokenUrl || "",
    clientId: provider.clientId || "",
    clientSecret: provider.clientSecret || "",
    scopes: provider.scopes || "",
    redirectUri: provider.redirectUri || DEFAULT_OAUTH_REDIRECT
  };
}

function oauthProviderId(provider) {
  return providerId(provider);
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function buildOAuthStart(provider, state) {
  const config = oauthConfig(provider);
  const providerId = oauthProviderId(provider);
  if (providerId === "openai-codex") {
    config.redirectUri = "http://localhost:8787/auth/callback";
  }
  if (!config.authUrl || !config.clientId) {
    throw new Error("Provider này cần adapter OAuth/session riêng giống 9router; chưa thể mở login callback chuẩn.");
  }
  const oauthState = Buffer.from(JSON.stringify({
    providerId: provider.id,
    nonce: Math.random().toString(36).slice(2, 10),
    at: Date.now()
  })).toString("base64url");
  if (providerId === "claude-code") {
    const authorizeParams = new URLSearchParams({
      code: "true",
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      state: oauthState
    });
    const returnTo = `/oauth/authorize?${authorizeParams.toString()}`;
    const loginParams = new URLSearchParams({
      selectAccount: "true",
      returnTo
    });
    return {
      url: `https://claude.ai/login?${loginParams.toString()}`,
      state: oauthState,
      redirectUri: config.redirectUri
    };
  }
  if (providerId === "openai-codex") {
    const pkce = createPkcePair();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state: oauthState,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256"
    });
    if (config.scopes) params.set("scope", config.scopes);
    return {
      url: `${config.authUrl}?${params.toString()}`,
      state: oauthState,
      redirectUri: config.redirectUri,
      codeVerifier: pkce.verifier
    };
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state: oauthState
  });
  if (config.scopes) params.set("scope", config.scopes);
  if (provider.type === "gemini") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return {
    url: `${config.authUrl}?${params.toString()}`,
    state: oauthState,
    redirectUri: config.redirectUri
  };
}

async function exchangeOAuthCode(provider, code) {
  const config = oauthConfig(provider);
  const providerId = oauthProviderId(provider);
  if (providerId === "openai-codex") {
    config.redirectUri = "http://localhost:8787/auth/callback";
  }
  if (!config.tokenUrl || !config.clientId) {
    throw new Error("Provider chua du client credentials/token URL");
  }
  let authCode = String(code || "").trim();
  if (/^https?:\/\//i.test(authCode)) {
    const parsed = new URL(authCode);
    authCode = parsed.searchParams.get("code") || authCode;
  }
  const tokenPayload = {
    code: authCode,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code"
  };
  if (config.clientSecret) tokenPayload.client_secret = config.clientSecret;
  if (providerId === "openai-codex" && provider.providerSpecificData?.oauthCodeVerifier) {
    tokenPayload.code_verifier = provider.providerSpecificData.oauthCodeVerifier;
  }
  const payload = await requestForm(config.tokenUrl, tokenPayload);
  return {
    accessToken: payload.access_token || "",
    refreshToken: payload.refresh_token || "",
    expiresIn: payload.expires_in || null,
    raw: payload
  };
}

function applyModelScanOptions(provider, models, options = {}) {
  const catalogId = providerId(provider);
  const freeTierProviderIds = new Set(["nvidia-nim", "gemini-cli", "opencode-free", "qoder", "vertex-ai"]);
  const enriched = models.map((model) => {
    if (model.isFree || !freeTierProviderIds.has(catalogId)) return model;
    return { ...model, isFree: true, freeReason: "provider-tier" };
  });
  if (options.freeOnly) return enriched.filter((model) => model.isFree);
  return enriched;
}

async function scanProviderModels(provider, options = {}) {
  const baseUrl = providerBaseUrl(provider);
  const headers = authHeaders(provider);
  let models = [];
  if (provider.type === "gemini") {
    const url = provider.apiKey
      ? `${baseUrl}/models?key=${encodeURIComponent(provider.apiKey)}`
      : `${baseUrl}/models`;
    models = normalizeModels(await requestJson(url, { headers }), provider.type);
    return applyModelScanOptions(provider, models, options);
  }
  if (provider.type === "anthropic" || provider.type === "anthropic-compatible") {
    models = normalizeModels(await requestJson(`${baseUrl}/models`, { headers }), provider.type);
    return applyModelScanOptions(provider, models, options);
  }
  models = normalizeModels(await requestJson(`${baseUrl}/models`, { headers }), provider.type);
  return applyModelScanOptions(provider, models, options);
}

async function testProvider(provider) {
  const models = await scanProviderModels(provider);
  return {
    ok: true,
    provider: provider.name,
    modelCount: models.length,
    sampleModels: models.slice(0, 8)
  };
}

function normalizeRunnableModelId(provider, model) {
  const raw = String(model || "").trim();
  const providerKey = oauthProviderId(provider);
  if (raw.startsWith(`${providerKey}/`)) return raw.slice(providerKey.length + 1);
  if (provider.type === "gemini" && raw.startsWith("gemini/")) return raw.slice("gemini/".length);
  if (provider.type === "deepseek" && raw.startsWith("deepseek/")) return raw.slice("deepseek/".length);
  if ((provider.type === "openai" || provider.type === "openai-compatible") && raw.startsWith("openai/")) return raw.slice("openai/".length);
  if ((provider.type === "anthropic" || provider.type === "anthropic-compatible") && raw.startsWith("anthropic/")) return raw.slice("anthropic/".length);
  return raw;
}

async function testProviderModel(provider, model) {
  const modelId = normalizeRunnableModelId(provider, model || provider.defaultModel || provider.models?.[0]?.id || provider.models?.[0]);
  if (!modelId) throw new Error(`Provider ${provider.name} chua co model de test`);
  if (provider.type === "gemini") {
    const query = provider.apiKey ? `?key=${encodeURIComponent(provider.apiKey)}` : "";
    const data = await requestJson(`${providerBaseUrl(provider)}/models/${modelId}:generateContent${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(provider) },
      body: JSON.stringify({
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
        contents: [{ role: "user", parts: [{ text: "Reply with OK only." }] }]
      })
    });
    return { ok: true, provider: provider.name, model: modelId, raw: data };
  }
  if (provider.type === "anthropic" || provider.type === "anthropic-compatible") {
    const data = await requestJson(`${providerBaseUrl(provider)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(provider) },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: "user", content: "Reply with OK only." }]
      })
    });
    return { ok: true, provider: provider.name, model: modelId, raw: data };
  }
  const data = await requestJson(`${providerBaseUrl(provider)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 16,
      temperature: 0,
      messages: [{ role: "user", content: "Reply with OK only." }]
    })
  });
  return { ok: true, provider: provider.name, model: modelId, raw: data };
}

async function callOpenAiLike(provider, model, context) {
  const payload = {
    model,
    temperature: Number(provider.temperature || 0.7),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt(context.contentMode, context.tone, context.writingStyle) },
      { role: "user", content: userPrompt(context) }
    ]
  };
  const data = await requestJson(`${providerBaseUrl(provider)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse(data?.choices?.[0]?.message?.content || "{}");
}

async function callAnthropicLike(provider, model, context) {
  const payload = {
    model,
    max_tokens: Number(provider.maxTokens || 1200),
    temperature: Number(provider.temperature || 0.7),
    system: systemPrompt(context.contentMode, context.tone, context.writingStyle),
    messages: [{ role: "user", content: userPrompt(context) }]
  };
  const data = await requestJson(`${providerBaseUrl(provider)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify(payload)
  });
  const text = Array.isArray(data?.content) ? data.content.map((item) => item.text || "").join("\n") : "";
  return parseJsonResponse(text || "{}");
}

async function callGemini(provider, model, context) {
  const modelId = String(model || "").replace(/^models\//, "");
  const query = provider.apiKey ? `?key=${encodeURIComponent(provider.apiKey)}` : "";
  const data = await requestJson(`${providerBaseUrl(provider)}/models/${modelId}:generateContent${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: Number(provider.temperature || 0.7)
      },
      contents: [{
        role: "user",
        parts: [{ text: `${systemPrompt(context.contentMode, context.tone, context.writingStyle)}\n${userPrompt(context)}` }]
      }]
    })
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "{}";
  return parseJsonResponse(text);
}

async function writeWithLlm(job, provider) {
  const context = jobSourceContext(job);
  const model = job.options?.llmModel || provider.defaultModel || provider.models?.[0]?.id || provider.models?.[0];
  if (!model) throw new Error(`Provider ${provider.name} chua co model`);
  let raw;
  if (provider.type === "anthropic" || provider.type === "anthropic-compatible") {
    raw = await callAnthropicLike(provider, model, context);
  } else if (provider.type === "gemini") {
    raw = await callGemini(provider, model, context);
  } else {
    raw = await callOpenAiLike(provider, model, context);
  }
  return normalizeLlmOutput(raw, job.topic);
}

function maskSecret(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 8) return "********";
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function sanitizeProviderForClient(provider) {
  const providerSpecificData = { ...(provider.providerSpecificData || {}) };
  if (providerSpecificData.oauthCodeVerifier) delete providerSpecificData.oauthCodeVerifier;
  return {
    ...provider,
    providerSpecificData,
    apiKey: provider.apiKey ? maskSecret(provider.apiKey) : "",
    accessToken: provider.accessToken ? maskSecret(provider.accessToken) : "",
    refreshToken: provider.refreshToken ? maskSecret(provider.refreshToken) : "",
    clientSecret: provider.clientSecret ? maskSecret(provider.clientSecret) : ""
  };
}

module.exports = {
  buildOAuthStart,
  exchangeOAuthCode,
  providerHistoryEvent,
  sanitizeProviderForClient,
  scanProviderModels,
  testProvider,
  testProviderModel,
  writeWithLlm
};
