"""Private, local PCM recognition and synthesis. JSONL over stdin/stdout only."""
import base64
import contextlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np
import sherpa_onnx
from scipy.signal import resample_poly
from opencc import OpenCC

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / 'models'

class SpeechEngine:
    def __init__(self):
        self.cc = OpenCC('t2s')
        self.asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(MODELS / 'asr/model.int8.onnx'),
            tokens=str(MODELS / 'asr/tokens.txt'), num_threads=4,
            language='zh', use_itn=True, debug=False)
        self.vad_config = sherpa_onnx.VadModelConfig()
        self.vad_config.silero_vad.model = str(MODELS / 'asr/vad.onnx')
        self.vad_config.silero_vad.min_speech_duration = 0.2
        self.vad_config.sample_rate = 16000
        matcha = sherpa_onnx.OfflineTtsMatchaModelConfig(
            acoustic_model=str(MODELS / 'tts/model-steps-3.onnx'),
            vocoder=str(MODELS / 'tts/vocos.onnx'),
            lexicon=str(MODELS / 'tts/lexicon.txt'),
            tokens=str(MODELS / 'tts/tokens.txt'))
        model = sherpa_onnx.OfflineTtsModelConfig(matcha=matcha, num_threads=4, debug=False, provider='cpu')
        config = sherpa_onnx.OfflineTtsConfig(
            model=model,
            rule_fsts=','.join(str(MODELS / 'tts' / n) for n in ('phone.fst', 'date.fst', 'number.fst')),
            max_num_sentences=1)
        if not config.validate():
            raise RuntimeError('Invalid speech synthesis configuration')
        self.tts = sherpa_onnx.OfflineTts(config)

    def transcribe(self, pcm):
        if not pcm or len(pcm) % 2 or len(pcm) > 512000:
            raise ValueError('invalid_audio')
        samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
        vad = sherpa_onnx.VoiceActivityDetector(self.vad_config, buffer_size_in_seconds=20)
        padded = np.concatenate([samples, np.zeros(8000, np.float32)])
        window = self.vad_config.silero_vad.window_size
        for start in range(0, len(padded) - window + 1, window):
            vad.accept_waveform(padded[start:start + window])
        vad.flush()
        speech = 0
        while not vad.empty():
            speech += len(vad.front.samples)
            vad.pop()
        if speech < 3200:
            return ''
        stream = self.asr.create_stream()
        stream.accept_waveform(16000, samples)
        self.asr.decode_stream(stream)
        return self.cc.convert(stream.result.text.strip())

    def synthesize(self, text):
        if not isinstance(text, str) or not text.strip() or len(text) > 100:
            raise ValueError('invalid_tts_text')
        audio = self.tts.generate(text, sid=0, speed=1.05)
        samples = np.asarray(audio.samples, dtype=np.float32)
        if not len(samples):
            raise ValueError('empty_tts_audio')
        rate = int(audio.sample_rate)
        if rate != 16000:
            divisor = math.gcd(rate, 16000)
            samples = resample_poly(samples, 16000 // divisor, rate // divisor)
        pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
        return pcm

def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    with contextlib.redirect_stdout(sys.stderr):
        engine = SpeechEngine()
    print(json.dumps({'ready': True, 'sample_rate': 16000}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            started = time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                if request.get('op') == 'asr':
                    result = {'text': engine.transcribe(base64.b64decode(request['pcm'], validate=True))}
                elif request.get('op') == 'tts':
                    pcm = engine.synthesize(request['text'])
                    result = {'pcm': base64.b64encode(pcm).decode('ascii'), 'sample_rate': 16000}
                else:
                    raise ValueError('invalid_operation')
            result.update(id=request.get('id'), elapsed_ms=round((time.monotonic() - started) * 1000))
        except Exception as error:
            result = {'id': request.get('id'), 'error': str(error)[:150]}
        print(json.dumps(result, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
