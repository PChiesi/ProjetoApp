"""Histórico de execuções (SQLite) usado pelo dashboard."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .storage import app_data_dir

SCHEMA = """
CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT, started_at TEXT, finished_at TEXT,
    status TEXT, total_rows INTEGER DEFAULT 0, ok_rows INTEGER DEFAULT 0,
    error_rows INTEGER DEFAULT 0, skipped_rows INTEGER DEFAULT 0,
    duration_s REAL DEFAULT 0, evidence_dir TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS row_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER, row_index INTEGER, started_at TEXT,
    finished_at TEXT, status TEXT, message TEXT, duration_s REAL,
    attempts INTEGER DEFAULT 1, data_json TEXT
);
CREATE TABLE IF NOT EXISTS step_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER, row_run_id INTEGER, row_index INTEGER,
    step_order INTEGER, step_name TEXT, action TEXT, status TEXT,
    duration_ms REAL, error TEXT, value TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER, row_index INTEGER, title TEXT, text TEXT,
    rule TEXT, action TEXT, screenshot TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER, row_index INTEGER, kind TEXT, name TEXT,
    value TEXT, at TEXT
);
CREATE INDEX IF NOT EXISTS ix_rr_exec ON row_runs(execution_id);
CREATE INDEX IF NOT EXISTS ix_sr_exec ON step_runs(execution_id);
"""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Database:
    def __init__(self, path: str | Path | None = None):
        self.path = str(path or (app_data_dir() / "historico.db"))
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def _exec(self, sql: str, params=()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur.lastrowid

    def query(self, sql: str, params=()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params)]

    # ------------------------------------------------------------ escrita
    def start_execution(self, project: str, total: int) -> int:
        return self._exec(
            "INSERT INTO executions(project, started_at, status, total_rows)"
            " VALUES (?,?,?,?)", (project, _now(), "Executando", total))

    def set_evidence_dir(self, eid: int, path: str) -> None:
        self._exec("UPDATE executions SET evidence_dir=? WHERE id=?", (path, eid))

    def finish_execution(self, eid: int, status: str, ok: int, err: int,
                         skipped: int, duration: float) -> None:
        self._exec(
            "UPDATE executions SET finished_at=?, status=?, ok_rows=?,"
            " error_rows=?, skipped_rows=?, duration_s=? WHERE id=?",
            (_now(), status, ok, err, skipped, duration, eid))

    def start_row(self, eid: int, row_index: int, data_json: str) -> int:
        return self._exec(
            "INSERT INTO row_runs(execution_id,row_index,started_at,status,"
            "data_json) VALUES (?,?,?,?,?)",
            (eid, row_index, _now(), "Executando", data_json))

    def finish_row(self, rid: int, status: str, message: str,
                   duration: float, attempts: int, data_json: str) -> None:
        self._exec(
            "UPDATE row_runs SET finished_at=?, status=?, message=?,"
            " duration_s=?, attempts=?, data_json=? WHERE id=?",
            (_now(), status, message, duration, attempts, data_json, rid))

    def log_step(self, eid, rid, row_index, order, name, action, status,
                 duration_ms, error="", value="") -> None:
        self._exec(
            "INSERT INTO step_runs(execution_id,row_run_id,row_index,"
            "step_order,step_name,action,status,duration_ms,error,value,at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (eid, rid, row_index, order, name, action, status, duration_ms,
             error[:2000], str(value)[:500], _now()))

    def log_message(self, eid, row_index, title, text, rule, action,
                    screenshot="") -> None:
        self._exec(
            "INSERT INTO messages(execution_id,row_index,title,text,rule,"
            "action,screenshot,at) VALUES (?,?,?,?,?,?,?,?)",
            (eid, row_index, title, text[:4000], rule, action, screenshot,
             _now()))

    def log_capture(self, eid, row_index, kind, name, value) -> None:
        self._exec(
            "INSERT INTO captures(execution_id,row_index,kind,name,value,at)"
            " VALUES (?,?,?,?,?,?)",
            (eid, row_index, kind, name, str(value)[:4000], _now()))

    def delete_execution(self, eid: int) -> None:
        for t in ("row_runs", "step_runs", "messages", "captures"):
            self._exec(f"DELETE FROM {t} WHERE execution_id=?", (eid,))
        self._exec("DELETE FROM executions WHERE id=?", (eid,))

    # ------------------------------------------------------------ leitura
    def kpis(self, project: str | None = None, days: int = 30) -> dict:
        where, params = self._filter(project, days, "e")
        r = self.query(
            f"SELECT COUNT(*) n, COALESCE(SUM(total_rows),0) tr,"
            f" COALESCE(SUM(ok_rows),0) ok, COALESCE(SUM(error_rows),0) er,"
            f" COALESCE(SUM(skipped_rows),0) sk,"
            f" COALESCE(SUM(duration_s),0) dur FROM executions e {where}",
            params)[0]
        rr = self.query(
            f"SELECT AVG(r.duration_s) avg_row FROM row_runs r JOIN executions e"
            f" ON e.id=r.execution_id {where}"
            f"{' AND' if where else ' WHERE'} r.status IN ('Sucesso','Aviso')",
            params)[0]
        steps = self.query(
            f"SELECT COUNT(*) n FROM step_runs s JOIN executions e"
            f" ON e.id=s.execution_id {where}", params)[0]
        msgs = self.query(
            f"SELECT COUNT(*) n FROM messages m JOIN executions e"
            f" ON e.id=m.execution_id {where}", params)[0]
        done = r["ok"] + r["er"]
        return {
            "execucoes": r["n"], "linhas": r["tr"], "sucesso": r["ok"],
            "erros": r["er"], "pulados": r["sk"],
            "taxa": (r["ok"] / done * 100) if done else 0.0,
            "tempo_total_s": r["dur"], "media_linha_s": rr["avg_row"] or 0.0,
            "passos": steps["n"], "mensagens": msgs["n"],
        }

    def daily(self, project: str | None = None, days: int = 14) -> list[dict]:
        where, params = self._filter(project, days, "e")
        return self.query(
            f"SELECT substr(r.started_at,1,10) dia,"
            f" SUM(CASE WHEN r.status IN ('Sucesso','Aviso') THEN 1 ELSE 0 END) ok,"
            f" SUM(CASE WHEN r.status='Erro' THEN 1 ELSE 0 END) erro"
            f" FROM row_runs r JOIN executions e ON e.id=r.execution_id {where}"
            f" GROUP BY dia ORDER BY dia", params)

    def step_times(self, project: str | None = None, days: int = 30,
                   limit: int = 12) -> list[dict]:
        where, params = self._filter(project, days, "e")
        return self.query(
            f"SELECT s.step_name nome, AVG(s.duration_ms) media,"
            f" MAX(s.duration_ms) maximo, COUNT(*) n,"
            f" SUM(CASE WHEN s.status='Erro' THEN 1 ELSE 0 END) erros"
            f" FROM step_runs s JOIN executions e ON e.id=s.execution_id {where}"
            f" GROUP BY s.step_name ORDER BY media DESC LIMIT ?",
            params + [limit])

    def top_errors(self, project: str | None = None, days: int = 30,
                   limit: int = 8) -> list[dict]:
        where, params = self._filter(project, days, "e")
        return self.query(
            f"SELECT r.message msg, COUNT(*) n FROM row_runs r JOIN executions e"
            f" ON e.id=r.execution_id {where}"
            f"{' AND' if where else ' WHERE'} r.status='Erro'"
            f" GROUP BY r.message ORDER BY n DESC LIMIT ?", params + [limit])

    def executions(self, project: str | None = None, days: int = 365,
                   limit: int = 200) -> list[dict]:
        where, params = self._filter(project, days, "e")
        return self.query(
            f"SELECT * FROM executions e {where} ORDER BY e.id DESC LIMIT ?",
            params + [limit])

    def rows_of(self, eid: int) -> list[dict]:
        return self.query("SELECT * FROM row_runs WHERE execution_id=?"
                          " ORDER BY id", (eid,))

    def steps_of(self, eid: int, row_run_id: int | None = None) -> list[dict]:
        if row_run_id:
            return self.query("SELECT * FROM step_runs WHERE row_run_id=?"
                              " ORDER BY id", (row_run_id,))
        return self.query("SELECT * FROM step_runs WHERE execution_id=?"
                          " ORDER BY id", (eid,))

    def messages_of(self, eid: int) -> list[dict]:
        return self.query("SELECT * FROM messages WHERE execution_id=?"
                          " ORDER BY id", (eid,))

    def captures_of(self, eid: int) -> list[dict]:
        return self.query("SELECT * FROM captures WHERE execution_id=?"
                          " ORDER BY id", (eid,))

    def projects(self) -> list[str]:
        return [r["project"] for r in self.query(
            "SELECT DISTINCT project FROM executions ORDER BY project")]

    @staticmethod
    def _filter(project, days, alias):
        conds, params = [], []
        if project:
            conds.append(f"{alias}.project=?")
            params.append(project)
        if days:
            conds.append(f"{alias}.started_at >= datetime('now','localtime',?)")
            params.append(f"-{int(days)} days")
        return ("WHERE " + " AND ".join(conds)) if conds else "", params
