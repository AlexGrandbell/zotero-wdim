#!/usr/bin/env python3
"""Build a reproducible XPI with only runtime files. Python stdlib only."""
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text())
version = manifest["version"]
if "--release" in sys.argv:
    url = urlparse(manifest["applications"]["zotero"]["update_url"])
    host = url.hostname or ""
    if url.scheme != "https" or not host or host.endswith((".invalid", ".example", ".test", ".localhost")) or host in ("localhost", "example.com", "127.0.0.1"):
        raise SystemExit("Release blocked: configure an HTTPS update_url on a host you control first.")
assert json.loads((ROOT / "package.json").read_text())["version"] == version
files = [ROOT / "manifest.json", ROOT / "bootstrap.js", ROOT / "LICENSE"]
files += sorted((ROOT / "src").glob("*.js"))
files += sorted((ROOT / "assets").glob("*.svg"))
out = ROOT / "dist"
out.mkdir(exist_ok=True)
target = out / f"zotero-wdim-{version}.xpi"
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        info = zipfile.ZipInfo(str(path.relative_to(ROOT)), (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
digest = hashlib.sha256(target.read_bytes()).hexdigest()
(out / "SHA256SUMS").write_text(f"{digest}  {target.name}\n")
print(f"Built {target.name} ({target.stat().st_size} bytes)\nSHA256 {digest}")
