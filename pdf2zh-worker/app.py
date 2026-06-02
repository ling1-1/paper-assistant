import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file


app = Flask(__name__)

DATA_DIR = Path(os.environ.get("PDF2ZH_DATA_DIR", "/data"))
JOBS_DIR = DATA_DIR / "jobs"
MAX_UPLOAD_MB = int(os.environ.get("PDF2ZH_MAX_UPLOAD_MB", "120"))
TIMEOUT_SECONDS = int(os.environ.get("PDF2ZH_TIMEOUT_SECONDS", "3600"))
DEFAULT_SERVICE = os.environ.get("PDF2ZH_SERVICE", "").strip()

JOBS_DIR.mkdir(parents=True, exist_ok=True)


def resolve_pdf2zh_bin():
    explicit = os.environ.get("PDF2ZH_BIN", "").strip()
    if explicit:
        return explicit

    sibling = Path(sys.executable).with_name("pdf2zh")
    if sibling.exists() and os.access(sibling, os.X_OK):
        return str(sibling)

    return shutil.which("pdf2zh") or "pdf2zh"


PDF2ZH_BIN = resolve_pdf2zh_bin()


def now_ms():
    return int(time.time() * 1000)


def job_dir(job_id):
    return JOBS_DIR / job_id


def status_path(job_id):
    return job_dir(job_id) / "status.json"


def read_status(job_id):
    path = status_path(job_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_status(job_id, patch):
    current = read_status(job_id) or {"id": job_id}
    current.update(patch)
    current["updatedAt"] = now_ms()
    path = status_path(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(current, handle, ensure_ascii=False, indent=2)
    return current


def safe_filename(value):
    name = Path(value or "paper.pdf").name
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name


def find_outputs(output_dir):
    pdfs = sorted(output_dir.rglob("*.pdf"), key=lambda item: item.stat().st_mtime, reverse=True)
    mono = None
    dual = None

    for item in pdfs:
        lowered = item.name.lower()
        if dual is None and ("dual" in lowered or "双语" in lowered or "bilingual" in lowered):
            dual = item
        if mono is None and ("mono" in lowered or "zh" in lowered or "translated" in lowered or "单语" in lowered):
            mono = item

    if mono is None and pdfs:
        mono = pdfs[0]
    if dual is None and len(pdfs) > 1:
        dual = next((item for item in pdfs if item != mono), None)

    return {
        "mono": str(mono) if mono else "",
        "dual": str(dual) if dual else "",
    }


def build_command(input_path, output_dir, source_lang, target_lang, pages, service):
    command = [
        PDF2ZH_BIN,
        str(input_path),
        "-o",
        str(output_dir),
        "-li",
        source_lang or "en",
        "-lo",
        target_lang or "zh",
    ]

    selected_service = (service or DEFAULT_SERVICE).strip()
    if selected_service:
        command.extend(["-s", selected_service])

    if pages and pages != "all":
        command.extend(["-p", str(pages)])

    return command


def run_job(job_id):
    status = read_status(job_id)
    if not status:
        return

    work_dir = job_dir(job_id)
    input_path = work_dir / "input.pdf"
    output_dir = work_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    command = build_command(
        input_path,
        output_dir,
        status.get("sourceLang", "en"),
        status.get("targetLang", "zh"),
        status.get("pages", "all"),
        status.get("service", ""),
    )

    write_status(job_id, {
        "status": "running",
        "stage": "pdf2zh-running",
        "progress": 20,
        "command": " ".join(command),
    })

    try:
        completed = subprocess.run(
            command,
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
        outputs = find_outputs(output_dir)
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()

        if completed.returncode != 0:
            raise RuntimeError(stderr or stdout or f"pdf2zh exited with code {completed.returncode}")

        if not outputs["mono"] and not outputs["dual"]:
            raise RuntimeError("pdf2zh completed but no PDF output was found")

        write_status(job_id, {
            "status": "done",
            "stage": "pdf2zh-done",
            "progress": 100,
            "outputs": outputs,
            "downloads": {
                key: f"/jobs/{job_id}/download?type={key}"
                for key, value in outputs.items()
                if value
            },
            "stdout": stdout[-4000:],
            "stderr": stderr[-4000:],
        })
    except Exception as error:
        write_status(job_id, {
            "status": "failed",
            "stage": "pdf2zh-failed",
            "progress": 100,
            "error": str(error),
        })


@app.get("/health")
def health():
    return jsonify({"ok": True, "engine": "pdf2zh-worker"})


@app.post("/jobs")
def create_job():
    uploaded = request.files.get("file")
    if uploaded is None:
        return jsonify({"error": "missing PDF file"}), 400

    filename = safe_filename(request.form.get("filename") or uploaded.filename)
    job_id = uuid.uuid4().hex
    work_dir = job_dir(job_id)
    work_dir.mkdir(parents=True, exist_ok=True)
    input_path = work_dir / "input.pdf"

    uploaded.save(input_path)
    size = input_path.stat().st_size
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        shutil.rmtree(work_dir, ignore_errors=True)
        return jsonify({"error": f"PDF exceeds upload limit of {MAX_UPLOAD_MB} MB"}), 413

    status = write_status(job_id, {
        "id": job_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "filename": filename,
        "sourceLang": request.form.get("source_lang", "en"),
        "targetLang": request.form.get("target_lang", "zh"),
        "mode": request.form.get("mode", "dual"),
        "pages": request.form.get("pages", "all"),
        "service": request.form.get("service", DEFAULT_SERVICE),
        "fileSize": size,
        "createdAt": now_ms(),
    })

    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    thread.start()

    return jsonify({"job": status}), 202


@app.get("/jobs/<job_id>")
def get_job(job_id):
    status = read_status(job_id)
    if not status:
        return jsonify({"error": "job not found"}), 404
    return jsonify(status)


@app.get("/jobs/<job_id>/download")
def download(job_id):
    status = read_status(job_id)
    if not status:
        return jsonify({"error": "job not found"}), 404
    if status.get("status") != "done":
        return jsonify({"error": "job is not complete"}), 409

    download_type = "mono" if request.args.get("type") == "mono" else "dual"
    outputs = status.get("outputs") or {}
    output_path = outputs.get(download_type) or outputs.get("mono") or outputs.get("dual")
    if not output_path or not Path(output_path).exists():
        return jsonify({"error": "requested output is not available"}), 404

    filename_stem = Path(status.get("filename", "translation.pdf")).stem
    return send_file(
        output_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{filename_stem}-{download_type}.pdf",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
