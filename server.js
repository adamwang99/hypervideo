const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");
const { spawn } = require("child_process");
const { id, loadState, mutate, now, saveState } = require("./lib/store");
const { collectSourceContext, collectSourceMedia, processJob, scriptFromJob } = require("./lib/render");
const { buildOAuthStart, exchangeOAuthCode, providerHistoryEvent, sanitizeProviderForClient, scanProviderModels, testProvider, testProviderModel, writeWithLlm } = require("./lib/llm");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PROJECTS_DIR = path.join(ROOT, "projects");
const TEMP_DIR = path.join(PROJECTS_DIR, "_temps");
const PORT = Number(process.env.PORT || 8787);
const USER_ROOT = "/Users/adam";
const HYPERFRAMES_COMMANDS = [
  "init",
  "add",
  "capture",
  "catalog",
  "preview",
  "present",
  "publish",
  "render",
  "lint",
  "beats",
  "inspect",
  "snapshot",
  "info",
  "compositions",
  "docs",
  "benchmark",
  "browser",
  "doctor",
  "upgrade",
  "cloud",
  "lambda",
  "cloudrun",
  "skills",
  "transcribe",
  "tts",
  "remove-background",
  "auth",
  "feedback",
  "telemetry"
];

let queueActive = false;
let currentJobId = null;
const ttsStatus = {
  provider: "vieneu",
  mode: "offline",
  status: "booting",
  ready: false,
  checkedAt: null,
  error: "",
  detail: ""
};

function cleanTempWorkspaces() {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } catch (error) {
    console.warn(`Cannot clean temp workspaces: ${error.message}`);
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${command} exited ${code}`).trim()));
    });
  });
}

async function preloadVieNeuTts() {
  ttsStatus.status = "loading";
  ttsStatus.ready = false;
  ttsStatus.error = "";
  ttsStatus.detail = "Đang load VieNeu TTS offline...";
  ttsStatus.checkedAt = now();
  const workspace = path.join(TEMP_DIR, "tts-preload");
  try {
    fs.mkdirSync(workspace, { recursive: true });
    const textPath = path.join(workspace, "preload.txt");
    const wavPath = path.join(workspace, "preload.wav");
    fs.writeFileSync(textPath, "Kiểm tra VieNeu TTS offline.", "utf8");
    const { stdout } = await runProcess("python3", [
      path.join(ROOT, "scripts", "vieneu_tts.py"),
      textPath,
      "-o", wavPath,
      "--voice", "Ngọc Lan"
    ], {
      cwd: workspace,
      env: {
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1"
      }
    });
    const info = JSON.parse(stdout.trim().split(/\n/).pop() || "{}");
    if (!fs.existsSync(wavPath)) throw new Error("VieNeu preload không tạo được WAV.");
    ttsStatus.status = "ready";
    ttsStatus.ready = true;
    ttsStatus.error = "";
    ttsStatus.detail = `VieNeu offline ready: ${info.modelDir || "local model"}`;
    ttsStatus.checkedAt = now();
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch (error) {
    ttsStatus.status = "failed";
    ttsStatus.ready = false;
    ttsStatus.error = error.message;
    ttsStatus.detail = "VieNeu TTS offline chưa sẵn sàng. Không cho tạo video có voice.";
    ttsStatus.checkedAt = now();
  }
}

function repairStaleRunningJobs() {
  const state = loadState();
  const cutoff = Date.now() - 30 * 60 * 1000;
  let changed = false;
  for (const job of state.jobs || []) {
    if (job.status !== "running") continue;
    const updatedAt = Date.parse(job.updatedAt || job.startedAt || job.createdAt || "");
    if (Number.isFinite(updatedAt) && updatedAt >= cutoff) continue;
    job.status = "failed";
    job.progress = Math.max(job.progress || 0, 5);
    job.error = job.error || "Job running cũ bị ngắt do server restart hoặc treo quá lâu.";
    job.updatedAt = now();
    job.logs = Array.isArray(job.logs) ? job.logs : [];
    job.logs.push({ at: now(), text: "Job cũ được đánh dấu failed vì không còn process render đang chạy." });
    changed = true;
  }
  if (changed) saveState(state);
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function decodeOAuthState(stateValue) {
  if (!stateValue) return {};
  try {
    return JSON.parse(Buffer.from(String(stateValue), "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function oauthCallbackHtml(payload) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const title = payload.ok ? "OAuth connected" : "OAuth failed";
  const detail = payload.ok
    ? `Đã lưu kết nối OAuth cho ${payload.providerId}.`
    : `Lỗi OAuth: ${payload.error || "unknown error"}`;
  return `<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<body style="font-family:Arial,sans-serif;padding:24px;background:#111827;color:#f8fafc">
  <h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(detail)}</p>
  <p style="color:#cbd5e1">Tab này có thể đóng. Hypervideo sẽ tự cập nhật danh sách connections.</p>
  <script>
    const payload = ${safePayload};
    try { localStorage.setItem("hypervideo:llm-oauth", JSON.stringify(payload)); } catch (error) {}
    try { window.opener && window.opener.postMessage({ type: "hypervideo:llm-oauth", payload }, window.location.origin); } catch (error) {}
    setTimeout(() => window.close(), 1200);
  </script>
