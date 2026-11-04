"""Janela principal: navegação lateral, barra superior e páginas."""
from __future__ import annotations

import os

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QAction, QIcon, QKeySequence
from PySide6.QtWidgets import (QApplication, QButtonGroup, QFileDialog,
                               QHBoxLayout, QMainWindow, QMessageBox,
                               QPushButton, QStackedWidget, QVBoxLayout,
                               QWidget)

from .. import __version__
from ..core import storage
from ..core.models import Project, default_message_rules
from . import theme
from .pages.dashboard import DashboardPage
from .pages.data import DataPage
from .pages.execution import ExecutionPage
from .pages.flow import FlowPage
from .pages.home import HomePage
from .pages.mapping import MappingPage
from .pages.messages import MessagesPage
from .pages.settings import SettingsPage
from .picker import GlobalHotkeys
from .state import AppState
from .widgets.common import Badge, button, label, toast

NAV = [("Início", "⌂"), ("Mapeamento", "🎯"), ("Fluxo", "⇶"), ("Massa de dados", "▦"),
       ("Mensagens", "💬"), ("Execução", "▶"), ("Dashboard", "📊"), ("Configurações", "⚙")]


class MainWindow(QMainWindow):
    def __init__(self, app: QApplication):
        super().__init__()
        self.app = app
        self.state = AppState()
        self.prefs = storage.load_prefs()
        self.setWindowTitle("AutoMassa Studio")
        self.resize(1360, 860)
        self.setMinimumSize(1100, 700)
        icon_path = storage.resource_path("automassa/assets/icon.png")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        central = QWidget()
        self.setCentralWidget(central)
        h = QHBoxLayout(central)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)

        # ---------------------------------------------------- sidebar
        side = QWidget()
        side.setObjectName("sidebar")
        side.setFixedWidth(220)
        sv = QVBoxLayout(side)
        sv.setContentsMargins(14, 18, 14, 14)
        sv.setSpacing(4)
        sv.addWidget(label("⚡ AutoMassa", "brand"))
        sv.addWidget(label(f"Studio • v{__version__}", "brandSub"))
        sv.addSpacing(18)
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        for i, (name, ic) in enumerate(NAV):
            b = QPushButton(f"{ic}    {name}")
            b.setObjectName("nav")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            self.nav_group.addButton(b, i)
            sv.addWidget(b)
        self.nav_group.idClicked.connect(self.go)
        sv.addStretch()
        self.run_badge = Badge("● Parado", "muted")
        sv.addWidget(self.run_badge)
        sv.addSpacing(6)
        sv.addWidget(label("F9 pausar  •  F10 parar", "brandSub"))
        h.addWidget(side)

        # ---------------------------------------------------- conteúdo
        main = QWidget()
        mv = QVBoxLayout(main)
        mv.setContentsMargins(0, 0, 0, 0)
        mv.setSpacing(0)
        top = QWidget()
        top.setObjectName("topbar")
        tl = QHBoxLayout(top)
        tl.setContentsMargins(26, 16, 26, 14)
        tbox = QVBoxLayout()
        tbox.setSpacing(2)
        self.page_title = label("", "pageTitle")
        self.page_sub = label("", "pageSubtitle")
        tbox.addWidget(self.page_title)
        tbox.addWidget(self.page_sub)
        tl.addLayout(tbox, 1)
        self.proj_badge = Badge("", "primary")
        tl.addWidget(self.proj_badge)
        tl.addSpacing(8)
        tl.addWidget(button("Novo", "ghost", "Ctrl+N", self.new_project, "＋"))
        tl.addWidget(button("Abrir", "ghost", "Ctrl+O", self.open_project, "📂"))
        tl.addWidget(button("Salvar", "primary", "Ctrl+S", self.save_project, "💾"))
        tl.addWidget(button("Executar", "success", "F5", self.run_now, "▶"))
        mv.addWidget(top)

        self.stack = QStackedWidget()
        holder = QWidget()
        holder.setObjectName("page")
        hl = QVBoxLayout(holder)
        hl.setContentsMargins(26, 18, 26, 22)
        hl.addWidget(self.stack)
        mv.addWidget(holder, 1)
        h.addWidget(main, 1)

        st = self.state
        self.home = HomePage(st, self.go)
        self.home.open_recent.connect(self._open_path)
        self.mapping = MappingPage(st)
        self.flow = FlowPage(st)
        self.data = DataPage(st)
        self.messages = MessagesPage(st)
        self.execution = ExecutionPage(st, self.data)
        self.dashboard = DashboardPage(st)
        self.settings = SettingsPage(st)
        self.settings.set_theme(self.prefs.get("tema", "escuro"))
        self.settings.theme_changed.connect(self.set_theme)
        self.pages = [self.home, self.mapping, self.flow, self.data, self.messages,
                      self.execution, self.dashboard, self.settings]
        for p in self.pages:
            self.stack.addWidget(p)

        st.dirty_changed.connect(self._update_title)
        st.project_loaded.connect(self._update_title)
        st.settings_changed.connect(self._update_title)
        st.running_changed.connect(self._on_running)
        self._shortcuts()
        self.hotkeys = GlobalHotkeys(self)
        self.hotkeys.pause.connect(self.execution.toggle_pause)
        self.hotkeys.stop.connect(self.execution.stop)

        # autosave de segurança a cada 2 minutos (só projetos já salvos)
        self.autosave = QTimer(self, interval=120000)
        self.autosave.timeout.connect(self._autosave)
        self.autosave.start()

        self.go(0)
        self._update_title()
        rec = storage.recent_projects()
        if self.prefs.get("abrir_ultimo", True) and rec:
            QTimer.singleShot(100, lambda: self._open_path(rec[0], quiet=True))

    # ------------------------------------------------------------ navegação
    def go(self, i: int):
        self.stack.setCurrentIndex(i)
        self.nav_group.button(i).setChecked(True)
        page = self.pages[i]
        self.page_title.setText(page.title)
        self.page_sub.setText(page.subtitle)

    def _shortcuts(self):
        for seq, fn in ((QKeySequence.Save, self.save_project), (QKeySequence.Open, self.open_project),
                        (QKeySequence.New, self.new_project), (QKeySequence("F5"), self.run_now),
                        (QKeySequence("Ctrl+Shift+S"), lambda: self.save_project(True))):
            a = QAction(self)
            a.setShortcut(seq)
            a.triggered.connect(fn)
            self.addAction(a)
        for i in range(len(NAV)):
            a = QAction(self)
            a.setShortcut(QKeySequence(f"Ctrl+{i + 1}"))
            a.triggered.connect(lambda _=False, i=i: self.go(i))
            self.addAction(a)

    def set_theme(self, name):
        theme.apply(self.app, name)
        self.prefs["tema"] = name
        storage.save_prefs(self.prefs)
        toast(self, "Tema aplicado. Alguns gráficos atualizam ao reabrir a página.")
        self.dashboard.refresh()

    def _update_title(self, *_):
        p = self.state.project
        star = " •" if self.state.dirty else ""
        self.proj_badge.setText(f"📁 {p.name}{star}")
        fname = os.path.basename(p.path) if p.path else "não salvo"
        self.setWindowTitle(f"AutoMassa Studio — {p.name} ({fname}){star}")

    def _on_running(self, running):
        self.run_badge.setText("● Executando" if running else "● Parado")
        self.run_badge.set_color("success" if running else "muted")

    def run_now(self):
        self.go(5)
        self.execution.start()

    # ------------------------------------------------------------ arquivos
    def _confirm_discard(self) -> bool:
        if not self.state.dirty:
            return True
        r = QMessageBox.question(self, "Alterações não salvas",
                                 "Deseja salvar as alterações do projeto atual?",
                                 QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if r == QMessageBox.Save:
            return self.save_project()
        return r == QMessageBox.Discard

    def new_project(self):
        if self.state.running:
            toast(self, "Aguarde a execução terminar", "warn")
            return
        if not self._confirm_discard():
            return
        p = Project()
        p.message_rules = default_message_rules()
        self.state.set_project(p)
        self.go(0)
        toast(self, "Novo projeto criado")

    def open_project(self):
        if self.state.running or not self._confirm_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Abrir projeto", str(storage.default_workspace()),
                                              f"Projeto AutoMassa (*{storage.PROJECT_EXT})")
        if path:
            self._open_path(path)

    def _open_path(self, path, quiet=False):
        if not path or not os.path.exists(path):
            return
        if not quiet and (self.state.running or not self._confirm_discard()):
            return
        try:
            p = storage.load_project(path)
        except Exception as e:
            if not quiet:
                QMessageBox.critical(self, "Abrir projeto", f"Não foi possível abrir:\n{e}")
            return
        self.state.set_project(p)
        if not quiet:
            toast(self, f"Projeto '{p.name}' aberto", "ok")

    def save_project(self, save_as=False) -> bool:
        p = self.state.project
        path = p.path
        if save_as or not path:
            from ..core.models import sanitize_column_name
            default = os.path.join(str(storage.default_workspace()),
                                   sanitize_column_name(p.name) + storage.PROJECT_EXT)
            path, _ = QFileDialog.getSaveFileName(self, "Salvar projeto", default,
                                                  f"Projeto AutoMassa (*{storage.PROJECT_EXT})")
            if not path:
                return False
        try:
            storage.save_project(p, path)
        except Exception as e:
            QMessageBox.critical(self, "Salvar", f"Erro ao salvar:\n{e}")
            return False
        self.state.mark_dirty(False)
        self._update_title()
        toast(self, "Projeto salvo ✓", "ok")
        return True

    def _autosave(self):
        p = self.state.project
        if p.path and self.state.dirty:
            try:
                storage.save_project(p, p.path)
                self.state.mark_dirty(False)
            except Exception:
                pass

    def closeEvent(self, e):
        if self.state.running:
            if QMessageBox.question(self, "Sair", "Há uma execução em andamento. Parar e sair?") != QMessageBox.Yes:
                e.ignore()
                return
            self.execution.stop()
            if self.execution.thread:
                self.execution.thread.wait(5000)
        if not self._confirm_discard():
            e.ignore()
            return
        self.hotkeys.close()
        try:
            self.state.web.close()
        except Exception:
            pass
        e.accept()


__all__ = ["MainWindow", "QSize"]
