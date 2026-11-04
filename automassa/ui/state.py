"""Estado compartilhado da aplicação (projeto aberto, banco, drivers)."""
from __future__ import annotations

from PySide6.QtCore import QObject, Signal

from ..core.database import Database
from ..core.models import Project, default_message_rules
from ..drivers.web import WebDriver


class AppState(QObject):
    project_loaded = Signal()       # projeto inteiro trocado
    fields_changed = Signal()
    steps_changed = Signal()
    rows_changed = Signal()
    rules_changed = Signal()
    settings_changed = Signal()
    dirty_changed = Signal(bool)
    history_changed = Signal()      # nova execução registrada
    web_pick = Signal(dict, bytes)  # elemento clicado no navegador
    running_changed = Signal(bool)

    def __init__(self):
        super().__init__()
        self.db = Database()
        self.project = Project()
        self.project.message_rules = default_message_rules()
        self._dirty = False
        self.running = False
        self.web = WebDriver(self.project.settings, on_pick=self._emit_pick)

    def _emit_pick(self, info, thumb):
        # chamado na thread do Playwright → sinal enfileirado p/ a UI
        self.web_pick.emit(info or {}, thumb or b"")

    # ------------------------------------------------------------------
    @property
    def dirty(self) -> bool:
        return self._dirty

    def mark_dirty(self, value: bool = True):
        if value != self._dirty:
            self._dirty = value
            self.dirty_changed.emit(value)

    def set_project(self, project: Project):
        self.project = project
        self.web.settings = project.settings
        self.project.sync_columns()
        self._dirty = False
        self.project_loaded.emit()
        self.dirty_changed.emit(False)

    def touch(self, *signals):
        for s in signals:
            s.emit()
        self.mark_dirty(True)

    def set_running(self, value: bool):
        self.running = value
        self.running_changed.emit(value)
