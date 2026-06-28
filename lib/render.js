const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { now } = require("./store");
const { writeWithLlm } = require("./llm");

const ROOT = path.join(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT, "projects");
const TEMP_DIR = path.join(PROJECTS_DIR, "_temps");

function safeName(input) {
  return String(input || "video")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "video";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isMediaPath(filePath) {
  return /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i.test(filePath || "");
}

function isEvidenceMediaPath(filePath) {
  const target = String(filePath || "");
  if (!isMediaPath(target)) return false;
  if (/\/(?:audio|voices?|sounds?|samples?)\//i.test(target) && !/(screenshot|screen|demo|preview|video)/i.test(target)) return false;
  return true;
}

function mediaKind(filePath) {
  return /\.(mp4|webm|mov)$/i.test(filePath || "") ? "video" : "image";
}

function githubRepoFromLink(link) {
  try {
    const parsed = new URL(link);
    if (!/github\.com$/i.test(parsed.hostname)) return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

function firstValidUrl(links) {
  for (const link of links || []) {
    try {
      return new URL(link).toString();
    } catch {
      continue;
    }
  }
  return "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function htmlMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i");
  const match = String(html || "").match(pattern);
  return decodeHtmlEntities(match?.[1] || match?.[2] || "");
}

function htmlTitle(html) {
  const ogTitle = htmlMeta(html, "og:title") || htmlMeta(html, "twitter:title");
  if (ogTitle) return shortText(ogTitle, 110);
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return shortText(stripHtml(match?.[1] || ""), 110);
}

function extractWebPoints(html) {
  const blocks = [];
  const source = String(html || "");
  const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  for (const regex of [headingRegex, paragraphRegex]) {
    let match;
    while ((match = regex.exec(source))) {
      const text = stripHtml(match[1]);
      if (looksLikeNarrativeLine(text)) blocks.push(shortText(text, 150));
      if (blocks.length >= 10) break;
    }
    if (blocks.length >= 10) break;
  }
  const seen = new Set();
  return blocks.filter((item) => {
    const key = normalizeScriptKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "Hypervideo" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

async function downloadUrl(url, targetPath) {
  const response = await fetch(url, { headers: { "user-agent": "Hypervideo" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, body);
}

function cleanMarkdownLine(line) {
  return String(line || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
    .replace(/[`*_>#|]/g, "")
    .replace(/^\s*[-+•]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value, max = 150) {
  const text = cleanMarkdownLine(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function conciseText(value, maxWords = 12, maxChars = 82) {
  const text = cleanMarkdownLine(value);
  if (!text) return "";
  const sentence = splitTextBySentences(text)[0] || text;
  const words = sentence.split(/\s+/).filter(Boolean);
  let output = words.slice(0, maxWords).join(" ");
  if (output.length > maxChars) {
    output = output.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
  return output.replace(/[,;:–—-]+$/u, "").trim();
}

function displayName(value, fallback = "") {
  const raw = cleanMarkdownLine(value || fallback).replace(/[-_]+/g, " ").trim();
  if (!raw) return fallback;
  return raw
    .split(/\s+/)
    .map((word) => /^[a-z][a-z0-9]*$/i.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .join(" ");
}

function normalizeScriptKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateScriptLine(line, previousLines) {
  const key = normalizeScriptKey(line);
  if (!key) return true;
  const words = key.split(" ").filter((word) => word.length > 2);
  if (words.length < 3) return false;
  return previousLines.some((previous) => {
    const previousKey = normalizeScriptKey(previous);
    if (!previousKey) return false;
    if (previousKey === key) return true;
    const previousWords = previousKey.split(" ").filter((word) => word.length > 2);
    const previousSet = new Set(previousWords);
    const overlap = words.filter((word) => previousSet.has(word)).length;
    return words.length >= 6 && overlap / Math.max(words.length, previousWords.length) > 0.68;
  });
}

function looksLikeNarrativeLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  if (text.length < 28) return false;
  if (/^(supporting this project|table of contents|installation|usage|features?)$/i.test(text)) return false;
  if (/^(unity|unreal engine|godot|tier)\b/i.test(text)) return false;
  if (/^type\s+\//i.test(text)) return false;
  if (/\/[a-z0-9-]{2,}/i.test(text)) return false;
  if (/all three major engines|agent sets/i.test(text)) return false;
  if (/:\s*$/.test(text) && !/[.!?]/.test(text)) return false;
  if (/^(?:[a-z]+(?:-[a-z]+)?\s+){1,6}[a-z-]+$/i.test(text) && !/[.!?,:;]/.test(text)) return false;
  if (/^[A-Z][A-Za-z0-9/+ -]{0,20}$/.test(text) && !/[.!?,:;]/.test(text)) return false;
  const words = text.split(/\s+/);
  const longWords = words.filter((word) => word.length > 2);
  if (longWords.length < 5) return false;
  return true;
}

function extractReadmePoints(readme) {
  const lines = String(readme || "")
    .split(/\r?\n/)
    .filter((line) => !/<\/?\w+|align=|<h\d/i.test(line))
    .map(cleanMarkdownLine)
    .filter((line) => line.length > 24 && !/^https?:\/\//i.test(line))
    .filter((line) => !/badge|license|npm|build|coverage|screenshot|table of contents/i.test(line))
    .filter((line) => !/^[-=]{3,}$/.test(line))
    .filter((line) => !/(supporting this project|category count description)/i.test(line))
    .filter((line) => !/^tier\s+\d+/i.test(line))
    .filter((line) => !/^(creative-director|technical-director|producer)\b/i.test(line))
    .filter((line) => !/^(agents are organized into three tiers|audio-director|release-manager|game-designer|ui-designer|system-architect)\b/i.test(line))
    .filter((line) => !/^(?:[a-z]+(?:-[a-z]+)?\s+){2,}[a-z-]+$/i.test(line))
    .filter((line) => !/^\w+\s+\d+\s+\w+/i.test(line))
    .filter(looksLikeNarrativeLine);
  const seen = new Set();
  return lines
    .map((line) => shortText(line, 145))
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function extractReadmeMedia(readme, repo, branch) {
  const source = String(readme || "");
  const urls = [];
  const markdownImage = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlImage = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  for (const regex of [markdownImage, htmlImage]) {
    let match;
    while ((match = regex.exec(source))) {
      const raw = decodeHtmlEntities(match[1] || "").trim();
      if (!raw || /^data:/i.test(raw)) continue;
      if (/img\.shields\.io|trendshift\.io\/api\/badge/i.test(raw)) continue;
      if (!isEvidenceMediaPath(raw)) continue;
      const sourcePath = raw.replace(/^\.?\//, "");
      const mediaUrl = /^https?:\/\//i.test(raw)
        ? raw
        : `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${sourcePath}`;
      urls.push({ url: mediaUrl, sourcePath });
    }
  }
  const seen = new Set();
  return urls.filter((item) => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function sourceMediaScore(item) {
  const target = String(item?.sourcePath || item?.url || "");
  if (/\.(mp4|webm|mov)$/i.test(target)) return -8;
  if (/demo|sample|preview/i.test(target)) return -6;
  if (/screenshot|screen|app|landing|cover|hero/i.test(target)) return -5;
  if (/readme|docs|assets/i.test(target)) return -3;
  if (/logo|icon/i.test(target)) return -1;
  return 0;
}

function mediaCaptionFor(item, index = 0) {
  const target = String(item?.sourcePath || item?.url || "").toLowerCase();
  if (/\.(mp4|webm|mov)$/i.test(target)) return "Video demo từ nguồn";
  if (/screenshot|screen|app|landing/i.test(target)) return "Ảnh chụp giao diện thật";
  if (/hero|cover|preview/i.test(target)) return "Ảnh minh họa từ nguồn";
  if (/logo|icon/i.test(target)) return "Logo hoặc nhận diện dự án";
  return ["Dẫn chứng trực quan từ nguồn", "Minh họa từ dự án", "Bằng chứng hình ảnh"][index % 3];
}

function fallbackMediaCandidates(repo, branch) {
  const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}`;
  const repoName = repo.repo.replace(/[^a-z0-9-]/gi, "");
  const candidates = [
    `landing/public/${repoName}-demo.webm`,
    "landing/public/demo.webm",
    "landing/public/preview.webm",
    "public/demo.webm",
    "public/preview.webm",
    "docs/demo.webm",
    "landing/public/assets/app-screenshot-1.webp",
    "landing/public/assets/app-screenshot-2.webp",
    "landing/public/assets/app-screenshot-3.webp",
    ".github/assets/screenshot.webp",
    ".github/assets/preview.webp",
    "public/assets/screenshot.png",
    "public/assets/preview.png",
    `app/src/assets/${repoName}-logo.png`,
    "app/src/assets/logo.png"
  ];
  return candidates.map((sourcePath) => ({
    url: `${base}/${sourcePath}`,
    sourcePath,
    fallback: true
  }));
}

function vietnameseText(value, fallback = "Nội dung chính được tóm tắt rõ ràng để người xem nắm bắt nhanh.") {
  let text = cleanMarkdownLine(value || fallback);
  const replacements = [
    [/Turn Claude Code into a full game dev studio/gi, "Biến Claude Code thành một studio phát triển game đầy đủ"],
    [/Turn a single Claude Code session into a full game development studio/gi, "Biến một phiên Claude Code thành studio phát triển game hoàn chỉnh"],
    [/49 AI agents?,?\s*72 workflow skills?/gi, "49 tác nhân AI và 72 kỹ năng quy trình"],
    [/49 agents?\.?\s*73 skills?/gi, "49 agent và 73 kỹ năng"],
    [/complete coordination system mirroring real studio hierarchy/gi, "hệ thống phối hợp mô phỏng cấu trúc studio thật"],
    [/Claude Code Game Studios solves this by giving your AI session the structure of a real studio\. Instead of one general-purpose assistant, you…?/gi, "Dự án tổ chức phiên AI như một studio thật, thay vì chỉ dùng một trợ lý chung."],
    [/Claude Code Game Studios solves this by giving your AI session the structure of a real studio\.?/gi, "Dự án tổ chức phiên AI như một studio thật."],
    [/The result:\s*you still make every decision, but now you have a team that asks the right questions, catches mistakes early, and keeps your…?/gi, "Kết quả là bạn vẫn quyết định mọi thứ, nhưng có một đội AI hỗ trợ đặt đúng câu hỏi, phát hiện lỗi sớm và giữ tiến độ."],
    [/The result:\s*you still make every decision, but now you have a team that asks the right questions\.?/gi, "Kết quả là bạn vẫn quyết định mọi thứ, nhưng có một đội hỗ trợ đặt đúng câu hỏi."],
    [/one coordinated AI team/gi, "một đội AI phối hợp thống nhất"],
    [/game development studio/gi, "studio phát triển game"],
    [/workflow skills?/gi, "kỹ năng quy trình"],
    [/workflow/gi, "quy trình"],
    [/\bagents?\b/gi, "tác nhân"],
    [/AI team/gi, "đội AI"],
    [/full game dev studio/gi, "studio phát triển game đầy đủ"],
    [/Voicebox is a local-first AI voice studio/gi, "Voicebox là studio AI giọng nói chạy ưu tiên trên máy cá nhân"],
    [/The full\s+luồng xử lý giọng nói đầu vào và đầu ra,?\s*running locally on your machine\.?/gi, "Toàn bộ luồng xử lý giọng nói đầu vào và đầu ra chạy trên máy của bạn."],
    [/The full voice I\/O stack,?\s*running locally on your machine\.?/gi, "Toàn bộ luồng xử lý giọng nói đầu vào và đầu ra chạy trên máy của bạn."],
    [/a free and open-source alternative to \*?\*?ElevenLabs\*?\*? and \*?\*?WisprFlow\*?\*?/gi, "một lựa chọn miễn phí, mã nguồn mở thay cho ElevenLabs và WisprFlow"],
    [/in one app\.?\s*Clone voices? from a few…?/gi, "trong một ứng dụng. Có thể clone giọng từ vài mẫu ngắn."],
    [/in one app\.?/gi, "trong một ứng dụng."],
    [/Clone voices? from a few…?/gi, "Có thể clone giọng từ vài mẫu ngắn."],
    [/The two cloud incumbents sit on opposite halves of the voice I\/O loop/gi, "Hai nhóm công cụ đám mây thường chia đôi luồng giọng nói"],
    [/ElevenLabs on output, WisprFlow on input/gi, "ElevenLabs thiên về đầu ra, WisprFlow thiên về đầu vào"],
    [/Voicebox does both, bridges…?/gi, "Voicebox gom cả hai phần vào một luồng."],
    [/voice I\/O stack/gi, "luồng xử lý giọng nói đầu vào và đầu ra"],
    [/local-first/gi, "ưu tiên chạy trên máy cá nhân"],
    [/open-source/gi, "mã nguồn mở"],
    [/Clone any voice\.?\s*Generate speech\.?\s*Dictate into any app\.?/gi, "Nhân bản giọng nói, tạo giọng đọc từ văn bản và đọc chính tả vào nhiều ứng dụng."],
    [/\bclone(?:d|s|ing)?\b/gi, "nhân bản"],
    [/\bdictate\b/gi, "đọc chính tả"],
    [/\btest\b/gi, "kiểm tra"],
    [/The full voice I\/O stack, running locally on your machine\.?/gi, "Toàn bộ luồng xử lý giọng nói đầu vào và đầu ra chạy trên máy của bạn."],
    [/Complete privacy/gi, "Quyền riêng tư đầy đủ"],
    [/models, voice data, and captures never leave your machine/gi, "mô hình, dữ liệu giọng nói và bản ghi không rời khỏi máy của bạn"],
    [/Voice cloning and preset voices/gi, "Nhân bản giọng nói và dùng giọng có sẵn"],
    [/23 languages/gi, "23 ngôn ngữ"],
    [/Runs everywhere/gi, "Chạy trên nhiều nền tảng"],
    [/Native performance/gi, "Hiệu năng tối ưu trên máy"]
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .replace(/,\s*and a\s+/gi, " và ")
    .replace(/\.\s*one /gi, ". Một ")
    .replace(/\bclaim\b/gi, "điểm khẳng định")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/([,;:])([.!?…])/g, "$2")
    .replace(/([.!?…])\.+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[\x00-\x7F]+$/.test(text) && /[a-z]{4,}/i.test(text)) {
    return fallback;
  }
  return text;
}

function normalizeVietnameseSpeechText(value) {
  let text = String(value || "");
  const small = [
    "không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín",
    "mười", "mười một", "mười hai", "mười ba", "mười bốn", "mười lăm",
    "mười sáu", "mười bảy", "mười tám", "mười chín"
  ];
  const underHundred = (num) => {
    if (num < 20) return small[num];
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    if (!ones) return `${small[tens]} mươi`;
    if (ones === 1) return `${small[tens]} mươi mốt`;
    if (ones === 5) return `${small[tens]} mươi lăm`;
    return `${small[tens]} mươi ${small[ones]}`;
  };
  const underThousand = (num) => {
    if (num < 100) return underHundred(num);
    const hundreds = Math.floor(num / 100);
    const rest = num % 100;
    if (!rest) return `${small[hundreds]} trăm`;
    if (rest < 10) return `${small[hundreds]} trăm lẻ ${small[rest]}`;
    return `${small[hundreds]} trăm ${underHundred(rest)}`;
  };
  const numberToVietnamese = (num) => {
    if (!Number.isFinite(num)) return "";
    if (num < 1000) return underThousand(num);
    if (num < 1000000) {
      const thousands = Math.floor(num / 1000);
      const rest = num % 1000;
      return `${numberToVietnamese(thousands)} nghìn${rest ? ` ${underThousand(rest)}` : ""}`;
    }
    const millions = Math.floor(num / 1000000);
    const rest = num % 1000000;
    return `${numberToVietnamese(millions)} triệu${rest ? ` ${numberToVietnamese(rest)}` : ""}`;
  };
  text = text.replace(/\b(\d{1,3}(?:[.,]\d{3})+)\b/g, (match) => {
    const num = Number(match.replace(/[.,]/g, ""));
    return numberToVietnamese(num) || match;
  });
  text = text.replace(/\b(\d+)%/g, (_, digits) => `${numberToVietnamese(Number(digits)) || digits} phần trăm`);
  text = text.replace(/\b(\d{1,4})\b/g, (match, digits, offset, whole) => {
    const previous = whole[offset - 1] || "";
    const next = whole[offset + match.length] || "";
    if (/[./:_-]/.test(previous) || /[./:_-]/.test(next)) return match;
    const num = Number(digits);
    if (!Number.isInteger(num) || num < 0 || num > 9999) return match;
    return numberToVietnamese(num) || match;
  });
  return text;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      options.onLog?.(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      options.onLog?.(chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr || stdout}`));
    });
  });
}

function hashText(value) {
  let hash = 2166136261;
  for (const ch of String(value || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickBySeed(items, seed, offset = 0) {
  return items.length ? items[(seed + offset) % items.length] : "";
}

function contentKind(source, job) {
  const text = [
    source.name,
    source.description,
    source.language,
    ...(source.topics || []),
    ...(source.points || []),
    job.topic
  ].join(" ").toLowerCase();
  if (/tts|voice|audio|speech|clone|giọng|âm thanh/.test(text)) return "voice";
  if (/video|render|ffmpeg|remotion|hyperframe|media|creator/.test(text)) return "creator";
  if (/agent|workflow|automation|cli|developer|code|github|api|sdk/.test(text)) return "devtool";
  if (/business|sale|crm|shop|marketing|landing|customer/.test(text)) return "business";
  return "general";
}

const TITLE_STYLE_FAMILIES = [
  ["straight-value", "GIÁ TRỊ", "{name}: đáng chú ý ở điểm nào?", "Nếu chỉ nhìn lướt, {name} có vẻ như một {sourceType} bình thường. Nhưng điểm đáng xem là cách nó giải quyết {promise}."],
  ["problem-first", "VẤN ĐỀ", "Vấn đề không nằm ở công cụ", "Vấn đề là quy trình thường rời rạc: ý tưởng, thao tác và kết quả không nối với nhau. {name} cố gắng gom phần đó thành một luồng dễ kiểm soát hơn."],
  ["contrarian", "GÓC NHÌN", "Đừng chỉ nhìn vào tính năng", "Điểm quan trọng không phải là {name} có bao nhiêu tính năng, mà là nó giúp người dùng đi từ nhu cầu đến kết quả nhanh hơn như thế nào."],
  ["before-after", "TRƯỚC SAU", "Trước thì thủ công, sau thì có luồng", "Trước đây bạn phải tự nối nhiều bước. Với {name}, phần đáng chú ý là cách các bước được đóng gói thành một trải nghiệm rõ hơn."],
  ["number-led", "CON SỐ", "{metric}", "{metric} là tín hiệu đáng chú ý. Nó không chỉ giới thiệu ý tưởng, mà đưa ra một cách tổ chức công việc cụ thể."],
  ["question-open", "CÂU HỎI", "Có nên thử không?", "Câu hỏi không phải là {name} có mới hay không. Câu hỏi đúng hơn là: nó có giúp tiết kiệm bước, giảm rối và ra kết quả nhanh hơn không?"],
  ["hidden-cost", "CHI PHÍ ẨN", "Thứ tốn thời gian nhất thường bị bỏ qua", "Thứ tốn thời gian không chỉ là tạo đầu ra. Đó là giữ mọi bước đi đúng hướng. {name} nhắm vào điểm nghẽn này."],
  ["use-case-first", "ỨNG DỤNG", "Dùng khi cần ra kết quả nhanh", "Nếu bạn cần biến một ý tưởng thành đầu ra có thể xem, nghe hoặc kiểm tra ngay, {name} là kiểu công cụ đáng đưa vào quy trình."],
  ["trust-signal", "TIN CẬY", "Điểm đáng tin nằm ở cấu trúc", "{name} đáng chú ý vì nó không chỉ hứa hẹn. Nó có cấu trúc, có ngữ cảnh nguồn và có cách biến thông tin thành đầu ra rõ ràng."],
  ["workflow-angle", "QUY TRÌNH", "Một quy trình tốt hơn một mẹo lẻ", "Một mẹo đơn lẻ có thể gây ấn tượng, nhưng quy trình mới tạo giá trị lặp lại. {name} đi theo hướng xây một luồng làm việc rõ hơn."],
  ["creator-hook", "SÁNG TẠO", "Nội dung hay bắt đầu từ cấu trúc", "{name} cho thấy một điều: muốn nội dung hấp dẫn, không chỉ cần hiệu ứng. Cần có mở đầu rõ, bằng chứng, nhịp kể và lời kêu gọi đúng lúc."],
  ["voice-hook", "GIỌNG NÓI", "Âm thanh tốt chưa đủ", "Âm thanh rõ là bước đầu. Nhưng với {name}, giá trị thật nằm ở việc giọng đọc, phụ đề và hình ảnh cùng đi theo một mạch nội dung."],
  ["skeptic-open", "NGHI NGỜ", "Nghe có vẻ hay, nhưng có đáng dùng?", "Không phải {sourceType} nào cũng đáng đưa vào quy trình. {name} đáng xem vì nó chạm vào một nhu cầu cụ thể: {promise}."],
  ["one-sentence", "TÓM TẮT", "{name}, nói gọn là gì?", "Nói ngắn gọn: {name} là một cách biến thông tin rời rạc thành quy trình dễ hiểu hơn, dễ thử hơn và dễ đánh giá hơn."],
  ["why-now", "BÂY GIỜ", "Vì sao nên để ý lúc này?", "Khi công cụ AI ngày càng nhiều, thứ tạo khác biệt là cách phối hợp. {name} đáng chú ý vì tập trung vào luồng làm việc, không chỉ vào một tính năng đơn lẻ."],
  ["mistake-avoid", "TRÁNH LỖI", "Sai lầm là chỉ ghép mọi thứ lại", "Ghép nhiều bước không tự tạo ra sản phẩm tốt. {name} chỉ có giá trị khi mỗi bước xuất hiện đúng lúc và phục vụ một thông điệp rõ."],
  ["operator-view", "VẬN HÀNH", "Nhìn như người vận hành", "Từ góc nhìn vận hành, {name} đáng chú ý nếu nó giảm thao tác lặp, giữ lịch sử rõ và giúp kết quả có thể kiểm tra lại."],
  ["builder-view", "XÂY HỆ THỐNG", "Dành cho người muốn xây hệ thống", "{name} không chỉ là thứ để xem qua. Nó phù hợp hơn với người muốn hiểu cấu trúc, chỉnh quy trình và biến nó thành công cụ dùng thật."],
  ["fast-demo", "DEMO", "Một demo nhanh phải trả lời đúng câu hỏi", "Người xem không cần biết mọi chi tiết. Họ cần hiểu {name} giúp gì, khác gì và có nên thử ngay không."],
  ["source-proof", "KIỂM CHỨNG", "Bắt đầu từ chi tiết có thể kiểm tra", "Điểm tốt là nội dung không cần bịa thêm. Từ {name}, ta có thể kéo ra vấn đề, bằng chứng và lời kêu gọi hành động rõ hơn."],
  ["pain-relief", "GIẢM ĐAU", "Giảm một việc gây mệt", "{name} đáng xem nếu nó giúp bỏ bớt việc thủ công: đọc, gom ý, trình bày và chuyển thành đầu ra có thể dùng."],
  ["quality-bar", "CHẤT LƯỢNG", "Chuyển động thôi chưa đủ", "Hiệu ứng chỉ giữ mắt người xem. Điều làm {name} thuyết phục là logic rõ: mở đúng vấn đề, đưa bằng chứng, rồi kết bằng hành động cụ thể."],
  ["comparison", "SO SÁNH", "Khác biệt nằm ở cách nối các bước", "So với cách làm rời rạc, {name} đáng chú ý nếu nó giúp các bước nối liền nhau: từ nguồn, thành ý, thành hình, thành kết quả."],
  ["decision-frame", "QUYẾT ĐỊNH", "Có đáng đưa vào quy trình không?", "Để quyết định, hãy nhìn vào ba thứ: {name} giải quyết gì, bằng chứng có rõ không, và đầu ra có dễ kiểm tra không."],
  ["simple-truth", "SỰ THẬT", "Sự thật đơn giản", "Một công cụ tốt không cần nói quá nhiều. {name} chỉ cần chứng minh rằng nó làm một việc cụ thể tốt hơn cách cũ."],
  ["anti-hype", "TỈNH TÁO", "Bỏ lời quảng bá, nhìn vào kết quả", "Đừng đánh giá {name} bằng lời quảng bá. Hãy nhìn nó có tạo ra kết quả rõ hơn, nhanh hơn và ít lỗi hơn không."],
  ["step-by-step", "TỪNG BƯỚC", "Giá trị nằm ở từng bước nhỏ", "{name} trở nên thuyết phục khi mỗi bước đều có vai trò: lấy nguồn, chọn ý, tạo nhịp, gắn giọng đọc và kết thúc bằng hành động."],
  ["audience-first", "NGƯỜI XEM", "Người xem cần hiểu ngay", "Nếu người xem mất quá lâu để hiểu {name}, video đã thất bại. Mở đầu phải rõ, bằng chứng phải nhanh và lời kêu gọi phải tự nhiên."],
  ["risk-first", "RỦI RO", "Rủi ro là làm nhiều mà không rõ", "{name} chỉ đáng dùng nếu nó giảm sự mơ hồ. Nội dung cần cho thấy nó giải quyết điểm nào, không chỉ liệt kê tính năng."],
  ["outcome-first", "KẾT QUẢ", "Bắt đầu từ kết quả cuối", "Kết quả người dùng muốn không phải là thêm một {sourceType}. Họ muốn có một cách làm nhanh hơn, rõ hơn và có thể lặp lại với {name}."],
  ["expert-note", "GHI CHÚ", "Một điểm người làm sản phẩm sẽ để ý", "{name} đáng chú ý ở khả năng biến logic kỹ thuật thành trải nghiệm người dùng. Đây là thứ nhiều demo thường bỏ qua."],
  ["short-form-rule", "VIDEO NGẮN", "Thông điệp cần một đường thẳng", "Với {name}, nội dung ngắn không nên ôm quá nhiều ý. Chỉ cần một đường thẳng: vấn đề, bằng chứng, lợi ích, phản biện, lời kêu gọi."],
  ["tool-stack", "BỘ CÔNG CỤ", "Một mảnh trong bộ công cụ làm việc", "{name} nên được nhìn như một mảnh trong bộ công cụ: nó nhận nguồn vào, xử lý thành cấu trúc và giúp đầu ra dễ kiểm tra hơn."],
  ["credibility", "ĐỘ TIN", "Thuyết phục bằng độ rõ", "Điểm làm {name} đáng tin không phải câu chữ mạnh. Đó là thông điệp rõ, bằng chứng cụ thể và lời kết không phóng đại."],
  ["small-team", "NHÓM NHỎ", "Hợp với nhóm nhỏ cần tốc độ", "Với nhóm nhỏ, giá trị của {name} nằm ở tốc độ thử nghiệm: ít bước hơn, ít phụ thuộc hơn và kết quả dễ xem lại hơn."],
  ["final-push", "ĐIỂM CHỐT", "Điểm chốt nằm ở cách kể", "{name} có thể không cần kể dài. Điều cần là chọn đúng góc nhìn, đưa bằng chứng đúng lúc và kết bằng một hành động rõ."]
];

const STYLE_IDS_BY_KIND = {
  devtool: ["workflow-angle", "builder-view", "tool-stack", "expert-note", "step-by-step", "source-proof", "anti-hype", "operator-view", "risk-first", "trust-signal", "why-now", "decision-frame"],
  creator: ["creator-hook", "quality-bar", "short-form-rule", "audience-first", "fast-demo", "mistake-avoid", "outcome-first", "before-after", "use-case-first", "source-proof"],
  voice: ["voice-hook", "use-case-first", "quality-bar", "anti-hype", "step-by-step", "mistake-avoid", "audience-first", "credibility"],
  business: ["pain-relief", "small-team", "operator-view", "decision-frame", "risk-first", "before-after", "hidden-cost", "credibility", "skeptic-open"],
  general: ["straight-value", "one-sentence", "question-open", "simple-truth", "credibility", "final-push", "source-proof", "comparison"]
};

const USER_WRITING_STYLE_MAP = {
  "source-proof": ["source-proof", "credibility", "trust-signal"],
  "problem-first": ["problem-first", "pain-relief", "hidden-cost"],
  "question-open": ["question-open", "skeptic-open", "why-now"],
  "outcome-first": ["outcome-first", "straight-value", "quality-bar"],
  "quick-compare": ["comparison", "before-after", "decision-frame"],
  "anti-hype": ["anti-hype", "risk-first", "simple-truth"],
  "step-by-step": ["step-by-step", "operator-view", "workflow-angle"],
  "creator-story": ["creator-hook", "pain-relief", "before-after"],
  "data-led": ["number-led", "quality-bar", "short-form-rule"],
  "trust-review": ["trust-signal", "credibility", "risk-first"],
  "direct-cta": ["final-push", "fast-demo", "short-form-rule"],
  "myth-buster": ["skeptic-open", "anti-hype", "simple-truth"],
  "risk-first": ["risk-first", "decision-frame", "anti-hype"],
  checklist: ["step-by-step", "quality-bar", "short-form-rule"],
  "use-case": ["use-case-first", "operator-view", "straight-value"],
  "demo-narrative": ["fast-demo", "operator-view", "workflow-angle"],
  "why-now": ["why-now", "question-open", "outcome-first"],
  "beginner-friendly": ["one-sentence", "audience-first", "step-by-step"],
  "technical-proof": ["expert-note", "source-proof", "credibility"],
  "local-first": ["trust-signal", "risk-first", "credibility"],
  "decision-guide": ["decision-frame", "simple-truth", "comparison"],
  "short-review": ["credibility", "anti-hype", "decision-frame"],
  "story-contrast": ["before-after", "creator-hook", "pain-relief"]
};

const USER_WRITING_STYLE_PROFILES = {
  "source-proof": {
    label: "Dẫn chứng trước",
    opening: "Từ thông tin công khai của {name}, có một điểm đáng kiểm tra trước: {promise}.",
    counter: "Điểm cần tỉnh táo là bằng chứng chỉ nên được đọc trong đúng ngữ cảnh nguồn. Nếu nguồn chưa chứng minh một ý, nội dung không nên nói quá.",
    ctas: [
      "Nếu muốn tự kiểm chứng, hãy lưu {actionTarget}, xem phần nguồn chính và thử trên một tình huống nhỏ.",
      "Lưu nguồn này lại nếu bạn cần một ví dụ có thể kiểm tra, không chỉ một lời giới thiệu."
    ]
  },
  "problem-first": {
    label: "Vấn đề trước",
    opening: "Vấn đề không nằm ở việc thiếu thêm công cụ. Vấn đề là người dùng đang mất quá nhiều bước để đi từ ý tưởng tới kết quả.",
    counter: "Tất nhiên, {name} không tự làm thay toàn bộ quyết định. Nó chỉ đáng giá nếu thật sự giảm được một điểm nghẽn trong quy trình.",
    ctas: [
      "Nếu bạn cũng đang kẹt ở điểm đó, hãy lưu {actionTarget} và thử với một việc nhỏ trước.",
      "Hãy thử {name} khi bạn cần giảm bớt một đoạn thao tác lặp lại, không phải khi chỉ muốn thêm một công cụ cho vui."
    ]
  },
  "question-open": {
    label: "Câu hỏi gây tò mò",
    opening: "Nếu chỉ được hỏi một câu về {name}, câu hỏi nên là: nó thật sự giúp người xem làm nhanh hơn ở bước nào?",
    counter: "Câu trả lời không nên dựa vào cảm giác mới lạ. Hãy nhìn vào nguồn, vào minh họa, và vào kết quả có thể kiểm tra.",
    ctas: [
      "Lưu lại để tự trả lời câu hỏi đó với trường hợp sử dụng của bạn.",
      "Nếu câu hỏi này đúng với việc bạn đang làm, hãy mở {actionTarget} và kiểm tra ngay."
    ]
  },
  "outcome-first": {
    label: "Kết quả trước",
    opening: "Kết quả người xem cần là một cách làm rõ hơn, nhanh hơn và ít phụ thuộc hơn khi dùng {name}.",
    counter: "Nhưng kết quả chỉ có ý nghĩa khi điều kiện dùng phù hợp. Nếu quy trình của bạn khác quá xa, hãy thử nhỏ trước khi đưa vào việc chính.",
    ctas: [
      "Nếu kết quả này đúng thứ bạn đang cần, hãy lưu {actionTarget} và thử một lượt ngắn.",
      "Đừng áp dụng ngay vào việc lớn. Hãy thử {name} trên một đầu việc nhỏ trước."
    ]
  },
  "quick-compare": {
    label: "So sánh nhanh",
    opening: "Cách cũ là làm từng phần rời rạc. Điểm đáng xem của {name} là nó có thể nối các bước đó thành một luồng dễ kiểm soát hơn.",
    counter: "So sánh công bằng là không hỏi nó có thay mọi thứ không, mà hỏi nó thay được đoạn nào rõ nhất.",
    ctas: [
      "Nếu đoạn khác biệt này hữu ích, hãy lưu {actionTarget} và thử so sánh với quy trình hiện tại của bạn.",
      "Hãy dùng {name} như một bài test trước sau: mất bao lâu, rõ hơn không, và có dễ sửa không."
    ]
  },
  "anti-hype": {
    label: "Phản quảng bá",
    opening: "Đừng nhìn {name} như một lời hứa quá lớn. Hãy nhìn nó như một thứ cần được kiểm tra bằng kết quả thật.",
    counter: "Điểm cần tỉnh táo là hãy thử bằng một đầu việc nhỏ trước. Nếu kết quả không rõ hơn cách cũ, bạn không cần đưa nó vào quy trình.",
    ctas: [
      "Nếu bạn thích cách đánh giá tỉnh táo, hãy lưu {actionTarget} và tự kiểm chứng.",
      "Thử {name} khi bạn có tiêu chí rõ, không phải khi chỉ bị cuốn theo lời quảng bá."
    ]
  },
  "step-by-step": {
    label: "Từng bước",
    opening: "Cách hiểu nhanh nhất về {name} là đi theo từng bước: đầu vào là gì, xử lý ra sao, và kết quả kiểm tra ở đâu.",
    counter: "Nếu một bước chưa rõ, đừng bỏ qua. Hãy kiểm tra điều kiện cần có trước khi thử thật.",
    ctas: [
      "Lưu lại quy trình này, rồi thử từng bước với dữ liệu của bạn.",
      "Bắt đầu nhỏ: mở {actionTarget}, chạy bước đầu tiên, và xem kết quả có đủ rõ không."
    ]
  },
  "creator-story": {
    label: "Câu chuyện người sáng tạo",
    opening: "Câu chuyện bắt đầu rất quen: có ý tưởng, có công cụ, nhưng để biến nó thành sản phẩm dùng được thì quy trình lại bị vỡ nhịp.",
    counter: "Không có công cụ nào thay thế được gu và quyết định của người sáng tạo. Nhưng một quy trình tốt có thể giúp bạn ít mất nhịp hơn.",
    ctas: [
      "Nếu câu chuyện này giống việc bạn đang làm, hãy lưu {actionTarget} và thử trên một ý tưởng nhỏ.",
      "Hãy xem {name} như một trợ lý giữ nhịp, rồi tự quyết nó có đáng ở lại trong bộ công cụ của bạn không."
    ]
  },
  "data-led": {
    label: "Số liệu dẫn dắt",
    opening: "Tín hiệu quan trọng nhất là {metricOrSignal}. Từ đó, người xem hiểu vì sao {name} đáng chú ý.",
    counter: "Nhưng điểm neo chỉ là phần mở đầu. Điều quan trọng là nó chuyển thành lợi ích cụ thể nào trong quy trình.",
    ctas: [
      "Nếu tín hiệu này đáng kiểm tra, hãy lưu {actionTarget} và xem nó có đúng với trường hợp sử dụng của bạn không.",
      "Dùng {name} như một phép thử: điểm neo có dẫn tới kết quả thật, hay chỉ là tín hiệu ban đầu."
    ]
  },
  "trust-review": {
    label: "Review niềm tin",
    opening: "Với {name}, câu hỏi quan trọng không chỉ là làm được gì, mà là dữ liệu ở đâu và người dùng kiểm soát được gì.",
    counter: "Niềm tin không đến từ lời khẳng định tuyệt đối. Nó đến từ nguồn rõ, giới hạn rõ và quyền kiểm tra nằm ở người dùng.",
    ctas: [
      "Nếu quyền kiểm soát là thứ bạn cần, hãy lưu {actionTarget} và kiểm tra kỹ phần chạy trên máy, dữ liệu và quyền riêng tư.",
      "Hãy thử {name} theo tiêu chí niềm tin trước: dữ liệu, quyền kiểm soát và rủi ro còn lại."
    ]
  },
  "direct-cta": {
    label: "Chốt hành động",
    opening: "{name} đáng được xem nhanh nếu bạn cần một cách rút ngắn quy trình mà vẫn giữ được đầu ra rõ ràng.",
    counter: "Đừng dùng nó vì nghe hấp dẫn. Dùng nó khi bạn thấy một bước cụ thể có thể được làm nhanh hơn.",
    ctas: [
      "Mở {actionTarget}, thử một lượt ngắn, rồi quyết định có giữ nó trong quy trình không.",
      "Nếu đúng nhu cầu, lưu lại và thử ngay trên việc bạn đang làm hôm nay."
    ]
  },
  "myth-buster": {
    label: "Đập hiểu lầm",
    opening: "Hiểu lầm dễ gặp về {name} là nó chỉ thêm một lớp tính năng cho vui. Điểm đáng kiểm tra nằm ở chỗ nó xử lý được một nhu cầu thật: {promise}.",
    counter: "Nếu nguồn chưa chứng minh đủ, video phải nói rõ phần nào là bằng chứng và phần nào là diễn giải.",
    ctas: [
      "Hãy lưu {actionTarget}, kiểm tra lại nguồn và tự xem hiểu lầm đó có đúng với trường hợp của bạn không.",
      "Nếu bạn từng nghĩ công cụ này không đáng thử, hãy kiểm chứng bằng một việc nhỏ trước."
    ]
  },
  "risk-first": {
    label: "Rủi ro trước",
    opening: "Trước khi nói {name} hay ở đâu, cần nói điểm phải cẩn trọng: công cụ chỉ hữu ích khi nó làm rõ quy trình, không làm người dùng phụ thuộc mù mờ.",
    counter: "Rủi ro lớn nhất là dùng vì nghe mới. Cách đúng là thử nhỏ, đo kết quả, rồi mới đưa vào việc chính.",
    ctas: [
      "Nếu chấp nhận cách kiểm tra này, hãy lưu {actionTarget} và thử trên một dữ liệu không quan trọng trước.",
      "Đừng triển khai rộng ngay. Hãy dùng {name} như một bài test có tiêu chí rõ."
    ]
  },
  checklist: {
    label: "Checklist nhanh",
    opening: "Muốn hiểu nhanh {name}, hãy kiểm tra ba câu hỏi: nó nhận đầu vào gì, tạo ra kết quả nào và bằng chứng nằm ở đâu.",
    counter: "Checklist tốt không thay thế trải nghiệm thật. Nó chỉ giúp bạn biết nên thử tiếp hay dừng lại.",
    ctas: [
      "Lưu checklist này, mở {actionTarget}, rồi kiểm tra từng mục bằng dữ liệu của bạn.",
      "Nếu ba mục này đều rõ, {name} đáng được thử thêm một lượt."
    ]
  },
  "use-case": {
    label: "Tình huống sử dụng",
    opening: "Đặt {name} vào một tình huống cụ thể: người dùng có một nguồn đầu vào, muốn có kết quả rõ hơn, và không muốn tốn quá nhiều bước trung gian.",
    counter: "Không phải tình huống nào cũng hợp. Nếu quy trình của bạn không có điểm nghẽn này, lợi ích sẽ không rõ.",
    ctas: [
      "Hãy lưu {actionTarget} và thử đúng một tình huống giống việc bạn đang làm.",
      "Nếu tình huống này quen thuộc, {name} đáng được kiểm tra bằng một thử nghiệm ngắn."
    ]
  },
  "demo-narrative": {
    label: "Demo theo cảnh",
    opening: "Một demo ngắn về {name} nên đi thẳng vào bốn việc: mở nguồn, nhìn thao tác, xem kết quả, rồi quyết định có đáng dùng không.",
    counter: "Một demo tốt không cần nói quá nhiều. Nó cần cho thấy thao tác đúng lúc và kết quả đủ rõ để người xem tự đánh giá.",
    ctas: [
      "Lưu {actionTarget}, chạy thử một demo nhỏ và xem kết quả có đủ thuyết phục không.",
      "Nếu demo giải quyết đúng bước bạn đang kẹt, hãy thử {name} trước khi tìm thêm công cụ khác."
    ]
  },
  "why-now": {
    label: "Vì sao lúc này",
    opening: "Lý do {name} đáng chú ý lúc này không phải vì nó mới, mà vì người dùng đang cần quy trình ngắn hơn, rõ hơn và kiểm soát tốt hơn.",
    counter: "Nhưng đúng thời điểm không có nghĩa là phù hợp với mọi người. Hãy đối chiếu với nhu cầu thật của bạn.",
    ctas: [
      "Nếu nhu cầu này đang xuất hiện trong quy trình của bạn, hãy lưu {actionTarget} và thử ngay một lượt.",
      "Hãy kiểm tra {name} bằng câu hỏi đơn giản: nó có giúp bạn làm rõ một bước ngay hôm nay không?"
    ]
  },
  "beginner-friendly": {
    label: "Dành cho người mới",
    opening: "Nếu mới biết {name}, hãy hiểu đơn giản thế này: nó giúp biến một nhu cầu rời rạc thành các bước dễ thử hơn.",
    counter: "Người mới không cần học hết mọi chi tiết. Nhưng cần biết điều kiện tối thiểu để thử không bị sai kỳ vọng.",
    ctas: [
      "Lưu {actionTarget}, bắt đầu từ bước nhỏ nhất và chỉ mở rộng khi kết quả đã rõ.",
      "Nếu bạn mới làm quen, hãy thử {name} bằng ví dụ đơn giản trước."
    ]
  },
  "technical-proof": {
    label: "Bằng chứng kỹ thuật",
    opening: "Chi tiết kỹ thuật chỉ có giá trị khi dịch được thành lợi ích rõ. Với {name}, điểm cần nói là chi tiết nguồn chứng minh điều gì cho người dùng.",
    counter: "Đừng bê nguyên thuật ngữ ra màn hình. Hãy chuyển nó thành ý nghĩa, tác động và giới hạn.",
    ctas: [
      "Nếu bạn cần kiểm chứng kỹ hơn, hãy lưu {actionTarget} và đối chiếu từng chi tiết trong nguồn.",
      "Hãy xem nguồn trước, rồi quyết định {name} có đủ cơ sở để thử không."
    ]
  },
  "local-first": {
    label: "Local-first",
    opening: "Điểm đáng chú ý của {name} là câu hỏi dữ liệu: cái gì chạy trên máy, cái gì rời khỏi máy và người dùng kiểm soát được phần nào.",
    counter: "Local-first không tự động đồng nghĩa với tốt hơn. Nó tốt hơn khi quyền kiểm soát thật sự rõ và tốc độ vẫn đủ dùng.",
    ctas: [
      "Nếu bạn quan tâm dữ liệu và quyền riêng tư, hãy lưu {actionTarget} rồi kiểm tra phần chạy local trước.",
      "Hãy thử {name} với tiêu chí rõ: dữ liệu, tốc độ và quyền kiểm soát."
    ]
  },
  "decision-guide": {
    label: "Có nên dùng không",
    opening: "Câu hỏi chính không phải {name} có hay không. Câu hỏi là: có nên đưa nó vào quy trình của bạn không.",
    counter: "Không nên dùng nếu lợi ích chỉ nằm trên lời giới thiệu. Nên dùng khi một bước cụ thể được rút ngắn hoặc rõ hơn.",
    ctas: [
      "Lưu {actionTarget}, thử một việc nhỏ, rồi tự quyết nó có xứng đáng ở lại không.",
      "Hãy dùng {name} như một bài kiểm tra quyết định, không phải một lựa chọn mặc định."
    ]
  },
  "short-review": {
    label: "Review ngắn",
    opening: "Review nhanh về {name}: điểm mạnh là {promise}; điều cần kiểm tra là nguồn có đủ bằng chứng cho nhu cầu của bạn không.",
    counter: "Một review công bằng phải có cả điểm nên thử và điểm cần thận trọng.",
    ctas: [
      "Nếu phần mạnh đúng nhu cầu của bạn, hãy lưu {actionTarget} và tự kiểm tra phần còn lại.",
      "Hãy thử {name} như một lựa chọn có điều kiện, không phải lời khuyên chung cho mọi người."
    ]
  },
  "story-contrast": {
    label: "Tương phản câu chuyện",
    opening: "Trước đây, người dùng phải nối nhiều bước rời rạc. Với {name}, câu chuyện đáng kể là cách các bước đó có thể liền mạch hơn.",
    counter: "Tương phản chỉ thuyết phục khi có bằng chứng. Nếu không thấy rõ khác biệt trước và sau, video không nên nói quá.",
    ctas: [
      "Lưu {actionTarget}, so sánh trước và sau bằng chính quy trình của bạn.",
      "Nếu khác biệt đủ rõ, {name} đáng được thử tiếp trong một dự án nhỏ."
    ]
  }
};

const COMBO_WRITING_STYLE_IDS = {
  "repo-launch-dynamic": ["question-open", "source-proof", "why-now", "outcome-first", "problem-first", "direct-cta"],
  "evidence-explainer": ["source-proof", "technical-proof", "anti-hype", "trust-review", "question-open", "myth-buster"],
  "infographic-cta": ["data-led", "checklist", "outcome-first", "quick-compare", "direct-cta"],
  "app-demo-flow": ["demo-narrative", "step-by-step", "use-case", "outcome-first", "source-proof", "question-open"],
  "privacy-trust-review": ["local-first", "trust-review", "risk-first", "anti-hype", "source-proof", "quick-compare"],
  "quick-compare": ["quick-compare", "story-contrast", "decision-guide", "anti-hype", "outcome-first", "direct-cta"],
  "tutorial-steps": ["step-by-step", "beginner-friendly", "checklist", "problem-first", "question-open", "source-proof"],
  "creator-story": ["creator-story", "story-contrast", "problem-first", "outcome-first", "anti-hype", "short-review"]
};

function resolveUserWritingProfile(job, preferredStyleIds, seed) {
  const requested = String(job.options?.writingStyle || "random");
  const comboId = job.options?.templateCombo || "";
  let profileId = requested;
  let randomPick = false;
  if (!USER_WRITING_STYLE_PROFILES[profileId]) {
    const pool = COMBO_WRITING_STYLE_IDS[comboId] || Object.keys(USER_WRITING_STYLE_PROFILES);
    profileId = pickBySeed(pool, seed + Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 997));
    randomPick = true;
  }
  const profile = USER_WRITING_STYLE_PROFILES[profileId] || USER_WRITING_STYLE_PROFILES["source-proof"];
  const familyIds = (USER_WRITING_STYLE_MAP[profileId] || preferredStyleIds)
    .filter((id) => TITLE_STYLE_FAMILIES.some((style) => style[0] === id));
  return {
    ...profile,
    id: profileId,
    requestedId: requested,
    randomPick,
    familyIds: familyIds.length ? familyIds : preferredStyleIds
  };
}

function resolveWritingStylePool(job, preferredStyleIds, seed) {
  return resolveUserWritingProfile(job, preferredStyleIds, seed).familyIds;
}

function applyContentTemplate(template, values) {
  return template.replace(/\{(\w+)}/g, (_, key) => values[key] || "");
}

function contentFacts(source, job) {
  const name = source.name || job.topic || "dự án này";
  const points = (Array.isArray(source.points) ? source.points : [])
    .map((point) => vietnameseText(point))
    .filter(Boolean);
  const description = vietnameseText(source.description, `${name} là một dự án cần được giải thích ngắn gọn.`);
  const rawMetricText = [source.description, ...(Array.isArray(source.points) ? source.points : [])].join(" ");
  const metricText = [description, ...points].join(" ");
  const metricMatch = rawMetricText.match(/\d+[\w%+.-]*(?:\s+\S+){0,7}/) || metricText.match(/\d+[\w%+.-]*(?:\s+\S+){0,5}/);
  const metric = metricMatch ? shortText(vietnameseText(metricMatch[0]), 70).replace(/[.!?…]+$/g, "") : "";
  const metricOrSignal = (metric || shortText(points[0] || description || `điểm nổi bật của ${name}`, 70).toLowerCase()).replace(/[.!?…]+$/g, "");
  const topicText = source.language
    ? `mã nguồn chính dùng ${source.language}`
    : Array.isArray(source.topics) && source.topics.length
      ? `tập trung vào ${source.topics.slice(0, 3).join(", ")}`
      : "có ngữ cảnh nguồn rõ ràng";
  return {
    name,
    description,
    points,
    sourceType: source.repo ? "dự án mã nguồn" : "nguồn",
    actionTarget: source.repo ? "dự án này" : "nguồn này",
    promise: shortText(points[0] || description || "một nhu cầu cụ thể", 90).toLowerCase().replace(/[.!?…]+$/g, ""),
    metric,
    metricOrSignal,
    topicText
  };
}

function uniqueLine(lines, candidate, fallback) {
  const normalized = (value) => cleanMarkdownLine(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const key = normalized(candidate);
  const duplicate = isNearDuplicateScriptLine(candidate, lines) || lines.some((line) => {
    const other = normalized(line);
    return key && other && (key.includes(other.slice(0, 42)) || other.includes(key.slice(0, 42)));
  });
  if (!duplicate) return candidate;
  return isNearDuplicateScriptLine(fallback, lines)
    ? `${fallback} Hãy xem nó như một tín hiệu để kiểm tra sâu hơn, không phải lời hứa tuyệt đối.`
    : fallback;
}

function looksLikeDuplicateCta(line, previousLines) {
  const key = normalizeScriptKey(line);
  if (!key) return true;
  const ctaSignals = ["luu lai", "thu ngay", "chia se", "link", "mo ta", "repo"];
  const signalCount = ctaSignals.filter((signal) => key.includes(signal)).length;
  if (signalCount < 2) return false;
  return previousLines.some((previous) => {
    const prev = normalizeScriptKey(previous);
    const prevSignals = ctaSignals.filter((signal) => prev.includes(signal)).length;
    if (prevSignals < 2) return false;
    const words = key.split(" ").filter((word) => word.length > 2);
    const prevSet = new Set(prev.split(" ").filter((word) => word.length > 2));
    const overlap = words.filter((word) => prevSet.has(word)).length;
    return overlap >= 3 || key.includes(prev) || prev.includes(key);
  });
}

function stripInternalScriptPrefix(value) {
  let text = cleanMarkdownLine(value);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = text
      .replace(/^\s*\d+[\).:-]\s*/u, "")
      .replace(/^\s*\[(?:hook|cta|value|proof|evidence|workflow|counter|giá trị|bang chứng|bằng chứng|phản biện|mở đầu|kết luận|lời kêu gọi)\]\s*[:：\-–—]?\s*/iu, "")
      .replace(/^\s*(?:hook|cta|value|proof|evidence|workflow|counter|giá trị|bang chứng|bằng chứng|phản biện|mở đầu|kết luận|lời kêu gọi)\s*[:：\-–—]\s*/iu, "");
    if (next === text) break;
    text = next.trim();
  }
  return text;
}

function expandScriptInputLines(lines) {
  const source = Array.isArray(lines) ? lines : [lines];
  const output = [];
  for (const item of source) {
    const raw = String(item || "").replace(/\r/g, "\n");
    for (const part of raw.split(/\n+/u)) {
      const cleaned = part.trim();
      if (cleaned) output.push(cleaned);
    }
  }
  return output;
}

function cleanupScriptLines(lines) {
  const output = [];
  for (const raw of expandScriptInputLines(lines || [])) {
    const line = cleanMarkdownLine(vietnameseText(stripInternalScriptPrefix(raw)));
    if (!line) continue;
    if (looksLikeDuplicateCta(line, output)) continue;
    if (isNearDuplicateScriptLine(line, output)) continue;
    output.push(line);
  }
  return output;
}

function looksLikeStandaloneTitle(line, job) {
  const text = cleanMarkdownLine(line);
  if (!text) return false;
  const words = countWords(text);
  if (words < 2 || words > 14) return false;
  if (/[.!?…]$/.test(text)) return false;
  const sourceKey = normalizeScriptKey(job?.sourceContext?.name || job?.topic || "");
  const key = normalizeScriptKey(text);
  if (sourceKey && (key.includes(sourceKey) || sourceKey.includes(key))) return true;
  return /[:–—-]/.test(text);
}

function extractLeadingTitleFromLine(line, job) {
  const text = cleanMarkdownLine(line);
  if (!text || countWords(text) < 10) return null;
  const sourceKey = normalizeScriptKey(job?.sourceContext?.name || job?.topic || "");
  const match = text.match(/^(.{8,120}?)(\s+(?:Bạn|Nếu|Có|Đây|Đó|Với|Thay|Chỉ|Từ|Nhưng|Quan trọng|Dự án|Công cụ)\b.+)$/u);
  if (!match) return null;
  const title = match[1].trim();
  const body = match[2].trim();
  if (!title || !body || countWords(title) > 14 || countWords(body) < 5) return null;
  const titleKey = normalizeScriptKey(title);
  const hasTitleSeparator = /[:–—-]/.test(title);
  const looksLikeProductTitle = /(repo|du an|dự án|cong cu|công cụ|ung dung|ứng dụng|studio|ai|ma nguon|mã nguồn|local|voice|giong noi|giọng nói)/.test(titleKey);
  if ((sourceKey && titleKey.includes(sourceKey) && hasTitleSeparator) || (hasTitleSeparator && looksLikeProductTitle)) {
    return { title: vietnameseText(title, title), body: vietnameseText(body, body) };
  }
  return null;
}

function normalizeNarrationScriptLines(lines, job) {
  const cleaned = cleanupScriptLines(lines);
  if (cleaned.length) {
    const extracted = extractLeadingTitleFromLine(cleaned[0], job);
    if (extracted) {
      job.contentPlan = {
        ...(job.contentPlan || {}),
        displayTitle: extracted.title
      };
      cleaned[0] = extracted.body;
    }
  }
  if (cleaned.length > 1 && looksLikeStandaloneTitle(cleaned[0], job)) {
    job.contentPlan = {
      ...(job.contentPlan || {}),
      displayTitle: cleaned[0]
    };
    return cleaned.slice(1);
  }
  return cleaned;
}

function maxScenesForDuration(seconds) {
  if (seconds >= 85) return 14;
  if (seconds >= 55) return 11;
  if (seconds >= 38) return 8;
  return 6;
}

function splitTextBySentences(text) {
  const source = cleanMarkdownLine(text);
  if (!source) return [];
  const parts = source.match(/[^.!?…]+[.!?…]*/gu) || [source];
  return parts.map((part) => part.trim()).filter(Boolean);
}

function splitLongSentence(sentence, maxWords = 24) {
  const words = String(sentence || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [sentence.trim()].filter(Boolean);
  const chunks = [];
  let cursor = 0;
  while (cursor < words.length) {
    let end = Math.min(words.length, cursor + maxWords);
    if (end < words.length) {
      for (let index = end; index > cursor + 10; index -= 1) {
        if (/[,;:]$/.test(words[index - 1])) {
          end = index;
          break;
        }
      }
      if (words.length - end < 6) end = words.length;
    }
    chunks.push(words.slice(cursor, end).join(" ").trim());
    cursor = end;
  }
  return chunks.filter(Boolean);
}

function splitScriptForScenes(lines, seconds) {
  const maxWords = seconds >= 70 ? 26 : seconds >= 45 ? 23 : 20;
  const chunks = [];
  for (const line of cleanupScriptLines(lines)) {
    for (const sentence of splitTextBySentences(line)) {
      chunks.push(...splitLongSentence(sentence, maxWords));
    }
  }
  return chunks.filter(Boolean);
}

function isLikelyScriptHeading(line) {
  const text = cleanMarkdownLine(line);
  const words = countWords(text);
  return words > 1 && words <= 12 && !/[.!?…]$/.test(text);
}

function joinScriptLines(left, right) {
  const a = cleanMarkdownLine(left);
  const b = cleanMarkdownLine(right);
  if (!a) return b;
  if (!b) return a;
  const continuation = /^\p{Ll}/u.test(b) || /^(?:và|nhưng|hoặc|rồi|nên|để|vì|khi|nếu)\b/iu.test(b);
  const separator = /[.!?…,;:]$/.test(a) ? " " : continuation ? " " : ". ";
  return cleanMarkdownLine(`${a}${separator}${b}`);
}

function mergeShortScriptLines(lines, seconds) {
  const maxScenes = maxScenesForDuration(seconds);
  const merged = [];
  for (const line of splitScriptForScenes(lines, seconds)) {
    const words = countWords(line);
    const last = merged[merged.length - 1] || "";
    if (merged.length && words < 8 && countWords(last) < 28 && !isLikelyScriptHeading(last)) {
      merged[merged.length - 1] = joinScriptLines(last, line);
    } else {
      merged.push(line);
    }
  }
  while (merged.length > maxScenes) {
    let index = 1;
    let bestWords = Infinity;
    for (let i = 1; i < merged.length; i += 1) {
      const combined = countWords(merged[i - 1]) + countWords(merged[i]);
      const headingPenalty = isLikelyScriptHeading(merged[i - 1]) || isLikelyScriptHeading(merged[i]) ? 1000 : 0;
      const score = combined + headingPenalty;
      if (score < bestWords) {
        bestWords = score;
        index = i;
      }
    }
    merged[index - 1] = joinScriptLines(merged[index - 1], merged[index]);
    merged.splice(index, 1);
  }
  for (let index = 0; index < merged.length - 1; index += 1) {
    if (/[,;:–—-]\s*$/u.test(merged[index])) {
      merged[index] = joinScriptLines(merged[index], merged[index + 1]);
      merged.splice(index + 1, 1);
      index -= 1;
    }
  }
  return merged;
}

function sceneCountForDuration(seconds) {
  if (seconds >= 85) return 9;
  if (seconds >= 70) return 8;
  if (seconds >= 52) return 7;
  if (seconds >= 38) return 6;
  return 5;
}

function isDefaultCta(value) {
  const key = normalizeScriptKey(value);
  return !key || key === normalizeScriptKey("Lưu lại, thử ngay và chia sẻ nếu hữu ích.");
}

function strictSourceFallback(facts) {
  return [
    `${facts.name} hiện có nguồn đủ để nêu vấn đề và lợi ích chính, nhưng chưa nên suy diễn thêm ý cụ thể ngoài mô tả dự án.`,
    `Nếu cần nội dung dài hơn, hãy bổ sung README, demo, ảnh chụp màn hình hoặc trường hợp sử dụng thật để phần dẫn chứng thuyết phục hơn.`
  ];
}

function fillToDurationLines(job, facts, lines) {
  const extras = [];
  const source = job.sourceContext || {};
  const topics = Array.isArray(source.topics) ? source.topics : [];
  const contentMode = job.options?.contentMode || "auto-fit";
  if (contentMode === "strict-source") {
    extras.push(...strictSourceFallback(facts));
  } else {
    if (facts.points[3]) {
      extras.push(vietnameseText(facts.points[3], `${facts.name} không chỉ nói về ý tưởng; phần đáng xem nằm ở cách nó tổ chức quy trình để đầu ra nhất quán hơn.`));
    }
    if (facts.points[4]) {
      extras.push(vietnameseText(facts.points[4], `Điểm mở rộng của ${facts.name} là có thể dùng như khung làm việc, rồi tùy biến theo đúng bối cảnh của từng đội hoặc từng người sáng tạo.`));
    }
    if (topics.length) {
      extras.push(`Các từ khóa như ${topics.slice(0, 4).join(", ")} cho thấy hướng dùng khá rõ: không chỉ để thử công nghệ, mà để biến quy trình thành thứ có thể lặp lại và đánh giá được.`);
    }
    extras.push(`Khi nguồn chưa đủ hình ảnh hay số liệu, cách kể tốt hơn là chuyển sang tình huống sử dụng thật: ai cần nó, dùng lúc nào, và giới hạn nào cần biết trước.`);
  }
  const target = sceneCountForDuration(Number(job.options?.durationSeconds || 60));
  const output = [...lines];
  for (const extra of extras) {
    if (output.length >= target - 1) break;
    output.splice(Math.max(3, output.length - 2), 0, uniqueLine(output, extra, `${facts.name} nên được xem theo đúng ngữ cảnh nguồn hiện có, rồi mới quyết định có phù hợp để thử sâu hơn hay không.`));
  }
  return output.slice(0, target - 1);
}

function scriptFromJob(job) {
  const source = job.sourceContext || {};
  const facts = contentFacts(source, job);
  const kind = contentKind(source, job);
  const comboId = job.options?.templateCombo || "";
  const seed = hashText(`${job.id}|${facts.name}|${facts.description}|${comboId}|${job.options?.writingStyle || "random"}`);
  const comboStyleIds = {
    "repo-launch-dynamic": ["source-proof", "tool-stack", "workflow-angle", "builder-view", "fast-demo"],
    "evidence-explainer": ["source-proof", "trust-signal", "credibility", "decision-frame", "anti-hype"],
    "infographic-cta": ["number-led", "outcome-first", "quality-bar", "simple-truth", "short-form-rule"],
    "app-demo-flow": ["step-by-step", "use-case-first", "workflow-angle", "operator-view", "before-after"],
    "privacy-trust-review": ["trust-signal", "credibility", "risk-first", "anti-hype", "decision-frame"],
    "quick-compare": ["comparison", "before-after", "contrarian", "decision-frame", "simple-truth"],
    "tutorial-steps": ["step-by-step", "use-case-first", "operator-view", "fast-demo", "workflow-angle"],
    "creator-story": ["problem-first", "hidden-cost", "pain-relief", "before-after", "final-push"]
  };
  const preferredStyleIds = comboStyleIds[comboId] || STYLE_IDS_BY_KIND[kind] || STYLE_IDS_BY_KIND.general;
  const writingProfile = resolveUserWritingProfile(job, preferredStyleIds, seed);
  const resolvedStyleIds = writingProfile.familyIds;
  const stylePool = TITLE_STYLE_FAMILIES.filter((style) => resolvedStyleIds.includes(style[0]));
  const style = pickBySeed(stylePool.length ? stylePool : TITLE_STYLE_FAMILIES, seed);
  const styleValues = { ...facts };
  const defaultCtaPool = [
    `Nếu ${facts.name} đúng với việc bạn đang làm, hãy lưu lại ${facts.actionTarget} và thử trên một dự án nhỏ trước.`,
    `Muốn kiểm chứng nhanh, hãy mở ${facts.actionTarget}, đọc phần chính và thử một quy trình ngắn.`,
    `Lưu lại nguồn này nếu bạn cần một cách triển khai có cấu trúc hơn, rồi thử với trường hợp sử dụng của chính bạn.`,
    `Nếu thấy phù hợp, hãy lưu ${facts.actionTarget} và chia sẻ cho người đang cần rút ngắn vòng lặp thử nghiệm.`
  ];
  const ctaPool = (writingProfile.ctas || defaultCtaPool).map((line) => applyContentTemplate(line, facts));
  const cta = isDefaultCta(job.options.cta) ? pickBySeed(ctaPool, seed, 23) : job.options.cta;
  const contentMode = job.options?.contentMode || "auto-fit";
  const point = (index, fallback) => vietnameseText(facts.points[index], fallback);
  const visibleMetric = (facts.points.find((item) => /\d/.test(item)) || facts.metric || facts.metricOrSignal || facts.promise).replace(/[.!?…]+$/g, "");
  const bodyTemplates = {
    "infographic-cta": [
      `Từ điểm neo đó, người xem cần thấy ngay lợi ích là gì và có thể kiểm chứng ở đâu.`,
      point(0, `${facts.name} giải quyết một vấn đề cụ thể, không chỉ thêm một lớp hiệu ứng cho đẹp.`),
      `Phần đáng chú ý nằm ở mối liên hệ giữa vấn đề, kết quả và ${facts.topicText}.`,
      point(1, `Bằng chứng tốt nhất là chi tiết ngắn, rõ và dễ kiểm tra lại.`)
    ],
    "app-demo-flow": [
      `Mở bằng một tình huống thật: người dùng có nguồn đầu vào, nhưng cần biến nó thành kết quả có thể dùng ngay.`,
      `Bước tiếp theo là cho thấy ${facts.name} giúp gom quy trình lại: từ nguồn, đến ý chính, rồi tới đầu ra.`,
      point(0, `Điểm đáng giá là người dùng không phải đoán nên làm gì tiếp theo; quy trình dẫn họ qua từng bước.`),
      `Người xem cần thấy thao tác và kết quả: chọn, chạy thử, kiểm tra, rồi quyết định có đưa vào quy trình chính không.`
    ],
    "evidence-explainer": [
      `Bắt đầu từ chi tiết có thể kiểm tra của ${facts.name}, không mở bằng lời hứa quá lớn.`,
      point(0, `Nguồn cho thấy vấn đề chính đủ rõ để giải thích bằng một video ngắn.`),
      point(1, `Tín hiệu đáng tin là những chi tiết có thể kiểm tra lại, không phải câu chữ quảng cáo.`),
      `Nếu nguồn còn thiếu dữ liệu, điểm đúng đắn là nói rõ giới hạn để người xem tự đánh giá.`
    ],
    "repo-launch-dynamic": [
      `Đây là kiểu dự án cần được hiểu thật nhanh: nó là gì, dùng để làm gì, và vì sao đáng thử ngay.`,
      point(0, `${facts.name} có một điểm mở đầu đủ mạnh để người xem hiểu giá trị trong vài giây đầu.`),
      point(1, `Sau phần mở đầu, cần đưa bằng chứng từ README hoặc mô tả dự án để video không thành quảng cáo rỗng.`),
      `Người xem cần thấy nhanh ba điều: ${facts.name} giúp gì, khác gì, và nên thử nó trong tình huống nào.`
    ],
    "privacy-trust-review": [
      point(0, `Nguồn hiện có cho thấy giá trị chính, nhưng cần nói rõ phần nào là bằng chứng và phần nào là diễn giải.`),
      point(1, `${facts.name} đáng chú ý hơn khi người xem hiểu được dữ liệu ở đâu, chạy ở đâu và rủi ro còn lại là gì.`),
      `Điểm nên kiểm tra tiếp theo là quyền kiểm soát: người dùng có thể thử nhỏ, đối chiếu kết quả, rồi mới quyết định đưa vào quy trình thật.`,
      `Cách hiểu an toàn là không phóng đại: nêu lợi ích, nêu điều kiện, rồi để người xem tự quyết có nên thử hay không.`
    ],
    "quick-compare": [
      `Hãy đặt ${facts.name} vào thế so sánh: trước đây người dùng làm thủ công, còn bây giờ có thể rút ngắn một phần quy trình.`,
      point(0, `Khác biệt cần nói rõ không phải là nhiều tính năng hơn, mà là bước nào được làm nhanh hơn hoặc dễ kiểm soát hơn.`),
      point(1, `Bằng chứng tốt nhất là một chi tiết cụ thể từ nguồn, đủ để người xem thấy đây không chỉ là lời giới thiệu.`),
      `Kết luận ngắn gọn: ${facts.name} đáng thử nếu nó thay được một đoạn việc thật trong quy trình của bạn.`
    ],
    "tutorial-steps": [
      `Mở bằng tình huống sử dụng: người xem có một nhu cầu cụ thể và cần biết bắt đầu từ đâu với ${facts.name}.`,
      `Bước một là xác định đầu vào. Bước hai là chạy thử luồng chính. Bước ba là kiểm tra kết quả trước khi dùng thật.`,
      point(0, `Phần hướng dẫn cần thao tác rõ, ít thuật ngữ và luôn cho thấy kết quả sau mỗi bước.`),
      `Nếu nguồn chưa đủ hình ảnh thật, phần minh họa vẫn có thể dùng checklist và vật thể động để tránh khoảng trống.`
    ],
    "creator-story": [
      `Câu chuyện bắt đầu từ một vấn đề quen thuộc: có ý tưởng, có công cụ, nhưng quy trình lại rời rạc và khó giữ nhịp.`,
      point(0, `${facts.name} trở nên đáng chú ý khi nó biến một việc phức tạp thành trải nghiệm dễ hiểu hơn.`),
      `Khoảnh khắc chuyển hướng là khi người xem nhận ra họ không cần thêm một công cụ để khoe, mà cần một luồng làm việc rõ hơn.`,
      point(1, `Bằng chứng từ nguồn là chi tiết hỗ trợ câu chuyện, không phải một bảng liệt kê khô cứng.`)
    ]
  };
  const lines = [];
  lines.push(applyContentTemplate(writingProfile.opening || style[3], styleValues));
  for (const templateLine of bodyTemplates[comboId] || [
    point(0, `${facts.name} giải quyết một điểm nghẽn cụ thể: biến quy trình phức tạp thành các bước dễ theo dõi hơn.`),
    point(1, `Điểm đáng tin nằm ở phần mô tả và các chi tiết công khai của nguồn, không phải ở lời quảng cáo.`),
    point(2, `Cách dùng hợp lý là bắt đầu nhỏ: xem ${facts.name} giúp được bước nào, rồi mới mở rộng sang quy trình lớn hơn.`)
  ]) {
    lines.push(uniqueLine(
      lines,
      templateLine,
      `Điểm đáng xem của ${facts.name} là một lợi ích cụ thể, có bằng chứng rõ và có bước thử phù hợp với người xem.`
    ));
  }
  if (contentMode === "strict-source") {
    lines.splice(1, 0, `Tất cả ý trong video này bám sát nguồn hiện có của ${facts.name}; nếu dự án chưa nói rõ, phần đó sẽ không bị thổi phồng thêm.`);
  } else if (contentMode === "fill-to-duration") {
    const extended = fillToDurationLines(job, facts, lines);
    lines.length = 0;
    lines.push(...extended);
  }
  lines.push(uniqueLine(
    lines,
    applyContentTemplate(writingProfile.counter || `Phản biện công bằng: ${facts.name} không thay thế quyết định của bạn. Giá trị của nó nằm ở việc giảm bước lặp, giúp phát hiện vấn đề sớm và giữ quy trình dễ kiểm soát hơn.`, facts),
    `Điểm cần tỉnh táo là không nên xem ${facts.name} như phép màu. Nó hữu ích nhất khi bạn vẫn giữ vai trò kiểm tra và ra quyết định cuối cùng.`
  ));
  lines.push(vietnameseText(cta));
  const defaultLabels = ["Điểm mở", "Lợi ích", "Kiểm chứng", "Cách thử", "Cân nhắc", "Bước tiếp theo"];
  const extraLabels = ["Tình huống", "Ngữ cảnh", "Điều kiện", "Giới hạn"];
  const target = lines.length;
  const titleFallbacks = ["Điểm đáng chú ý", "Lợi ích rõ nhất", "Bằng chứng kiểm tra", "Cách thử nhanh", "Điểm cần cân nhắc", "Bước tiếp theo"];
  job.contentPlan = {
    kind,
    styleId: style[0],
    styleLabel: style[1],
    writingStyleId: writingProfile.id,
    writingStyleLabel: writingProfile.randomPick ? `Random: ${writingProfile.label}` : writingProfile.label,
    titles: lines.map((line, index) => titleFromLine(line, titleFallbacks[index] || "Điểm đáng chú ý")),
    labels: Array.from({ length: target }, (_, index) => defaultLabels[index] || extraLabels[(index - defaultLabels.length) % extraLabels.length])
  };
  return cleanupScriptLines(lines.map((line) => vietnameseText(line, line)));
}

function subtitleFor(text, index, plan) {
  const cleaned = vietnameseText(text);
  if (plan?.subtitles?.[index]) return conciseText(vietnameseText(plan.subtitles[index]), 11, 64);
  return conciseText(cleaned, 11, 64);
}

function displayLabel(label, index) {
  const fallback = ["Điểm đáng chú ý", "Lợi ích rõ nhất", "Bằng chứng kiểm tra", "Cách thử nhanh", "Điểm cần cân nhắc", "Bước tiếp theo"];
  const raw = String(label || "").trim();
  const key = normalizeScriptKey(raw);
  const internal = {
    hook: "Điểm thu hút",
    value: "Lợi ích rõ nhất",
    proof: "Bằng chứng kiểm tra",
    evidence: "Bằng chứng kiểm tra",
    workflow: "Cách thử nhanh",
    counter: "Điểm cần cân nhắc",
    counterargument: "Điểm cần cân nhắc",
    cta: "Bước tiếp theo"
  };
  return internal[key] || raw || fallback[index] || `CẢNH ${index + 1}`;
}

function displayLabels(labels, count) {
  return Array.from({ length: count }, (_, index) => displayLabel(labels?.[index], index));
}

const COMBO_SCENE_TITLES = {
  "repo-launch-dynamic": ["Đáng chú ý", "Khác biệt", "Bằng chứng", "Cách thử", "Lưu ý", "Thử ngay"],
  "evidence-explainer": ["Nguồn thật", "Điểm chính", "Tín hiệu tin cậy", "Giới hạn", "Kết luận", "Kiểm tra tiếp"],
  "infographic-cta": ["Con số chính", "Giá trị", "Tác động", "Chốt nhanh", "Lưu ý", "Hành động"],
  "app-demo-flow": ["Luồng thao tác", "Tạo kết quả", "Kiểm tra", "Dùng thật", "Lưu ý", "Thử ngay"],
  "privacy-trust-review": ["Dữ liệu ở đâu?", "Chạy trên máy", "Kiểm soát thật", "Không phóng đại", "Rủi ro còn lại", "Thử an toàn"],
  "quick-compare": ["Trước đây", "Khác biệt", "Kết quả", "Điểm cân nhắc", "Chọn khi nào", "Thử nhanh"],
  "tutorial-steps": ["Bắt đầu", "Bước chính", "Kiểm tra", "Kết quả", "Lưu ý", "Làm tiếp"],
  "creator-story": ["Vấn đề", "Chuyển hướng", "Cách làm", "Kết quả", "Điểm tỉnh táo", "Chốt lại"]
};

function goodDisplayTitle(value) {
  const text = cleanMarkdownLine(value);
  return text && !isTechnicalTitle(text) && text.length <= 38 && countWords(text) <= 7;
}

function isTechnicalTitle(value) {
  const key = normalizeScriptKey(value);
  if (!key || /^y(?:\s+\d+)?$/.test(key) || /^ý(?:\s+\d+)?$/.test(key) || /^canh\s+\d+$/.test(key)) return true;
  if ([
    "hook",
    "cta",
    "value",
    "proof",
    "evidence",
    "workflow",
    "counter",
    "counterargument",
    "mo dau",
    "mở đầu",
    "diem chinh",
    "điểm chính",
    "diem noi bat",
    "điểm nổi bật",
    "nguon that",
    "nguồn thật",
    "bang chung",
    "bằng chứng",
    "cach dung",
    "cách dùng",
    "quy trinh",
    "quy trình",
    "luu y",
    "lưu ý",
    "thu ngay",
    "thử ngay"
  ].includes(key)) return true;
  return /^(?:mo dau|mở đầu|diem chinh|điểm chính|nguon that|nguồn thật|bang chung|bằng chứng|cach dung|cách dùng|quy trinh|quy trình|luu y|lưu ý|thu ngay|thử ngay|buoc tiep theo|bước tiếp theo|tinh huong|tình huống|gioi han|giới hạn|phan bien|phản biện)\b/.test(key);
}

function titleFromLine(line, fallback = "Điểm đáng chú ý") {
  const cleaned = vietnameseText(stripInternalScriptPrefix(line), fallback);
  const first = cleaned.split(/(?<=[.!?])\s+|[,;:]\s+/u).find(Boolean) || cleaned;
  return shortText(first, 46);
}

function sceneTitleFor(line, index, plan, job) {
  const planned = plan.titles?.[index];
  if (goodDisplayTitle(planned)) return planned;
  const comboTitle = COMBO_SCENE_TITLES[job?.options?.templateCombo || ""]?.[index];
  if (comboTitle) return comboTitle;
  const labelTitle = displayLabel(plan.labels?.[index], index);
  if (goodDisplayTitle(labelTitle)) return labelTitle;
  const fallbackTitles = [
    "Điểm đáng chú ý",
    "Lợi ích rõ nhất",
    "Bằng chứng kiểm tra",
    "Cách thử nhanh",
    "Điểm cần cân nhắc",
    "Bước tiếp theo",
    "Tình huống phù hợp",
    "Điều kiện để hiệu quả",
    "Giới hạn cần biết",
    "Kết luận nhanh"
  ];
  return titleFromLine(line, fallbackTitles[index] || "Điểm đáng chú ý");
}

function buildScenes(job) {
  const seconds = Number(job.options.durationSeconds || 60);
  const rawScript = normalizeNarrationScriptLines(
    Array.isArray(job.script) && job.script.length ? job.script : scriptFromJob(job),
    job
  );
  const script = mergeShortScriptLines(rawScript, seconds);
  job.script = script;
  const plan = job.contentPlan || {};
  const weights = script.map((line) => Math.max(4, countWords(line)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || script.length || 1;
  let cursor = 0;
  return script.map((line, index) => ({
    title: sceneTitleFor(line, index, plan, job),
    body: line,
    subtext: subtitleFor(line, index, plan),
    label: plan.labels?.[index] || `CẢNH ${index + 1}`,
    start: (() => Math.round(cursor * 10) / 10)(),
    end: (() => {
      cursor += seconds * (weights[index] / totalWeight);
      return Math.round((index === script.length - 1 ? seconds : cursor) * 10) / 10;
    })()
  }));
}

function countWords(text) {
  const matches = String(text || "").trim().match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

function wordsFromText(text) {
  return String(text || "").match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)?/gu) || [];
}

function formatTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = Math.round((safe - minutes * 60) * 10) / 10;
  return `${minutes}:${String(rest.toFixed(1)).padStart(4, "0")}`;
}

function hyperWorkflowSummary(job, catalogs) {
  const palette = catalogs.palettes.find((item) => item.id === job.options.palette) || catalogs.palettes[0] || {};
  const combo = catalogs.templateCombos.find((item) => item.id === job.options.templateCombo) || {};
  const source = job.sourceContext || {};
  const scenes = buildScenes(job);
  const scriptText = scenes.map((scene) => scene.body).join(" ");
  const duration = Number(job.options.durationSeconds || 60);
  const words = countWords(scriptText);
  const mediaAssets = Array.isArray(job.mediaAssets) ? job.mediaAssets : [];
  const storyboard = scenes.map((scene, index) => ({
    beat: index + 1,
    start: scene.start,
    end: scene.end,
    title: scene.title,
    vo: scene.body,
    subtext: scene.subtext,
    visualRole: mediaAssets[index]?.caption || "synthetic visual",
    motion: [job.options.effect, job.options.motion, index % 2 ? "kinetic text" : "source/proof reveal"].filter(Boolean)
  }));
  return {
    workflow: "website-to-hyperframes-lite",
    gates: ["capture-source", "design-basis", "script", "storyboard", "voice-timing", "build", "validate"],
    sourceSummary: {
      name: source.name || job.topic,
      fullName: source.fullName || "",
      description: source.description || "",
      topics: source.topics || [],
      language: source.language || "",
      links: job.links || []
    },
    designBasis: {
      palette: job.options.palette,
      colors: {
        background: palette.bg,
        primary: palette.primary,
        accent: palette.accent
      },
      templateCombo: combo.name || job.options.templateCombo,
      titleStyle: job.options.titleStyle,
      motion: job.options.motion,
      mediaStrategy: job.options.mediaStrategy,
      evidenceStyle: job.options.evidenceStyle
    },
    scriptPacing: {
      durationSeconds: duration,
      words,
      wordsPerSecond: duration ? Math.round((words / duration) * 100) / 100 : 0,
      target: "Hyper khuyen nghi khoang 2.3 tu/giay va de khoang tho thi giac."
    },
    storyboard,
    transcript: buildApproxTranscript(scenes),
    validationPlan: {
      snapshotTimes: storyboard.map((beat) => Math.round((beat.start + (beat.end - beat.start) * 0.65) * 10) / 10),
      checks: [
        "visible-content",
        "text-contrast",
        "no-overlap",
        "asset-visible",
        "subtext-readable",
        "cta-only-last"
      ]
    },
    assets: mediaAssets.map((asset) => ({
      kind: asset.kind,
      caption: asset.caption,
      sourcePath: asset.sourcePath,
      path: asset.path
    })),
    validationChecklist: [
      "Text khong bi chong/tran khung o snapshot giua moi beat.",
      "Moi beat co it nhat mot visual hoac synthetic object dang chuyen dong.",
      "Subtitle/subtext ngan hon voice va khong lap nguyen cau voice.",
      "Canh cat theo voice duration, khong de hinh keo dai sau khi voice ket thuc.",
      "CTA chi xuat hien o cuoi video."
    ]
  };
}

function buildApproxTranscript(scenes) {
  const transcript = [];
  for (const scene of scenes) {
    const words = wordsFromText(scene.body);
    const span = Math.max(0.2, Number(scene.end || 0) - Number(scene.start || 0));
    const step = words.length ? span / words.length : span;
    words.forEach((word, index) => {
      const start = Number(scene.start || 0) + step * index;
      const end = index === words.length - 1 ? Number(scene.end || start + step) : start + step;
      transcript.push({
        text: word,
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        beat: scene.title
      });
    });
  }
  return transcript;
}

function writeHyperArtifacts(job, catalogs, workspace, onLog) {
  const summary = hyperWorkflowSummary(job, catalogs);
  job.hyperWorkflow = summary;
  const design = `# Design Basis

## Overview
${summary.sourceSummary.name || job.topic} được dựng theo workflow Hyper: nguồn -> design basis -> script -> storyboard -> voice timing -> render -> validate. Style hiện tại dùng combo ${summary.designBasis.templateCombo}, motion ${summary.designBasis.motion}, evidence ${summary.designBasis.evidenceStyle}.

## Colors
- **Background**: \`${summary.designBasis.colors.background || ""}\`
- **Primary**: \`${summary.designBasis.colors.primary || ""}\`
- **Accent**: \`${summary.designBasis.colors.accent || ""}\`

## Typography
- Title style: ${summary.designBasis.titleStyle || "default"}
- Caption/subtext: ngắn, rõ, không copy nguyên câu voice.

## Components
- Source/proof card từ repo/link.
- Synthetic object/infographic khi thiếu media thật.
- CTA cuối video.

## Do's and Don'ts
- Do giữ nhịp theo voice và để khoảng thở thị giác.
- Do dùng asset nguồn khi có.
- Don't lộ nhãn kỹ thuật như Hook/Giá trị/Backend trong video.
- Don't lặp CTA hoặc lặp lại cùng một ý bằng câu ngắn hơn.
`;
  const script = `# SCRIPT

**Words:** ${summary.scriptPacing.words}
**Estimated pace:** ${summary.scriptPacing.wordsPerSecond} words/s
**Target:** ${summary.scriptPacing.target}

${summary.storyboard.map((beat) => beat.vo).join("\n\n")}
`;
  const storyboard = `# STORYBOARD

**Format:** ${job.options.aspect || "vertical"}
**Audio:** ${job.options.voice || "none"} ${job.options.voiceName ? `(${job.options.voiceName})` : ""}
**Style basis:** DESIGN.md

## Asset Audit

| Asset | Type | Role |
| --- | --- | --- |
${summary.assets.length ? summary.assets.map((asset, index) => `| ${publicMediaProof(asset, index) || `Asset ${index + 1}`} | ${asset.kind || ""} | Dẫn chứng/visual nguồn |`).join("\n") : "| synthetic visual | generated | Bù khi nguồn thiếu media thật |"}

## Beats

${summary.storyboard.map((beat) => `### Beat ${beat.beat}: ${beat.title}

- **Time:** ${formatTimestamp(beat.start)} - ${formatTimestamp(beat.end)}
- **VO:** ${beat.vo}
- **Subtext:** ${beat.subtext}
- **Visual:** ${beat.visualRole}
- **Motion:** ${beat.motion.join(", ")}
`).join("\n")}
`;
  const handoff = `# Handoff - ${job.title || job.topic}

**Preview:** ${job.previewPath || "index.html"}
**Output:** ${job.outputPath || "output.mp4"}

## Audio

| Asset | Status | Notes |
| --- | --- | --- |
| voice | ${job.voicePath ? "Done" : "None"} | ${job.voicePath || "Không dùng voice"} |
| transcript.json | Done | ${summary.transcript.length} word entries, approximate timing |

## Artifacts

- DESIGN.md
- SCRIPT.md
- STORYBOARD.md
- transcript.json
- beats.json
- hyper-workflow.json

## Hyper Workflow Gates

${summary.gates.map((gate) => `- [x] ${gate}`).join("\n")}

## Validation Checklist

${summary.validationChecklist.map((item) => `- [ ] ${item}`).join("\n")}

## Snapshot Times

\`${summary.validationPlan.snapshotTimes.join(",")}\`
`;
  fs.writeFileSync(path.join(workspace, "DESIGN.md"), design);
  fs.writeFileSync(path.join(workspace, "SCRIPT.md"), script);
  fs.writeFileSync(path.join(workspace, "STORYBOARD.md"), storyboard);
  fs.writeFileSync(path.join(workspace, "HANDOFF.md"), handoff);
  fs.writeFileSync(path.join(workspace, "transcript.json"), JSON.stringify(summary.transcript, null, 2));
  fs.writeFileSync(path.join(workspace, "beats.json"), JSON.stringify(summary.storyboard, null, 2));
  fs.writeFileSync(path.join(workspace, "hyper-workflow.json"), JSON.stringify(summary, null, 2));
  onLog?.("Wrote Hyper workflow artifacts: DESIGN.md, SCRIPT.md, STORYBOARD.md, transcript.json, beats.json, HANDOFF.md");
}

function workspaceFor(job) {
  const slug = safeName(`${job.topic || "video"}-${job.id}`);
  return path.join(PROJECTS_DIR, slug);
}

async function generateVietnameseVoice(job, workspace, onLog) {
  const narrationLines = normalizeNarrationScriptLines(job.script && job.script.length ? job.script : scriptFromJob(job), job);
  const narration = narrationLines
    .map((line) => splitTextBySentences(normalizeVietnameseSpeechText(vietnameseText(line))).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  const textPath = path.join(workspace, "assets", "narration.txt");
  const wavPath = path.join(workspace, "assets", "voice.wav");
  fs.writeFileSync(textPath, narration);
  const maxChunkLength = Math.max(...narration.split(/\n+/).map((line) => line.length), 120);
  const maxNewFrames = Math.max(560, Math.min(1100, 220 + Math.round(maxChunkLength * 2.8)));
  const vieneuVoice = job.options.vieneuVoice || job.options.voiceName || "Ngọc Lan";
  const refAudio = job.options.voice === "clone-local" && job.options.voicePath && fs.existsSync(job.options.voicePath)
    ? job.options.voicePath
    : "";
  onLog?.(`Đang sinh voice VieNeu (${refAudio ? "clone local" : vieneuVoice})...`);
  await run("python3", [
    path.join(ROOT, "scripts", "vieneu_tts.py"),
    textPath,
    "-o", wavPath,
    "--voice", vieneuVoice,
    "--temperature", String(Number(job.options.temperature || 0.8)),
    "--max-new-frames", String(maxNewFrames),
    ...(refAudio ? ["--ref-audio", refAudio] : [])
  ], { cwd: workspace, onLog });
  onLog?.(`Generated Vietnamese voice with official local VieNeu TTS (${refAudio ? "clone" : vieneuVoice})`);
  return wavPath;
}

function comboFor(job, catalogs) {
  const selected = catalogs.templateCombos?.find((item) => item.id === job.options.templateCombo);
  return {
    id: job.options.templateCombo || selected?.id || "repo-launch-dynamic",
    titleStyle: job.options.titleStyle || selected?.titleStyle || "kinetic-bold",
    mediaStrategy: job.options.mediaStrategy || selected?.mediaStrategy || "source-card",
    evidenceStyle: job.options.evidenceStyle || selected?.evidenceStyle || "repo-proof",
    iconSet: Array.isArray(job.options.iconSet) ? job.options.iconSet : (selected?.iconSet || ["AI", "API", "MP4"]),
    infographic: job.options.infographic || selected?.infographic || "feature-bars",
    motion: job.options.motion || selected?.motion || "pulse-grid",
    fallbackVisuals: job.options.fallbackVisuals !== false
  };
}

async function collectSourceMedia(job, workspace, onLog) {
  if (job.sourceContext?.image) {
    try {
      const imageUrl = new URL(job.sourceContext.image, firstValidUrl(job.links)).toString();
      const ext = path.extname(new URL(imageUrl).pathname) || ".png";
      const target = path.join(workspace, "assets", `source-web${ext}`);
      await downloadUrl(imageUrl, target);
      onLog?.("Loaded web preview image from source metadata");
      return [{
        kind: mediaKind(target),
        sourcePath: imageUrl,
        path: target,
        url: imageUrl,
        caption: "Ảnh preview từ website"
      }];
    } catch (error) {
      onLog?.(`Web preview image skipped: ${error.message}`);
    }
  }
  const repo = job.links.map(githubRepoFromLink).find(Boolean);
  if (!repo) return [];
  const assets = [];
  let branch = "main";
  try {
    const repoInfo = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
    branch = repoInfo.default_branch || "main";
  } catch (error) {
    onLog?.(`Repo info lookup skipped, fallback branch main: ${error.message}`);
  }
  let readmeMedia = [];
  try {
    const readmeInfo = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`);
    if (readmeInfo.content) {
      const readme = Buffer.from(readmeInfo.content, readmeInfo.encoding || "base64").toString("utf8");
      readmeMedia = extractReadmeMedia(readme, repo, branch);
    }
  } catch (error) {
    onLog?.(`README media lookup skipped: ${error.message}`);
  }
  let treeMedia = [];
  try {
    const tree = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${branch}?recursive=1`);
    treeMedia = (tree.tree || [])
      .filter((item) => item.type === "blob" && isEvidenceMediaPath(item.path))
      .map((item) => ({
        url: `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${item.path}`,
        sourcePath: item.path
      }));
  } catch (error) {
    onLog?.(`Repo media tree lookup skipped: ${error.message}`);
  }
  const mediaFiles = [...readmeMedia, ...treeMedia, ...fallbackMediaCandidates(repo, branch)]
    .filter((item, index, list) => list.findIndex((other) => other.url.toLowerCase() === item.url.toLowerCase()) === index)
    .sort((a, b) => sourceMediaScore(a) - sourceMediaScore(b));
  let attemptIndex = 0;
  for (const item of mediaFiles) {
    if (assets.length >= 6) break;
    try {
      const ext = path.extname(new URL(item.url).pathname) || path.extname(item.sourcePath || "") || ".png";
      const target = path.join(workspace, "assets", `source-${attemptIndex}${ext}`);
      attemptIndex += 1;
      await downloadUrl(item.url, target);
      assets.push({
        kind: mediaKind(item.sourcePath || item.url),
        sourcePath: item.sourcePath || item.url,
        path: target,
        url: item.url,
        caption: mediaCaptionFor(item, assets.length)
      });
    } catch (error) {
      if (!item.fallback) onLog?.(`Media asset skipped: ${error.message}`);
    }
  }
  if (assets.length) onLog?.(`Loaded ${assets.length} media asset(s) from ${repo.owner}/${repo.repo}`);
  if (!assets.length) onLog?.(`No usable media asset found for ${repo.owner}/${repo.repo}; renderer will use animated objects.`);
  return assets;
}

async function collectSourceContext(job, onLog) {
  const repo = job.links.map(githubRepoFromLink).find(Boolean);
  if (!repo) {
    const url = firstValidUrl(job.links);
    if (!url) return null;
    try {
      const response = await fetch(url, { headers: { "user-agent": "Hypervideo" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsed = new URL(url);
      const title = htmlTitle(html) || job.topic || parsed.hostname;
      const description = shortText(
        htmlMeta(html, "description") ||
        htmlMeta(html, "og:description") ||
        htmlMeta(html, "twitter:description") ||
        `${title} là nguồn web cần được tóm tắt thành video ngắn.`,
        155
      );
      const points = extractWebPoints(html);
      const keywords = (htmlMeta(html, "keywords") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4);
      const ogImage = htmlMeta(html, "og:image") || htmlMeta(html, "twitter:image");
      onLog?.(`Loaded lightweight web context for ${parsed.hostname}`);
      return {
        owner: parsed.hostname,
        repo: "",
        fullName: parsed.hostname,
        name: title,
        description,
        language: "",
        topics: keywords,
        image: ogImage,
        points: points.length ? points : [
          description,
          `Nguồn chính là ${parsed.hostname}.`,
          "Điểm đáng chú ý là lợi ích, dẫn chứng và giới hạn cần được nhìn cùng nhau."
        ]
      };
    } catch (error) {
      onLog?.(`Web context lookup skipped: ${error.message}`);
      return null;
    }
  }
  try {
    const repoInfo = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
    let readme = "";
    try {
      const readmeInfo = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`);
      if (readmeInfo.content) {
        readme = Buffer.from(readmeInfo.content, readmeInfo.encoding || "base64").toString("utf8");
      }
    } catch (error) {
      onLog?.(`README lookup skipped: ${error.message}`);
    }
    const points = extractReadmePoints(readme).slice(0, 4);
    const name = repoInfo.name ? repoInfo.name.replace(/[-_]+/g, " ") : job.topic;
    const description = shortText(repoInfo.description || points[0] || `${name} là dự án mã nguồn mở cần được giới thiệu ngắn gọn.`, 155);
    const topics = Array.isArray(repoInfo.topics) ? repoInfo.topics.slice(0, 4) : [];
    onLog?.(`Loaded source context for ${repo.owner}/${repo.repo}`);
    return {
      owner: repo.owner,
      repo: repo.repo,
      fullName: repoInfo.full_name || `${repo.owner}/${repo.repo}`,
      name,
      description,
      language: repoInfo.language || "",
      topics,
      points: points.length ? points : [
        description,
        topics.length ? `Dự án tập trung vào ${topics.join(", ")}.` : "Nội dung được tóm tắt thành các điểm chính dễ hiểu.",
        repoInfo.language ? `Mã nguồn chính sử dụng ${repoInfo.language}.` : "Có thể dùng như điểm bắt đầu để khám phá hoặc phát triển thêm."
      ]
    };
  } catch (error) {
    onLog?.(`Source context lookup skipped: ${error.message}`);
    return null;
  }
}

async function resolveJobScript(job, state, onLog) {
  const hasUserScript = Array.isArray(job.script) && job.script.length > 0;
  const writerMode = String(job.options?.writerMode || "").toLowerCase();
  if (hasUserScript && (writerMode === "manual" || job.options?.llmEnabled === false || job.options?.llmEnabled === "false")) {
    job.script = normalizeNarrationScriptLines(job.script, job);
    job.contentPlan = {
      ...(job.contentPlan || {}),
      kind: "manual",
      styleLabel: "MANUAL"
    };
    onLog?.("Using user-approved script from preview/manual editor");
    return job.script;
  }
  const llmEnabled = job.options?.llmEnabled === true || job.options?.llmEnabled === "true";
  const providerId = job.options?.llmProviderId || job.options?.llmProvider || "";
  if (!llmEnabled || !providerId) {
    job.script = scriptFromJob(job);
    return job.script;
  }
  const provider = (state.catalogs.llmProviders || []).find((item) => item.id === providerId && item.enabled);
  if (!provider) {
    onLog?.(`LLM provider ${providerId} khong kha dung, fallback local writer`);
    job.script = scriptFromJob(job);
    return job.script;
  }
  try {
    const llm = await writeWithLlm(job, provider);
    if (!llm.scenes.length) throw new Error("LLM khong tra ve scene hop le");
    job.script = llm.scenes.map((scene) => scene.voice);
    job.contentPlan = {
      ...(job.contentPlan || {}),
      kind: "llm",
      styleId: provider.type,
      styleLabel: "LLM",
      titles: llm.scenes.map((scene) => isTechnicalTitle(scene.title) ? titleFromLine(scene.voice || scene.subtitle || "") : scene.title),
      labels: displayLabels(llm.scenes.map((scene) => scene.label || "SCENE"), llm.scenes.length),
      subtitles: llm.scenes.map((scene) => scene.subtitle || "")
    };
    if (llm.cta) job.options.cta = llm.cta;
    onLog?.(`LLM writer used: ${provider.name} / ${job.options?.llmModel || provider.defaultModel || ""}`);
    return job.script;
  } catch (error) {
    onLog?.(`LLM writer failed, fallback local writer: ${error.message}`);
    job.script = scriptFromJob(job);
    return job.script;
  }
}

function syntheticVisualHtml(index, scene, labels, icons) {
  const title = conciseText(scene.title, 6, 34);
  const text = conciseText(scene.subtext || scene.body, 12, 84);
  const iconItems = icons.slice(0, 6);
  if (index % 5 === 1) {
    return `
      <div class="synthetic terminal-visual">
        <div class="terminal-top"><span></span><span></span><span></span><b>${escapeHtml(title)}</b></div>
        <pre><code>• Ghi nhận nguồn chính
• Rút ra ý đáng xem
• Gắn minh họa phù hợp
• Chốt thông điệp ngắn gọn
✓ ${escapeHtml(text)}</code></pre>
        <i class="terminal-cursor"></i>
      </div>`;
  }
  if (index % 5 === 2) {
    return `
      <div class="synthetic flow-visual">
        <svg viewBox="0 0 760 520">
          <path class="main-flow" d="M90 260 C190 70 330 70 405 260 S610 450 690 260" />
          <path class="sub-flow" d="M160 330 C270 440 475 440 600 330" />
        </svg>
        ${[title, labels[0], labels[1], labels[2], "Kết quả"].map((node, i) => `<em class="big-node node-${i}">${escapeHtml(conciseText(node, 4, 22))}</em>`).join("")}
      </div>`;
  }
  if (index % 5 === 3) {
    return `
      <div class="synthetic orbit-visual">
        <strong>${escapeHtml(title)}</strong>
        ${iconItems.map((icon, i) => `<em class="orbit-item orbit-${i}">${escapeHtml(icon)}</em>`).join("")}
        <span class="orbit-ring r1"></span><span class="orbit-ring r2"></span><span class="orbit-ring r3"></span>
      </div>`;
  }
  if (index % 5 === 4) {
    return `
      <div class="synthetic cta-visual">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
        <i></i><i></i><i></i><i></i>
      </div>`;
  }
  return `
    <div class="synthetic burst-visual">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
      ${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}
    </div>`;
}

function publicSourceLabel(job, fallback = "Nguồn đã chọn") {
  const isRepo = job.sourceContext?.repo || (job.links || []).some((link) => /github\.com/i.test(String(link || "")));
  const name = displayName(job.sourceContext?.name || job.topic || "", "");
  if (name) return conciseText(isRepo ? `${name} trên GitHub` : name, 6, 44);
  return isRepo ? "Nguồn GitHub" : conciseText(fallback, 6, 44);
}

function publicChipLabel(value, index = 0) {
  const raw = String(value || "").trim();
  const key = normalizeScriptKey(raw);
  const map = {
    ai: "AI hỗ trợ",
    api: "API",
    cli: "CLI",
    github: "GitHub",
    mp4: "Video",
    lock: "Riêng tư",
    local: "Chạy local",
    proof: "Kiểm chứng",
    risk: "Điểm cần biết",
    before: "Trước đây",
    after: "Bây giờ",
    why: "Vì sao",
    try: "Thử ngay",
    "1": "Bước 1",
    "2": "Bước 2",
    "3": "Bước 3",
    done: "Hoàn tất",
    pain: "Vấn đề",
    shift: "Khác biệt",
    result: "Kết quả",
    cta: "Hành động",
    ui: "Giao diện",
    queue: "Quy trình",
    source: "Nguồn kiểm tra",
    demo: "Demo"
  };
  const fallback = ["Điểm đáng xem", "Lợi ích", "Kiểm chứng", "Bước thử"][index] || "Ý chính";
  return shortText(map[key] || raw || fallback, 18);
}

function publicMediaProof(media, index) {
  if (!media) return "";
  const kind = media.kind === "video" ? "Video minh họa" : "Ảnh minh họa";
  const focus = [
    "giao diện thật của dự án",
    "màn hình tính năng quan trọng",
    "luồng sử dụng chính",
    "kết quả người xem có thể kiểm chứng",
    "bằng chứng trực quan từ nguồn"
  ][index % 5];
  return `${kind} cho thấy ${focus}.`;
}

function publicSceneTitle(scene, index) {
  const title = String(scene.title || "").trim();
  if (!title || isTechnicalTitle(title)) return titleFromLine(scene.body || scene.subtext || "", `Cảnh ${index + 1}`);
  return conciseText(vietnameseText(title), 7, 46);
}

function comboVisualCopy(comboId, index, scene, job, media, fallbackSource = "Nguồn đã chọn") {
  const source = publicSourceLabel(job, fallbackSource);
  const body = conciseText(scene.body, 18, 118);
  const subtext = conciseText(scene.subtext || scene.body, 10, 68);
  const mediaProof = publicMediaProof(media, index);
  const captions = {
    "evidence-explainer": "Minh họa bằng bằng chứng dễ kiểm tra",
    "privacy-trust-review": "Tập trung vào quyền kiểm soát dữ liệu",
    "quick-compare": "So sánh nhanh trước và sau",
    "tutorial-steps": "Dẫn người xem theo từng bước",
    "app-demo-flow": "Cho thấy luồng thao tác trong sản phẩm",
    "infographic-cta": "Biến ý chính thành tín hiệu trực quan",
    "creator-story": "Kể bằng vấn đề, chuyển biến và kết quả"
  };
  return {
    source,
    title: publicSceneTitle(scene, index),
    proof: mediaProof || body || `${source} được tóm tắt thành ý dễ hiểu cho người xem.`,
    body,
    subtext,
    caption: captions[comboId] || "Thông tin được trình bày trực quan cho người xem"
  };
}

function mediaFrameHtml(mediaNode, scene, copy, extraClass = "") {
  return `
    <div class="media-frame cue media-float ${extraClass}">
      <div class="object-stage">
        ${mediaNode}
      </div>
      <div class="object-subtitle cue">${escapeHtml(copy.subtext)}</div>
      <div class="object-caption cue">
        <small>${escapeHtml(copy.caption)}</small>
      </div>
    </div>`;
}

function proofCardHtml(copy, compact = false) {
  return `
    <div class="visual-card proof-card cue proof-float ${compact ? "compact-proof" : ""}">
      <div class="proof-head"><span>${escapeHtml(copy.title)}</span><strong>${escapeHtml(copy.source)}</strong></div>
      <p>${escapeHtml(copy.proof)}</p>
    </div>`;
}

function chipsHtml(icons, className = "icon-strip") {
  return `<div class="${className}">${icons.slice(0, 4).map((icon) => `<em class="cue">${escapeHtml(icon)}</em>`).join("")}</div>`;
}

function flowMiniHtml(nodes) {
  return `
    <div class="flow-mini cue">
      <svg viewBox="0 0 620 160" preserveAspectRatio="none">
        <path class="flow-path" d="M55 80 C160 12 248 148 345 80 S510 20 565 80" />
      </svg>
      ${nodes.map((node, i) => `<span class="flow-node cue n${i}">${escapeHtml(conciseText(node, 4, 24))}</span>`).join("")}
    </div>`;
}

function visualHtml(scene, index, job, combo) {
  const variant = index % 3;
  const iconSet = Array.isArray(combo.iconSet) && combo.iconSet.length ? combo.iconSet : ["AI", "API", "MP4"];
  const icons = iconSet.map(publicChipLabel);
  const link = job.links[index % Math.max(job.links.length, 1)] || "Hypervideo";
  const sourceLabel = (() => {
    try {
      const parsed = new URL(link);
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parsed.hostname;
    } catch {
      return "Nguồn đã chọn";
    }
  })();
  const sceneWords = wordsFromText(`${scene.title} ${scene.subtext} ${scene.body}`)
    .filter((word) => word.length > 2)
    .slice(0, 3);
  const labels = sceneWords.length >= 3 ? sceneWords : [
    publicSceneTitle(scene, index),
    scene.subtext,
    job.sourceContext?.name || job.topic
  ];
  const mediaAssets = job.mediaAssets || [];
  const media = mediaAssets[index] || null;
  const relMedia = media?.path ? path.relative(job.workspace, media.path).replace(/\\/g, "/") : "";
  const preferGeneratedVisual = combo.mediaStrategy === "generated-abstract" || (combo.infographic || "").includes("metric");
  const mediaNode = !preferGeneratedVisual && media?.kind === "video"
    ? `<video class="source-media" src="${escapeHtml(relMedia)}" muted loop autoplay playsinline></video>`
    : !preferGeneratedVisual && media?.path
      ? `<img class="source-media" src="${escapeHtml(relMedia)}" alt="source media">`
      : syntheticVisualHtml(index, scene, labels, icons);
  const copy = comboVisualCopy(combo.id, index, scene, job, media, sourceLabel);
  const words = scene.subtext.split(/\s+/).filter(Boolean).slice(0, 14);
  const kineticWords = words.map((word, i) => `<span class="kinetic-word cue" style="--i:${i}">${escapeHtml(word)}</span>`).join("");
  const flowNodes = [
    publicSceneTitle(scene, index),
    ...labels.map(publicChipLabel),
    job.options.cta || "Thử ngay"
  ].slice(0, 5);
  const mediaFrame = mediaFrameHtml(mediaNode, scene, copy);
  const proofCard = proofCardHtml(copy, false);
  const chipStrip = chipsHtml(icons);
  const commonTop = `
      <div class="orb one"></div>
      <div class="orb two"></div>
      <div class="kinetic-stage cue">${kineticWords}</div>`;
  let layout = `
      ${proofCard}
      ${mediaFrame}
      <div class="visual-bottom">
        ${flowMiniHtml(flowNodes)}
        ${chipStrip}
      </div>`;
  if (combo.id === "privacy-trust-review") {
    const trustItems = ["Dữ liệu ở lại", "Chạy trên máy", "Tự kiểm chứng", "Thử nhỏ trước"];
    const trustGrid = `<div class="trust-grid">${trustItems.map((item, i) => `<span class="trust-card cue"><b>${escapeHtml(item)}</b><small>${escapeHtml([copy.proof, copy.body, copy.subtext, "Người dùng vẫn là người quyết định"][i] || copy.caption)}</small></span>`).join("")}</div>`;
    if (variant === 1) {
      layout = `
        <div class="trust-radar cue">
          <span>${escapeHtml(copy.source)}</span>
          <strong>${escapeHtml(copy.title)}</strong>
          <p>${escapeHtml(copy.body || copy.proof)}</p>
          <i class="r1"></i><i class="r2"></i><i class="r3"></i>
        </div>
        ${trustGrid}
        <div class="visual-bottom">${chipsHtml(["Kiểm soát", "Dữ liệu", "Tốc độ", "Rủi ro"])}</div>`;
    } else if (variant === 2) {
      layout = `
        <div class="trust-ledger cue">
          ${["Nên thử khi", "Cần kiểm tra", "Không nên nói quá"].map((label, i) => `<span><b>${escapeHtml(label)}</b><small>${escapeHtml(conciseText([copy.body, copy.proof, copy.subtext][i], 10, 74))}</small></span>`).join("")}
        </div>
        ${mediaFrameHtml(mediaNode, scene, copy, "trust-media compact-trust-media")}
        <div class="visual-bottom">${chipsHtml(["Local", "Riêng tư", "Proof", "Quyết định"])}</div>`;
    } else {
      layout = `
        <div class="trust-showcase">
          ${mediaFrameHtml(mediaNode, scene, copy, "trust-media")}
          <div class="visual-card trust-panel cue">
            <strong>${escapeHtml(copy.title)}</strong>
            <p>${escapeHtml(copy.body || copy.proof)}</p>
            ${trustGrid}
          </div>
        </div>
        <div class="visual-bottom">${chipsHtml(["Riêng tư", "Trên máy", "Kiểm soát", "Minh bạch"])}</div>`;
    }
  } else if (combo.id === "quick-compare") {
    if (variant === 1) {
      layout = `
        ${mediaFrameHtml(mediaNode, scene, copy, "compare-media compare-spotlight")}
        <div class="compare-timeline cue">
          ${["Trước", "Khác biệt", "Kết quả"].map((label, i) => `<span><b>${escapeHtml(label)}</b><small>${escapeHtml(conciseText([copy.body, scene.subtext, copy.proof][i], 8, 58))}</small></span>`).join("")}
        </div>
        <div class="visual-bottom">${chipStrip}</div>`;
    } else {
      layout = `
        ${proofCardHtml(copy, true)}
        <div class="compare-grid cue">
          <div class="compare-panel before"><span>Trước</span><p>${escapeHtml(conciseText(copy.body, 10, 74))}</p></div>
          <div class="compare-panel after"><span>Sau</span><p>${escapeHtml(conciseText(scene.subtext || copy.proof, 10, 74))}</p></div>
        </div>
        ${variant === 2 ? flowMiniHtml(flowNodes) : mediaFrameHtml(mediaNode, scene, copy, "compare-media")}
        <div class="visual-bottom">${chipStrip}</div>`;
    }
  } else if (combo.id === "tutorial-steps") {
    const steps = ["Mở nguồn", "Chọn cách dùng", "Tạo kết quả"];
    const stepCards = `<div class="step-stack cue compact-steps">
      ${steps.map((step, i) => `<div class="step-card"><b>0${i + 1}</b><span>${escapeHtml(step)}</span><p>${escapeHtml(conciseText(i === 0 ? copy.proof : i === 1 ? copy.body : copy.subtext, 9, 66))}</p></div>`).join("")}
    </div>`;
    layout = variant === 1
      ? `<div class="tutorial-split">${stepCards}${mediaFrameHtml(mediaNode, scene, copy, "tutorial-media")}</div><div class="visual-bottom">${chipStrip}</div>`
      : `${mediaFrame}${stepCards}<div class="visual-bottom">${chipStrip}</div>`;
  } else if (combo.id === "infographic-cta") {
    const metrics = ["Nguồn rõ", "Lợi ích", "Thử nhanh"];
    layout = `
      ${proofCard}
      <div class="metric-grid cue">
        ${metrics.map((metric, i) => `<div class="metric-pill"><b>${escapeHtml(metric)}</b><span style="--w:${78 + i * 7}%"></span><small>${escapeHtml(conciseText([copy.proof, copy.body, copy.subtext][i], 8, 54))}</small></div>`).join("")}
      </div>
      ${mediaFrameHtml(mediaNode, scene, copy, "metric-media")}`;
  } else if (combo.id === "app-demo-flow") {
    const actions = `<div class="app-actions cue">
      ${["Xem", "Thử", "So sánh", "Chia sẻ"].map((item, i) => `<span><b>${escapeHtml(item)}</b><small>${escapeHtml(icons[i] || labels[i] || "Ý chính")}</small></span>`).join("")}
    </div>`;
    layout = variant === 2
      ? `<div class="app-demo-rail">${proofCard}${actions}</div>${mediaFrameHtml(mediaNode, scene, copy, "app-media")}`
      : `${mediaFrameHtml(mediaNode, scene, copy, "app-media")}${actions}${proofCard}`;
  } else if (combo.id === "creator-story") {
    layout = `
      ${mediaFrameHtml(mediaNode, scene, copy, "story-media")}
      <div class="story-note proof-card cue proof-float">
        <div class="proof-head"><span>${escapeHtml(copy.title)}</span><strong>${escapeHtml(copy.source)}</strong></div>
        <p>${escapeHtml(copy.body || copy.proof)}</p>
      </div>
      <div class="visual-bottom">${flowMiniHtml(flowNodes)}</div>`;
  } else if (combo.id === "repo-launch-dynamic") {
    layout = `
      <div class="launch-board cue">
        <div class="launch-copy">
          <span>${escapeHtml(copy.source)}</span>
          <strong>${escapeHtml(publicSceneTitle(scene, index))}</strong>
          <p>${escapeHtml(copy.body || copy.proof)}</p>
        </div>
        ${mediaFrameHtml(mediaNode, scene, copy, "launch-media")}
      </div>
      <div class="visual-bottom">
        ${flowMiniHtml(flowNodes)}
        ${chipStrip}
      </div>`;
  } else if (combo.id === "evidence-explainer") {
    layout = `
      ${mediaFrameHtml(mediaNode, scene, copy, "evidence-media")}
      ${proofCardHtml(copy, false)}
      <div class="visual-bottom">${flowMiniHtml(flowNodes)}</div>`;
  }
  return `
    <aside class="visual visual-${index} combo-${escapeHtml(combo.id)} ${escapeHtml(combo.mediaStrategy)} ${escapeHtml(combo.infographic)} dynamic-${index % 5} layout-${variant}">
      ${commonTop}
      ${layout}
    </aside>
  `;
}

function renderHtml(job, catalogs) {
  const aspect = catalogs.aspects.find((item) => item.id === job.options.aspect) || catalogs.aspects[0];
  const palette = catalogs.palettes.find((item) => item.id === job.options.palette) || catalogs.palettes[0];
  const combo = comboFor(job, catalogs);
  const scenes = buildScenes(job);
  const duration = Number(job.options.durationSeconds || scenes[scenes.length - 1].end || 60);
  const audioTag = job.voicePath
    ? `<audio id="voice" data-start="0" data-duration="auto" data-track-index="0" src="${escapeHtml(path.relative(job.workspace, job.voicePath).replace(/\\/g, "/"))}" data-volume="1"></audio>`
    : "";

  const sceneHtml = scenes.map((scene, index) => `
    <section id="scene${index}" class="scene scene-${index % 3}">
      <div class="copy">
        <div class="eyebrow title-pill cue">${escapeHtml(scene.title)}</div>
        <p class="body-copy cue">${escapeHtml(scene.body)}</p>
        <div class="meta cue">${escapeHtml(publicSourceLabel(job, "Nguồn đã chọn"))}</div>
      </div>
      ${visualHtml(scene, index, job, combo)}
    </section>
  `).join("\n");

  const timelineJs = scenes.map((scene, index) => {
    const span = Math.max(0.6, scene.end - scene.start);
    const at = (ratio, cap) => Math.round((scene.start + Math.min(span * ratio, cap)) * 100) / 100;
    const exitAt = Math.round(Math.max(scene.end - Math.min(0.55, span * 0.18), scene.start + 0.45) * 100) / 100;
    const sceneOutAt = Math.round(Math.max(scene.end - Math.min(0.32, span * 0.1), scene.start + 0.55) * 100) / 100;
    return `
    tl.set("#scene${index} .cue", {autoAlpha:0, y:26});
    tl.set("#scene${index}", {visibility:"visible"}, ${scene.start});
    tl.to("#scene${index}", {opacity:1, y:0, duration:0.25, ease:"power2.out"}, ${at(0.03, 0.12)});
    tl.to("#scene${index} .eyebrow", {autoAlpha:1, y:0, duration:0.25, ease:"power2.out"}, ${at(0.06, 0.22)});
    tl.to("#scene${index} .body-copy", {autoAlpha:1, y:0, duration:0.3, ease:"power2.out"}, ${at(0.18, 0.55)});
    tl.to("#scene${index} .media-frame", {autoAlpha:1, y:0, rotateX:0, rotateY:0, scale:1, duration:0.28, ease:"power3.out"}, ${at(0.05, 0.12)});
    tl.fromTo("#scene${index} .media-float", {scale:0.94, rotateX:5, rotateY:${index % 2 ? -5 : 5}}, {scale:1, rotateX:0, rotateY:0, duration:0.38, ease:"expo.out"}, ${at(0.05, 0.12)});
    tl.to("#scene${index} .object-subtitle", {autoAlpha:1, y:0, duration:0.24, ease:"power2.out"}, ${at(0.12, 0.3)});
    tl.to("#scene${index} .proof-card", {autoAlpha:1, y:0, duration:0.28, ease:"back.out(1.2)"}, ${at(0.32, 0.9)});
    tl.fromTo("#scene${index} .proof-float", {scale:0.9, rotate:${index % 2 ? 2 : -2}}, {scale:1, rotate:0, duration:0.34, ease:"back.out(1.7)"}, ${at(0.32, 0.9)});
    tl.to("#scene${index} .visual-card, #scene${index} .trust-radar, #scene${index} .trust-ledger, #scene${index} .trust-card, #scene${index} .compare-panel, #scene${index} .compare-timeline, #scene${index} .step-stack, #scene${index} .step-card, #scene${index} .metric-grid, #scene${index} .metric-pill, #scene${index} .app-actions, #scene${index} .app-actions span, #scene${index} .launch-copy", {autoAlpha:1, y:0, duration:0.3, stagger:0.035, ease:"power2.out"}, ${at(0.2, 0.58)});
    tl.to("#scene${index} .object-caption", {autoAlpha:1, y:0, duration:0.26, ease:"power2.out"}, ${at(0.38, 1.05)});
    tl.to("#scene${index} .kinetic-stage", {autoAlpha:1, y:0, duration:0.08, ease:"none"}, ${at(0.16, 0.55)});
    tl.to("#scene${index} .kinetic-word", {autoAlpha:1, scale:1, rotate:0, duration:0.18, stagger:0.06, ease:"back.out(2.2)"}, ${at(0.18, 0.7)});
    tl.to("#scene${index} .kinetic-word", {autoAlpha:0, scale:1.24, duration:0.12, stagger:0.035, ease:"power2.in"}, ${at(0.48, 1.9)});
    tl.to("#scene${index} .kinetic-stage", {autoAlpha:0, duration:0.12, ease:"power2.in"}, ${at(0.52, 2.05)});
    tl.fromTo("#scene${index} .synthetic", {clipPath:"inset(0 100% 0 0)", filter:"blur(10px)"}, {clipPath:"inset(0 0% 0 0)", filter:"blur(0px)", duration:0.36, ease:"power3.out"}, ${at(0.08, 0.18)});
    tl.fromTo("#scene${index} .terminal-visual code", {textShadow:"0 0 0 rgba(0,0,0,0)", opacity:0}, {textShadow:"0 0 18px ${palette.primary}", opacity:1, duration:0.4, ease:"steps(8)"}, ${at(0.16, 0.4)});
    tl.to("#scene${index} .main-flow, #scene${index} .sub-flow", {strokeDashoffset:0, duration:0.56, stagger:0.08, ease:"power2.inOut"}, ${at(0.18, 0.45)});
    tl.fromTo("#scene${index} .big-node", {autoAlpha:0, scale:0.72}, {autoAlpha:1, scale:1, duration:0.26, stagger:0.05, ease:"back.out(1.8)"}, ${at(0.22, 0.55)});
    tl.fromTo("#scene${index} .orbit-item", {autoAlpha:0, scale:0, y:24}, {autoAlpha:1, scale:1, y:0, duration:0.26, stagger:0.05, ease:"back.out(2)"}, ${at(0.18, 0.45)});
    tl.fromTo("#scene${index} .burst-visual strong, #scene${index} .cta-visual strong", {scale:.72, autoAlpha:0}, {scale:1, autoAlpha:1, duration:.3, ease:"back.out(2)"}, ${at(0.14, 0.35)});
    tl.to("#scene${index} .flow-path", {strokeDashoffset:0, duration:0.5, ease:"power2.inOut"}, ${at(0.2, 0.5)});
    tl.fromTo("#scene${index} .flow-node", {autoAlpha:0, scale:0.74}, {autoAlpha:1, scale:1, duration:0.26, stagger:0.05, ease:"back.out(1.7)"}, ${at(0.23, 0.58)});
    tl.to("#scene${index} .icon-strip em", {autoAlpha:1, y:0, duration:0.2, stagger:0.04, ease:"back.out(1.4)"}, ${at(0.34, 0.88)});
    tl.to("#scene${index} .meta", {autoAlpha:1, y:0, duration:0.22, ease:"power2.out"}, ${at(0.34, 0.88)});
    ${index < scenes.length - 1 ? `tl.to("#grid-pixelate-overlay .grid-cell", {scale:1, duration:0.22, stagger:{amount:0.18, from:"center"}, ease:"power2.inOut"}, ${Math.max(scene.end - 0.42, scene.start + 0.5)});
    tl.to("#grid-pixelate-overlay .grid-cell", {scale:0, duration:0.22, stagger:{amount:0.18, from:"edges"}, ease:"power2.inOut"}, ${Math.max(scene.end - 0.18, scene.start + 0.7)});` : ""}
    tl.to("#scene${index} .cue", {autoAlpha:0, y:-18, duration:0.22, stagger:0.02, ease:"power2.in"}, ${exitAt});
    tl.to("#scene${index}", {opacity:0, y:-20, duration:0.25, ease:"power2.in"}, ${sceneOutAt});
    tl.set("#scene${index}", {visibility:"hidden"}, ${scene.end});
  `;
  }).join("\n");

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${aspect.width},height=${aspect.height},initial-scale=1">
  <title>${escapeHtml(job.topic || "Hypervideo")}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { width:${aspect.width}px; height:${aspect.height}px; margin:0; overflow:hidden; font-family: Arial, Helvetica, sans-serif; color:#f8fafc; background:${palette.bg}; }
    #root { position:relative; width:100%; height:100%; background:
      radial-gradient(circle at 25% 16%, ${palette.primary}44, transparent 34%),
      radial-gradient(circle at 80% 76%, ${palette.accent}33, transparent 38%),
      linear-gradient(160deg, ${palette.bg}, #0f172a); }
    .topbar { position:absolute; left:48px; right:48px; top:26px; display:flex; justify-content:flex-start; color:#cbd5e1; font-size:22px; font-weight:800; z-index:10; }
    .progress { position:absolute; left:48px; right:48px; bottom:28px; height:10px; border-radius:99px; background:rgba(255,255,255,.14); overflow:hidden; z-index:10; }
    .progress div { width:0%; height:100%; background:linear-gradient(90deg, ${palette.primary}, ${palette.accent}); }
    .scene { position:absolute; inset:0; padding:96px 62px 82px; display:grid; grid-template-rows:auto minmax(0,1fr); gap:26px; align-items:stretch; opacity:0; visibility:hidden; transform:translateY(34px); }
    .copy { min-width:0; z-index:2; }
    .eyebrow { display:inline-flex; width:max-content; max-width:920px; padding:14px 22px; border-radius:999px; background:${palette.primary}22; border:2px solid ${palette.primary}66; color:${palette.primary}; font-size:24px; font-weight:900; margin-bottom:18px; }
    .title-pill { width:auto; color:#f8fafc; font-size:${aspect.height > aspect.width ? 42 : 34}px; line-height:1.08; border-color:${palette.primary}; box-shadow:0 0 30px ${palette.primary}33; white-space:normal; }
    h1 { margin:0; font-size:${aspect.height > aspect.width ? 60 : 62}px; line-height:1; letter-spacing:0; max-width:920px; text-shadow:0 0 32px ${palette.primary}44; }
    p { margin:18px 0 0; font-size:${aspect.height > aspect.width ? 27 : 27}px; line-height:1.22; color:#cbd5e1; font-weight:700; max-width:900px; }
    .meta { margin-top:18px; padding:14px 18px; border-radius:20px; background:rgba(15,23,42,.72); border:1px solid rgba(226,232,240,.18); color:#94a3b8; font-size:18px; word-break:break-word; max-width:900px; }
    .visual { position:relative; min-height:0; height:100%; border-radius:36px; overflow:hidden; background:rgba(15,23,42,.42); border:1px solid rgba(226,232,240,.16); box-shadow:0 34px 90px rgba(0,0,0,.32); display:grid; grid-template-rows:auto minmax(0,1fr) auto; gap:18px; padding:26px; align-items:stretch; perspective:1200px; }
    .visual:before { content:""; position:absolute; inset:-22%; background:conic-gradient(from 120deg, ${palette.primary}22, transparent, ${palette.accent}22, transparent, ${palette.primary}22); animation:spin 12s linear infinite; opacity:.75; }
    .orb { position:absolute; width:360px; height:360px; border-radius:50%; filter:blur(4px); opacity:.62; animation:float 4s ease-in-out infinite alternate; }
    .orb.one { right:-120px; top:-80px; background:${palette.primary}55; }
    .orb.two { left:-120px; bottom:-110px; background:${palette.accent}55; animation-delay:.8s; }
    .visual-card, .icon-strip, .media-frame { position:relative; z-index:2; }
    .proof-card { padding:22px 24px; border-radius:24px; background:rgba(255,255,255,.92); color:#0f172a; box-shadow:0 18px 48px rgba(0,0,0,.22); transform-origin:center; }
    .compact-proof { padding:18px 22px; }
    .compact-proof p { display:none; }
    .proof-head { display:flex; justify-content:space-between; gap:16px; align-items:center; color:${palette.primary}; font-weight:900; text-transform:uppercase; font-size:18px; }
    .proof-card p { color:#334155; margin:12px 0 0; font-size:21px; line-height:1.18; word-break:break-word; }
    .icon-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .icon-strip em { min-height:66px; border-radius:20px; display:grid; place-items:center; background:${palette.primary}22; border:1px solid ${palette.primary}66; color:#fff; font-size:23px; font-style:normal; font-weight:900; animation:pop .9s ease both; }
    .visual-bottom { display:grid; gap:14px; position:relative; z-index:3; }
    .trust-panel { position:relative; z-index:3; padding:28px; border-radius:30px; background:rgba(255,255,255,.88); color:#0f172a; box-shadow:0 24px 60px rgba(15,23,42,.22); }
    .trust-panel strong { display:block; color:${palette.primary}; font-size:34px; line-height:1; margin-bottom:14px; }
    .trust-panel p { margin:0 0 22px; color:#334155; font-size:24px; max-width:none; }
    .trust-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
    .trust-card { min-height:120px; border-radius:22px; padding:18px; background:linear-gradient(145deg, #fff, ${palette.primary}18); border:1px solid ${palette.primary}44; display:grid; align-content:center; gap:8px; }
    .trust-card b { color:#0f172a; font-size:25px; }
    .trust-card small { color:#64748b; font-size:17px; line-height:1.25; }
    .trust-showcase { position:relative; z-index:3; min-height:0; display:grid; grid-template-columns:1.05fr .95fr; gap:18px; align-items:stretch; }
    .trust-radar { position:relative; z-index:3; min-height:380px; border-radius:34px; padding:34px; overflow:hidden; display:grid; align-content:center; gap:16px; background:radial-gradient(circle at 50% 50%, ${palette.primary}22, transparent 38%), linear-gradient(145deg, rgba(255,255,255,.88), rgba(255,255,255,.6)); color:#0f172a; border:1px solid ${palette.primary}44; box-shadow:0 22px 60px rgba(15,23,42,.2); }
    .trust-radar span { width:max-content; padding:8px 14px; border-radius:999px; color:${palette.primary}; background:${palette.primary}18; font-size:18px; font-weight:900; text-transform:uppercase; }
    .trust-radar strong { max-width:680px; color:#0f172a; font-size:46px; line-height:1.02; }
    .trust-radar p { max-width:760px; margin:0; color:#334155; font-size:25px; }
    .trust-radar i { position:absolute; right:10%; top:50%; width:260px; aspect-ratio:1; border-radius:50%; border:2px solid ${palette.primary}44; transform:translateY(-50%); animation:ripple 2.6s ease-out infinite; }
    .trust-radar .r2 { width:370px; animation-delay:.4s; border-color:${palette.accent}44; }
    .trust-radar .r3 { width:500px; animation-delay:.8s; }
    .trust-ledger { position:relative; z-index:3; display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .trust-ledger span { min-height:168px; padding:22px; border-radius:26px; color:#0f172a; background:rgba(255,255,255,.82); border:1px solid ${palette.primary}44; box-shadow:0 16px 38px rgba(15,23,42,.16); display:grid; align-content:start; gap:12px; }
    .trust-ledger b { color:${palette.primary}; font-size:23px; }
    .trust-ledger small { color:#334155; font-size:18px; line-height:1.25; }
    .compare-grid { position:relative; z-index:3; display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .compare-panel { min-height:190px; border-radius:28px; padding:24px; background:rgba(2,6,23,.64); border:1px solid rgba(255,255,255,.16); box-shadow:0 18px 44px rgba(0,0,0,.2); }
    .compare-panel span { display:inline-flex; padding:8px 14px; border-radius:999px; background:${palette.primary}22; color:${palette.primary}; font-size:18px; font-weight:900; text-transform:uppercase; }
    .compare-panel.after span { background:${palette.accent}22; color:${palette.accent}; }
    .compare-panel p { margin-top:16px; font-size:23px; color:#e2e8f0; max-width:none; }
    .compare-timeline { position:relative; z-index:3; display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .compare-timeline span { min-height:142px; padding:20px; border-radius:26px; background:rgba(255,255,255,.1); border:1px solid ${palette.primary}55; display:grid; gap:10px; align-content:center; }
    .compare-timeline b { color:${palette.primary}; font-size:24px; }
    .compare-timeline small { color:#dbeafe; font-size:18px; line-height:1.24; }
    .step-stack { position:relative; z-index:3; display:grid; grid-template-columns:1fr; gap:14px; }
    .step-card { display:grid; grid-template-columns:76px 1fr; gap:10px 16px; align-items:center; padding:18px; border-radius:24px; background:rgba(255,255,255,.1); border:1px solid ${palette.primary}55; color:#fff; }
    .step-card b { grid-row:1 / 3; width:66px; height:66px; display:grid; place-items:center; border-radius:20px; background:linear-gradient(135deg, ${palette.primary}, ${palette.accent}); font-size:24px; }
    .step-card span { font-size:25px; font-weight:900; }
    .step-card p { margin:0; color:#cbd5e1; font-size:18px; max-width:none; }
    .tutorial-split { position:relative; z-index:3; min-height:0; display:grid; grid-template-columns:.88fr 1.12fr; gap:18px; align-items:stretch; }
    .metric-grid { position:relative; z-index:3; display:grid; gap:16px; }
    .metric-pill { min-height:126px; padding:20px; border-radius:26px; background:rgba(255,255,255,.1); border:1px solid ${palette.primary}66; display:grid; gap:10px; color:#fff; overflow:hidden; }
    .metric-pill b { font-size:26px; }
    .metric-pill span { height:14px; width:var(--w); border-radius:999px; background:linear-gradient(90deg, ${palette.primary}, ${palette.accent}); box-shadow:0 0 24px ${palette.primary}66; }
    .metric-pill small { color:#cbd5e1; font-size:17px; line-height:1.25; }
    .app-actions { position:relative; z-index:3; display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .app-actions span { min-height:100px; padding:16px; border-radius:22px; background:rgba(255,255,255,.12); border:1px solid ${palette.primary}55; display:grid; place-items:center; text-align:center; }
    .app-actions b { font-size:26px; color:#fff; }
    .app-actions small { font-size:16px; color:#cbd5e1; }
    .app-demo-rail { position:relative; z-index:3; display:grid; grid-template-columns:.92fr 1.08fr; gap:16px; align-items:stretch; }
    .story-note { position:relative; z-index:5; }
    .launch-board { position:relative; z-index:3; min-height:0; display:grid; grid-template-rows:auto minmax(0,1fr); gap:18px; }
    .launch-copy { padding:26px; border-radius:28px; background:linear-gradient(135deg, rgba(2,6,23,.88), ${palette.primary}22); border:1px solid ${palette.primary}66; box-shadow:0 24px 60px rgba(0,0,0,.28); }
    .launch-copy span { display:inline-flex; padding:8px 14px; border-radius:999px; color:${palette.primary}; background:${palette.primary}22; font-size:18px; font-weight:900; text-transform:uppercase; }
    .launch-copy strong { display:block; margin-top:14px; color:#fff; font-size:36px; line-height:1.05; }
    .launch-copy p { margin-top:12px; color:#cbd5e1; max-width:none; font-size:23px; }
    .media-frame { min-height:0; padding:18px; border-radius:28px; border:1px solid rgba(226,232,240,.2); background:rgba(2,6,23,.72); color:#e2e8f0; display:grid; grid-template-rows:minmax(280px, 1fr) auto auto; gap:16px; align-items:stretch; transform-style:preserve-3d; }
    .object-stage { position:relative; min-height:230px; height:100%; overflow:hidden; border-radius:20px; background:#020617; display:grid; place-items:center; }
    .source-media { display:block; width:100%; height:100%; max-height:420px; object-fit:contain; border-radius:20px; background:#020617; }
    .synthetic { position:relative; width:100%; height:100%; min-height:350px; max-height:600px; border-radius:20px; overflow:hidden; background:radial-gradient(circle at 30% 20%, ${palette.primary}55, transparent 36%), radial-gradient(circle at 72% 78%, ${palette.accent}55, transparent 34%), rgba(2,6,23,.92); }
    .burst-visual { display:grid; place-items:center; text-align:center; padding:44px; }
    .burst-visual strong, .orbit-visual strong, .cta-visual strong { position:relative; z-index:3; color:#fff; font-size:54px; line-height:1; text-transform:uppercase; text-shadow:0 0 34px ${palette.primary}; }
    .burst-visual p, .cta-visual p { position:relative; z-index:3; margin:18px 0 0; color:#dbeafe; font-size:24px; max-width:760px; }
    .burst-visual i { position:absolute; left:50%; top:50%; width:16px; height:110px; border-radius:999px; background:linear-gradient(${palette.primary}, ${palette.accent}); transform:rotate(calc(var(--i) * 20deg)) translateY(-180px); transform-origin:0 180px; opacity:.55; animation:pulseRay 1.8s ease-in-out infinite alternate; animation-delay:calc(var(--i) * .04s); }
    .terminal-visual { padding:0; background:#050816; border:1px solid rgba(255,255,255,.16); }
    .terminal-top { height:58px; display:flex; align-items:center; gap:10px; padding:0 22px; background:rgba(255,255,255,.08); color:#fff; font-weight:900; }
    .terminal-top span { width:16px; height:16px; border-radius:50%; background:${palette.accent}; } .terminal-top span:nth-child(2) { background:${palette.primary}; } .terminal-top span:nth-child(3) { background:#facc15; }
    .terminal-visual pre { margin:0; padding:34px; color:#d1fae5; font-size:26px; line-height:1.45; white-space:pre-wrap; }
    .terminal-cursor { position:absolute; left:34px; bottom:34px; width:18px; height:34px; background:${palette.primary}; animation:blink .8s steps(1) infinite; }
    .flow-visual svg { position:absolute; inset:0; width:100%; height:100%; }
    .main-flow, .sub-flow { fill:none; stroke:${palette.primary}; stroke-width:8; stroke-linecap:round; stroke-dasharray:1200; stroke-dashoffset:1200; opacity:.85; }
    .sub-flow { stroke:${palette.accent}; stroke-width:5; opacity:.7; }
    .big-node { position:absolute; min-width:140px; min-height:78px; padding:14px 18px; border-radius:22px; display:grid; place-items:center; text-align:center; color:#fff; font-size:20px; font-weight:900; background:linear-gradient(135deg, ${palette.primary}, ${palette.accent}); box-shadow:0 22px 48px rgba(0,0,0,.35); translate:-50% -50%; opacity:0; }
    .node-0 { left:12%; top:50%; } .node-1 { left:32%; top:22%; } .node-2 { left:52%; top:52%; } .node-3 { left:72%; top:78%; } .node-4 { left:88%; top:50%; }
    .orbit-visual { display:grid; place-items:center; }
    .orbit-ring { position:absolute; width:62%; aspect-ratio:1; border-radius:50%; border:2px solid ${palette.primary}55; animation:spin 7s linear infinite; }
    .orbit-ring.r2 { width:78%; border-color:${palette.accent}55; animation-duration:10s; animation-direction:reverse; }
    .orbit-ring.r3 { width:42%; border-style:dashed; animation-duration:5s; }
    .orbit-item { position:absolute; width:86px; height:86px; border-radius:24px; display:grid; place-items:center; color:#fff; font-size:22px; font-style:normal; font-weight:900; background:rgba(255,255,255,.14); border:1px solid ${palette.primary}88; box-shadow:0 20px 44px rgba(0,0,0,.32); }
    .orbit-0 { left:12%; top:18%; } .orbit-1 { right:14%; top:18%; } .orbit-2 { right:9%; bottom:22%; } .orbit-3 { left:15%; bottom:18%; } .orbit-4 { left:45%; top:8%; } .orbit-5 { left:45%; bottom:8%; }
    .cta-visual { display:grid; place-items:center; text-align:center; padding:50px; }
    .cta-visual i { position:absolute; width:180px; height:180px; border-radius:50%; border:4px solid ${palette.accent}; animation:ripple 2s ease-out infinite; opacity:0; }
    .cta-visual i:nth-of-type(2) { animation-delay:.35s; } .cta-visual i:nth-of-type(3) { animation-delay:.7s; } .cta-visual i:nth-of-type(4) { animation-delay:1.05s; }
    .object-subtitle { position:relative; min-height:0; display:flex; align-items:flex-start; padding:22px 24px 22px 28px; border-left:7px solid ${palette.accent}; border-radius:22px; background:linear-gradient(135deg, rgba(2,6,23,.88), ${palette.accent}20 58%, ${palette.primary}16); color:${palette.accent}; font-size:${aspect.height > aspect.width ? 31 : 26}px; line-height:1.18; font-weight:900; box-shadow:0 18px 42px rgba(0,0,0,.32); overflow:hidden; }
    .object-subtitle::after { content:""; position:absolute; right:-42px; bottom:-70px; width:190px; height:190px; border-radius:50%; border:3px solid ${palette.primary}55; }
    .object-caption { margin-top:12px; padding:0 4px; }
    .object-caption small { display:block; color:#94a3b8; font-size:17px; line-height:1.25; text-transform:uppercase; letter-spacing:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .kinetic-stage { position:absolute; inset:26px; z-index:4; pointer-events:none; display:grid; place-items:center; }
    .kinetic-word { position:absolute; font-size:72px; line-height:.92; font-weight:900; text-transform:uppercase; color:#fff; text-shadow:0 0 20px ${palette.primary}, 0 0 60px ${palette.accent}; opacity:0; visibility:hidden; translate:-50% -50%; }
    .kinetic-word:nth-child(1) { left:18%; top:28%; } .kinetic-word:nth-child(2) { left:55%; top:22%; } .kinetic-word:nth-child(3) { left:78%; top:35%; }
    .kinetic-word:nth-child(4) { left:28%; top:52%; } .kinetic-word:nth-child(5) { left:66%; top:55%; } .kinetic-word:nth-child(6) { left:42%; top:74%; }
    .kinetic-word:nth-child(7) { left:78%; top:78%; } .kinetic-word:nth-child(8) { left:18%; top:78%; } .kinetic-word:nth-child(n+9) { left:50%; top:50%; font-size:56px; }
    .flow-mini { height:150px; position:relative; border-radius:24px; overflow:hidden; background:rgba(2,6,23,.28); border:1px solid rgba(255,255,255,.12); }
    .flow-mini svg { position:absolute; inset:0; width:100%; height:100%; }
    .flow-path { fill:none; stroke:url(#none); stroke:${palette.primary}; stroke-width:5; stroke-linecap:round; stroke-dasharray:900; stroke-dashoffset:900; opacity:.85; }
    .flow-node { position:absolute; min-width:116px; max-width:150px; min-height:48px; padding:10px 12px; border-radius:16px; display:grid; place-items:center; text-align:center; background:linear-gradient(135deg, ${palette.primary}, ${palette.accent}); color:#fff; font-size:16px; font-weight:900; box-shadow:0 16px 34px rgba(0,0,0,.24); translate:-50% -50%; opacity:0; }
    .flow-node.n0 { left:9%; top:52%; } .flow-node.n1 { left:30%; top:25%; } .flow-node.n2 { left:50%; top:72%; } .flow-node.n3 { left:72%; top:32%; } .flow-node.n4 { left:91%; top:52%; }
    #grid-pixelate-overlay { position:absolute; inset:0; z-index:999; pointer-events:none; display:grid; grid-template-columns:repeat(12,1fr); grid-template-rows:repeat(20,1fr); }
    #grid-pixelate-overlay .grid-cell { background:${palette.bg}; transform:scale(0); transform-origin:center; }
    .dynamic-0 .media-frame { rotate:-1deg; }
    .dynamic-1 .media-frame { rotate:1.5deg; }
    .dynamic-2 .proof-card { order:2; }
    .dynamic-3 .media-frame { box-shadow:0 30px 80px rgba(0,0,0,.34), 0 0 0 1px ${palette.primary}33; }
    .dynamic-4 .visual-bottom { order:1; }
    #root.combo-app-demo-flow .scene { grid-template-columns:.82fr 1.18fr; grid-template-rows:minmax(0,1fr); align-items:center; gap:30px; padding:90px 54px 82px; }
    #root.combo-app-demo-flow .copy { align-self:center; }
    #root.combo-app-demo-flow .title-pill { font-size:36px; }
    #root.combo-app-demo-flow .body-copy { font-size:25px; max-width:390px; }
    #root.combo-app-demo-flow .meta { max-width:390px; }
    #root.combo-app-demo-flow .visual { min-width:0; }
    #root.combo-quick-compare .scene { grid-template-rows:auto minmax(0,1fr); padding:84px 58px 82px; gap:20px; }
    #root.combo-quick-compare .copy { display:grid; grid-template-columns:auto minmax(0,1fr); gap:18px; align-items:center; }
    #root.combo-quick-compare .title-pill { margin:0; font-size:34px; }
    #root.combo-quick-compare .body-copy { margin:0; max-width:none; font-size:25px; }
    #root.combo-quick-compare .meta { display:none; }
    #root.combo-tutorial-steps .scene { grid-template-columns:.92fr 1.08fr; grid-template-rows:minmax(0,1fr); align-items:center; gap:28px; padding:92px 54px 84px; }
    #root.combo-tutorial-steps .copy { align-self:center; }
    #root.combo-tutorial-steps .title-pill { font-size:38px; }
    #root.combo-tutorial-steps .body-copy { font-size:25px; max-width:430px; }
    #root.combo-tutorial-steps .meta { max-width:430px; }
    #root.combo-infographic-cta .scene { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); padding:80px 60px 80px; }
    #root.combo-infographic-cta .copy { text-align:center; justify-self:center; }
    #root.combo-infographic-cta .title-pill { margin-left:auto; margin-right:auto; }
    #root.combo-infographic-cta .body-copy, #root.combo-infographic-cta .meta { max-width:900px; }
    #root.combo-privacy-trust-review .scene { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); padding:78px 58px 80px; }
    #root.combo-privacy-trust-review .copy { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:16px; }
    #root.combo-privacy-trust-review .title-pill { margin:0; color:#0f172a; background:rgba(255,255,255,.72); }
    #root.combo-privacy-trust-review .body-copy { margin:0; max-width:none; color:#0f172a; font-size:25px; }
    #root.combo-privacy-trust-review .meta { display:none; }
    #root.combo-creator-story .scene { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); padding:84px 56px 80px; }
    #root.combo-creator-story .copy { max-width:850px; justify-self:center; text-align:center; }
    #root.combo-creator-story .title-pill { margin-left:auto; margin-right:auto; border-radius:28px; }
    #root.combo-creator-story .body-copy { max-width:850px; }
    #root.combo-repo-launch-dynamic .scene { grid-template-rows:auto minmax(0,1fr); padding:86px 58px 80px; }
    #root.combo-evidence-explainer .scene { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); padding:78px 56px 80px; }
    #root.combo-evidence-explainer .copy { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:16px; }
    #root.combo-evidence-explainer .title-pill { margin:0; }
    #root.combo-evidence-explainer .body-copy { margin:0; max-width:none; font-size:25px; }
    #root.combo-evidence-explainer .meta { display:none; }
    #root.combo-repo-launch-dynamic .visual { grid-template-rows:minmax(0,1fr) auto; }
    #root.combo-repo-launch-dynamic .media-frame { grid-template-rows:minmax(320px,1fr) auto auto; }
    #root.combo-repo-launch-dynamic .object-stage { min-height:330px; }
    #root.combo-evidence-explainer .visual { grid-template-rows:minmax(0,1fr) auto auto; }
    #root.combo-evidence-explainer .media-frame { grid-template-rows:minmax(340px,1fr) auto auto; }
    #root.combo-evidence-explainer .proof-card { background:rgba(255,255,255,.96); }
    #root.combo-evidence-explainer .visual-bottom .icon-strip { display:none; }
    #root.combo-infographic-cta .visual { grid-template-rows:auto auto minmax(0,1fr); background:linear-gradient(150deg, rgba(2,6,23,.82), ${palette.primary}22); }
    #root.combo-infographic-cta .proof-card { background:rgba(2,6,23,.72); color:#f8fafc; border:1px solid ${palette.primary}66; }
    #root.combo-infographic-cta .proof-card p { color:#dbeafe; }
    #root.combo-infographic-cta .media-frame { grid-template-rows:minmax(300px,1fr) auto auto; border:0; background:transparent; box-shadow:none; }
    #root.combo-infographic-cta .object-stage { min-height:320px; background:transparent; }
    #root.combo-app-demo-flow .visual { grid-template-rows:minmax(0,1fr) auto auto; padding:22px; }
    #root.combo-app-demo-flow .proof-card { border-radius:18px; }
    #root.combo-app-demo-flow .media-frame { grid-template-rows:minmax(360px,1fr) auto auto; border-radius:22px; }
    #root.combo-app-demo-flow .object-stage { min-height:420px; }
    #root.combo-app-demo-flow .source-media { max-height:none; object-fit:cover; }
    #root.combo-tutorial-steps .visual { grid-template-columns:1fr; grid-template-rows:minmax(0,1fr) auto auto; }
    #root.combo-tutorial-steps .media-frame { grid-template-rows:minmax(380px,1fr) auto auto; width:100%; }
    #root.combo-tutorial-steps .compact-steps { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    #root.combo-tutorial-steps .compact-steps .step-card { min-height:96px; padding:14px; }
    #root.combo-tutorial-steps .compact-steps .step-card p { display:none; }
    #root.combo-tutorial-steps .visual-bottom { grid-column:1; }
    #root.combo-quick-compare .visual { grid-template-columns:1fr 1fr; grid-template-rows:auto auto minmax(0,1fr) auto; }
    #root.combo-quick-compare .proof-card, #root.combo-quick-compare .compare-grid, #root.combo-quick-compare .media-frame, #root.combo-quick-compare .visual-bottom { grid-column:1 / -1; }
    #root.combo-quick-compare .media-frame { grid-template-rows:minmax(260px,1fr) auto auto; }
    #root.combo-privacy-trust-review .visual { grid-template-columns:1fr; grid-template-rows:minmax(0,1fr) auto; background:rgba(248,251,255,.72); color:#0f172a; }
    #root.combo-privacy-trust-review .media-frame { grid-row:auto; background:rgba(255,255,255,.78); border-color:${palette.primary}55; grid-template-rows:minmax(360px,1fr) auto auto; }
    #root.combo-privacy-trust-review .object-stage { background:#f8fafc; min-height:460px; }
    #root.combo-privacy-trust-review .source-media { max-height:none; object-fit:cover; }
    #root.combo-privacy-trust-review .object-subtitle { color:#0f766e; background:rgba(15,118,110,.1); }
    #root.combo-privacy-trust-review .layout-1 { grid-template-rows:auto minmax(0,1fr) auto; }
    #root.combo-privacy-trust-review .layout-1 .trust-grid { grid-template-columns:repeat(4,1fr); }
    #root.combo-privacy-trust-review .layout-2 { grid-template-rows:auto minmax(0,1fr) auto; }
    #root.combo-privacy-trust-review .layout-2 .media-frame { grid-template-rows:minmax(330px,1fr) auto auto; }
    #root.combo-privacy-trust-review .visual-bottom { grid-column:auto; }
    #root.combo-creator-story .visual { grid-template-rows:minmax(0,1fr) auto auto; border-radius:48px; }
    #root.combo-creator-story .proof-card { background:rgba(2,6,23,.82); color:#f8fafc; border:1px solid ${palette.accent}66; }
    #root.combo-creator-story .proof-card p { color:#e2e8f0; }
    #root.combo-creator-story .media-frame { grid-template-rows:minmax(420px,1fr) auto auto; background:rgba(2,6,23,.52); }
    ${aspect.height > aspect.width ? `
    #root.combo-app-demo-flow .scene,
    #root.combo-tutorial-steps .scene,
    #root.combo-privacy-trust-review .scene,
    #root.combo-quick-compare .scene {
      grid-template-columns:1fr;
      grid-template-rows:auto minmax(0,1fr);
      align-items:stretch;
      padding:82px 58px 80px;
    }
    #root.combo-app-demo-flow .scene { grid-template-columns:.78fr 1.22fr; grid-template-rows:minmax(0,1fr); gap:26px; }
    #root.combo-tutorial-steps .scene { grid-template-columns:.88fr 1.12fr; grid-template-rows:minmax(0,1fr); gap:26px; }
    #root.combo-quick-compare .scene { grid-template-rows:auto minmax(0,1fr); gap:18px; }
    #root.combo-privacy-trust-review .scene { grid-template-rows:auto minmax(0,1fr); gap:20px; }
    #root.combo-app-demo-flow .copy,
    #root.combo-tutorial-steps .copy,
    #root.combo-privacy-trust-review .copy,
    #root.combo-quick-compare .copy {
      align-self:auto;
      max-width:none;
      display:block;
      text-align:left;
    }
    #root.combo-app-demo-flow .body-copy,
    #root.combo-app-demo-flow .meta,
    #root.combo-tutorial-steps .body-copy,
    #root.combo-tutorial-steps .meta,
    #root.combo-privacy-trust-review .body-copy,
    #root.combo-privacy-trust-review .meta,
    #root.combo-quick-compare .body-copy,
    #root.combo-quick-compare .meta {
      max-width:900px;
    }
    #root.combo-app-demo-flow .visual,
    #root.combo-tutorial-steps .visual,
    #root.combo-privacy-trust-review .visual,
    #root.combo-quick-compare .visual {
      min-width:0;
      width:100%;
      grid-template-columns:1fr;
      grid-template-rows:minmax(0,1fr) auto auto;
      justify-items:stretch;
    }
    #root.combo-app-demo-flow .visual,
    #root.combo-tutorial-steps .visual {
      grid-template-rows:minmax(0,1fr);
      gap:16px;
      padding:22px;
    }
    #root.combo-app-demo-flow .app-demo-rail,
    #root.combo-tutorial-steps .tutorial-split,
    #root.combo-privacy-trust-review .trust-showcase {
      min-height:0;
      grid-template-columns:1fr;
      grid-template-rows:auto minmax(0,1fr);
    }
    #root.combo-app-demo-flow .app-actions,
    #root.combo-privacy-trust-review .trust-ledger,
    #root.combo-privacy-trust-review .layout-1 .trust-grid,
    #root.combo-quick-compare .compare-timeline {
      grid-template-columns:repeat(2,1fr);
    }
    #root.combo-privacy-trust-review .trust-radar {
      min-height:360px;
    }
    #root.combo-privacy-trust-review .trust-ledger span,
    #root.combo-quick-compare .compare-timeline span {
      min-height:126px;
    }
    #root.combo-privacy-trust-review .media-frame,
    #root.combo-privacy-trust-review .visual-bottom,
    #root.combo-quick-compare .proof-card,
    #root.combo-quick-compare .compare-grid,
    #root.combo-quick-compare .media-frame,
    #root.combo-quick-compare .visual-bottom {
      grid-column:1;
      grid-row:auto;
    }
    #root.combo-privacy-trust-review .media-frame,
    #root.combo-quick-compare .media-frame {
      width:100%;
      max-width:900px;
      justify-self:center;
    }
    #root.combo-privacy-trust-review .media-frame {
      grid-template-rows:minmax(360px,1fr) auto;
    }
    #root.combo-privacy-trust-review .object-caption {
      display:none;
    }
    #root.combo-privacy-trust-review .object-stage {
      min-height:360px;
    }
    #root.combo-privacy-trust-review .trust-panel {
      width:100%;
      max-width:900px;
      justify-self:center;
      padding:22px;
    }
    #root.combo-privacy-trust-review .trust-grid {
      grid-template-columns:repeat(4,1fr);
    }
    #root.combo-quick-compare .compare-grid {
      grid-template-columns:1fr 1fr;
    }
    ` : ""}
    @keyframes float { from { transform:translateY(-10px) scale(1); } to { transform:translateY(18px) scale(1.06); } }
    @keyframes spin { from { transform:rotate(0deg) scale(1.1); } to { transform:rotate(360deg) scale(1.1); } }
    @keyframes pop { from { transform:translateY(18px) scale(.92); opacity:0; } to { transform:translateY(0) scale(1); opacity:1; } }
    @keyframes blink { 50% { opacity:0; } }
    @keyframes ripple { from { transform:scale(.2); opacity:.8; } to { transform:scale(3.2); opacity:0; } }
    @keyframes pulseRay { from { opacity:.18; height:80px; } to { opacity:.75; height:150px; } }
    @media (max-width:1200px) { h1 { font-size:56px; } }
  </style>
</head>
<body>
  <div id="root" class="combo-${escapeHtml(combo.id)}" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${aspect.width}" data-height="${aspect.height}">
    ${audioTag}
    <div class="topbar"><span>Hypervideo</span></div>
    ${sceneHtml}
    <div id="grid-pixelate-overlay"></div>
    <div class="progress"><div id="bar"></div></div>
  </div>
  <script>
    (function(){
      gsap.config({ nullTargetWarn: false });
      const overlay = document.getElementById("grid-pixelate-overlay");
      for (let i = 0; i < 240; i++) {
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        overlay.appendChild(cell);
      }
    })();
    const tl = gsap.timeline({paused:true});
    ${timelineJs}
    tl.to("#bar", {width:"100%", duration:${duration}, ease:"none"}, 0);
    window.__timelines = window.__timelines || {};
    window.__timelines.main = tl;
  </script>
</body>
</html>`;
}

