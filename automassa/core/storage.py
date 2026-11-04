"""Persistência: projetos (.amproj), pastas do app e preferências."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .models import Project

PROJECT_EXT = ".amproj"


def app_data_dir() -> Path:
    base = os.environ.get("APPDATA") or os.path.join(Path.home(), ".config")
    p = Path(base) / "AutoMassaStudio"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_workspace() -> Path:
    p = Path.home() / "Documents" / "AutoMassa"
    p.mkdir(parents=True, exist_ok=True)
    return p


def evidence_dir(project_name: str, execution_id: int | str) -> Path:
    from .models import sanitize_column_name
    p = (default_workspace() / "evidencias" / sanitize_column_name(project_name)
         / f"execucao_{execution_id}")
    p.mkdir(parents=True, exist_ok=True)
    return p


def resource_path(rel: str) -> str:
    """Caminho de recursos compatível com PyInstaller (sys._MEIPASS)."""
    base = getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])
    return str(Path(base) / rel)


def save_project(project: Project, path: str | None = None) -> str:
    path = path or project.path
    if not path:
        raise ValueError("Caminho do projeto não definido")
    if not path.lower().endswith(PROJECT_EXT):
        path += PROJECT_EXT
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(project.to_dict(), fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    project.path = path
    add_recent(path)
    return path


def load_project(path: str) -> Project:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    p = Project.from_dict(data)
    p.path = path
    add_recent(path)
    return p


# ---------------------------------------------------------------- prefs
def _prefs_file() -> Path:
    return app_data_dir() / "preferencias.json"


def load_prefs() -> dict:
    try:
        return json.loads(_prefs_file().read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_prefs(prefs: dict) -> None:
    try:
        _prefs_file().write_text(json.dumps(prefs, indent=2), encoding="utf-8")
    except Exception:
        pass


def add_recent(path: str) -> None:
    prefs = load_prefs()
    rec = [p for p in prefs.get("recentes", []) if p != path]
    rec.insert(0, path)
    prefs["recentes"] = rec[:10]
    save_prefs(prefs)


def recent_projects() -> list[str]:
    return [p for p in load_prefs().get("recentes", []) if os.path.exists(p)]
