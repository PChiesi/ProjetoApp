"""Página inicial: projeto, alvos e guia rápido."""
from __future__ import annotations

import os

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QFileDialog, QFormLayout, QGridLayout,
                               QHBoxLayout, QLineEdit, QListWidget,
                               QListWidgetItem, QPlainTextEdit, QVBoxLayout,
                               QWidget)

from ...core.storage import recent_projects
from .. import theme
from ..widgets.common import Card, button, label


class StepCard(Card):
    def __init__(self, n, title, text, page_index, nav):
        super().__init__()
        c = theme.colors()
        top = QHBoxLayout()
        num = label(str(n))
        num.setFixedSize(34, 34)
        num.setAlignment(Qt.AlignCenter)
        num.setStyleSheet(f"background: {theme.rgba(c['primary'], 0.15)}; color: {c['primary']}; border-radius: 17px;"
                          f" font-weight: 700; font-size: 12pt;")
        top.addWidget(num)
        top.addWidget(label(title, "h2"), 1)
        self.add(top)
        self.status = label("", "muted")
        self.add(label(text, "muted", wrap=True))
        self.add(self.status)
        b = button("Abrir", "ghost", "", lambda: nav(page_index), "→")
        self.add(b)


class HomePage(QWidget):
    title = "Início"
    subtitle = "Automatize a criação de massas em sistemas web e executáveis"
    open_recent = Signal(str)

    def __init__(self, state, nav):
        super().__init__()
        self.state = state
        self._loading = False
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(14)

        steps = QGridLayout()
        steps.setSpacing(14)
        data = [
            ("Mapeie os campos", "Clique nos campos do sistema. Listas trazem seus valores automaticamente.", 1),
            ("Monte o fluxo", "Ordem dos passos, tempos, tentativas e o que fazer em cada erro.", 2),
            ("Prepare a massa", "Gere linhas válidas ou exporte o Excel, preencha e importe de volta.", 3),
            ("Trate mensagens", "Regras para sucesso, erro e confirmações. Capturas de tela automáticas.", 4),
            ("Execute", "Acompanhe ao vivo, pause (F9), pare (F10) e decida em cada erro.", 5),
            ("Analise", "Dashboard com tempos, taxa de sucesso, erros e evidências.", 6),
        ]
        self.cards = []
        for i, (t, txt, idx) in enumerate(data):
            card = StepCard(i + 1, t, txt, idx, nav)
            self.cards.append(card)
            steps.addWidget(card, i // 3, i % 3)
        root.addLayout(steps)

        row = QHBoxLayout()
        row.setSpacing(14)
        proj = Card("Projeto", "Informações e sistemas alvo")
        f = QFormLayout()
        f.setLabelAlignment(Qt.AlignRight)
        self.name = QLineEdit()
        self.desc = QPlainTextEdit()
        self.desc.setMaximumHeight(70)
        self.app_path = QLineEdit()
        self.app_path.setPlaceholderText(r"C:\Sistemas\Contabil\sistema.exe")
        app_row = QHBoxLayout()
        app_row.addWidget(self.app_path, 1)
        app_row.addWidget(button("…", "", "Procurar executável", self._browse))
        self.win_title = QLineEdit()
        self.win_title.setPlaceholderText("Parte do título da janela principal")
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://")
        f.addRow("Nome", self.name)
        f.addRow("Descrição", self.desc)
        f.addRow("Executável", app_row)
        f.addRow("Título da janela", self.win_title)
        f.addRow("URL inicial", self.url)
        proj.add(f)
        row.addWidget(proj, 3)

        rec = Card("Projetos recentes")
        self.recent = QListWidget()
        self.recent.itemDoubleClicked.connect(lambda it: self.open_recent.emit(it.data(Qt.UserRole)))
        rec.add(self.recent, 1)
        row.addWidget(rec, 2)
        root.addLayout(row, 1)

        for w in (self.name, self.app_path, self.win_title, self.url):
            w.editingFinished.connect(self._save)
        self.desc.textChanged.connect(self._save)
        for sig in (state.project_loaded, state.fields_changed, state.steps_changed, state.rows_changed,
                    state.rules_changed, state.history_changed):
            sig.connect(self.refresh)
        self.refresh()

    def refresh(self):
        self._loading = True
        p = self.state.project
        s = p.settings
        if not self.name.hasFocus():
            self.name.setText(p.name)
        if not self.desc.hasFocus():
            self.desc.setPlainText(p.description)
        self.app_path.setText(s.app_path)
        self.win_title.setText(s.app_window_title)
        self.url.setText(s.start_url)
        self._loading = False
        lists = sum(1 for f in p.fields if f.options)
        k = self.state.db.kpis(p.name, 0)
        stats = [
            f"{len(p.fields)} campo(s) • {lists} lista(s)",
            f"{len(p.steps)} passo(s) • {len(p.reset_steps)} de reinício",
            f"{len(p.rows)} linha(s) na massa",
            f"{len(p.message_rules)} regra(s)",
            "Pronto para executar" if p.steps else "Crie o fluxo primeiro",
            f"{k['execucoes']} execução(ões) • {k['taxa']:.0f}% sucesso",
        ]
        c = theme.colors()
        for card, st in zip(self.cards, stats):
            card.status.setText(st)
            card.status.setStyleSheet(f"color: {c['primary']}; font-weight: 600;")
        self.recent.clear()
        for path in recent_projects():
            it = QListWidgetItem(f"📄  {os.path.basename(path)}\n      {os.path.dirname(path)}")
            it.setData(Qt.UserRole, path)
            self.recent.addItem(it)
        if not self.recent.count():
            self.recent.addItem("Nenhum projeto recente")

    def _save(self):
        if self._loading:
            return
        p = self.state.project
        p.name = self.name.text().strip() or p.name
        p.description = self.desc.toPlainText()
        p.settings.app_path = self.app_path.text().strip()
        p.settings.app_window_title = self.win_title.text().strip()
        p.settings.start_url = self.url.text().strip()
        self.state.mark_dirty()
        self.state.settings_changed.emit()

    def _browse(self):
        path, _ = QFileDialog.getOpenFileName(self, "Executável", "", "Programas (*.exe *.bat *.cmd *.lnk);;Todos (*)")
        if path:
            self.app_path.setText(path)
            self._save()