async function probe(filePath) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=index,codec_type,codec_name,width,height,duration",
      "-show_entries", "format=duration,size",
      "-of", "json",
      filePath
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    return { error: error.message };
  }
}

async function mediaDuration(filePath) {
  const info = await probe(filePath);
  const formatDuration = Number(info?.format?.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) return formatDuration;
  const streamDuration = Number((info?.streams || []).find((stream) => stream.duration)?.duration);
  return Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : 0;
}

function copyPreparedMediaAssets(job, workspace, onLog) {
  const prepared = Array.isArray(job.mediaAssets) ? job.mediaAssets : [];
  if (!prepared.length) return [];
  const assetsDir = path.join(workspace, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const copied = [];
  const tempRoots = new Set();
  prepared.forEach((asset, index) => {
    if (!asset?.path || !fs.existsSync(asset.path)) return;
    const resolvedAsset = path.resolve(asset.path);
    if (resolvedAsset.startsWith(TEMP_DIR + path.sep)) {
      const relative = path.relative(TEMP_DIR, resolvedAsset);
      const [tempRoot] = relative.split(path.sep);
      if (tempRoot) tempRoots.add(path.join(TEMP_DIR, tempRoot));
    }
    const ext = path.extname(asset.path) || (asset.kind === "video" ? ".mp4" : ".png");
    const target = path.join(assetsDir, `source-${index + 1}${ext}`);
    if (resolvedAsset !== path.resolve(target)) fs.copyFileSync(asset.path, target);
    copied.push({ ...asset, path: target });
  });
  if (copied.length) onLog?.(`Using ${copied.length} prepared media asset(s) from writer preview`);
  for (const tempRoot of tempRoots) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      onLog?.(`Cleaned temp writer workspace: ${path.basename(tempRoot)}`);
    } catch (error) {
      onLog?.(`Không xoá được temp writer workspace ${path.basename(tempRoot)}: ${error.message}`);
    }
  }
  return copied;
}