</body>
</html>`;
}

function sendFile(res, filePath) {
  if (!filePath.startsWith(ROOT) && !filePath.startsWith("/Users/adam/Desktop")) {
    send(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeLinks(input) {
  if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
  return String(input || "")
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferTopic(link, fallback = "Video mới") {
  try {
    const parsed = new URL(link);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || parsed.hostname).replace(/[-_]+/g, " ");
  } catch {
    return fallback;
  }
}

function toBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function sanitizeStateForClient(state) {
  return {
    ...state,
    tts: { ...ttsStatus },
    catalogs: {
      ...state.catalogs,
      llmProviders: (state.catalogs.llmProviders || []).map(sanitizeProviderForClient)
        .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
    }
  };
}

function createJobs(payload) {
  const links = normalizeLinks(payload.links || payload.link);
  if (!links.length) throw new Error("Cần ít nhất một link hoặc nội dung.");
  const mode = payload.mode || "one-video-per-link";
  const state = loadState();
  const combo = state.catalogs.templateCombos?.find((item) => item.id === payload.templateCombo);
  const baseOptions = {
    templateCombo: payload.templateCombo || combo?.id || "repo-launch-dynamic",
    template: payload.template || combo?.template || "launch-card",
    effect: payload.effect || combo?.effect || "soft-rise",
    palette: payload.palette || combo?.palette || "dark-neon",
    titleStyle: payload.titleStyle || combo?.titleStyle || "kinetic-bold",
    mediaStrategy: payload.mediaStrategy || combo?.mediaStrategy || "source-card",
    evidenceStyle: payload.evidenceStyle || combo?.evidenceStyle || "repo-proof",
    iconSet: payload.iconSet || combo?.iconSet || ["AI", "API", "MP4"],
    infographic: payload.infographic || combo?.infographic || "feature-bars",
    motion: payload.motion || combo?.motion || "pulse-grid",
    fallbackVisuals: payload.fallbackVisuals !== undefined ? payload.fallbackVisuals : (combo?.fallbackVisuals ?? true),
    aspect: payload.aspect || "vertical",
    resolution: payload.resolution || "1080p",
    duration: payload.duration || "one-minute",
    durationSeconds: Number(payload.durationSeconds || payload.seconds || 60),
    voice: payload.voice || "vieneu-demo",
    voiceName: payload.voiceName || payload.vieneuVoice || "",
    vieneuVoice: payload.vieneuVoice || payload.voiceName || "",
    voicePath: payload.voicePath || "",
    renderFormat: payload.renderFormat || "",
    renderQuality: payload.renderQuality || "",
    fps: payload.fps || "",
    workers: payload.workers || "",
    crf: payload.crf || "",
    videoBitrate: payload.videoBitrate || "",
    gpu: payload.gpu,
    hdr: payload.hdr,
    sdr: payload.sdr,
    lowMemoryMode: payload.lowMemoryMode,
    writerMode: payload.writerMode || (toBoolean(payload.llmEnabled) ? "llm" : "local"),
    llmEnabled: toBoolean(payload.llmEnabled),
    llmProviderId: payload.llmProviderId || "",
    llmModel: payload.llmModel || "",
    contentMode: payload.contentMode || "auto-fit",
    writingStyle: payload.writingStyle || "random",
    tone: payload.tone || "gọn, rõ, có nhịp",
    cta: payload.cta || "Lưu lại, thử ngay và chia sẻ nếu hữu ích.",
    hook: payload.hook || ""
  };

  const grouped = mode === "combine-links";
  const sources = grouped ? [links] : links.map((link) => [link]);
  return sources.map((jobLinks, index) => {
    const topic = payload.topic || inferTopic(jobLinks[0], `Video ${index + 1}`);
    const job = {
      id: id("job"),
      projectId: payload.projectId || null,
      title: payload.title || topic,
      topic,
      links: jobLinks,
      points: Array.isArray(payload.points) ? payload.points : [],
      options: { ...baseOptions },
      script: Array.isArray(payload.script) ? payload.script : null,
      contentPlan: payload.contentPlan || null,
      sourceContext: payload.sourceContext || null,
      mediaAssets: Array.isArray(payload.mediaAssets) ? payload.mediaAssets : [],
      status: "queued",
      progress: 0,
      logs: [],
      createdAt: now(),
      updatedAt: now()
    };
    return job;
  });
}

function appendLog(state, jobId, text) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const line = String(text).trim();
  if (!line) return;
  job.logs.push({ at: now(), text: line.slice(-1200) });
  job.logs = job.logs.slice(-240);
  const frameMatch = line.match(/Streaming frame\s+(\d+)\/(\d+)/);
  if (frameMatch) {
    const current = Number(frameMatch[1]);
    const total = Number(frameMatch[2]);
    if (total > 0) job.progress = Math.max(job.progress || 0, Math.min(94, Math.round((current / total) * 34 + 60)));
  }
  const phaseProgress = [
    [/Bắt đầu render/, 5],
    [/Đang đọc nguồn|Loaded source context|Loaded lightweight web context/, 12],
    [/Đang chuẩn bị nội dung|Using user-approved script|LLM writer used|fallback local writer/, 20],
    [/Đang tải media|Loaded \d+ media asset|Loaded web preview image|Source media lookup skipped/, 28],
    [/Đang sinh voice|Warning: You are sending unauthenticated requests to the HF Hub/, 36],
    [/Generated Vietnamese voice/, 48],
    [/Synced video duration/, 54],
    [/Wrote Hyper workflow artifacts/, 58],
    [/Đang render video|Streaming frame|Render complete|Compiler|Fetched .*font/, 62],
    [/Render complete|completed/, 95],
    [/Đang ghép voice|Mux warning|ffmpeg version/, 96],
    [/Đã ghép voice|Muxed final video/, 98]
  ];
  for (const [pattern, progress] of phaseProgress) {
    if (pattern.test(line)) job.progress = Math.max(job.progress || 0, progress);
  }
  job.updatedAt = now();
}

function runNodeCli(args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const state = loadState();
    const cli = state.settings.hyperframesCli;
    const child = spawn("node", [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `hyperframes exited ${code}`));
    });
  });
}

function normalizeCliArgs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item))
    .filter((item) => item.length > 0)
    .slice(0, 80);
}

function safeCwd(value) {
  const cwd = value ? path.resolve(String(value)) : ROOT;
  if (!cwd.startsWith(USER_ROOT)) throw new Error("cwd chỉ được nằm trong /Users/adam");
  return cwd;
}

function safeProjectPath(value) {
  if (!value) return "";
  const target = path.resolve(String(value));
  if (!target.startsWith(PROJECTS_DIR + path.sep) && target !== PROJECTS_DIR) {
    throw new Error("Chỉ được thao tác file trong thư mục projects của Hypervideo");
  }
  return target;
}

function jobOutputFolder(job) {
  const candidates = [
    job.workspace,
    job.outputPath ? path.dirname(job.outputPath) : "",
    job.previewPath ? path.dirname(job.previewPath) : ""
  ].filter(Boolean);
  return candidates[0] ? safeProjectPath(candidates[0]) : "";
}

function deleteJobFiles(job) {
  const folder = jobOutputFolder(job);
  if (folder && fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
}

function openPath(targetPath) {
  const safePath = safeProjectPath(targetPath);
  if (!safePath || !fs.existsSync(safePath)) throw new Error("Không tìm thấy file/thư mục để mở");
  const child = spawn("open", [safePath], { detached: true, stdio: "ignore" });
  child.unref();
}

async function runHyperframesCommand(payload) {
  const command = String(payload.command || "").trim();
  if (!HYPERFRAMES_COMMANDS.includes(command)) {
    throw new Error(`Lệnh HyperFrames không được hỗ trợ: ${command || "(trống)"}`);
  }
  const args = normalizeCliArgs(payload.args);
  const cwd = safeCwd(payload.cwd);
  return runNodeCli([command, ...args], cwd);
}

async function syncHyperframesCatalog() {
  const { stdout } = await runNodeCli(["catalog", "--json"]);
  const items = JSON.parse(stdout);
  return mutate((state) => {
    state.catalogs.hyperframes = items.map((item) => ({
      id: `hf:${item.type}:${item.name}`,
      name: item.title || item.name,
      sourceName: item.name,
      kind: item.type,
      description: item.description || "",
      tags: item.tags || [],
      dimensions: item.dimensions || null,
      duration: item.duration || null
    }));

    const existingTemplateIds = new Set(state.catalogs.templates.map((item) => item.id));
    const existingEffectIds = new Set(state.catalogs.effects.map((item) => item.id));
    for (const item of state.catalogs.hyperframes) {
      if (item.kind === "block" && !existingTemplateIds.has(item.id)) {
        state.catalogs.templates.push({
          id: item.id,
          name: `HF · ${item.name}`,
          description: item.description,
          style: "hyperframes",
          sourceName: item.sourceName,
          tags: item.tags,
          dimensions: item.dimensions,
          duration: item.duration
        });
      }
      if (item.kind === "component" && !existingEffectIds.has(item.id)) {
        state.catalogs.effects.push({
          id: item.id,
          name: `HF · ${item.name}`,
          description: item.description,
          sourceName: item.sourceName,
          tags: item.tags
        });
      }
    }
    return { count: items.length, blocks: items.filter((i) => i.type === "block").length, components: items.filter((i) => i.type === "component").length };
  });
}

async function processQueue() {
  if (queueActive) return;
  queueActive = true;
  try {
    while (true) {
      const state = loadState();
      const job = state.jobs.find((item) => item.status === "queued");
      if (!job) break;
      currentJobId = job.id;
      job.status = "running";
      job.progress = 5;
      job.startedAt = now();
      job.updatedAt = now();
      saveState(state);

      let liveJob = null;
      try {
        appendLog(loadState(), job.id, "Bắt đầu render");
        const current = loadState();
        liveJob = current.jobs.find((item) => item.id === job.id);
        await processJob(liveJob, current, (line) => {
          mutate((s) => appendLog(s, job.id, line));
        });
        mutate((s) => {
          const done = s.jobs.find((item) => item.id === job.id);
          if (done.cancelRequested) {
            done.status = "cancelled";
            done.progress = Math.max(done.progress || 0, 5);
            done.updatedAt = now();
            done.logs.push({ at: now(), text: "Job đã bị huỷ theo yêu cầu." });
            return;
          }
          Object.assign(done, {
            workspace: liveJob.workspace,
            voicePath: liveJob.voicePath,
            previewPath: liveJob.previewPath,
            outputPath: liveJob.outputPath,
            result: liveJob.result
          });
          done.status = "done";
          done.progress = 100;
          done.finishedAt = now();
          done.updatedAt = now();
          s.history.unshift({
            id: id("history"),
            jobId: done.id,
            title: done.title,
            outputPath: done.outputPath,
            previewPath: done.previewPath,
            finishedAt: done.finishedAt
          });
          s.history = s.history.slice(0, 300);
        });
      } catch (error) {
        mutate((s) => {
          const failed = s.jobs.find((item) => item.id === job.id);
          if (liveJob) {
            failed.workspace = liveJob.workspace || failed.workspace;
            failed.voicePath = liveJob.voicePath || failed.voicePath;
            failed.previewPath = liveJob.previewPath || failed.previewPath;
            failed.outputPath = liveJob.outputPath || failed.outputPath;
            failed.result = liveJob.result || failed.result;
          }
          failed.status = "failed";
          failed.error = error.message;
          failed.updatedAt = now();
          failed.logs.push({ at: now(), text: error.message });
        });
      }
    }
  } finally {
    currentJobId = null;
    queueActive = false;
  }
}

function maybeStartQueue() {
  const state = loadState();
  if (state.settings.autoStartQueue) processQueue();
}

function upsertCatalog(type, payload) {
  return mutate((state) => {
    if (!state.catalogs[type]) throw new Error(`Catalog không tồn tại: ${type}`);
    const item = { ...payload };
    if (!item.id) item.id = id(type.slice(0, -1) || "item");
    const index = state.catalogs[type].findIndex((entry) => entry.id === item.id);
    if (index >= 0) state.catalogs[type][index] = { ...state.catalogs[type][index], ...item };
    else state.catalogs[type].push(item);
    return item;
  });
}

function llmProviderDefaults(type) {
  const presets = {
    openai: {
      authType: "api-key",
      compatibleMode: "openai",
      baseUrl: "https://api.openai.com/v1"
    },
    "openai-compatible": {
      authType: "api-key",
      compatibleMode: "openai"
    },
    deepseek: {
      authType: "api-key",
      compatibleMode: "openai",
      baseUrl: "https://api.deepseek.com/v1"
    },
    anthropic: {
      authType: "api-key",
      compatibleMode: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      anthropicVersion: "2023-06-01"
    },
    "anthropic-compatible": {
      authType: "api-key",
      compatibleMode: "anthropic",
      anthropicVersion: "2023-06-01"
    },
    gemini: {
      authType: "api-key",
      compatibleMode: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: "https://www.googleapis.com/auth/generative-language",
      redirectUri: "http://localhost:8787/api/llm/oauth/callback"
    }
  };
  return presets[type] || {};
}

function llmProviderConnectionDefaults(providerId) {
  const presets = {
    "openrouter": { baseUrl: "https://openrouter.ai/api/v1" },
    "nvidia-nim": { baseUrl: "https://integrate.api.nvidia.com/v1" },
    "groq": { baseUrl: "https://api.groq.com/openai/v1" },
    "xai-grok": { baseUrl: "https://api.x.ai/v1" },
    "fireworks-ai": { baseUrl: "https://api.fireworks.ai/inference/v1" },
    "cerebras": { baseUrl: "https://api.cerebras.ai/v1" },
    "cohere": { baseUrl: "https://api.cohere.ai/v1" },
    "hyperbolic": { baseUrl: "https://api.hyperbolic.xyz/v1" },
    "chutes-ai": { baseUrl: "https://llm.chutes.ai/v1" },
    "alibaba": { baseUrl: "https://coding.dashscope.aliyuncs.com/v1" },
    "alibaba-intl": { baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1" },
    "byteplus-modelark": { baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3" },
    "cloudflare": { baseUrl: "https://api.cloudflare.com/client/v4/accounts" },
    "ollama-cloud": { baseUrl: "https://ollama.com/api" },
    "qoder": { baseUrl: "https://api3.qoder.sh/algo/api/v2/service/pro" },
    "glm-china": { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" },
    "glm-coding": { baseUrl: "https://api.z.ai/api/anthropic/v1" },
    "kimi": { baseUrl: "https://api.kimi.com/coding/v1" },
    "command-code": { baseUrl: "https://api.commandcode.ai/alpha" }
  };
  return presets[providerId] || {};
}

function llmProviderOAuthDefaults(providerId) {
  const redirectUri = "http://localhost:8787/api/llm/oauth/callback";
  const codexRedirectUri = "http://localhost:8787/auth/callback";
  const env = (name) => process.env[`HYPERVIDEO_${name}`] || "";
  const presets = {
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
      clientId: env("ANTIGRAVITY_CLIENT_ID"),
      clientSecret: env("ANTIGRAVITY_CLIENT_SECRET"),
      scopes: "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language",
      redirectUri
    },
    "gemini-cli": {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: env("GEMINI_CLI_CLIENT_ID"),
      clientSecret: env("GEMINI_CLI_CLIENT_SECRET"),
      scopes: "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language",
      redirectUri
    },
    "vertex-ai": {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: env("VERTEX_AI_CLIENT_ID") || env("GEMINI_CLI_CLIENT_ID"),
      clientSecret: env("VERTEX_AI_CLIENT_SECRET") || env("GEMINI_CLI_CLIENT_SECRET"),
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
  return presets[providerId] || {};
}

function normalizeLlmProviderId(value) {
  const raw = String(value || "").trim();
  const aliases = {
    openai: "openai",
    "open-ai": "openai",
    gpt: "openai",
    gemini: "gemini",
    google: "gemini",
    deepseek: "deepseek",
    "deep-seek": "deepseek",
    anthropic: "anthropic",
    claude: "anthropic",
    "openai-compatible": "openai-compatible",
    "anthropic-compatible": "anthropic-compatible"
  };
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return aliases[key] || raw || "openai-compatible";
}

function parseProviderSpecificData(payload, current = {}) {
  if (payload.providerSpecificData && typeof payload.providerSpecificData === "object") {
    return payload.providerSpecificData;
  }
  if (typeof payload.providerSpecificDataText === "string" && payload.providerSpecificDataText.trim()) {
    return JSON.parse(payload.providerSpecificDataText);
  }
  return current.providerSpecificData || {};
}

function validateLlmProvider(provider) {
  const errors = [];
  if (!provider.id) errors.push("ID is required");
  if (!provider.name) errors.push("Name is required");
  if (!provider.type) errors.push("Provider type is required");
  if ((provider.authType === "api-key" || provider.authType === "apikey") && !provider.apiKey && provider.enabled) {
    errors.push("API key is required when enabling an API-key provider");
  }
  if (provider.authType === "oauth" && provider.enabled && !provider.accessToken && !provider.refreshToken) {
    errors.push("OAuth token is required when enabling an OAuth provider");
  }
  if ((provider.type === "openai-compatible" || provider.type === "anthropic-compatible") && !provider.baseUrl) {
    errors.push("Base URL is required for compatible providers");
  }
  return { ok: errors.length === 0, errors };
}

function normalizeLlmProviderPayload(payload, current = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const keepOrSet = (key) => has(key) ? String(payload[key] || "").trim() : (current[key] || "");
  const type = normalizeLlmProviderId(payload.type || current.type || "openai-compatible");
  const defaults = llmProviderDefaults(type);
  const providerSpecificData = parseProviderSpecificData(payload, current);
  const provider = payload.provider || payload.providerId || providerSpecificData.catalogId || providerSpecificData.nodeId || current.provider || "";
  const oauthDefaults = llmProviderOAuthDefaults(provider);
  const connectionDefaults = llmProviderConnectionDefaults(provider);
  const redirectUri = provider === "openai-codex"
    ? (oauthDefaults.redirectUri || "http://localhost:8787/auth/callback")
    : (has("redirectUri") ? String(payload.redirectUri || "").trim() : (current.redirectUri || oauthDefaults.redirectUri || defaults.redirectUri || "http://localhost:8787/api/llm/oauth/callback"));
  return {
    id: payload.id || current.id || id("llm"),
    provider,
    name: payload.name || current.name || "LLM Provider",
    type,
    authType: payload.authType || current.authType || defaults.authType || "api-key",
    baseUrl: payload.baseUrl || current.baseUrl || connectionDefaults.baseUrl || defaults.baseUrl || "",
    apiKey: payload.apiKey ? String(payload.apiKey).trim() : (current.apiKey || ""),
    accessToken: payload.accessToken ? String(payload.accessToken).trim() : (current.accessToken || ""),
    refreshToken: payload.refreshToken ? String(payload.refreshToken).trim() : (current.refreshToken || ""),
    clientId: has("clientId") ? keepOrSet("clientId") : (current.clientId || oauthDefaults.clientId || defaults.clientId || ""),
    clientSecret: has("clientSecret") ? keepOrSet("clientSecret") : (current.clientSecret || oauthDefaults.clientSecret || defaults.clientSecret || ""),
    authUrl: has("authUrl") ? keepOrSet("authUrl") : (current.authUrl || oauthDefaults.authUrl || defaults.authUrl || ""),
    tokenUrl: has("tokenUrl") ? keepOrSet("tokenUrl") : (current.tokenUrl || oauthDefaults.tokenUrl || defaults.tokenUrl || ""),
    scopes: has("scopes") ? String(payload.scopes || "").trim() : (current.scopes || oauthDefaults.scopes || defaults.scopes || ""),
    redirectUri,
    defaultModel: payload.defaultModel || current.defaultModel || "",
    enabled: toBoolean(payload.enabled !== undefined ? payload.enabled : current.enabled),
    compatibleMode: payload.compatibleMode || current.compatibleMode || defaults.compatibleMode || "",
    models: Array.isArray(payload.models) ? payload.models : (current.models || []),
    disabledModels: Array.isArray(payload.disabledModels) ? payload.disabledModels.map(String) : (current.disabledModels || []),
    anthropicVersion: payload.anthropicVersion || current.anthropicVersion || defaults.anthropicVersion || "",
    notes: payload.notes || current.notes || "",
    priority: payload.priority !== undefined && payload.priority !== "" ? Number(payload.priority) : (current.priority || 999),
    providerSpecificData,
    lastScannedAt: payload.lastScannedAt || current.lastScannedAt || "",
    lastTestAt: payload.lastTestAt || current.lastTestAt || "",
    lastTestStatus: payload.lastTestStatus || current.lastTestStatus || "",
    lastError: payload.lastError || current.lastError || "",
    healthHistory: Array.isArray(payload.healthHistory) ? payload.healthHistory : (current.healthHistory || []),
    temperature: payload.temperature !== undefined && payload.temperature !== "" ? Number(payload.temperature) : (current.temperature || 0.7),
    maxTokens: payload.maxTokens !== undefined && payload.maxTokens !== "" ? Number(payload.maxTokens) : (current.maxTokens || 1200)
  };
}

function recordProviderHealth(state, providerId, event) {
  const provider = (state.catalogs.llmProviders || []).find((item) => item.id === providerId);
  if (!provider) return null;
  provider.healthHistory = [event, ...(provider.healthHistory || [])].slice(0, 12);
  provider.lastError = event.ok ? "" : event.detail;
  if (event.kind === "test") {
    provider.lastTestAt = event.at;
    provider.lastTestStatus = event.ok ? "ok" : "failed";
  }
  if (event.kind === "scan") {
    provider.lastScannedAt = event.at;
  }
  return provider;
}

function chooseLlmDefaultModel(provider, models) {
  const ids = (models || []).map((model) => typeof model === "string" ? model : model.id).filter(Boolean);
  const preferredByProvider = {
    "nvidia-nim": ["meta/llama-3.1-8b-instruct", "meta/llama-3.3-70b-instruct", "mistralai/mistral-7b-instruct-v0.3"],
    gemini: ["gemini-2.5-flash", "gemini-2.0-flash"],
    "gemini-cli": ["gemini-2.5-flash", "gemini-2.0-flash"],
    openrouter: ["openai/gpt-4o-mini", "google/gemini-2.5-flash"],
    groq: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
  };
  const providerKey = provider.provider || provider.providerSpecificData?.catalogId || provider.id || "";
  const preferred = preferredByProvider[providerKey] || [];
  const exact = preferred.find((idValue) => ids.includes(idValue));
  if (exact) return exact;
  const chatLike = ids.find((idValue) => /(?:chat|instruct|assistant|reason|sonnet|opus|haiku|flash|gpt|gemini|llama|qwen|mistral|deepseek)/i.test(idValue)
    && !/(?:embed|rerank|guard|safety|parse|translate|vision|image|audio|tts|reward)/i.test(idValue));
  return chatLike || ids[0] || "";
}

function modelIdOf(model) {
  return typeof model === "string" ? model : model?.id;
}

function modelLooksRunnableForWriter(model) {
  const idValue = String(modelIdOf(model) || "").toLowerCase();
  if (!idValue) return false;
  if (/(?:embed|embedding|rerank|rank|retriever|bge|arctic-embed|nv-embed|guard|safety|moderation|reward|parse|translate|tts|audio|image|vision|vl|ocr|deplot|kosmos|fuyu|vila|multimodal)/.test(idValue)) {
    return false;
  }
  return /(?:chat|instruct|assistant|reason|sonnet|opus|haiku|flash|gpt|gemini|llama|qwen|mistral|deepseek|glm|kimi|command|cohere|nemotron|palmyra)/i.test(idValue);
}

async function validateWorkingModels(provider, models) {
  const active = [];
  const disabled = [];
  const errors = {};
  const candidates = models.filter(modelLooksRunnableForWriter);
  const skipped = models.filter((model) => !modelLooksRunnableForWriter(model));
  skipped.forEach((model) => {
    const modelId = modelIdOf(model);
    if (modelId) {
      disabled.push(modelId);
      errors[modelId] = "Không phải model viết/chat phù hợp cho writer.";
    }
  });
  for (const model of candidates) {
    const modelId = modelIdOf(model);
    try {
      await testProviderModel(provider, modelId);
      active.push(modelId);
    } catch (error) {
      disabled.push(modelId);
      errors[modelId] = String(error.message || "Model test failed").slice(0, 300);
    }
  }
  return { active, disabled, errors };
}

function updateLlmModelStatus(providerId, payload) {
  const modelId = String(payload.model || "").trim();
  if (!modelId) throw new Error("Model ID is required");
  return mutate((s) => {
    const provider = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
    if (!provider) throw new Error("Provider not found");
    const disabled = new Set((provider.disabledModels || []).map(String));
    if (toBoolean(payload.enabled)) {
      disabled.delete(modelId);
      if (provider.modelErrors && typeof provider.modelErrors === "object") delete provider.modelErrors[modelId];
    }
    else disabled.add(modelId);
    provider.disabledModels = Array.from(disabled);
    if (provider.defaultModel === modelId && disabled.has(modelId)) {
      const activeModels = (provider.models || []).filter((model) => !disabled.has(typeof model === "string" ? model : model.id));
      provider.defaultModel = chooseLlmDefaultModel(provider, activeModels);
    }
    provider.updatedAt = now();
    return provider;
  });
}

function updateAllLlmModelStatuses(providerId, enabled) {
  return mutate((s) => {
    const provider = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
    if (!provider) throw new Error("Provider not found");
    const models = provider.models || [];
    const errorIds = Object.keys(provider.modelErrors || {});
    provider.disabledModels = enabled ? errorIds : models.map((model) => typeof model === "string" ? model : model.id).filter(Boolean);
    if (!enabled) provider.defaultModel = "";
    else provider.defaultModel = chooseLlmDefaultModel(provider, models.filter((model) => !errorIds.includes(modelIdOf(model))));
    provider.updatedAt = now();
    return provider;
  });
}

async function handleApi(req, res, pathname, method) {
  if (pathname === "/api/health") {
    send(res, 200, { ok: true, active: queueActive, currentJobId, time: now() });
    return;
  }
  if (pathname === "/api/tts/status" && method === "GET") {
    send(res, 200, { ...ttsStatus });
    return;
  }
  if (pathname === "/api/tts/preload" && method === "POST") {
    if (ttsStatus.status !== "loading") preloadVieNeuTts().catch((error) => {
      ttsStatus.status = "failed";
      ttsStatus.ready = false;
      ttsStatus.error = error.message;
      ttsStatus.checkedAt = now();
    });
    send(res, 200, { ...ttsStatus });
    return;
  }
  if (pathname === "/api/state" && method === "GET") {
    send(res, 200, sanitizeStateForClient(loadState()));
    return;
  }
  const workflowMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/hyper-workflow$/);
  if (workflowMatch && method === "GET") {
    const state = loadState();
    const job = state.jobs.find((item) => item.id === workflowMatch[1]);
    if (!job) {
      send(res, 404, { error: "Job not found" });
      return;
    }
    send(res, 200, {
      jobId: job.id,
      title: job.title,
      status: job.status,
      workspace: job.workspace || "",
      workflow: job.hyperWorkflow || null,
      artifacts: job.workspace ? {
        design: path.join(job.workspace, "DESIGN.md"),
        script: path.join(job.workspace, "SCRIPT.md"),
        storyboard: path.join(job.workspace, "STORYBOARD.md"),
        transcript: path.join(job.workspace, "transcript.json"),
        beats: path.join(job.workspace, "beats.json"),
        handoff: path.join(job.workspace, "HANDOFF.md"),
        json: path.join(job.workspace, "hyper-workflow.json")
      } : null,
      message: job.hyperWorkflow ? "" : "Job này chưa có Hyper workflow artifact. Hãy render lại bằng pipeline mới."
    });
    return;
  }
  if (pathname === "/api/settings" && method === "POST") {
    const body = await readBody(req);
    const settings = mutate((state) => {
      state.settings = { ...state.settings, ...body };
      return state.settings;
    });
    send(res, 200, settings);
    maybeStartQueue();
    return;
  }
  if (pathname === "/api/draft" && method === "POST") {
    const body = await readBody(req);
    const draft = mutate((state) => {
      const key = body.key || "main";
      state.drafts[key] = { value: body.value || {}, updatedAt: now() };
      return state.drafts[key];
    });
    send(res, 200, draft);
    return;
  }
  if (pathname === "/api/projects" && method === "POST") {
    const body = await readBody(req);
    const project = mutate((state) => {
      const item = {
        id: id("project"),
        name: body.name || "Dự án mới",
        description: body.description || "",
        createdAt: now(),
        updatedAt: now()
      };
      state.projects.unshift(item);
      return item;
    });
    send(res, 200, project);
    return;
  }
  if (pathname === "/api/jobs" && method === "POST") {
    const body = await readBody(req);
    const jobs = createJobs(body);
    for (const job of jobs) {
      if (!Array.isArray(job.script) || !job.script.some((line) => String(line || "").trim())) {
        throw new Error("Chưa có nội dung cho video. Hãy gọi /api/write/preview hoặc gửi script trước khi đưa vào queue.");
      }
    }
    const needsVieNeu = jobs.some((job) => job.options.voice && job.options.voice !== "none");
    if (needsVieNeu && !ttsStatus.ready) {
      throw new Error(`VieNeu TTS offline chưa sẵn sàng (${ttsStatus.status}). ${ttsStatus.error || "Chờ ứng dụng load TTS xong rồi tạo video."}`);
    }
    mutate((state) => {
      state.jobs.push(...jobs);
      for (const job of jobs) {
        const voice = state.catalogs.voices.find((item) => item.id === job.options.voice);
        if (voice && voice.id !== "none") voice.usageCount = Number(voice.usageCount || voice.usage_count || 0) + 1;
      }
      return jobs;
    });
    send(res, 200, { jobs });
    maybeStartQueue();
    return;
  }
  if (pathname === "/api/jobs/delete" && method === "POST") {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const deleteFiles = body.deleteFiles !== false;
    if (!ids.length) throw new Error("Chưa chọn job để xoá");
    const result = mutate((state) => {
      const deleted = [];
      const blocked = [];
      for (const jobId of ids) {
        const job = state.jobs.find((item) => item.id === jobId);
        if (!job) continue;
        if (job.status === "running") {
          blocked.push(jobId);
          continue;
        }
        if (deleteFiles) deleteJobFiles(job);
        state.jobs = state.jobs.filter((item) => item.id !== jobId);
        state.history = (state.history || []).filter((item) => item.jobId !== jobId);
        deleted.push(jobId);
      }
      return { deleted, blocked };
    });
    send(res, 200, result);
    return;
  }
  if (pathname === "/api/write/preview" && method === "POST") {
    const body = await readBody(req);
    const state = loadState();
    const job = createJobs({ ...body, durationSeconds: body.durationSeconds || body.seconds || 60 })[0];
    job.workspace = job.workspace || path.join(TEMP_DIR, `${job.topic || "preview"}-${job.id}`);
    fs.mkdirSync(job.workspace, { recursive: true });
    fs.mkdirSync(path.join(job.workspace, "assets"), { recursive: true });
    job.sourceContext = body.sourceContext || await collectSourceContext(job);
    if (job.sourceContext?.name) job.topic = job.sourceContext.name;
    if (!body.topic && job.sourceContext?.name) job.title = job.sourceContext.name;
    const mediaPromise = collectSourceMedia(job, job.workspace, () => {}).catch((error) => {
      job.mediaAssets = [];
      job.mediaError = error.message;
      return [];
    });
    if (job.options.llmEnabled && job.options.llmProviderId) {
      const provider = (state.catalogs.llmProviders || []).find((item) => item.id === job.options.llmProviderId && item.enabled);
      if (!provider) throw new Error("LLM provider khong kha dung");
      const llm = await writeWithLlm(job, provider);
      job.mediaAssets = await mediaPromise;
      send(res, 200, {
        mode: "llm",
        ...llm,
        contentPlan: job.contentPlan || null,
        sourceContext: job.sourceContext || null,
        mediaAssets: job.mediaAssets || [],
        title: llm.title || job.title,
        topic: job.topic
      });
      return;
    }
    job.script = null;
    const script = scriptFromJob(job);
    const mediaAssets = await mediaPromise;
    send(res, 200, {
      mode: "local",
      script,
      contentPlan: job.contentPlan || null,
      sourceContext: job.sourceContext || null,
      mediaAssets,
      title: job.title,
      topic: job.topic
    });
    return;
  }
  if (pathname === "/api/hyperframes/catalog/sync" && method === "POST") {
    send(res, 200, await syncHyperframesCatalog());
    return;
  }
  if (pathname === "/api/hyperframes/capabilities" && method === "GET") {
    const state = loadState();
    send(res, 200, {
      cli: state.settings.hyperframesCli,
      commands: HYPERFRAMES_COMMANDS,
      catalog: {
        hyperframes: state.catalogs.hyperframes.length,
        templates: state.catalogs.templates.length,
        effects: state.catalogs.effects.length
      },
      renderOptions: [
        "format",
        "fps",
        "quality",
        "workers",
        "resolution",
        "lowMemoryMode",
        "crf",
        "videoBitrate",
        "gpu",
        "hdr",
        "sdr",
        "variables",
        "batch"
      ]
    });
    return;
  }
  if (pathname === "/api/hyperframes/run" && method === "POST") {
    const result = await runHyperframesCommand(await readBody(req));
    send(res, 200, { stdout: result.stdout, stderr: result.stderr });
    return;
  }
  if (pathname === "/api/hyperframes/doctor" && method === "GET") {
    const result = await runNodeCli(["doctor"]);
    send(res, 200, { stdout: result.stdout, stderr: result.stderr });
    return;
  }
  if (pathname === "/api/queue/start" && method === "POST") {
    processQueue();
    send(res, 200, { ok: true });
    return;
  }
  if ((pathname === "/api/llm/oauth/callback" || pathname === "/auth/callback") && method === "GET") {
    const query = url.parse(req.url, true).query || {};
    const code = query.code ? String(query.code) : "";
    const stateValue = query.state ? String(query.state) : "";
    const error = query.error ? String(query.error) : "";
    const decodedState = decodeOAuthState(stateValue);
    const providerId = decodedState.providerId || "";
    if (error || !code || !providerId) {
      const message = error || (!providerId ? "Missing OAuth provider state" : "Missing OAuth code");
      if (providerId) {
        mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("oauth", false, message)));
      }
      send(res, 200, oauthCallbackHtml({ ok: false, providerId, error: message, at: now() }), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    try {
      const state = loadState();
      const provider = (state.catalogs.llmProviders || []).find((item) => item.id === providerId);
      if (!provider) throw new Error("Khong tim thay OAuth provider pending");
      const token = await exchangeOAuthCode(provider, code);
      const updated = mutate((s) => {
        const target = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
        target.accessToken = token.accessToken || target.accessToken || "";
        if (token.refreshToken) target.refreshToken = token.refreshToken;
        if (target.providerSpecificData?.oauthCodeVerifier) delete target.providerSpecificData.oauthCodeVerifier;
        target.enabled = true;
        target.lastOAuthAt = now();
        recordProviderHealth(s, providerId, providerHistoryEvent("oauth", true, "OAuth token saved from callback"));
        return target;
      });
      send(res, 200, oauthCallbackHtml({ ok: true, providerId, providerName: updated.name, at: now() }), { "content-type": "text/html; charset=utf-8" });
    } catch (callbackError) {
      if (providerId) {
        mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("oauth", false, callbackError.message)));
      }
      send(res, 200, oauthCallbackHtml({ ok: false, providerId, error: callbackError.message, at: now() }), { "content-type": "text/html; charset=utf-8" });
    }
    return;
  }
  if (pathname === "/api/llm/providers/validate" && method === "POST") {
    const body = await readBody(req);
    const current = body.id
      ? (loadState().catalogs.llmProviders || []).find((entry) => entry.id === body.id) || {}
      : {};
    const provider = normalizeLlmProviderPayload(body, current);
    const result = validateLlmProvider(provider);
    send(res, 200, { ...result, provider: sanitizeProviderForClient(provider) });
    return;
  }
  if (pathname === "/api/llm/providers/test-batch" && method === "POST") {
    const body = await readBody(req);
    const state = loadState();
    const ids = Array.isArray(body.ids) && body.ids.length
      ? body.ids.map(String)
      : (state.catalogs.llmProviders || []).filter((item) => item.enabled).map((item) => item.id);
    const results = [];
    for (const providerId of ids) {
      const provider = (state.catalogs.llmProviders || []).find((item) => item.id === providerId);
      if (!provider) {
        results.push({ id: providerId, ok: false, error: "Provider not found" });
        continue;
      }
      try {
        const result = await testProvider(provider);
        mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("test", true, `OK · ${result.modelCount} models`)));
        results.push({ id: providerId, ok: true, modelCount: result.modelCount, sampleModels: result.sampleModels });
      } catch (error) {
        mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("test", false, error.message)));
        results.push({ id: providerId, ok: false, error: error.message });
      }
    }
    send(res, 200, { results });
    return;
  }
  const llmProviderAction = pathname.match(/^\/api\/llm\/providers(?:\/([^/]+))?(?:\/(test|test-model|scan-models|model-status|models-status|clone|oauth-start|oauth-exchange))?$/);
  if (llmProviderAction) {
    const [, providerId, action] = llmProviderAction;
    if (method === "GET" && !providerId) {
      send(res, 200, { items: sanitizeStateForClient(loadState()).catalogs.llmProviders || [] });
      return;
    }
    if (method === "POST" && !providerId && !action) {
      const body = await readBody(req);
      const item = mutate((state) => {
        const current = (state.catalogs.llmProviders || []).find((entry) => entry.id === body.id) || {};
        const provider = normalizeLlmProviderPayload(body, current);
        const list = state.catalogs.llmProviders || (state.catalogs.llmProviders = []);
        const index = list.findIndex((entry) => entry.id === provider.id);
        if (index >= 0) list[index] = { ...list[index], ...provider };
        else list.push(provider);
        return provider;
      });
      send(res, 200, sanitizeProviderForClient(item));
      return;
    }
    if (method === "DELETE" && providerId && !action) {
      mutate((state) => {
        state.catalogs.llmProviders = (state.catalogs.llmProviders || []).filter((item) => item.id !== providerId);
      });
      send(res, 200, { ok: true });
      return;
    }
    if (method === "POST" && providerId && action) {
      const state = loadState();
      const provider = (state.catalogs.llmProviders || []).find((item) => item.id === providerId);
      if (!provider) throw new Error("Khong tim thay LLM provider");
      if (action === "test") {
        try {
          const result = await testProvider(provider);
          mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("test", true, `OK · ${result.modelCount} models`)));
          send(res, 200, result);
        } catch (error) {
          mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("test", false, error.message)));
          throw error;
        }
        return;
      }
      if (action === "test-model") {
        const body = await readBody(req);
        try {
          const result = await testProviderModel(provider, body.model || provider.defaultModel || "");
          send(res, 200, { ok: true, provider: result.provider, model: result.model });
        } catch (error) {
          throw error;
        }
        return;
      }
      if (action === "model-status") {
        const body = await readBody(req);
        const updated = updateLlmModelStatus(providerId, body);
        send(res, 200, sanitizeProviderForClient(updated));
        return;
      }
      if (action === "models-status") {
        const body = await readBody(req);
        const updated = updateAllLlmModelStatuses(providerId, toBoolean(body.enabled));
        send(res, 200, sanitizeProviderForClient(updated));
        return;
      }
      if (action === "scan-models") {
        const body = await readBody(req);
        try {
          const models = await scanProviderModels(provider, { freeOnly: toBoolean(body.freeOnly) });
          const workingOnly = body.workingOnly !== false;
          const validation = workingOnly ? await validateWorkingModels(provider, models) : null;
          const updated = mutate((s) => {
            const target = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
            target.models = models;
            if (validation) {
              target.disabledModels = validation.disabled;
              target.modelErrors = validation.errors;
            } else {
              target.disabledModels = [];
              target.modelErrors = {};
            }
            const modelIds = models.map((model) => typeof model === "string" ? model : model.id).filter(Boolean);
            const activeModels = validation ? models.filter((model) => validation.active.includes(modelIdOf(model))) : models;
            const weakDefault = !target.defaultModel || !modelIds.includes(target.defaultModel) || (validation && !validation.active.includes(target.defaultModel)) || /default-model|^01-ai\/yi-large$/i.test(target.defaultModel);
            if (weakDefault) target.defaultModel = chooseLlmDefaultModel(target, activeModels);
            const detail = validation
              ? `Loaded ${validation.active.length}/${models.length} working ${body.freeOnly ? "free " : ""}models`
              : `Loaded ${models.length} ${body.freeOnly ? "free " : ""}models`;
            recordProviderHealth(s, providerId, providerHistoryEvent("scan", true, detail));
            return target;
          });
          send(res, 200, sanitizeProviderForClient(updated));
        } catch (error) {
          mutate((s) => recordProviderHealth(s, providerId, providerHistoryEvent("scan", false, error.message)));
          throw error;
        }
        return;
      }
      if (action === "clone") {
        const cloned = mutate((s) => {
          const source = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
          if (!source) throw new Error("Khong tim thay provider de clone");
          const copy = {
            ...source,
            id: id("llm"),
            name: `${source.name} copy`,
            enabled: false,
            healthHistory: []
          };
          s.catalogs.llmProviders.push(copy);
          return copy;
        });
        send(res, 200, sanitizeProviderForClient(cloned));
        return;
      }
      if (action === "oauth-start") {
        const oauthDefaults = llmProviderOAuthDefaults(provider.provider || provider.providerSpecificData?.catalogId || provider.id);
        const providerForOAuth = {
          ...provider,
          clientId: provider.clientId || oauthDefaults.clientId || "",
          clientSecret: provider.clientSecret || oauthDefaults.clientSecret || "",
          authUrl: provider.authUrl || oauthDefaults.authUrl || "",
          tokenUrl: provider.tokenUrl || oauthDefaults.tokenUrl || "",
          scopes: provider.scopes || oauthDefaults.scopes || "",
          redirectUri: (provider.provider === "openai-codex" ? oauthDefaults.redirectUri : provider.redirectUri) || oauthDefaults.redirectUri || provider.redirectUri || ""
        };
        const start = buildOAuthStart(providerForOAuth);
        if (start.codeVerifier) {
          mutate((s) => {
            const target = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
            target.clientId = providerForOAuth.clientId || target.clientId;
            target.clientSecret = providerForOAuth.clientSecret || target.clientSecret;
            target.authUrl = providerForOAuth.authUrl || target.authUrl;
            target.tokenUrl = providerForOAuth.tokenUrl || target.tokenUrl;
            target.scopes = providerForOAuth.scopes || target.scopes;
            target.redirectUri = start.redirectUri || target.redirectUri;
            target.providerSpecificData = {
              ...(target.providerSpecificData || {}),
              oauthCodeVerifier: start.codeVerifier
            };
            return target;
          });
        }
        const { codeVerifier, ...clientStart } = start;
        send(res, 200, clientStart);
        return;
      }
      if (action === "oauth-exchange") {
        const body = await readBody(req);
        const token = await exchangeOAuthCode(provider, body.code || body.oauthCode || "");
        const updated = mutate((s) => {
          const target = (s.catalogs.llmProviders || []).find((item) => item.id === providerId);
          target.accessToken = token.accessToken || target.accessToken || "";
          if (token.refreshToken) target.refreshToken = token.refreshToken;
          recordProviderHealth(s, providerId, providerHistoryEvent("oauth", true, "OAuth token updated"));
          return target;
        });
        send(res, 200, { provider: sanitizeProviderForClient(updated), token: { ...token, accessToken: token.accessToken ? "***saved***" : "", refreshToken: token.refreshToken ? "***saved***" : "" } });
        return;
      }
    }
  }

  const catalogMatch = pathname.match(/^\/api\/catalog\/([^/]+)(?:\/([^/]+))?(?:\/clone)?$/);
  if (catalogMatch) {
    const [, type, itemId] = catalogMatch;
    const isClone = pathname.endsWith("/clone");
    if (method === "POST" && isClone && itemId) {
      const cloned = mutate((state) => {
        const source = state.catalogs[type]?.find((item) => item.id === itemId);
        if (!source) throw new Error("Không tìm thấy item để clone");
        const copy = { ...source, id: id("clone"), name: `${source.name} copy` };
        state.catalogs[type].push(copy);
        return copy;
      });
      send(res, 200, cloned);
      return;
    }
    if (method === "POST") {
      send(res, 200, upsertCatalog(type, await readBody(req)));
      return;
    }
    if (method === "DELETE" && itemId) {
      mutate((state) => {
        state.catalogs[type] = (state.catalogs[type] || []).filter((item) => item.id !== itemId);
      });
      send(res, 200, { ok: true });
      return;
    }
  }

  const jobAction = pathname.match(/^\/api\/jobs\/([^/]+)\/(retry|cancel|clone|delete|open)$/);
  if (jobAction && method === "POST") {
    const [, jobId, action] = jobAction;
    if (action === "open") {
      const body = await readBody(req);
      const state = loadState();
      const job = state.jobs.find((item) => item.id === jobId);
      const historyItem = (state.history || []).find((item) => item.jobId === jobId);
      if (!job && !historyItem) throw new Error("Không tìm thấy job");
      const target = body.target || "folder";
      if (target === "video") openPath(job?.outputPath || historyItem?.outputPath);
      else if (target === "preview") openPath(job?.previewPath || historyItem?.previewPath);
      else openPath(jobOutputFolder(job || historyItem));
      send(res, 200, { ok: true });
      return;
    }
    const result = mutate((state) => {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error("Không tìm thấy job");
      if (action === "retry") {
        job.status = "queued";
        job.error = null;
        job.progress = 0;
        job.updatedAt = now();
        return job;
      }
      if (action === "cancel") {
        if (job.status === "running") {
          job.cancelRequested = true;
          job.updatedAt = now();
          job.logs = job.logs || [];
          job.logs.push({ at: now(), text: "Đã nhận yêu cầu huỷ. Render hiện tại sẽ dừng mềm khi tới điểm kết thúc an toàn." });
          return job;
        }
        job.status = "cancelled";
        job.cancelRequested = true;
        job.updatedAt = now();
        return job;
      }
      if (action === "delete") {
        if (job.status === "running") throw new Error("Job đang chạy, hãy cancel trước khi xoá");
        deleteJobFiles(job);
        state.jobs = state.jobs.filter((item) => item.id !== jobId);
        state.history = (state.history || []).filter((item) => item.jobId !== jobId);
        return { ok: true, deleted: [jobId] };
      }
      const clone = {
        ...job,
        id: id("job"),
        title: `${job.title} copy`,
        status: "queued",
        progress: 0,
        logs: [],
        error: null,
        cancelRequested: false,
        createdAt: now(),
        updatedAt: now()
      };
      delete clone.outputPath;
      delete clone.result;
      delete clone.workspace;
      delete clone.voicePath;
      delete clone.previewPath;
      delete clone.startedAt;
      delete clone.finishedAt;
      delete clone.sourceContext;
      delete clone.mediaAssets;
      delete clone.hyperWorkflow;
      state.jobs.push(clone);
      return clone;
    });
    send(res, 200, result);
    maybeStartQueue();
    return;
  }

  const fileMatch = pathname.match(/^\/api\/file\/(.+)$/);
  if (fileMatch && method === "GET") {
    const decoded = Buffer.from(fileMatch[1], "base64url").toString("utf8");
    sendFile(res, decoded);
    return;
  }

  send(res, 404, { error: "API not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);
    const method = req.method || "GET";

    if (pathname.startsWith("/api/") || pathname === "/auth/callback") {
      await handleApi(req, res, pathname, method);
      return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      send(res, 403, "Forbidden");
      return;
    }
    sendFile(res, filePath);
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  cleanTempWorkspaces();
  repairStaleRunningJobs();
  console.log(`Hypervideo running at http://localhost:${PORT}`);
  preloadVieNeuTts().then(() => {
    if (ttsStatus.ready) maybeStartQueue();
    else console.warn(ttsStatus.detail, ttsStatus.error);
  });
});
