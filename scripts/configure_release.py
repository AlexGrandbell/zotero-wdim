#!/usr/bin/env python3
"""Prepare an owned GitHub repository's release URLs without publishing anything."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("repository", help="Owned GitHub repository, e.g. YOUR_ACCOUNT/zotero-wdim")
args = parser.parse_args()
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", args.repository):
    parser.error("Use OWNER/REPOSITORY without a URL or credentials")

repository = args.repository
owner = repository.split("/")[0]
repo_url = f"https://github.com/{repository}"
manifest_path = ROOT / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["homepage_url"] = repo_url
manifest["author"] = owner
app = manifest["applications"]["zotero"]
app["update_url"] = f"https://github.com/{repository}/releases/latest/download/updates.json"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

subprocess.run(["npm", "test"], cwd=ROOT, check=True)
subprocess.run([sys.executable, str(ROOT / "scripts/build.py"), "--release"], cwd=ROOT, check=True)
version = manifest["version"]
filename = f"zotero-wdim-{version}.xpi"
asset = ROOT / "dist" / filename
release_url = f"{repo_url}/releases/tag/v{version}"
updates = {"addons": {app["id"]: {"updates": [{
    "version": version,
    "update_link": f"{repo_url}/releases/download/v{version}/{filename}",
    "update_hash": "sha256:" + hashlib.sha256(asset.read_bytes()).hexdigest(),
    "applications": {"zotero": {
        "strict_min_version": app["strict_min_version"],
        "strict_max_version": app["strict_max_version"]
    }}
}]}}}
(ROOT / "updates.json").write_text(json.dumps(updates, ensure_ascii=False, indent=2) + "\n")

readme = ROOT / "README.md"
text = readme.read_text()
text = text.replace("在项目 GitHub Releases 下载最新版 `.xpi` 安装包。", f"在 [GitHub Releases]({repo_url}/releases/latest) 下载最新版 `.xpi` 安装包。")
readme.write_text(text)
submission = ROOT / "docs/COMMUNITY_SUBMISSION.md"
text = submission.read_text().replace("发布时填入真实仓库链接。", repo_url)
text = text.replace("发布时填入 v0.1.3 Release 和 XPI 资产链接。", release_url)
submission.write_text(text)
print(f"Prepared {repository} v{version}. No repository, release or issue was created.")
