# Hypervideo

Ứng dụng nhẹ để tạo video HyperFrames theo queue, dùng được cho cả người dùng và AI Agent.

## Chạy app

```bash
cd /Users/adam/Hypervideo
npm start
```

Mở:

```text
http://localhost:8787
```

## Tính năng hiện có

- Dán một hoặc nhiều link/nội dung.
- Tạo một video cho mỗi link hoặc gộp nhiều link thành một video.
- Chọn template, hiệu ứng, tone màu, khổ hình, độ phân giải, độ dài, voice.
- Queue xử lý tuần tự.
- Tự lưu nháp form tạo video.
- Lưu lịch sử job/video trong `data/state.json`.
- Quản lý thêm/sửa/xoá/clone:
  - templates
  - effects
  - palettes
  - voices
  - API xử lý
  - local writers
- API đơn giản cho agent.
- Render bằng HyperFrames CLI local nếu có.
- Nếu chọn voice local, app tự ghép voice vào MP4 bằng FFmpeg sau render.
- Sync registry HyperFrames vào UI: block trở thành template, component trở thành hiệu ứng.
- Agent có thể gọi passthrough HyperFrames CLI qua allowlist lệnh.

## API nhanh cho agent

Tạo nhiều job:

```bash
curl -X POST http://localhost:8787/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "links": [
      "https://github.com/voocel/ainovel-cli",
      "https://example.com/post-2"
    ],
    "mode": "one-video-per-link",
    "template": "launch-card",
    "palette": "dark-neon",
    "aspect": "vertical",
    "resolution": "1080p",
    "durationSeconds": 60,
    "voice": "vieneu-demo",
    "voicePath": "/Users/adam/Desktop/ainovel-promo/assets/narration_vieneu.wav",
    "renderQuality": "standard",
    "fps": 30,
    "tone": "tiếng Việt ngắn gọn, có CTA",
    "cta": "Star repo, cài CLI và thử ngay hôm nay."
  }'
```

Xem state:

```bash
curl http://localhost:8787/api/state
```

Chạy queue:

```bash
curl -X POST http://localhost:8787/api/queue/start
```

Sync toàn bộ catalog HyperFrames local:

```bash
curl -X POST http://localhost:8787/api/hyperframes/catalog/sync
```

Xem khả năng HyperFrames đang mở cho agent:

```bash
curl http://localhost:8787/api/hyperframes/capabilities
```

Gọi HyperFrames CLI trực tiếp qua API có allowlist:

```bash
curl -X POST http://localhost:8787/api/hyperframes/run \
  -H 'content-type: application/json' \
  -d '{
    "command": "doctor",
    "args": [],
    "cwd": "/Users/adam/Hypervideo"
  }'
```

## Debug render

- Nếu job chạy xong nhưng MP4 không có tiếng, kiểm tra `voicePath`. Voice `local-file` cần đường dẫn file thật, ví dụ `/Users/adam/Desktop/ainovel-promo/assets/narration_vieneu.wav`.
- Log HyperFrames nằm trong `data/state.json` theo từng job, trường `logs`.
- File render nằm trong `projects/<slug-job>/`. Khi có voice, file cuối là `final.mp4`; file `output.mp4` là video gốc từ HyperFrames.
- Có thể kiểm tra stream bằng:

```bash
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,duration -show_entries format=duration,size -of json projects/.../final.mp4
```

## Cấu trúc

```text
Hypervideo/
├── server.js              # HTTP server + API + queue worker
├── lib/
│   ├── store.js           # JSON state
│   └── render.js          # HTML generator + HyperFrames/FFmpeg render
├── public/
│   ├── index.html         # UI
│   ├── styles.css
│   └── app.js
├── data/state.json        # Tự sinh khi chạy app
└── projects/              # Workspace render từng video
```

## Ghi chú

App không dùng framework frontend, không cần database, không cần dependency npm. Mục tiêu là nhẹ, dễ sửa, dễ cho agent thao tác qua API.
