"""Download official speech assets into this new experiment directory only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / 'models'
DOWNLOADS = ROOT / 'downloads'
MODELS.mkdir(exist_ok=True)
DOWNLOADS.mkdir(exist_ok=True)
BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
ASSETS = [
    ('sensevoice', BASE + 'asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2', {'model.int8.onnx', 'tokens.txt'}, 'asr'),
    ('matcha', BASE + 'tts-models/matcha-icefall-zh-baker.tar.bz2', {'model-steps-3.onnx', 'tokens.txt', 'lexicon.txt', 'phone.fst', 'date.fst', 'number.fst'}, 'tts'),
    ('vocos', BASE + 'vocoder-models/vocos-22khz-univ.onnx', None, 'tts/vocos.onnx'),
    ('vad', BASE + 'asr-models/silero_vad.onnx', None, 'asr/vad.onnx'),
]

def install(asset):
    name, url, wanted, destination = asset
    target = MODELS / destination
    if wanted and all((target / n).exists() for n in wanted):
        return {'asset': name, 'existing': True}
    if wanted is None and target.exists():
        return {'asset': name, 'existing': True}
    archive = DOWNLOADS / url.rsplit('/', 1)[-1]
    if not archive.exists():
        partial = archive.with_suffix(archive.suffix + '.part')
        print(f'{name}: downloading official model', flush=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'imx-ai-relay-voice/1'})
        with urllib.request.urlopen(request, timeout=90) as response, partial.open('wb') as output:
            expected = int(response.headers.get('Content-Length', 0))
            received, last = 0, time.monotonic()
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                received += len(block)
                if time.monotonic() - last >= 10:
                    print(f'{name}: {received // (1024 * 1024)} MiB', flush=True)
                    last = time.monotonic()
            if expected and received != expected:
                raise RuntimeError(f'{name}: incomplete download')
        partial.rename(archive)
    if wanted:
        target.mkdir(parents=True, exist_ok=True)
        found = set()
        with tarfile.open(archive, 'r:bz2') as source:
            for member in source:
                basename = Path(member.name).name
                if not member.isfile() or basename not in wanted:
                    continue
                output = target / basename
                if not output.exists():
                    stream = source.extractfile(member)
                    with output.open('xb') as handle:
                        while block := stream.read(1024 * 1024):
                            handle.write(block)
                found.add(basename)
        if wanted - found:
            raise RuntimeError(f'{name}: missing files {wanted - found}')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open('rb') as source, target.open('xb') as output:
            while block := source.read(1024 * 1024):
                output.write(block)
    print(f'{name}: ready', flush=True)
    return {'asset': name, 'source': url, 'archive_sha256': hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()}

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(install, ASSETS))
    (ROOT / 'models-manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
    print('All speech models are ready.', flush=True)
