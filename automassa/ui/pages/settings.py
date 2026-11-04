"""Configurações de tempo, erros, capturas e navegador."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox,
                               QFileDialog, QFormLayout, QHBoxLayout,
                               QLineEdit, QScrollArea, QSpinBox, QVBoxLayout,
                               QWidget)

from ...core.models import ErrorPolicy
from ..widgets.common import Card, button, label


class SettingsPage(QWidget):
    title = "Configurações"
    subtitle = "Tempos de clique, tolerância a erros, evidências e navegador"
    theme_changed = Signal(str)

    def __init__(self, state):
        super().__init__()
        self.state = state
        self._loading = False
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        outer.addWidget(scroll)
        body = QWidget()
        body.setObjectName("page")
        scroll.setWidget(body)
        root = QHBoxLayout(body)
        root.setSpacing(14)
        col1, col2 = QVBoxLayout(), QVBoxLayout()
        root.addLayout(col1, 1)
        root.addLayout(col2, 1)

        t = Card("⏱  Tempos", "Controle fino dos cliques e execuções")
        f = QFormLayout()
        self.speed = QDoubleSpinBox(minimum=0.1, maximum=10, singleStep=0.1, decimals=2)
        self.speed.setToolTip("Multiplica todas as pausas: 0,5 = 2x mais rápido; 2 = 2x mais lento")
        self.step_delay = QSpinBox(maximum=60000, singleStep=50, suffix=" ms")
        self.row_delay = QSpinBox(maximum=600000, singleStep=100, suffix=" ms")
        self.timeout = QSpinBox(minimum=500, maximum=600000, singleStep=1000, suffix=" ms")
        self.typing = QSpinBox(maximum=1000, suffix=" ms")
        self.typing.setSpecialValueText("colar valor (mais rápido)")
        f.addRow("Multiplicador de velocidade", self.speed)
        f.addRow("Pausa entre passos", self.step_delay)
        f.addRow("Pausa entre rodadas", self.row_delay)
        f.addRow("Tempo máximo p/ achar campo", self.timeout)
        f.addRow("Intervalo entre teclas", self.typing)
        t.add(f)
        col1.addWidget(t)

        e = Card("⚠  Erros", "O que fazer quando algo dá errado")
        f = QFormLayout()
        self.policy = QComboBox()
        for k in ErrorPolicy.ALL[1:]:
            self.policy.addItem(ErrorPolicy.LABELS[k], k)
        self.restarts = QSpinBox(maximum=20)
        self.retries = QSpinBox(maximum=20)
        f.addRow("Política padrão", self.policy)
        f.addRow("Máx. recomeços por rodada", self.restarts)
        f.addRow("Tentativas extras por passo", self.retries)
        e.add(f)
        e.add(label("Use o “Fluxo de reinício” (aba Fluxo) para deixar o sistema pronto ao recomeçar "
                    "– por exemplo: fechar telas abertas, voltar ao menu ou recarregar a página.", "hint", wrap=True))
        col1.addWidget(e)
        col1.addStretch()

        c = Card("📷  Evidências", "Capturas de tela e saída")
        f = QFormLayout()
        self.shot_err = QCheckBox("Capturar tela quando ocorrer erro")
        self.shot_step = QCheckBox("Capturar tela a cada passo (mais lento)")
        self.out = QLineEdit()
        out_row = QHBoxLayout()
        out_row.addWidget(self.out, 1)
        out_row.addWidget(button("…", "", "", self._browse))
        f.addRow("", self.shot_err)
        f.addRow("", self.shot_step)
        f.addRow("Pasta dos Excel", out_row)
        c.add(f)
        col2.addWidget(c)

        b = Card("🌐  Navegador", "Para sistemas web")
        f = QFormLayout()
        self.channel = QComboBox()
        for txt, v in (("Microsoft Edge", "msedge"), ("Google Chrome", "chrome"), ("Chromium (embutido)", "chromium")):
            self.channel.addItem(txt, v)
        self.headless = QCheckBox("Executar sem janela (headless)")
        f.addRow("Navegador", self.channel)
        f.addRow("", self.headless)
        b.add(f)
        col2.addWidget(b)

        a = Card("🎨  Aparência")
        f = QFormLayout()
        self.theme = QComboBox()
        self.theme.addItem("Escuro", "escuro")
        self.theme.addItem("Claro", "claro")
        f.addRow("Tema", self.theme)
        a.add(f)
        a.add(label("Atalhos: Ctrl+S salvar • Ctrl+O abrir • Ctrl+N novo • F5 executar • F9 pausar • F10 parar",
                    "muted", wrap=True))
        col2.addWidget(a)
        col2.addStretch()

        for w in (self.speed, self.step_delay, self.row_delay, self.timeout, self.typing,
                  self.restarts, self.retries):
            w.valueChanged.connect(self._save)
        for w in (self.policy, self.channel):
            w.currentIndexChanged.connect(self._save)
        for w in (self.shot_err, self.shot_step, self.headless):
            w.toggled.connect(self._save)
        self.out.editingFinished.connect(self._save)
        self.theme.currentIndexChanged.connect(lambda: self.theme_changed.emit(self.theme.currentData()))
        state.project_loaded.connect(self.refresh)
        state.settings_changed.connect(self.refresh)
        self.refresh()

    def set_theme(self, name):
        self.theme.blockSignals(True)
        self.theme.setCurrentIndex(max(0, self.theme.findData(name)))
        self.theme.blockSignals(False)

    def refresh(self):
        self._loading = True
        s = self.state.project.settings
        self.speed.setValue(s.speed)
        self.step_delay.setValue(s.step_delay_ms)
        self.row_delay.setValue(s.row_delay_ms)
        self.timeout.setValue(s.timeout_ms)
        self.typing.setValue(s.typing_interval_ms)
        self.policy.setCurrentIndex(max(0, self.policy.findData(s.error_policy)))
        self.restarts.setValue(s.max_restarts)
        self.retries.setValue(s.default_retries)
        self.shot_err.setChecked(s.screenshot_on_error)
        self.shot_step.setChecked(s.screenshot_each_step)
        self.out.setText(s.output_folder)
        self.channel.setCurrentIndex(max(0, self.channel.findData(s.browser_channel)))
        self.headless.setChecked(s.browser_headless)
        self._loading = False

    def _save(self, *_):
        if self._loading:
            return
        s = self.state.project.settings
        s.speed = self.speed.value()
        s.step_delay_ms = self.step_delay.value()
        s.row_delay_ms = self.row_delay.value()
        s.timeout_ms = self.timeout.value()
        s.typing_interval_ms = self.typing.value()
        s.error_policy = self.policy.currentData()
        s.max_restarts = self.restarts.value()
        s.default_retries = self.retries.value()
        s.screenshot_on_error = self.shot_err.isChecked()
        s.screenshot_each_step = self.shot_step.isChecked()
        s.output_folder = self.out.text().strip()
        s.browser_channel = self.channel.currentData()
        s.browser_headless = self.headless.isChecked()
        self.state.mark_dirty()

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, "Pasta de saída")
        if d:
            self.out.setText(d)
            self._save()


__all__ = ["SettingsPage", "Qt"]