async function processJob(job, state, onLog) {
  const catalogs = state.catalogs;
  const workspace = workspaceFor(job);
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, "assets"), { recursive: true });
  job.workspace = workspace;

  onLog?.("Đang đọc nguồn/link...");
  job.sourceContext = job.sourceContext || await collectSourceContext(job, onLog);
  if (job.sourceContext?.name) job.topic = job.sourceContext.name;
  const preparedMedia = copyPreparedMediaAssets(job, workspace, onLog);
  const mediaPromise = preparedMedia.length
    ? Promise.resolve(preparedMedia)
    : (async () => {
        onLog?.("Đang tải media dẫn chứng từ nguồn...");
        try {
          return await collectSourceMedia(job, workspace, onLog);
        } catch (error) {
          onLog?.(`Tải media dẫn chứng thất bại: ${error.message}`);
          return [];
        }
      })();
  onLog?.("Đang chuẩn bị nội dung video...");
  await resolveJobScript(job, state, onLog);
  job.script = mergeShortScriptLines(normalizeNarrationScriptLines(job.script, job), Number(job.options.durationSeconds || 60));
  job.mediaAssets = await mediaPromise;

  const voice = catalogs.voices.find((item) => item.id === job.options.voice);
  const requestedVoicePath = job.options.voicePath || voice?.path || "";
  if (voice?.provider === "vieneu-tts" && !job.options.voiceName && voice.voiceName) {
    job.options.voiceName = voice.voiceName;
  }
  if (job.options.voice && job.options.voice !== "none") {
    if (job.options.voice === "local-file" && requestedVoicePath && fs.existsSync(requestedVoicePath)) {
      const ext = path.extname(requestedVoicePath) || ".wav";
      const target = path.join(workspace, "assets", `voice${ext}`);
      fs.copyFileSync(requestedVoicePath, target);
      job.voicePath = target;
    } else {
      job.voicePath = await generateVietnameseVoice(job, workspace, onLog);
    }
    if (job.voicePath && fs.existsSync(job.voicePath)) {
      const voiceDuration = await mediaDuration(job.voicePath);
      if (voiceDuration > 0) {
        const syncedDuration = Math.max(6, Math.ceil((voiceDuration + 0.4) * 10) / 10);
        job.options.durationSeconds = syncedDuration;
        onLog?.(`Synced video duration to voice: ${syncedDuration}s`);
      }
    }
  }

  writeHyperArtifacts(job, catalogs, workspace, onLog);
  const html = renderHtml(job, catalogs);
  const htmlPath = path.join(workspace, "index.html");
  fs.writeFileSync(htmlPath, html);
  job.previewPath = htmlPath;

  const outPath = path.join(workspace, "output.mp4");
  const cli = state.settings.hyperframesCli;
  if (!cli || !fs.existsSync(cli)) {
    job.result = { previewPath: htmlPath, renderSkipped: "HyperFrames CLI not found" };
    return job.result;
  }

  const requestedResolution = job.options.resolution && job.options.resolution !== "draft"
    ? String(job.options.resolution)
    : "1080p";
  const renderAspect = catalogs.aspects.find((item) => item.id === job.options.aspect) || catalogs.aspects[0];
  const isPortrait = renderAspect.height > renderAspect.width;
  const isSquare = renderAspect.height === renderAspect.width;
  const resolution = isPortrait
    ? (requestedResolution.includes("4k") ? "portrait-4k" : "portrait")
    : isSquare
      ? (requestedResolution.includes("4k") ? "square-4k" : "square")
      : requestedResolution;
  const renderArgs = [cli, "render", workspace, "-o", outPath];
  if (resolution) renderArgs.push("--resolution", resolution);
  if (job.options.renderFormat) renderArgs.push("--format", job.options.renderFormat);
  if (job.options.fps) renderArgs.push("--fps", String(job.options.fps));
  if (job.options.renderQuality) renderArgs.push("--quality", job.options.renderQuality);
  if (job.options.workers) renderArgs.push("--workers", String(job.options.workers));
  if (job.options.crf) renderArgs.push("--crf", String(job.options.crf));
  if (job.options.videoBitrate) renderArgs.push("--video-bitrate", String(job.options.videoBitrate));
  if (job.options.gpu === true) renderArgs.push("--gpu");
  if (job.options.gpu === false) renderArgs.push("--no-gpu");
  if (job.options.hdr === true) renderArgs.push("--hdr");
  if (job.options.sdr === true) renderArgs.push("--sdr");
  if (job.options.lowMemoryMode === false) renderArgs.push("--no-low-memory-mode");

  onLog?.(`Đang render video bằng HyperFrames (${resolution || "default"}${job.options.fps ? `, ${job.options.fps}fps` : ""})...`);
  await run("node", renderArgs, {
    cwd: workspace,
    onLog
  });

  let finalPath = outPath;
  if (job.voicePath) {
    finalPath = path.join(workspace, "final.mp4");
    const videoDuration = await mediaDuration(outPath);
    const voiceDuration = await mediaDuration(job.voicePath);
    if (voiceDuration > videoDuration + 0.25) {
      onLog?.(`Mux warning: rendered video ${videoDuration.toFixed(2)}s is shorter than voice ${voiceDuration.toFixed(2)}s; keeping full audio duration.`);
    }
    onLog?.("Đang ghép voice vào MP4...");
    await run("ffmpeg", [
      "-y",
      "-i", outPath,
      "-i", job.voicePath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      finalPath
    ], { cwd: workspace, onLog });
    onLog?.("Đã ghép voice vào MP4.");
  }

  job.outputPath = finalPath;
  job.result = {
    outputPath: finalPath,
    previewPath: htmlPath,
    probe: await probe(finalPath),
    finishedAt: now()
  };
  return job.result;
}

module.exports = {
  collectSourceContext,
  collectSourceMedia,
  processJob,
  safeName,
  scriptFromJob,
  workspaceFor
};
