"""Dashboard com indicadores, gráficos e histórico detalhado."""
from __future__ import annotations

import json
import os

from PySide6.QtCharts import (QBarCategoryAxis, QBarSeries, QBarSet, QChart,
                              QChartView, QHorizontalBarSeries, QPieSeries,
                              QStackedBarSeries, QValueAxis)
from PySide6.QtCore import QMargins, Qt, QUrl
from PySide6.QtGui import QColor, QDesktopServices, QFont, QPainter, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QDialog,
                               QFileDialog, QGridLayout, QHBoxLayout,
                               QHeaderView, QLabel, QMessageBox, QScrollArea,
                               QSplitter, QTableWidget, QTableWidgetItem,
                               QTabWidget, QVBoxLayout, QWidget)

from .. import theme
from ..widgets.common import Card, KpiCard, button, label, toast


def _fmt_s(s: float) -> str:
    s = float(s or 0)
    if s < 60:
        return f"{s:.1f}s"
    m, sec = divmod(int(s), 60)
    if m < 60:
        return f"{m}min {sec:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}min"


def _chart(title: str = "") -> tuple[QChart, QChartView]:
    c = theme.colors()
    ch = QChart()
    ch.setTitle(title)
    ch.setBackgroundBrush(QColor(c["surface"]))
    ch.setBackgroundRoundness(0)
    ch.setTitleBrush(QColor(c["text"]))
    ch.legend().setLabelColor(QColor(c["muted"]))
    ch.legend().setAlignment(Qt.AlignBottom)
    ch.setMargins(QMargins(4, 4, 4, 4))
    ch.setAnimationOptions(QChart.SeriesAnimations)
    ch.setAnimationDuration(450)
    v = QChartView(ch)
    v.setRenderHint(QPainter.Antialiasing)
    v.setMinimumHeight(250)
    v.setStyleSheet("background: transparent; border: none;")
    return ch, v


def _style_axis(ax):
    c = theme.colors()
    ax.setLabelsColor(QColor(c["muted"]))
    ax.setGridLineColor(QColor(c["chart_grid"]))
    ax.setLinePenColor(QColor(c["chart_grid"]))
    f = QFont()
    f.setPointSize(8)
    ax.setLabelsFont(f)


def _table(headers: list[str]) -> QTableWidget:
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.verticalHeader().setVisible(False)
    t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setAlternatingRowColors(True)
    t.horizontalHeader().setStretchLastSection(True)
    return t


def _fill(t: QTableWidget, rows: list[list], status_col: int | None = None):
    t.setRowCount(len(rows))
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            it = QTableWidgetItem("" if v is None else str(v))
            if status_col is not None and j == status_col:
                it.setForeground(QColor(theme.status_color(str(v).split()[0] if v else "")))
            t.setItem(i, j, it)


