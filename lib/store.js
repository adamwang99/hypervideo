const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState() {
  return {
    version: "0.1.0",
    updatedAt: now(),
    settings: {
      appName: "Hypervideo",
      renderMode: "hyperframes",
      hyperframesCli: "/Users/adam/.npm/_npx/702923228c2ce1e6/node_modules/hyperframes/dist/cli.js",
      outputDir: "projects",
      autoStartQueue: true
    },
    catalogs: {
      templateCombos: [
        {
          id: "repo-launch-dynamic",
          name: "Repo Launch Dynamic",
          description: "Combo giới thiệu repo/app: tiêu đề lớn, icon tech, source card, CTA mạnh.",
          template: "launch-card",
          effect: "snap-zoom",
          palette: "dark-neon",
          titleStyle: "kinetic-bold",
          mediaStrategy: "source-card",
          evidenceStyle: "repo-proof",
          iconSet: ["⚡", "CLI", "AI", "GitHub"],
          infographic: "feature-bars",
          motion: "pulse-grid",
          fallbackVisuals: true
        },
        {
          id: "evidence-explainer",
          name: "Evidence Explainer",
          description: "Combo giải thích có dẫn chứng: ảnh/link nguồn, callout, checklist động.",
          template: "explainer-list",
          effect: "slide-stack",
          palette: "clean-blue",
          titleStyle: "editorial-clear",
          mediaStrategy: "source-and-proof",
          evidenceStyle: "quote-card",
          iconSet: ["01", "02", "03", "✓"],
          infographic: "checklist-cards",
          motion: "soft-rise",
          fallbackVisuals: true
        },
        {
          id: "infographic-cta",
          name: "Infographic CTA",
          description: "Combo video bán hàng/ngắn: số liệu, progress, CTA nổi bật, ít khoảng trống.",
          template: "hf:block:data-chart",
          effect: "soft-rise",
          palette: "warm-maker",
          titleStyle: "number-led",
          mediaStrategy: "generated-abstract",
          evidenceStyle: "metric-proof",
          iconSet: ["1", "2", "3", "→"],
          infographic: "metric-rings",
          motion: "moving-orbits",
          fallbackVisuals: true
        },
        {
          id: "app-demo-flow",
          name: "App Demo Flow",
          description: "Combo demo ứng dụng: mock screen, flow arrows, feature chips, outro CTA.",
          template: "hf:block:app-showcase",
          effect: "slide-stack",
          palette: "dark-neon",
          titleStyle: "product-ui",
          mediaStrategy: "ui-mock",
          evidenceStyle: "workflow-proof",
          iconSet: ["UI", "API", "Queue", "MP4"],
          infographic: "workflow-steps",
          motion: "screen-float",
          fallbackVisuals: true
        },
        {
          id: "privacy-trust-review",
          name: "Privacy Trust Review",
          description: "Combo review niềm tin: quyền riêng tư, bằng chứng nguồn, giới hạn và phản biện.",
          template: "explainer-list",
          effect: "soft-rise",
          palette: "clean-blue",
          titleStyle: "trust-signal",
          mediaStrategy: "source-and-proof",
          evidenceStyle: "quote-card",
          iconSet: ["Lock", "Local", "Proof", "Risk"],
          infographic: "checklist-cards",
          motion: "soft-rise",
          fallbackVisuals: true
        },
        {
          id: "quick-compare",
          name: "Quick Compare",
          description: "Combo so sánh nhanh: trước/sau, khác biệt, điểm nên thử và điểm cần cân nhắc.",
          template: "story-promo",
          effect: "slide-stack",
          palette: "warm-maker",
          titleStyle: "comparison",
          mediaStrategy: "source-card",
          evidenceStyle: "metric-proof",
          iconSet: ["Before", "After", "Why", "Try"],
          infographic: "feature-bars",
          motion: "moving-orbits",
          fallbackVisuals: true
        },
        {
          id: "tutorial-steps",
          name: "Tutorial Steps",
          description: "Combo hướng dẫn: nêu tình huống, từng bước thao tác, kết quả và CTA thử nhanh.",
          template: "explainer-list",
          effect: "slide-stack",
          palette: "clean-blue",
          titleStyle: "step-by-step",
          mediaStrategy: "ui-mock",
          evidenceStyle: "workflow-proof",
          iconSet: ["1", "2", "3", "Done"],
          infographic: "workflow-steps",
          motion: "screen-float",
          fallbackVisuals: true
        },
        {
          id: "creator-story",
          name: "Creator Story",
          description: "Combo kể chuyện creator: vấn đề thật, khoảnh khắc chuyển hướng, lợi ích và lời kết mềm.",
          template: "story-promo",
          effect: "snap-zoom",
          palette: "dark-neon",
          titleStyle: "problem-first",
          mediaStrategy: "generated-abstract",
          evidenceStyle: "repo-proof",
          iconSet: ["Pain", "Shift", "Result", "CTA"],
          infographic: "metric-rings",
          motion: "pulse-grid",
          fallbackVisuals: true
        }
      ],
      templates: [
        {
          id: "launch-card",
          name: "Launch Card",
          description: "Video giới thiệu sản phẩm/công cụ, nhịp nhanh, có CTA rõ.",
          style: "product"
        },
        {
          id: "explainer-list",
          name: "Explainer List",
          description: "Giải thích nhiều ý chính theo dạng card/list dễ đọc.",
          style: "education"
        },
        {
          id: "story-promo",
          name: "Story Promo",
          description: "Kịch bản kể chuyện nhẹ, phù hợp giới thiệu repo/app/ý tưởng.",
          style: "narrative"
        }
      ],
      effects: [
        { id: "soft-rise", name: "Soft Rise", description: "Fade + trượt nhẹ lên." },
        { id: "snap-zoom", name: "Snap Zoom", description: "Zoom nhanh cho hook/CTA." },
        { id: "slide-stack", name: "Slide Stack", description: "Card xếp lớp theo nhịp." }
      ],
      palettes: [
        { id: "dark-neon", name: "Dark Neon", bg: "#07111F", primary: "#22D3EE", accent: "#EC4899" },
        { id: "clean-blue", name: "Clean Blue", bg: "#F8FBFF", primary: "#2563EB", accent: "#0F766E" },
        { id: "warm-maker", name: "Warm Maker", bg: "#17120B", primary: "#F59E0B", accent: "#EF4444" }
      ],
      aspects: [
        { id: "vertical", name: "Dọc 9:16", width: 1080, height: 1920 },
        { id: "square", name: "Vuông 1:1", width: 1080, height: 1080 },
        { id: "landscape", name: "Ngang 16:9", width: 1920, height: 1080 }
      ],
      resolutions: [
        { id: "1080p", name: "1080p", scale: 1 },
        { id: "720p", name: "720p", scale: 0.6667 },
        { id: "draft", name: "Draft nhanh", scale: 0.5 }
      ],
      durations: [
        { id: "short", name: "30 giây", seconds: 30 },
        { id: "one-minute", name: "1 phút", seconds: 60 },
        { id: "custom", name: "Tùy chỉnh", seconds: 45 }
      ],
      voices: [
        {
          id: "none",
          name: "Không voice",
          provider: "none",
          language: "vi",
          gender: "",
          pitch: "",
          tags: ["no-audio"],
          qualityScore: 0,
          usageCount: 0,
          favorite: false,
          description: "Chỉ tạo video có chữ."
        },
        {
          id: "local-file",
          name: "Voice file local",
          provider: "local",
          language: "vi",
          gender: "",
          pitch: "",
          tags: ["local", "upload"],
          qualityScore: 0,
          usageCount: 0,
          favorite: false,
          path: "",
          description: "Dùng file wav/mp3 có sẵn."
        },
        {
          id: "vieneu-demo",
          name: "VieNeu · Ngọc Lan",
          provider: "vieneu-tts",
          language: "vi",
          voiceName: "Ngọc Lan",
          gender: "Nữ",
          pitch: "Dịu dàng",
          tags: ["vieneu", "tiếng Việt", "preset"],
          qualityScore: 88,
          usageCount: 0,
          favorite: true,
          path: "",
          description: "Preset VieNeu local, sinh voice mới theo nội dung video."
        },
        {
          id: "vieneu-gia-bao",
          name: "VieNeu · Gia Bảo",
          provider: "vieneu-tts",
          language: "vi",
          voiceName: "Gia Bảo",
          gender: "Nam",
          pitch: "Mượt mà",
          tags: ["vieneu", "tiếng Việt", "preset"],
          qualityScore: 86,
          usageCount: 0,
          favorite: false,
          path: "",
          description: "Preset nam VieNeu local, phù hợp video giải thích."
        },
        {
          id: "vieneu-thai-son",
          name: "VieNeu · Thái Sơn",
          provider: "vieneu-tts",
          language: "vi",
          voiceName: "Thái Sơn",
          gender: "Nam",
          pitch: "Chắc khỏe",
          tags: ["vieneu", "tiếng Việt", "preset"],
          qualityScore: 86,
          usageCount: 0,
          favorite: false,
          path: "",
          description: "Preset nam VieNeu local, giọng rõ và mạnh."
        },
        {
          id: "vieneu-truc-ly",
          name: "VieNeu · Trúc Ly",
          provider: "vieneu-tts",
          language: "vi",
          voiceName: "Trúc Ly",
          gender: "Nữ",
          pitch: "Trẻ trung",
          tags: ["vieneu", "tiếng Việt", "preset"],
          qualityScore: 86,
          usageCount: 0,
          favorite: false,
          path: "",
          description: "Preset nữ VieNeu local, phù hợp video nhịp nhanh."
        }
      ],
      apis: [
        {
          id: "hyperframes-local",
          name: "HyperFrames local",
          type: "renderer",
          baseUrl: "local",
          enabled: true,
          notes: "Render HTML/GSAP sang MP4 bằng CLI local."
        },
        {
          id: "ffmpeg-local",
          name: "FFmpeg local",
          type: "media",
          baseUrl: "local",
          enabled: true,
          notes: "Ghép audio, probe media, encode phụ trợ."
        }
      ],
      writers: [
        {
          id: "local-outline",
          name: "Local outline",
          provider: "local",
          enabled: true,
          description: "Viết kịch bản ngắn từ link và prompt, không gọi LLM."
        },
        {
          id: "llm-script",
          name: "LLM script writer",
          provider: "llm",
          enabled: false,
          description: "Viết nội dung bằng provider/model được chọn."
        }
      ],
      llmProviders: [
        {
          id: "openai-main",
          name: "OpenAI",
          type: "openai",
          authType: "api-key",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          accessToken: "",
          refreshToken: "",
          clientId: "",
          clientSecret: "",
          authUrl: "",
          tokenUrl: "",
          scopes: "",
          redirectUri: "http://localhost:8787/api/llm/oauth/callback",
          defaultModel: "",
          enabled: false,
          compatibleMode: "openai",
          models: [],
          lastScannedAt: "",
          lastTestAt: "",
          lastTestStatus: "",
          lastError: "",
          healthHistory: [],
          notes: ""
        },
        {
          id: "gemini-main",
          name: "Gemini",
          type: "gemini",
          authType: "api-key",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          apiKey: "",
          accessToken: "",
          refreshToken: "",
          clientId: "",
          clientSecret: "",
          authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          tokenUrl: "https://oauth2.googleapis.com/token",
          scopes: "https://www.googleapis.com/auth/generative-language",
          redirectUri: "http://localhost:8787/api/llm/oauth/callback",
          defaultModel: "",
          enabled: false,
          compatibleMode: "google",
          models: [],
          lastScannedAt: "",
          lastTestAt: "",
          lastTestStatus: "",
          lastError: "",
          healthHistory: [],
          notes: ""
        },
        {
          id: "deepseek-main",
          name: "DeepSeek",
          type: "deepseek",
          authType: "api-key",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "",
          accessToken: "",
          refreshToken: "",
          clientId: "",
          clientSecret: "",
          authUrl: "",
          tokenUrl: "",
          scopes: "",
          redirectUri: "http://localhost:8787/api/llm/oauth/callback",
          defaultModel: "",
          enabled: false,
          compatibleMode: "openai",
          models: [],
          lastScannedAt: "",
          lastTestAt: "",
          lastTestStatus: "",
          lastError: "",
          healthHistory: [],
          notes: ""
        },
        {
          id: "anthropic-main",
          name: "Anthropic",
          type: "anthropic",
          authType: "api-key",
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "",
          accessToken: "",
          refreshToken: "",
          clientId: "",
          clientSecret: "",
          authUrl: "",
          tokenUrl: "",
          scopes: "",
          redirectUri: "http://localhost:8787/api/llm/oauth/callback",
          defaultModel: "",
          enabled: false,
          compatibleMode: "anthropic",
          models: [],
          lastScannedAt: "",
          lastTestAt: "",
          lastTestStatus: "",
          lastError: "",
          healthHistory: [],
          notes: ""
        }
      ]
    },
    drafts: {},
    projects: [],
    jobs: [],
    history: []
  };
}

