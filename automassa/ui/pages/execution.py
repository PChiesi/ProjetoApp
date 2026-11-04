"""Página de execução com controle de tempo, pausa e decisões em erros."""
from __future__ import annotations

import threading
import time

from PySide6.QtCore import QObject, QSize, Qt, QThread, QTimer, Signal, QUrl
from PySide6.QtGui import QColor, QDesktopServices, QPixmap, QTextCursor
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QGridLayout,
                               QHBoxLayout, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QPlainTextEdit, QProgressBar,
                               QSlider, QSpinBox, QSplitter, QTextEdit,
                               QVBoxLayout, QWidget)

from ...core.engine import Engine, EngineEvents
from ...core.models import (CTRL_EXECUTE, CTRL_STATUS, ErrorPolicy,
                            MessageAction, MessageRule, Platform, RowStatus)
from .. import theme
from ..widgets.common import Badge, Card, KpiCard, StatusDot, button, label, toast


# =================================================================== ponte
class QtEvents(QObject, EngineEvents):
    sig_log = Signal(str, str)
    sig_exec = Signal(int, int, str)
    sig_row_start = Signal(int, int)
    sig_row_end = Signal(int, str, str, float)
    sig_step_start = Signal(int, int, str)
    sig_step_end = Signal(int, int, str, str, float, str)
    sig_shot = Signal(str)
    sig_msg = Signal(int, str, str)
    sig_state = Signal(str)
    sig_done = Signal(dict)
    sig_ask_error = Signal(dict)
    sig_ask_msg = Signal(object)

    def __init__(self):
        QObject.__init__(self)
        self._answer = None
        self._evt = threading.Event()
        self.always_policy: str | None = None

    def log(self, level, text): self.sig_log.emit(level, text)
    def execution_started(self, eid, total, folder): self.sig_exec.emit(eid, total, folder)
    def row_started(self, idx, attempt): self.sig_row_start.emit(idx, attempt)
    def row_finished(self, idx, status, message, duration): self.sig_row_end.emit(idx, status, message, duration)
    def step_started(self, idx, order, name): self.sig_step_start.emit(idx, order, name)
    def step_finished(self, idx, order, name, status, dt, err): self.sig_step_end.emit(idx, order, name, status, dt, err)
    def screenshot(self, path): self.sig_shot.emit(path)
    def message_captured(self, idx, msg, action): self.sig_msg.emit(idx, msg.summary(), action)
    def state_changed(self, st): self.sig_state.emit(st)
    def finished(self, summary): self.sig_done.emit(summary)

    def _wait(self):
        self._evt.clear()
        while not self._evt.wait(0.2):
            if getattr(self, "engine", None) and self.engine._stop.is_set():
                return None
        return self._answer

    def answer(self, value):
        self._answer = value
        self._evt.set()

    def ask_error(self, info):
        if self.always_policy:
            return self.always_policy
        self.sig_ask_error.emit(info)
        return self._wait() or ErrorPolicy.STOP

    def ask_message(self, msg):
        self.sig_ask_msg.emit(msg)
        return self._wait() or ("parar", "")


class RunThread(QThread):
    def __init__(self, engine: Engine, rows):
        super().__init__()
        self.engine = engine
        self.rows = rows

    def run(self):
        from ...drivers.desktop import init_com
        init_com()
        self.engine.run(self.rows)
        for plat, d in self.engine.drivers.items():
            if plat == Platform.DESKTOP:
                try:
                    d.close()
                except Exception:
                    pass


# ================================================================ diálogos
def _shot_label(path: str, w=520, h=300) -> QLabel:
    lb = QLabel()
    lb.setAlignment(Qt.AlignCenter)
    pm = QPixmap(path) if path else QPixmap()
    if not pm.isNull():
        lb.setPixmap(pm.scaled(QSize(w, h), Qt.KeepAspectRatio, Qt.SmoothTransformation))
        lb.setCursor(Qt.PointingHandCursor)
        lb.mousePressEvent = lambda e: QDesktopServices.openUrl(QUrl.fromLocalFile(path))
        lb.setToolTip("Clique para abrir a imagem")
    else:
        lb.setText("(sem captura de tela)")
    return lb


