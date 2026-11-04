"""Página de controle de mensagens (popups, alertas, modais)."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox,
                               QFormLayout, QHBoxLayout, QHeaderView,
                               QLineEdit, QSplitter, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from ...core.models import (UNEXPECTED_LABELS, MessageAction, MessageRule,
                            RowStatus)
from ..widgets.common import Card, button, label, toast
from .mapping import run_task


class MessagesPage(QWidget):
    title = "Controle de mensagens"
    subtitle = "Defina o que fazer quando o sistema mostrar avisos, erros ou confirmações"

    def __init__(self, state):
        super().__init__()
        self.state = state
        self._loading = False
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(14)

        # --------------------------------------------- não previstas
        unexpected = Card("Mensagens não previstas",
                          "Quando aparecer uma mensagem que não bate com nenhuma regra abaixo")
        f = QFormLayout()
        self.watch = QCheckBox("Monitorar mensagens a cada passo")
        self.policy = QComboBox()
        for k, v in UNEXPECTED_LABELS.items():
            self.policy.addItem(v, k)
        self.buttons = QLineEdit()
        self.buttons.setToolTip("Botões que podem ser clicados automaticamente, em ordem de preferência")
        self.web_sel = QLineEdit()
        self.web_sel.setToolTip("Seletores CSS de modais/alertas em páginas web, separados por ;")
        f.addRow("", self.watch)
        f.addRow("Ação", self.policy)
        f.addRow("Botões para clique automático", self.buttons)
        f.addRow("Modais web (CSS)", self.web_sel)
        unexpected.add(f)
        for w in (self.buttons, self.web_sel):
            w.editingFinished.connect(self._save_settings)
        self.policy.currentIndexChanged.connect(self._save_settings)
        self.watch.toggled.connect(self._save_settings)

        detect = QHBoxLayout()
        detect.addWidget(button("Detectar mensagens abertas agora", "", "Lê as mensagens visíveis e permite criar regras",
                                self._detect, "🔍"))
        detect.addStretch()
        unexpected.add(detect)
        root.addWidget(unexpected)

        # --------------------------------------------- regras
        split = QSplitter(Qt.Horizontal)
        left = Card("Regras", "Avaliadas de cima para baixo — a primeira que combinar é aplicada")
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["Ativa", "Nome", "Contém", "Ação", "Status da linha"])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.itemSelectionChanged.connect(self._on_select)
        left.add(self.table, 1)
        r = QHBoxLayout()
        r.addWidget(button("Regra", "primary", "", self._add, "+"))
        r.addWidget(button("", "ghost", "Subir", lambda: self._move(-1), "↑"))
        r.addWidget(button("", "ghost", "Descer", lambda: self._move(1), "↓"))
        r.addStretch()
        r.addWidget(button("Excluir", "danger", "", self._delete, "🗑"))
        left.add(r)
        split.addWidget(left)

        right = Card("Editar regra")
        ef = QFormLayout()
        self.r_enabled = QCheckBox("Regra ativa")
        self.r_name = QLineEdit()
        self.r_title = QLineEdit()
        self.r_title.setPlaceholderText("vazio = qualquer título")
        self.r_text = QLineEdit()
        self.r_text.setPlaceholderText("texto contido, ou re:(erro|falha) para regex")
        self.r_action = QComboBox()
        for k in MessageAction.ALL:
            self.r_action.addItem(MessageAction.LABELS[k], k)
        self.r_button = QLineEdit()
        self.r_button.setPlaceholderText("OK  (aceita vários: Sim;OK)")
        self.r_status = QComboBox()
        for s in (RowStatus.SUCCESS, RowStatus.WARNING, RowStatus.ERROR):
            self.r_status.addItem(s, s)
        self.r_output = QComboBox()
        self.r_output.setEditable(True)
        self.r_shot = QCheckBox("Capturar tela da mensagem")
        ef.addRow("", self.r_enabled)
        ef.addRow("Nome", self.r_name)
        ef.addRow("Título contém", self.r_title)
        ef.addRow("Texto contém", self.r_text)
        ef.addRow("Ação", self.r_action)
        ef.addRow("Botão a clicar", self.r_button)
        ef.addRow("Status da linha", self.r_status)
        ef.addRow("Salvar texto em", self.r_output)
        ef.addRow("", self.r_shot)
        right.add(ef)
        right.add(label("💡 Exemplos: texto <b>re:(sucesso|gravado)</b> → Capturar, clicar e continuar "
                        "(status Sucesso). Texto <b>re:(inválido|obrigatório)</b> → Capturar, fechar e ir para "
                        "a próxima rodada (status Erro).", "hint", wrap=True))
        right.add(label("", ""), 1)
        self.editor = right
        split.addWidget(right)
        split.setSizes([600, 460])
        root.addWidget(split, 1)

        for w in (self.r_name, self.r_title, self.r_text, self.r_button):
            w.textChanged.connect(self._save_rule)
        for w in (self.r_action, self.r_status):
            w.currentIndexChanged.connect(self._save_rule)
        self.r_output.currentTextChanged.connect(self._save_rule)
        for w in (self.r_enabled, self.r_shot):
            w.toggled.connect(self._save_rule)

        state.project_loaded.connect(self.refresh)
        state.rules_changed.connect(self.refresh)
        self.refresh()

    # ----------------------------------------------------------------
    def refresh(self):
        self._loading = True
        s = self.state.project.settings
        self.watch.setChecked(s.watch_messages)
        self.policy.setCurrentIndex(max(0, self.policy.findData(s.unexpected_message_action)))
        self.buttons.setText(s.auto_click_buttons)
        self.web_sel.setText(s.web_message_selectors)
        cur = self._current()
        rules = self.state.project.message_rules
        self.table.setRowCount(len(rules))
        for i, r in enumerate(rules):
            self._fill_row(i, r)
        self._loading = False
        if cur in rules:
            self.table.selectRow(rules.index(cur))
        elif rules:
            self.table.selectRow(0)
        else:
            self.editor.setEnabled(False)

    def _fill_row(self, i, r):
        vals = ["✔" if r.enabled else "—", r.name, r.text_contains or r.title_contains or "(qualquer)",
                MessageAction.LABELS.get(r.action, r.action), r.row_status]
        for j, v in enumerate(vals):
            it = self.table.item(i, j)
            if it is None:
                it = QTableWidgetItem()
                self.table.setItem(i, j, it)
            it.setText(v)

    def _current(self) -> MessageRule | None:
        rows = self.table.selectionModel().selectedRows() if self.table.selectionModel() else []
        if not rows:
            return None
        i = rows[0].row()
        rules = self.state.project.message_rules
        return rules[i] if 0 <= i < len(rules) else None

    def _on_select(self):
        r = self._current()
        self.editor.setEnabled(r is not None)
        if r is None:
            return
        self._loading = True
        cols = [c for c in self.state.project.all_columns() if not c.startswith("_")]
        self.r_output.clear()
        self.r_output.addItems([""] + cols)
        self.r_enabled.setChecked(r.enabled)
        self.r_name.setText(r.name)
        self.r_title.setText(r.title_contains)
        self.r_text.setText(r.text_contains)
        self.r_action.setCurrentIndex(max(0, self.r_action.findData(r.action)))
        self.r_button.setText(r.button)
        self.r_status.setCurrentIndex(max(0, self.r_status.findData(r.row_status)))
        self.r_output.setCurrentText(r.output_column)
        self.r_shot.setChecked(r.screenshot)
        self._loading = False

    def _save_rule(self, *_):
        if self._loading:
            return
        r = self._current()
        if r is None:
            return
        r.enabled = self.r_enabled.isChecked()
        r.name = self.r_name.text()
        r.title_contains = self.r_title.text()
        r.text_contains = self.r_text.text()
        r.action = self.r_action.currentData()
        r.button = self.r_button.text()
        r.row_status = self.r_status.currentData()
        r.output_column = self.r_output.currentText().strip()
        r.screenshot = self.r_shot.isChecked()
        self._fill_row(self.state.project.message_rules.index(r), r)
        self.state.project.sync_columns()
        self.state.mark_dirty()
        self.state.rows_changed.emit()

    def _save_settings(self, *_):
        if self._loading:
            return
        s = self.state.project.settings
        s.watch_messages = self.watch.isChecked()
        s.unexpected_message_action = self.policy.currentData()
        s.auto_click_buttons = self.buttons.text()
        s.web_message_selectors = self.web_sel.text()
        self.state.mark_dirty()

    def _add(self, rule: MessageRule | None = None):
        rule = rule or MessageRule(name="Nova regra")
        self.state.project.message_rules.append(rule)
        self.state.touch(self.state.rules_changed)
        self.table.selectRow(len(self.state.project.message_rules) - 1)

    def _delete(self):
        r = self._current()
        if r:
            self.state.project.message_rules.remove(r)
            self.state.touch(self.state.rules_changed)

    def _move(self, d):
        r = self._current()
        rules = self.state.project.message_rules
        if not r:
            return
        i = rules.index(r)
        j = i + d
        if 0 <= j < len(rules):
            rules[i], rules[j] = rules[j], rules[i]
            self.state.touch(self.state.rules_changed)
            self.table.selectRow(j)

    def _detect(self):
        p = self.state.project

        def work():
            from ...drivers.desktop import DesktopDriver, IS_WINDOWS, init_com
            out = []
            if IS_WINDOWS:
                init_com()
                d = DesktopDriver(p.settings)
                if p.fields:
                    desk = [f for f in p.fields if f.platform == "desktop"]
                    if desk:
                        try:
                            d.find_window(desk[0].locator, 2)
                        except Exception:
                            pass
                out += d.messages()
            if self.state.web.running:
                out += self.state.web.messages()
            return out

        def done(msgs, err):
            if err:
                toast(self, err, "error")
                return
            if not msgs:
                toast(self, "Nenhuma mensagem aberta encontrada", "warn")
                return
            for m in msgs:
                text = (m.text or m.title).strip().split("\n")[0][:60]
                self._add(MessageRule(name=(m.title or "Mensagem")[:40], text_contains=text,
                                      button=(m.buttons[0] if m.buttons else "OK"),
                                      action=MessageAction.CLICK_CAPTURE))
            toast(self, f"{len(msgs)} mensagem(ns) detectada(s) – regras criadas para revisão", "ok")
        run_task(self, work, done)