function inferLlmProviderId(provider) {
  if (provider.provider) return provider.provider;
  if (provider.providerSpecificData?.catalogId) return provider.providerSpecificData.catalogId;
  if (provider.providerSpecificData?.nodeId) return provider.providerSpecificData.nodeId;
  const fromId = String(provider.id || "").replace(/-main$/, "");
  if (["openai", "gemini", "deepseek", "anthropic"].includes(fromId)) return fromId;
  if (provider.type === "openai") return "openai";
  if (provider.type === "gemini") return "gemini";
  if (provider.type === "deepseek") return "deepseek";
  if (provider.type === "anthropic") return "anthropic";
  return "";
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    const state = defaultState();
    saveState(state);
    return state;
  }
  return hydrateState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
}

function saveState(state) {
  ensureDataDir();
  state.updatedAt = now();
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function hydrateState(state) {
  const base = defaultState();
  state.settings = { ...base.settings, ...(state.settings || {}) };
  state.catalogs = { ...base.catalogs, ...(state.catalogs || {}) };
  for (const key of Object.keys(base.catalogs)) {
    if (!Array.isArray(state.catalogs[key])) state.catalogs[key] = base.catalogs[key];
  }
  for (const writer of base.catalogs.writers) {
    if (!state.catalogs.writers.some((item) => item.id === writer.id)) state.catalogs.writers.push(writer);
  }
  for (const provider of base.catalogs.llmProviders) {
    const existing = state.catalogs.llmProviders.find((item) => item.id === provider.id);
    if (existing) Object.assign(existing, { ...provider, ...existing });
    else state.catalogs.llmProviders.push(provider);
  }
  state.catalogs.llmProviders = state.catalogs.llmProviders.map((provider) => ({
    priority: 999,
    providerSpecificData: {},
    healthHistory: [],
    ...provider,
    provider: inferLlmProviderId(provider)
  }));
  state.catalogs.llmProviders.sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
  if (!state.drafts || typeof state.drafts !== "object") state.drafts = {};
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.jobs)) state.jobs = [];
  if (!Array.isArray(state.history)) state.history = [];
  return state;
}

function mutate(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result === undefined ? state : result;
}

module.exports = {
  STATE_PATH,
  defaultState,
  hydrateState,
  id,
  loadState,
  mutate,
  now,
  saveState
};
