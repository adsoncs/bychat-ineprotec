#!/usr/bin/env python3
"""Diarização soberana (quem falou) para reuniões presenciais — SEM API externa,
SEM modelo gated do HuggingFace. Pipeline: ffmpeg → resemblyzer (embeddings de voz
neurais, pesos embutidos no pacote) → clustering aglomerativo (cosine).

Uso:  python3 diarize.py <audio> [--max-speakers N] [--speakers N]
Saída (stdout, JSON):
  {"segments":[{"start":s,"end":s,"speaker":"Falante 1"}], "num_speakers":N}
  {"error":"..."} em falha (o chamador cai no modo sem diarização).

Projetado para casar com a transcrição do whisper: o chamador atribui a cada
trecho transcrito o falante cujas janelas têm maior sobreposição temporal.
"""
import sys
import os
import json
import tempfile
import subprocess

THRESHOLD = float(os.environ.get('DIARIZE_THRESHOLD', '0.55'))  # distância cosine p/ separar falantes
MAX_SPEAKERS = 8


def fail(msg):
    print(json.dumps({"error": str(msg)}))
    sys.exit(0)


def decode_to_wav16k(src):
    """Converte qualquer container (webm/ogg/m4a/mp3/wav) em wav 16k mono via ffmpeg."""
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    subprocess.run(
        ['ffmpeg', '-y', '-i', src, '-ar', '16000', '-ac', '1', tmp.name],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return tmp.name


def main():
    if len(sys.argv) < 2:
        fail('uso: diarize.py <audio>')
    src = sys.argv[1]
    forced = None
    max_spk = MAX_SPEAKERS
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == '--speakers' and i + 1 < len(args):
            forced = int(args[i + 1])
        if a == '--max-speakers' and i + 1 < len(args):
            max_spk = int(args[i + 1])

    if not os.path.exists(src):
        fail('arquivo não encontrado')

    wav_path = None
    try:
        import numpy as np
        from resemblyzer import VoiceEncoder, preprocess_wav
        from sklearn.cluster import AgglomerativeClustering

        wav_path = decode_to_wav16k(src)
        wav = preprocess_wav(wav_path)  # já 16k mono, normaliza/trim silêncio
        if wav is None or len(wav) < 16000:  # < 1s → um falante
            print(json.dumps({"segments": [{"start": 0.0, "end": None, "speaker": "Falante 1"}], "num_speakers": 1}))
            return

        encoder = VoiceEncoder(verbose=False)
        # Embeddings parciais ao longo do tempo + as fatias (em amostras) de cada um.
        _, partials, slices = encoder.embed_utterance(wav, return_partials=True, rate=1.3)
        if partials is None or len(partials) == 0:
            print(json.dumps({"segments": [{"start": 0.0, "end": None, "speaker": "Falante 1"}], "num_speakers": 1}))
            return

        # Tempo (s) de cada janela parcial.
        times = [(s.start / 16000.0, s.stop / 16000.0) for s in slices]

        if len(partials) == 1:
            labels = np.array([0])
        elif forced and forced >= 1:
            n = min(forced, len(partials), max_spk)
            labels = AgglomerativeClustering(n_clusters=n, metric='cosine', linkage='average').fit_predict(partials)
        else:
            # Nº de falantes desconhecido: threshold de distância; limita a max_spk.
            labels = AgglomerativeClustering(
                n_clusters=None, distance_threshold=THRESHOLD, metric='cosine', linkage='average',
            ).fit_predict(partials)
            if len(set(labels)) > max_spk:
                labels = AgglomerativeClustering(n_clusters=max_spk, metric='cosine', linkage='average').fit_predict(partials)

        # Renumera falantes por ordem de aparição (Falante 1, 2, …).
        order = {}
        for lab in labels:
            if lab not in order:
                order[lab] = len(order) + 1

        # Constrói turnos: agrupa janelas consecutivas do mesmo falante.
        segments = []
        cur_lab = None
        cur_start = None
        cur_end = None
        for (st, en), lab in zip(times, labels):
            if lab != cur_lab:
                if cur_lab is not None:
                    segments.append({"start": round(cur_start, 2), "end": round(cur_end, 2), "speaker": f"Falante {order[cur_lab]}"})
                cur_lab = lab
                cur_start = st
            cur_end = en
        if cur_lab is not None:
            segments.append({"start": round(cur_start, 2), "end": round(cur_end, 2), "speaker": f"Falante {order[cur_lab]}"})

        print(json.dumps({"segments": segments, "num_speakers": len(order)}))
    except Exception as e:  # noqa: BLE001
        fail(e)
    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass


if __name__ == '__main__':
    main()
