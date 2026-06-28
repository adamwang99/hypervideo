#!/usr/bin/env python3
import argparse
import inspect
import json
import os
from pathlib import Path

import numpy as np


SENTENCE_BREAKS = (".", "?", "!", "…")
SOFT_BREAKS = (",", ";", ":")


def latest_snapshot(cache_dir: Path, required_files):
    snapshots_dir = cache_dir / "snapshots"
    if not snapshots_dir.exists():
        return None
    candidates = sorted(
        [item for item in snapshots_dir.iterdir() if item.is_dir()],
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for candidate in candidates:
        if all((candidate / required).exists() for required in required_files):
            return candidate
    return None


def resolve_local_vieneu_paths():
    hub = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache" / "huggingface" / "hub"))
    model_dir = Path(os.environ["VIENEU_MODEL_DIR"]) if os.environ.get("VIENEU_MODEL_DIR") else latest_snapshot(
        hub / "models--pnnbao-ump--VieNeu-TTS-v3-Turbo",
        ["config.json", "tokenizer.json", "onnx/vieneu_prefill.onnx", "onnx/vieneu_decode_step.onnx", "onnx/vieneu_acoustic_cached.onnx", "onnx/vieneu_v3_heads.npz"],
    )
    codec_dir = Path(os.environ["VIENEU_CODEC_DIR"]) if os.environ.get("VIENEU_CODEC_DIR") else latest_snapshot(
        hub / "models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano-ONNX",
        ["moss_audio_tokenizer_decode_full.onnx", "moss_audio_tokenizer_encode.onnx"],
    )
    if not model_dir or not model_dir.exists():
        raise SystemExit("VieNeu offline model cache is missing: VieNeu-TTS-v3-Turbo. Run online setup once, then retry offline.")
    if not codec_dir or not codec_dir.exists():
        raise SystemExit("VieNeu offline codec cache is missing: MOSS-Audio-Tokenizer-Nano-ONNX. Run online setup once, then retry offline.")
    onnx_dir = Path(os.environ["VIENEU_ONNX_DIR"]) if os.environ.get("VIENEU_ONNX_DIR") else model_dir / "onnx"
    if not onnx_dir.exists():
        raise SystemExit(f"VieNeu offline ONNX directory is missing: {onnx_dir}")
    return model_dir, onnx_dir, codec_dir


def split_line_for_tts(line: str, limit: int = 105):
    line = " ".join(line.split()).strip()
    if not line:
        return []
    chunks = []
    while len(line) > limit:
        cut = -1
        for mark in SENTENCE_BREAKS:
            cut = max(cut, line.rfind(mark, 0, limit))
        if cut >= 62:
            cut += 1
        else:
            soft = -1
            for mark in SOFT_BREAKS:
                soft = max(soft, line.rfind(mark, 0, limit))
            cut = soft + 1 if soft >= 68 else line.rfind(" ", 0, limit)
        if cut < 62:
            cut = limit
        chunks.append(line[:cut].strip())
        line = line[cut:].strip()
    if line:
        chunks.append(line)
    return chunks


def frame_budget_for_text(text: str, requested_max: int):
    word_count = len(text.split())
    budget = max(460, 240 + int(len(text) * 3.2), 180 + word_count * 42)
    return min(max(requested_max, budget), 1600)


def main():
    parser = argparse.ArgumentParser(description="Generate Vietnamese speech with the official local VieNeu TTS SDK.")
    parser.add_argument("text_file")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--voice", default="Ngọc Lan")
    parser.add_argument("--ref-audio", default="")
    parser.add_argument("--emotion", default="natural")
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=25)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--max-new-frames", type=int, default=360)
    parser.add_argument("--seconds", type=float, default=None)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--backend", default=os.environ.get("VIENEU_BACKEND", "onnx"))
    args = parser.parse_args()

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

    raw_text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not raw_text:
        raise SystemExit("empty text")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    model_dir, onnx_dir, codec_dir = resolve_local_vieneu_paths()
    from vieneu import Vieneu
    tts = Vieneu(
        mode="v3turbo",
        backend=args.backend,
        backbone_repo=str(model_dir),
        onnx_repo=str(model_dir),
        onnx_dir=str(onnx_dir),
        codec_dir=str(codec_dir),
        hf_token=False,
    )
    infer_params = inspect.signature(tts.infer).parameters
    kwargs = {}
    if args.ref_audio:
        kwargs["ref_audio"] = args.ref_audio
    elif args.voice:
        kwargs["voice"] = args.voice

    base_optional_args = {
        "emotion": args.emotion,
        "temperature": args.temperature,
        "top_k": args.top_k,
        "top_p": args.top_p,
    }
    for key, value in base_optional_args.items():
        if key in infer_params:
            kwargs[key] = value

    lines = [line.strip() for line in raw_text.splitlines()]
    chunks = []
    for line in lines:
        if not line:
            if chunks and chunks[-1] is not None:
                chunks.append(None)
            continue
        chunks.extend(split_line_for_tts(line))

    rendered = []
    sentence_silence = np.zeros(int(48000 * 0.30), dtype=np.float32)
    paragraph_silence = np.zeros(int(48000 * 0.68), dtype=np.float32)
    tail_silence = np.zeros(int(48000 * 0.42), dtype=np.float32)
    for chunk in chunks:
        if chunk is None:
            rendered.append(paragraph_silence)
            continue
        chunk_kwargs = dict(kwargs)
        if "max_new_frames" in infer_params:
            chunk_kwargs["max_new_frames"] = frame_budget_for_text(chunk, args.max_new_frames)
        audio = np.asarray(tts.infer(chunk, **chunk_kwargs), dtype=np.float32).reshape(-1)
        rendered.append(audio)
        rendered.append(sentence_silence)

    if rendered and rendered[-1] is sentence_silence:
        rendered[-1] = tail_silence
    else:
        rendered.append(tail_silence)
    audio = np.concatenate(rendered if rendered else [tail_silence])
    tts.save(audio, output)
    print(json.dumps({
        "ok": True,
        "provider": "vieneu-sdk-local",
        "offline": True,
        "modelDir": str(model_dir),
        "codecDir": str(codec_dir),
        "voice": args.voice,
        "refAudio": args.ref_audio or None,
        "chunks": sum(1 for item in chunks if item is not None),
        "pauses": sum(1 for item in chunks if item is None),
        "output": str(output)
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