class ErrorDialog(QDialog):
    def __init__(self, info: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Erro na execução")
        self.setWindowFlag(Qt.WindowStaysOnTopHint)
        self.setMinimumWidth(620)
        self.choice = ErrorPolicy.SKIP_ROW
        lay = QVBoxLayout(self)
        c = theme.colors()
        head = QLabel(f"<span style='font-size:15pt;color:{c['danger']}'>✖</span>&nbsp;&nbsp;"
                      f"<b style='font-size:12pt'>Falha na rodada {info['row'] + 1}, passo {info['order']}</b>")
        lay.addWidget(head)
        lay.addWidget(label(info["step"], "muted"))
        err = QTextEdit(info["error"])
        err.setReadOnly(True)
        err.setMaximumHeight(90)
        lay.addWidget(err)
        lay.addWidget(_shot_label(info.get("screenshot", "")))
        lay.addWidget(label("O que deseja fazer?", "h2"))
        grid = QGridLayout()
        opts = [
            (ErrorPolicy.RETRY, "Repetir o passo", "primary", "⟳", "Corrija a tela e tente de novo"),
            (ErrorPolicy.CONTINUE, "Prosseguir", "", "⏭", "Ignora este passo e segue"),
            (ErrorPolicy.RESTART_ROW, "Recomeçar a rodada", "warning", "↺", "Executa o fluxo de reinício e começa a linha de novo"),
            (ErrorPolicy.SKIP_ROW, "Próxima rodada", "", "⤼", "Marca erro nesta linha e vai para a próxima"),
            (ErrorPolicy.STOP, "Parar execução", "danger", "■", "Interrompe tudo"),
        ]
        for i, (pol, txt, kind, ic, tip) in enumerate(opts):
            b = button(txt, kind, tip, lambda _=False, p=pol: self._pick(p), ic)
            b.setMinimumHeight(40)
            grid.addWidget(b, i // 3, i % 3)
        lay.addLayout(grid)
        self.always = QCheckBox("Aplicar esta escolha automaticamente aos próximos erros desta execução")
        lay.addWidget(self.always)

    def _pick(self, p):
        self.choice = p
        self.accept()


class MessageDialog(QDialog):
    def __init__(self, msg, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Mensagem não prevista")
        self.setWindowFlag(Qt.WindowStaysOnTopHint)
        self.setMinimumWidth(560)
        self.result_value = ("parar", "")
        lay = QVBoxLayout(self)
        c = theme.colors()
        lay.addWidget(QLabel(f"<span style='font-size:15pt;color:{c['warning']}'>💬</span>&nbsp;&nbsp;"
                             f"<b style='font-size:12pt'>O sistema exibiu uma mensagem</b>"))
        box = Card(msg.title or "(sem título)", shadow=False)
        t = QLabel(msg.text or "")
        t.setWordWrap(True)
        t.setTextInteractionFlags(Qt.TextSelectableByMouse)
        box.add(t)
        lay.addWidget(box)
        if msg.buttons:
            lay.addWidget(label("Clicar no botão da mensagem e continuar:", "h3"))
            row = QHBoxLayout()
            for b in msg.buttons[:6]:
                row.addWidget(button(b, "primary", "", lambda _=False, b=b: self._done("clicar", b)))
            row.addStretch()
            lay.addLayout(row)
        lay.addWidget(label("Ou:", "h3"))
        row2 = QHBoxLayout()
        row2.addWidget(button("Capturar e próxima rodada", "warning", "",
                              lambda: self._done("proxima", ""), "⤼"))
        row2.addWidget(button("Recomeçar rodada", "", "", lambda: self._done("recomecar", ""), "↺"))
        row2.addWidget(button("Ignorar", "ghost", "", lambda: self._done("ignorar", ""), "—"))
        row2.addWidget(button("Parar", "danger", "", lambda: self._done("parar", ""), "■"))
        lay.addLayout(row2)
        self.make_rule = QCheckBox("Criar regra para esta mensagem (repetir a escolha nas próximas vezes)")
        self.make_rule.setChecked(True)
        lay.addWidget(self.make_rule)
        self.msg = msg

    def _done(self, action, button_text):
        self.result_value = (action, button_text)
        self.accept()


# ================================================================== página
class ExecutionPage(QWidget):
    title = "Execução"
    subtitle = "Rode a automação com controle de tempo, pausa (F9) e parada (F10)"

    def __init__(self, state, data_page=None):
        super().__init__()
        self.state = state
        self.data_page = data_page
        self.thread: RunThread | None = None
        self.engine: Engine | None = None
        self.events: QtEvents | None = None
        self.t0 = 0.0
        self.done_rows = 0
        self.total_rows = 0
        self.ok = self.err = 0
        self.folder = ""

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(14)

        # ----------------------------------------------------- controles
        ctrl = Card()
        r1 = QHBoxLayout()
        self.start_btn = button("Iniciar", "success", "Executar a massa", self.start, "▶")
        self.start_btn.setProperty("kind", "success")
        self.start_btn.setMinimumHeight(44)
        self.start_btn.setMinimumWidth(140)
        self.pause_btn = button("Pausar", "warning", "F9", self.toggle_pause, "⏸")
        self.pause_btn.setMinimumHeight(44)
        self.stop_btn = button("Parar", "danger", "F10", self.stop, "■")
        self.stop_btn.setMinimumHeight(44)
        r1.addWidget(self.start_btn)
        r1.addWidget(self.pause_btn)
        r1.addWidget(self.stop_btn)
        r1.addSpacing(20)
        self.dot = StatusDot("muted")
        r1.addWidget(self.dot)
        self.state_lbl = label("Parado", "h2")
        r1.addWidget(self.state_lbl)
        r1.addStretch()
        self.folder_btn = button("Evidências", "ghost", "Abrir pasta de prints desta execução",
                                 self._open_folder, "📁")
        r1.addWidget(self.folder_btn)
        ctrl.add(r1)

        r2 = QHBoxLayout()
        r2.addWidget(label("Linhas:", "muted"))
        self.scope = QComboBox()
        self.scope.addItems(["Todas marcadas com S", "Somente pendentes / com erro", "Selecionadas na massa",
                             "Intervalo…"])
        r2.addWidget(self.scope)
        self.range_from = QSpinBox(minimum=1, maximum=1000000)
        self.range_to = QSpinBox(minimum=1, maximum=1000000)
        r2.addWidget(self.range_from)
        self.range_lbl = label("até", "muted")
        r2.addWidget(self.range_lbl)
        r2.addWidget(self.range_to)
        self.scope.currentIndexChanged.connect(self._scope_changed)
        self._scope_changed(0)
        r2.addSpacing(20)
        r2.addWidget(label("Velocidade:", "muted"))
        self.speed = QSlider(Qt.Horizontal)
        self.speed.setRange(1, 8)  # 1 = 4x lenta … 8 = 3x rápida
        self.speed.setFixedWidth(180)
        self.speed_lbl = label("", "muted")
        self.speed.valueChanged.connect(self._speed_changed)
        r2.addWidget(self.speed)
        r2.addWidget(self.speed_lbl)
        r2.addSpacing(20)
        r2.addWidget(label("Em erro:", "muted"))
        self.policy = QComboBox()
        for k in ErrorPolicy.ALL[1:]:
            self.policy.addItem(ErrorPolicy.LABELS[k], k)
        self.policy.currentIndexChanged.connect(self._policy_changed)
        r2.addWidget(self.policy)
        r2.addStretch()
        ctrl.add(r2)
        root.addWidget(ctrl)

        # ----------------------------------------------------- KPIs
        k = QHBoxLayout()
        self.k_prog = KpiCard("Progresso", "▶", "primary")
        self.k_ok = KpiCard("Sucesso", "✔", "success")
        self.k_err = KpiCard("Erros", "✖", "danger")
        self.k_time = KpiCard("Tempo decorrido", "⏱", "info")
        self.k_eta = KpiCard("Tempo médio / previsão", "⌛", "purple")
        for w in (self.k_prog, self.k_ok, self.k_err, self.k_time, self.k_eta):
            k.addWidget(w)
        root.addLayout(k)
        self.progress = QProgressBar()
        self.progress.setTextVisible(True)
        root.addWidget(self.progress)

        # ----------------------------------------------------- live
        split = QSplitter(Qt.Horizontal)
        steps = Card("Passos da rodada atual")
        self.current_lbl = label("—", "muted")
        steps.add(self.current_lbl)
        self.steps = QListWidget()
        steps.add(self.steps, 1)
        split.addWidget(steps)

        logc = Card("Log")
        logc.add_action(button("Limpar", "ghost", "", lambda: self.log.clear()))
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(5000)
        self.log.setStyleSheet("font-family: Consolas, 'Cascadia Mono', monospace; font-size: 9pt;")
        logc.add(self.log, 1)
        split.addWidget(logc)

        shot = Card("Última captura")
        self.shot = QLabel("—")
        self.shot.setAlignment(Qt.AlignCenter)
        self.shot.setMinimumWidth(260)
        shot.add(self.shot, 1)
        split.addWidget(shot)
        split.setSizes([360, 520, 300])
        root.addWidget(split, 1)

        self.timer = QTimer(self, interval=500)
        self.timer.timeout.connect(self._tick)
        state.project_loaded.connect(self._load_settings)
        self._load_settings()
        self._set_running(False)

    # ------------------------------------------------------------ config
    def _load_settings(self):
        s = self.state.project.settings
        self.speed.blockSignals(True)
        self.speed.setValue(self._speed_to_slider(s.speed))
        self.speed.blockSignals(False)
        self._speed_changed(self.speed.value(), save=False)
        self.policy.blockSignals(True)
        self.policy.setCurrentIndex(max(0, self.policy.findData(s.error_policy)))
        self.policy.blockSignals(False)

    _SPEEDS = [4.0, 2.0, 1.5, 1.0, 0.75, 0.5, 0.33, 0.2]

    def _speed_to_slider(self, v):
        diffs = [abs(v - x) for x in self._SPEEDS]
        return diffs.index(min(diffs)) + 1

    def _speed_changed(self, v, save=True):
        mult = self._SPEEDS[v - 1]
        self.speed_lbl.setText(f"{1 / mult:.1f}x" if mult != 1 else "normal")
        if save:
            self.state.project.settings.speed = mult
            self.state.mark_dirty()

    def _policy_changed(self):
        self.state.project.settings.error_policy = self.policy.currentData()
        self.state.mark_dirty()

    def _scope_changed(self, i):
        show = i == 3
        self.range_from.setVisible(show)
        self.range_to.setVisible(show)
        self.range_lbl.setVisible(show)
        n = max(1, len(self.state.project.rows))
        self.range_to.setValue(n)

    def _rows_to_run(self) -> list[int]:
        p = self.state.project
        i = self.scope.currentIndex()
        all_idx = list(range(len(p.rows)))
        if i == 1:
            return [r for r in all_idx if p.rows[r].get(CTRL_STATUS) not in (RowStatus.SUCCESS, RowStatus.WARNING)]
        if i == 2 and self.data_page is not None:
            return self.data_page._selected_rows()
        if i == 3:
            a, b = self.range_from.value() - 1, self.range_to.value()
            return all_idx[a:b]
        return all_idx

    # ------------------------------------------------------------ ações
    def start(self):
        p = self.state.project
        if self.thread and self.thread.isRunning():
            return
        if not p.steps:
            toast(self, "O fluxo está vazio – crie os passos primeiro", "warn")
            return
        rows = self._rows_to_run()
        if not p.rows:
            # sem massa: executa uma rodada única (útil p/ fluxos sem dados)
            p.rows.append({CTRL_EXECUTE: "S"})
            p.sync_columns()
            rows = [0]
        if not rows:
            toast(self, "Nenhuma linha para executar com o filtro escolhido", "warn")
            return
        from ...drivers.desktop import DesktopDriver
        drivers = {Platform.DESKTOP: DesktopDriver(p.settings), Platform.WEB: self.state.web}
        self.state.web.settings = p.settings
        self.events = QtEvents()
        self.engine = Engine(p, drivers, self.state.db, self.events)
        self.events.engine = self.engine
        ev = self.events
        ev.sig_log.connect(self._log)
        ev.sig_exec.connect(self._on_exec)
        ev.sig_row_start.connect(self._on_row_start)
        ev.sig_row_end.connect(self._on_row_end)
        ev.sig_step_start.connect(self._on_step_start)
        ev.sig_step_end.connect(self._on_step_end)
        ev.sig_shot.connect(self._on_shot)
        ev.sig_state.connect(self._on_state)
        ev.sig_done.connect(self._on_done)
        ev.sig_ask_error.connect(self._ask_error)
        ev.sig_ask_msg.connect(self._ask_msg)
        self.total_rows = len(rows)
        self.done_rows = self.ok = self.err = 0
        self.progress.setRange(0, len(rows))
        self.progress.setValue(0)
        self.t0 = time.time()
        self.thread = RunThread(self.engine, rows)
        self.thread.start()
        self.timer.start()
        self._set_running(True)

    def toggle_pause(self):
        if self.engine and self.thread and self.thread.isRunning():
            self.engine.toggle_pause()

    def stop(self):
        if self.engine and self.thread and self.thread.isRunning():
            self.engine.stop()
            if self.events:
                self.events.answer(None)

    def _set_running(self, running: bool):
        self.start_btn.setEnabled(not running)
        self.pause_btn.setEnabled(running)
        self.stop_btn.setEnabled(running)
        self.scope.setEnabled(not running)
        self.state.set_running(running)

    # ------------------------------------------------------------ eventos
    def _log(self, level, text):
        c = theme.colors()
        color = {"error": c["danger"], "warn": c["warning"], "ok": c["success"]}.get(level, c["text"])
        ts = time.strftime("%H:%M:%S")
        safe = text.replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br>")
        self.log.appendHtml(f"<span style='color:{c['muted']}'>{ts}</span> "
                            f"<span style='color:{color}'>{safe}</span>")
        self.log.moveCursor(QTextCursor.End)

    def _on_exec(self, eid, total, folder):
        self.folder = folder

    def _on_row_start(self, idx, attempt):
        self.steps.clear()
        self.current_lbl.setText(f"Rodada {idx + 1}" + (f" • tentativa {attempt}" if attempt > 1 else ""))
        if self.data_page:
            self.data_page.refresh_row(idx)

    def _on_row_end(self, idx, status, message, dur):
        self.done_rows += 1
        if status in (RowStatus.SUCCESS, RowStatus.WARNING):
            self.ok += 1
        elif status == RowStatus.ERROR:
            self.err += 1
        self.progress.setValue(self.done_rows)
        self.progress.setFormat(f"{self.done_rows}/{self.total_rows}  (%p%)")
        if self.data_page:
            self.data_page.refresh_row(idx)
        self.state.mark_dirty()

    def _on_step_start(self, idx, order, name):
        it = QListWidgetItem(f"⏳  {order}. {name}")
        it.setData(Qt.UserRole, order)
        self.steps.addItem(it)
        self.steps.scrollToBottom()

    def _on_step_end(self, idx, order, name, status, dt, err):
        for i in range(self.steps.count() - 1, -1, -1):
            it = self.steps.item(i)
            if it.data(Qt.UserRole) == order and it.text().startswith("⏳"):
                icon = {"Sucesso": "✔", "Erro": "✖", "Repetido": "↻", "Desviado": "⤼"}.get(status, "•")
                it.setText(f"{icon}  {order}. {name}   —  {dt / 1000:.2f}s" + (f"\n      {err[:120]}" if err else ""))
                it.setForeground(QColor(theme.status_color(status)))
                break

    def _on_shot(self, path):
        pm = QPixmap(path)
        if not pm.isNull():
            self.shot.setPixmap(pm.scaled(self.shot.width() - 10, 400, Qt.KeepAspectRatio, Qt.SmoothTransformation))
            self.shot.setToolTip(path)

    def _on_state(self, st):
        labels = {"executando": ("Executando", "success"), "pausado": ("Pausado", "warning"),
                  "aguardando": ("Aguardando sua decisão", "danger"), "parado": ("Parado", "muted")}
        txt, color = labels.get(st, (st, "muted"))
        self.state_lbl.setText(txt)
        self.dot.set(color)
        self.pause_btn.setText("▶  Retomar" if st == "pausado" else "⏸  Pausar")

    def _on_done(self, summary):
        self.timer.stop()
        self._tick()
        self._set_running(False)
        self.state.history_changed.emit()
        self.state.rows_changed.emit()
        win = self.window()
        if win.isMinimized():
            win.showNormal()
        kind = "ok" if not summary["erro"] else "warn"
        toast(self, f"Execução finalizada: {summary['ok'] + summary['aviso']} sucesso, {summary['erro']} erro(s)", kind)

    def _tick(self):
        if not self.t0:
            return
        el = time.time() - self.t0
        self.k_time.set(_fmt(el))
        self.k_prog.set(f"{self.done_rows}/{self.total_rows}")
        self.k_ok.set(str(self.ok))
        self.k_err.set(str(self.err))
        if self.done_rows:
            avg = el / self.done_rows
            rest = avg * (self.total_rows - self.done_rows)
            self.k_eta.set(f"{avg:.1f}s", f"faltam ~{_fmt(rest)}")

    def _ask_error(self, info):
        self._bring_front()
        dlg = ErrorDialog(info, self)
        dlg.exec()
        if dlg.always.isChecked() and self.events:
            self.events.always_policy = dlg.choice
        if self.events:
            self.events.answer(dlg.choice)

    def _ask_msg(self, msg):
        self._bring_front()
        dlg = MessageDialog(msg, self)
        dlg.exec()
        action, btn = dlg.result_value
        if dlg.make_rule.isChecked() and action not in ("parar",):
            text = (msg.text or msg.title).strip().split("\n")[0][:60]
            rule = MessageRule(
                name=(msg.title or "Mensagem")[:40], text_contains=text,
                action={"clicar": MessageAction.CLICK_CAPTURE, "proxima": MessageAction.CAPTURE_NEXT,
                        "recomecar": MessageAction.RESTART, "ignorar": MessageAction.IGNORE}[action],
                button=btn or "OK",
                row_status=RowStatus.ERROR if action in ("proxima", "recomecar") else RowStatus.SUCCESS)
            self.state.project.message_rules.append(rule)
            self.state.rules_changed.emit()
            self.state.mark_dirty()
        if self.events:
            self.events.answer((action, btn))

    def _bring_front(self):
        win = self.window()
        if win.isMinimized():
            win.showNormal()
        win.raise_()
        win.activateWindow()

    def _open_folder(self):
        if self.folder:
            QDesktopServices.openUrl(QUrl.fromLocalFile(self.folder))
        else:
            from ...core.storage import default_workspace
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(default_workspace() / "evidencias")))


def _fmt(s: float) -> str:
    s = int(s)
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


__all__ = ["ExecutionPage", "QLineEdit", "Badge"]