class ExecutionDetail(QDialog):
    def __init__(self, db, ex: dict, parent=None):
        super().__init__(parent)
        self.db, self.ex = db, ex
        self.setWindowTitle(f"Execução #{ex['id']} – {ex['project']}")
        self.resize(1100, 700)
        lay = QVBoxLayout(self)
        head = QHBoxLayout()
        head.addWidget(label(f"Execução #{ex['id']} • {ex['project']}", "h2"))
        head.addWidget(label(f"{(ex['started_at'] or '').replace('T', ' ')} • {ex['status']} • "
                             f"{_fmt_s(ex['duration_s'])}", "muted"))
        head.addStretch()
        head.addWidget(button("Pasta de evidências", "", "", self._open_folder, "📁"))
        head.addWidget(button("Relatório Excel", "primary", "", self._export, "⬇"))
        lay.addLayout(head)
        tabs = QTabWidget()
        lay.addWidget(tabs, 1)

        rows = db.rows_of(ex["id"])
        self.rows_t = _table(["Linha", "Status", "Mensagem", "Duração", "Tentativas", "Início"])
        _fill(self.rows_t, [[r["row_index"] + 1, r["status"], r["message"], _fmt_s(r["duration_s"]),
                             r["attempts"], (r["started_at"] or "").replace("T", " ")] for r in rows], 1)
        self.rows_t.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self._rows = rows
        self.rows_t.itemSelectionChanged.connect(self._on_row)
        split = QSplitter(Qt.Vertical)
        split.addWidget(self.rows_t)
        self.row_steps = _table(["#", "Passo", "Status", "Duração (s)", "Valor", "Erro"])
        split.addWidget(self.row_steps)
        tabs.addTab(split, f"Rodadas ({len(rows)})")

        steps = db.steps_of(ex["id"])
        st = _table(["Linha", "#", "Passo", "Status", "Duração (s)", "Valor", "Erro", "Horário"])
        _fill(st, [[s["row_index"] + 1, s["step_order"], s["step_name"], s["status"],
                    f"{(s['duration_ms'] or 0) / 1000:.2f}", s["value"], s["error"],
                    (s["at"] or "")[11:]] for s in steps], 3)
        tabs.addTab(st, f"Linha do tempo ({len(steps)})")

        msgs = db.messages_of(ex["id"])
        self.msgs = msgs
        mt = _table(["Linha", "Título", "Texto", "Regra", "Ação", "Print"])
        _fill(mt, [[m["row_index"] + 1, m["title"], m["text"], m["rule"], m["action"],
                    "📷" if m["screenshot"] else ""] for m in msgs])
        mt.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        mt.cellDoubleClicked.connect(lambda r, c: self._open_file(self.msgs[r]["screenshot"]))
        tabs.addTab(mt, f"Mensagens ({len(msgs)})")

        caps = db.captures_of(ex["id"])
        self.caps = caps
        ct = _table(["Linha", "Tipo", "Nome", "Valor", "Horário"])
        _fill(ct, [[c["row_index"] + 1, c["kind"], c["name"], c["value"], (c["at"] or "")[11:]] for c in caps])
        ct.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        ct.cellDoubleClicked.connect(lambda r, c: self._open_file(self.caps[r]["value"])
                                     if self.caps[r]["kind"] == "tela" else None)
        tabs.addTab(ct, f"Capturas ({len(caps)})")

        # galeria de prints
        folder = ex.get("evidence_dir") or ""
        imgs = sorted([os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(".png")]) \
            if folder and os.path.isdir(folder) else []
        gal = QScrollArea()
        gal.setWidgetResizable(True)
        inner = QWidget()
        grid = QGridLayout(inner)
        for i, path in enumerate(imgs[:300]):
            box = QVBoxLayout()
            lb = QLabel()
            pm = QPixmap(path)
            if not pm.isNull():
                lb.setPixmap(pm.scaled(240, 150, Qt.KeepAspectRatio, Qt.SmoothTransformation))
            lb.setCursor(Qt.PointingHandCursor)
            lb.mousePressEvent = lambda e, p=path: self._open_file(p)
            w = QWidget()
            box.addWidget(lb)
            box.addWidget(label(os.path.basename(path)[:40], "muted"))
            w.setLayout(box)
            grid.addWidget(w, i // 4, i % 4)
        gal.setWidget(inner)
        tabs.addTab(gal, f"Prints ({len(imgs)})")

    def _on_row(self):
        sel = self.rows_t.selectionModel().selectedRows()
        if not sel:
            return
        r = self._rows[sel[0].row()]
        steps = self.db.steps_of(self.ex["id"], r["id"])
        _fill(self.row_steps, [[s["step_order"], s["step_name"], s["status"],
                                f"{(s['duration_ms'] or 0) / 1000:.2f}", s["value"], s["error"]] for s in steps], 2)

    def _open_file(self, path):
        if path and os.path.exists(path):
            QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def _open_folder(self):
        self._open_file(self.ex.get("evidence_dir") or "")

    def _export(self):
        path, _ = QFileDialog.getSaveFileName(self, "Relatório", f"relatorio_execucao_{self.ex['id']}.xlsx",
                                              "Excel (*.xlsx)")
        if not path:
            return
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        wb = Workbook()
        ws = wb.active
        ws.title = "Resumo"
        for k in ("id", "project", "started_at", "finished_at", "status", "total_rows", "ok_rows",
                  "error_rows", "skipped_rows", "duration_s", "evidence_dir"):
            ws.append([k, self.ex.get(k)])

        def sheet(name, heads, rows):
            s = wb.create_sheet(name)
            s.append(heads)
            for c in s[1]:
                c.font = Font(bold=True, color="FFFFFF")
                c.fill = PatternFill("solid", fgColor="3B5BDB")
            for r in rows:
                s.append(r)
            for col in s.columns:
                s.column_dimensions[col[0].column_letter].width = 22
        rows = self.db.rows_of(self.ex["id"])
        data_rows = []
        keys: list[str] = []
        for r in rows:
            d = json.loads(r["data_json"] or "{}")
            for k in d:
                if k not in keys:
                    keys.append(k)
            data_rows.append(d)
        sheet("Rodadas", ["linha", "status", "mensagem", "duracao_s", "tentativas"] + keys,
              [[r["row_index"] + 1, r["status"], r["message"], r["duration_s"], r["attempts"]]
               + [d.get(k, "") for k in keys] for r, d in zip(rows, data_rows)])
        sheet("Passos", ["linha", "ordem", "passo", "acao", "status", "duracao_ms", "valor", "erro", "horario"],
              [[s["row_index"] + 1, s["step_order"], s["step_name"], s["action"], s["status"],
                round(s["duration_ms"] or 0), s["value"], s["error"], s["at"]] for s in self.db.steps_of(self.ex["id"])])
        sheet("Mensagens", ["linha", "titulo", "texto", "regra", "acao", "print", "horario"],
              [[m["row_index"] + 1, m["title"], m["text"], m["rule"], m["action"], m["screenshot"], m["at"]]
               for m in self.db.messages_of(self.ex["id"])])
        sheet("Capturas", ["linha", "tipo", "nome", "valor", "horario"],
              [[c["row_index"] + 1, c["kind"], c["name"], c["value"], c["at"]] for c in self.db.captures_of(self.ex["id"])])
        try:
            wb.save(path)
            toast(self, "Relatório salvo ✓", "ok")
            QDesktopServices.openUrl(QUrl.fromLocalFile(path))
        except PermissionError:
            toast(self, "Feche o arquivo no Excel e tente novamente", "error")


class DashboardPage(QWidget):
    title = "Dashboard"
    subtitle = "Tudo o que foi executado: volumes, tempos, erros e mensagens"

    def __init__(self, state):
        super().__init__()
        self.state = state
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        outer.addWidget(scroll)
        body = QWidget()
        body.setObjectName("page")
        scroll.setWidget(body)
        root = QVBoxLayout(body)
        root.setContentsMargins(0, 0, 8, 0)
        root.setSpacing(14)

        f = QHBoxLayout()
        f.addWidget(label("Projeto:", "muted"))
        self.proj = QComboBox()
        self.proj.setMinimumWidth(220)
        f.addWidget(self.proj)
        f.addWidget(label("Período:", "muted"))
        self.period = QComboBox()
        for txt, d in (("Hoje", 1), ("7 dias", 7), ("30 dias", 30), ("90 dias", 90), ("1 ano", 365), ("Tudo", 0)):
            self.period.addItem(txt, d)
        self.period.setCurrentIndex(2)
        f.addWidget(self.period)
        f.addStretch()
        f.addWidget(button("Atualizar", "", "", self.refresh, "⟳"))
        root.addLayout(f)
        self.proj.currentIndexChanged.connect(self.refresh)
        self.period.currentIndexChanged.connect(self.refresh)

        g = QGridLayout()
        g.setSpacing(12)
        self.k_exec = KpiCard("Execuções", "▶", "primary")
        self.k_rows = KpiCard("Massas processadas", "▦", "info")
        self.k_ok = KpiCard("Taxa de sucesso", "✔", "success")
        self.k_err = KpiCard("Rodadas com erro", "✖", "danger")
        self.k_avg = KpiCard("Tempo médio por massa", "⏱", "purple")
        self.k_tot = KpiCard("Tempo total automatizado", "⌛", "warning")
        self.k_steps = KpiCard("Passos executados", "◉", "info")
        self.k_msgs = KpiCard("Mensagens tratadas", "💬", "warning")
        for i, w in enumerate((self.k_exec, self.k_rows, self.k_ok, self.k_err,
                               self.k_avg, self.k_tot, self.k_steps, self.k_msgs)):
            g.addWidget(w, i // 4, i % 4)
        root.addLayout(g)

        charts = QHBoxLayout()
        c1 = Card("Rodadas por dia", "Sucesso x erro")
        self.daily_chart, v1 = _chart()
        c1.add(v1)
        charts.addWidget(c1, 3)
        c2 = Card("Resultado", "Distribuição das rodadas")
        self.pie_chart, v2 = _chart()
        c2.add(v2)
        charts.addWidget(c2, 2)
        root.addLayout(charts)

        charts2 = QHBoxLayout()
        c3 = Card("Tempo médio por passo", "Passos mais lentos (ms)")
        self.steps_chart, v3 = _chart()
        v3.setMinimumHeight(300)
        c3.add(v3)
        charts2.addWidget(c3, 3)
        c4 = Card("Erros mais frequentes")
        self.err_table = _table(["Mensagem", "Qtd."])
        self.err_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.err_table.horizontalHeader().setStretchLastSection(False)
        c4.add(self.err_table)
        charts2.addWidget(c4, 2)
        root.addLayout(charts2)

        hist = Card("Histórico de execuções", "Duplo clique para ver rodadas, passos, mensagens, capturas e prints")
        hist.add_action(button("Excluir", "ghost", "Remove a execução selecionada do histórico", self._delete, "🗑"))
        self.hist = _table(["#", "Projeto", "Início", "Status", "Linhas", "Sucesso", "Erro", "Pulado", "Duração"])
        self.hist.setMinimumHeight(280)
        self.hist.cellDoubleClicked.connect(self._open_detail)
        hist.add(self.hist)
        root.addWidget(hist)

        state.history_changed.connect(self.refresh)
        state.project_loaded.connect(self._reload_projects)
        self._reload_projects()

    def _reload_projects(self):
        cur = self.state.project.name
        self.proj.blockSignals(True)
        self.proj.clear()
        self.proj.addItem("Todos os projetos", "")
        names = self.state.db.projects()
        if cur not in names:
            names.insert(0, cur)
        for n in names:
            self.proj.addItem(n, n)
        self.proj.setCurrentIndex(max(0, self.proj.findData(cur)))
        self.proj.blockSignals(False)
        self.refresh()

    def showEvent(self, e):
        super().showEvent(e)
        self.refresh()

    def refresh(self):
        db = self.state.db
        project = self.proj.currentData() or None
        days = self.period.currentData()
        k = db.kpis(project, days)
        self.k_exec.set(str(k["execucoes"]))
        self.k_rows.set(str(k["linhas"]), f"{k['pulados']} pulada(s)")
        self.k_ok.set(f"{k['taxa']:.0f}%", f"{k['sucesso']} com sucesso")
        self.k_err.set(str(k["erros"]))
        self.k_avg.set(_fmt_s(k["media_linha_s"]))
        self.k_tot.set(_fmt_s(k["tempo_total_s"]))
        self.k_steps.set(f"{k['passos']:,}".replace(",", "."))
        self.k_msgs.set(str(k["mensagens"]))
        self._daily(db.daily(project, days or 3650))
        self._pie(k)
        self._steps(db.step_times(project, days))
        _fill(self.err_table, [[e["msg"], e["n"]] for e in db.top_errors(project, days)])
        self.execs = db.executions(project, days)
        _fill(self.hist, [[e["id"], e["project"], (e["started_at"] or "").replace("T", " "), e["status"],
                           e["total_rows"], e["ok_rows"], e["error_rows"], e["skipped_rows"],
                           _fmt_s(e["duration_s"])] for e in self.execs], 3)

    def _daily(self, rows):
        ch = self.daily_chart
        ch.removeAllSeries()
        for ax in ch.axes():
            ch.removeAxis(ax)
        c = theme.colors()
        ok, er = QBarSet("Sucesso"), QBarSet("Erro")
        ok.setColor(QColor(c["success"]))
        er.setColor(QColor(c["danger"]))
        ok.setBorderColor(QColor(c["success"]))
        er.setBorderColor(QColor(c["danger"]))
        cats = []
        for r in rows[-21:]:
            cats.append(f"{r['dia'][8:10]}/{r['dia'][5:7]}")
            ok.append(r["ok"] or 0)
            er.append(r["erro"] or 0)
        s = QStackedBarSeries()
        s.append(ok)
        s.append(er)
        ch.addSeries(s)
        ax = QBarCategoryAxis()
        ax.append(cats or ["—"])
        ay = QValueAxis()
        ay.setLabelFormat("%d")
        mx = max([(r["ok"] or 0) + (r["erro"] or 0) for r in rows] or [1])
        ay.setRange(0, max(1, mx))
        _style_axis(ax)
        _style_axis(ay)
        ch.addAxis(ax, Qt.AlignBottom)
        ch.addAxis(ay, Qt.AlignLeft)
        s.attachAxis(ax)
        s.attachAxis(ay)

    def _pie(self, k):
        ch = self.pie_chart
        ch.removeAllSeries()
        c = theme.colors()
        s = QPieSeries()
        s.setHoleSize(0.55)
        data = [("Sucesso", k["sucesso"], "success"), ("Erro", k["erros"], "danger"),
                ("Pulado", k["pulados"], "muted")]
        total = sum(d[1] for d in data)
        for name, v, key in data:
            if v or not total:
                sl = s.append(f"{name} ({v})", v or (1 if not total and name == "Sucesso" else 0))
                sl.setColor(QColor(c[key]) if total else QColor(c["surface2"]))
                sl.setBorderColor(QColor(c["surface"]))
                sl.setLabelColor(QColor(c["muted"]))
        ch.addSeries(s)

    def _steps(self, rows):
        ch = self.steps_chart
        ch.removeAllSeries()
        for ax in ch.axes():
            ch.removeAxis(ax)
        c = theme.colors()
        bs = QBarSet("Tempo médio (ms)")
        bs.setColor(QColor(c["primary"]))
        bs.setBorderColor(QColor(c["primary"]))
        cats = []
        for r in reversed(rows):
            cats.append((r["nome"] or "")[:34])
            bs.append(round(r["media"] or 0))
        s = QHorizontalBarSeries()
        s.append(bs)
        ch.addSeries(s)
        ay = QBarCategoryAxis()
        ay.append(cats or ["—"])
        ax = QValueAxis()
        ax.setLabelFormat("%d")
        ax.setRange(0, max([r["media"] or 0 for r in rows] or [1]) * 1.1 or 1)
        _style_axis(ax)
        _style_axis(ay)
        ch.addAxis(ay, Qt.AlignLeft)
        ch.addAxis(ax, Qt.AlignBottom)
        s.attachAxis(ax)
        s.attachAxis(ay)
        ch.legend().setVisible(False)

    def _open_detail(self, r, _c):
        if 0 <= r < len(self.execs):
            ExecutionDetail(self.state.db, self.execs[r], self).exec()

    def _delete(self):
        sel = self.hist.selectionModel().selectedRows()
        if not sel:
            return
        ex = self.execs[sel[0].row()]
        if QMessageBox.question(self, "Excluir", f"Remover a execução #{ex['id']} do histórico?") == QMessageBox.Yes:
            self.state.db.delete_execution(ex["id"])
            self.refresh()


__all__ = ["DashboardPage", "QBarSeries"]
