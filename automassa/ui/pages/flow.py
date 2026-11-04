"""Página do fluxo de automação (passos) e fluxo de reinício."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox,
                               QFormLayout, QHBoxLayout, QLineEdit,
                               QListWidget, QListWidgetItem, QMenu,
                               QMessageBox, QSpinBox, QSplitter, QTabWidget,
                               QVBoxLayout, QWidget)

from ...core import generators
from ...core.flow import auto_flow
from ...core.models import Action, ErrorPolicy, Step, ValueSource
from .. import theme
from ..widgets.common import Badge, Card, button, label, scrollable, toast
from .mapping import run_task


class StepEditor(QWidget):
    changed = Signal()

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.step: Step | None = None
        self._loading = False
        form = QFormLayout(self)
        form.setContentsMargins(0, 0, 14, 0)
        form.setLabelAlignment(Qt.AlignRight)
        form.setVerticalSpacing(8)
        self.form = form

        self.enabled = QCheckBox("Passo ativo")
        self.action = QComboBox()
        for a in Action.ALL:
            self.action.addItem(f"{Action.ICONS.get(a, '')}  {Action.LABELS[a]}", a)
        self.field = QComboBox()
        self.source = QComboBox()
        for k in ValueSource.ALL:
            self.source.addItem(ValueSource.LABELS[k], k)
        self.column = QComboBox()
        self.column.setEditable(True)
        self.value = QLineEdit()
        self.gen = QComboBox()
        for k, (lbl, _) in generators.GENERATORS.items():
            self.gen.addItem(lbl, k)
        self.output = QComboBox()
        self.output.setEditable(True)
        self.delay_before = QSpinBox(maximum=600000, singleStep=100, suffix=" ms")
        self.delay_after = QSpinBox(maximum=600000, singleStep=100, suffix=" ms")
        self.delay_after.setSpecialValueText("padrão do projeto")
        self.timeout = QSpinBox(maximum=600000, singleStep=1000, suffix=" ms")
        self.timeout.setSpecialValueText("padrão do projeto")
        self.retries = QSpinBox(maximum=20)
        self.on_error = QComboBox()
        for k in ErrorPolicy.ALL:
            self.on_error.addItem(ErrorPolicy.LABELS[k], k)
        self.condition = QComboBox()
        self.condition.setEditable(True)
        self.optional = QCheckBox("Opcional (se falhar, segue em frente)")
        self.note = QLineEdit()
        self.note.setPlaceholderText("Descrição exibida no fluxo e no dashboard")

        form.addRow("", self.enabled)
        form.addRow("Ação", self.action)
        form.addRow("Campo", self.field)
        form.addRow("Origem do valor", self.source)
        form.addRow("Coluna da massa", self.column)
        form.addRow("Gerador", self.gen)
        form.addRow("Valor", self.value)
        form.addRow("Salvar em (coluna)", self.output)
        form.addRow(label("Tempos e erros", "h3"))
        form.addRow("Aguardar antes", self.delay_before)
        form.addRow("Aguardar depois", self.delay_after)
        form.addRow("Tempo máximo", self.timeout)
        form.addRow("Tentativas extras", self.retries)
        form.addRow("Se der erro", self.on_error)
        form.addRow("", self.optional)
        form.addRow("Executar só se", self.condition)
        form.addRow("Descrição", self.note)
        self.help = label("", "hint", wrap=True)
        form.addRow(self.help)

        for w in (self.action, self.field, self.source, self.gen, self.on_error):
            w.currentIndexChanged.connect(self._save)
        for w in (self.column, self.output, self.condition):
            w.currentTextChanged.connect(self._save)
        for w in (self.value, self.note):
            w.textChanged.connect(self._save)
        for w in (self.delay_before, self.delay_after, self.timeout, self.retries):
            w.valueChanged.connect(self._save)
        for w in (self.enabled, self.optional):
            w.toggled.connect(self._save)
        self.setEnabled(False)

    def _fill_combos(self):
        p = self.state.project
        self.field.blockSignals(True)
        self.field.clear()
        self.field.addItem("— sem campo —", "")
        for f in p.fields:
            self.field.addItem(f"{f.name}  ({f.label})" if f.label and f.label != f.name else f.name, f.id)
        self.field.blockSignals(False)
        cols = [c for c in p.all_columns() if not c.startswith("_")]
        for cb in (self.column, self.output, self.condition):
            cb.blockSignals(True)
            cb.clear()
            cb.addItem("")
            cb.addItems(cols)
            cb.blockSignals(False)

    def load(self, step: Step | None):
        self._loading = True
        self.step = step
        self.setEnabled(step is not None)
        self._fill_combos()
        if step is not None:
            self.enabled.setChecked(step.enabled)
            self.action.setCurrentIndex(max(0, self.action.findData(step.action)))
            self.field.setCurrentIndex(max(0, self.field.findData(step.field_id)))
            self.source.setCurrentIndex(max(0, self.source.findData(step.value_source)))
            self.column.setCurrentText(step.column)
            self.value.setText(step.value)
            gi = self.gen.findData(step.value)
            self.gen.setCurrentIndex(max(0, gi))
            self.output.setCurrentText(step.output_column)
            self.delay_before.setValue(step.delay_before_ms)
            self.delay_after.setValue(step.delay_after_ms)
            self.timeout.setValue(step.timeout_ms)
            self.retries.setValue(step.retries)
            self.on_error.setCurrentIndex(max(0, self.on_error.findData(step.on_error)))
            self.condition.setCurrentText(step.condition_column)
            self.optional.setChecked(step.optional)
            self.note.setText(step.note)
        self._update_visibility()
        self._loading = False

    def _row(self, w, visible):
        self.form.setRowVisible(w, visible)

    def _update_visibility(self):
        a = self.action.currentData()
        src = self.source.currentData()
        needs_value = a in Action.NEEDS_VALUE
        self._row(self.field, a in Action.NEEDS_FIELD or a == Action.CAPTURE_SCREEN)
        self._row(self.source, needs_value)
        self._row(self.column, needs_value and src in (ValueSource.COLUMN, ValueSource.GENERATOR))
        self._row(self.gen, needs_value and src == ValueSource.GENERATOR)
        self._row(self.value, (needs_value and src in (ValueSource.FIXED, ValueSource.VARIABLE, ValueSource.COLUMN))
                  or a in (Action.HANDLE_MESSAGES, Action.CAPTURE_MESSAGE))
        self._row(self.output, a in Action.PRODUCES_OUTPUT)
        tips = {
            Action.FILL: "Digita o valor no campo. Na coluna você pode usar =GERAR(cpf). Em 'Valor' (fixo) use {coluna}, {hoje}, {linha} ou {gerar:nome}.",
            Action.SELECT: "Seleciona o item da lista pelo texto (aceita início do texto).",
            Action.CHECK: "Marca se o valor for S/Sim/1/X; desmarca caso contrário.",
            Action.KEYS: "Executável: {ENTER}, {TAB}, ^s (Ctrl+S), %{F4} (Alt+F4). Web: Enter, Tab, Control+S.",
            Action.WAIT: "Valor em milissegundos (respeita o controle de velocidade).",
            Action.CAPTURE_TEXT: "Lê o texto/valor do campo e grava na coluna escolhida (vai para o Excel de resultado).",
            Action.CAPTURE_SCREEN: "Salva um print (janela/página ou só do campo escolhido) na pasta de evidências.",
            Action.CAPTURE_MESSAGE: "Lê a mensagem aberta. Em 'Valor', informe o botão a clicar depois (ex.: OK).",
            Action.VALIDATE_TEXT: "Falha o passo se o campo não contiver o texto (use re: para regex).",
            Action.HANDLE_MESSAGES: "Aguarda até N ms (Valor) por mensagens e aplica as regras da aba Mensagens.",
            Action.NAVIGATE: "Abre a URL (vazio = URL inicial do projeto).",
            Action.LAUNCH: "Abre o executável (vazio = caminho definido no projeto).",
            Action.FOCUS: "Traz para frente a janela cujo título contém o valor.",
            Action.SET_VAR: "Guarda um valor (ex.: {gerar:cpf}) em uma coluna/variável para usar depois.",
            Action.WAIT_ELEMENT: "Espera o campo aparecer (até o tempo máximo).",
            Action.WAIT_GONE: "Espera o campo sumir (ex.: tela de carregamento).",
        }
        self.help.setText("💡 " + tips.get(a, "Clica no campo mapeado."))

    def _save(self, *_):
        if self._loading or self.step is None:
            return
        s = self.step
        s.enabled = self.enabled.isChecked()
        s.action = self.action.currentData()
        s.field_id = self.field.currentData() or ""
        s.value_source = self.source.currentData()
        s.column = self.column.currentText().strip()
        if s.value_source == ValueSource.GENERATOR:
            s.value = self.gen.currentData()
        else:
            s.value = self.value.text()
        s.output_column = self.output.currentText().strip()
        s.delay_before_ms = self.delay_before.value()
        s.delay_after_ms = self.delay_after.value()
        s.timeout_ms = self.timeout.value()
        s.retries = self.retries.value()
        s.on_error = self.on_error.currentData()
        s.condition_column = self.condition.currentText().strip()
        s.optional = self.optional.isChecked()
        s.note = self.note.text()
        self._update_visibility()
        self.changed.emit()


class StepList(QWidget):
    """Lista de passos com reordenação por arrastar."""
    selected = Signal(object)

    def __init__(self, state, attr: str):
        super().__init__()
        self.state = state
        self.attr = attr
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.list = QListWidget()
        self.list.setDragDropMode(QAbstractItemView.InternalMove)
        self.list.setDefaultDropAction(Qt.MoveAction)
        self.list.model().rowsMoved.connect(self._on_moved)
        self.list.currentRowChanged.connect(self._on_current)
        self.list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.list.customContextMenuRequested.connect(self._menu)
        lay.addWidget(self.list, 1)

    @property
    def steps(self) -> list[Step]:
        return getattr(self.state.project, self.attr)

    def refresh(self, keep: Step | None = None):
        p = self.state.project
        c = theme.colors()
        self.list.blockSignals(True)
        self.list.clear()
        for i, s in enumerate(self.steps, start=1):
            f = p.field_by_id(s.field_id) if s.field_id else None
            target = f.name if f else ""
            src = ""
            if s.action in Action.NEEDS_VALUE:
                if s.value_source == ValueSource.COLUMN and s.column:
                    src = f"← {s.column}"
                elif s.value_source == ValueSource.GENERATOR:
                    src = f"← gerar {s.value}"
                elif s.value:
                    src = f"← \"{s.value[:30]}\""
            if s.output_column:
                src += f"  → {s.output_column}"
            extras = []
            if s.delay_before_ms or s.delay_after_ms:
                extras.append("⏱")
            if s.retries:
                extras.append(f"↻{s.retries}")
            if s.on_error != ErrorPolicy.DEFAULT:
                extras.append("⚠")
            if s.condition_column:
                extras.append("❓")
            text = (f"{i:>2}.  {Action.ICONS.get(s.action, '•')}  {Action.LABELS.get(s.action, s.action)}"
                    f"{('  ·  ' + target) if target else ''}   {src}   {' '.join(extras)}")
            if s.note and s.note != target:
                text += f"\n       {s.note}"
            it = QListWidgetItem(text)
            if not s.enabled:
                it.setForeground(Qt.gray)
                f_ = it.font()
                f_.setStrikeOut(True)
                it.setFont(f_)
            elif f is None and s.action in Action.NEEDS_FIELD:
                it.setForeground(Qt.red)
                it.setToolTip("Este passo precisa de um campo mapeado")
            it.setData(Qt.UserRole, s.id)
            self.list.addItem(it)
        self.list.blockSignals(False)
        if keep is not None and keep in self.steps:
            self.list.setCurrentRow(self.steps.index(keep))
        _ = c

    def current(self) -> Step | None:
        i = self.list.currentRow()
        return self.steps[i] if 0 <= i < len(self.steps) else None

    def _on_current(self, i):
        self.selected.emit(self.current())

    def _on_moved(self, *_):
        ids = [self.list.item(i).data(Qt.UserRole) for i in range(self.list.count())]
        by_id = {s.id: s for s in self.steps}
        setattr(self.state.project, self.attr, [by_id[i] for i in ids if i in by_id])
        keep = self.current()
        self.refresh(keep)
        self.state.mark_dirty()

    def _menu(self, pos):
        m = QMenu(self)
        m.addAction("Duplicar", self.duplicate)
        m.addAction("Ativar/Desativar", self.toggle)
        m.addSeparator()
        m.addAction("Excluir", self.delete)
        m.exec(self.list.mapToGlobal(pos))

    def add(self, step: Step | None = None):
        step = step or Step(action=Action.CLICK)
        i = self.list.currentRow()
        if 0 <= i < len(self.steps):
            self.steps.insert(i + 1, step)
        else:
            self.steps.append(step)
        self.refresh(step)
        self.state.touch(self.state.steps_changed)

    def duplicate(self):
        s = self.current()
        if s:
            from ...core.models import new_id
            c = Step.from_dict(s.to_dict())
            c.id = new_id()
            self.add(c)

    def toggle(self):
        s = self.current()
        if s:
            s.enabled = not s.enabled
            self.refresh(s)
            self.state.mark_dirty()

    def delete(self):
        s = self.current()
        if s:
            i = self.steps.index(s)
            self.steps.remove(s)
            self.refresh()
            if self.steps:
                self.list.setCurrentRow(min(i, len(self.steps) - 1))
            self.state.touch(self.state.steps_changed)

    def move(self, d):
        s = self.current()
        if not s:
            return
        i = self.steps.index(s)
        j = i + d
        if 0 <= j < len(self.steps):
            self.steps[i], self.steps[j] = self.steps[j], self.steps[i]
            self.refresh(s)
            self.state.mark_dirty()


class FlowPage(QWidget):
    title = "Fluxo de automação"
    subtitle = "Sequência de passos executada em cada linha da massa"

    def __init__(self, state):
        super().__init__()
        self.state = state
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        split = QSplitter(Qt.Horizontal)

        left = Card("Passos", "Arraste para reordenar • botão direito para mais opções")
        self.count = left.add_action(Badge("0 passos"))
        self.tabs = QTabWidget()
        self.main_list = StepList(state, "steps")
        self.reset_list = StepList(state, "reset_steps")
        self.tabs.addTab(self.main_list, "Fluxo principal")
        self.tabs.addTab(self.reset_list, "Fluxo de reinício")
        self.tabs.setTabToolTip(1, "Executado ao recomeçar uma rodada ou após erro: ex. fechar telas, "
                                   "voltar ao menu, recarregar a página.")
        self.tabs.currentChanged.connect(self._tab_changed)
        left.add(self.tabs, 1)
        bar = QHBoxLayout()
        bar.addWidget(button("Passo", "primary", "Adicionar passo após o selecionado",
                             lambda: self._list().add(), "+"))
        bar.addWidget(button("", "ghost", "Subir", lambda: self._list().move(-1), "↑"))
        bar.addWidget(button("", "ghost", "Descer", lambda: self._list().move(1), "↓"))
        bar.addWidget(button("Duplicar", "ghost", "", lambda: self._list().duplicate(), "⧉"))
        bar.addWidget(button("Excluir", "ghost", "", lambda: self._list().delete(), "🗑"))
        bar.addStretch()
        bar.addWidget(button("Testar passo", "", "Executa só o passo selecionado com a 1ª linha da massa",
                             self._test_step, "▶"))
        bar.addWidget(button("Gerar pelos campos", "", "Cria o fluxo a partir dos campos mapeados",
                             self._auto, "✨"))
        left.add(bar)
        quick = QHBoxLayout()
        quick.addWidget(label("Inserir rápido:", "muted"))
        for a, txt in ((Action.WAIT, "Aguardar"), (Action.KEYS, "Teclas"),
                       (Action.HANDLE_MESSAGES, "Mensagens"), (Action.CAPTURE_SCREEN, "Print"),
                       (Action.NAVIGATE, "URL"), (Action.LAUNCH, "Abrir exe")):
            quick.addWidget(button(txt, "ghost", Action.LABELS[a],
                                   lambda _=False, a=a: self._quick(a), Action.ICONS[a]))
        quick.addStretch()
        left.add(quick)
        split.addWidget(left)

        right = Card("Configuração do passo")
        self.editor = StepEditor(state)
        self.editor.changed.connect(self._on_edit)
        right.add(scrollable(self.editor), 1)
        split.addWidget(right)
        split.setSizes([640, 440])
        root.addWidget(split)

        self.main_list.selected.connect(self.editor.load)
        self.reset_list.selected.connect(self.editor.load)
        state.project_loaded.connect(self.refresh)
        state.steps_changed.connect(self.refresh)
        state.fields_changed.connect(self.refresh)
        self.refresh()

    def _list(self) -> StepList:
        return self.main_list if self.tabs.currentIndex() == 0 else self.reset_list

    def _tab_changed(self, _):
        self.editor.load(self._list().current())

    def refresh(self):
        keep_m, keep_r = self.main_list.current(), self.reset_list.current()
        self.main_list.refresh(keep_m)
        self.reset_list.refresh(keep_r)
        n = len(self.state.project.steps)
        self.count.setText(f"{n} passos")
        if self._list().current() is None and self._list().steps:
            self._list().list.setCurrentRow(0)
        self.editor.load(self._list().current())

    def _on_edit(self):
        lst = self._list()
        lst.refresh(self.editor.step)
        self.state.project.sync_columns()
        self.state.mark_dirty()
        self.state.rows_changed.emit()

    def _quick(self, action):
        defaults = {Action.WAIT: "1000", Action.KEYS: "{ENTER}", Action.HANDLE_MESSAGES: "3000"}
        s = Step(action=action, value_source=ValueSource.FIXED, value=defaults.get(action, ""))
        if action == Action.CAPTURE_SCREEN:
            s.output_column = "print"
        self._list().add(s)

    def _auto(self):
        p = self.state.project
        if not p.fields:
            toast(self, "Mapeie campos primeiro", "warn")
            return
        if p.steps and QMessageBox.question(
                self, "Gerar fluxo", "Substituir o fluxo atual pelos campos mapeados?") != QMessageBox.Yes:
            return
        p.steps = auto_flow(p)
        p.sync_columns()
        self.state.touch(self.state.steps_changed, self.state.rows_changed)
        toast(self, f"Fluxo gerado com {len(p.steps)} passos", "ok")

    def _test_step(self):
        step = self._list().current()
        if step is None:
            return
        p = self.state.project
        row = p.rows[0] if p.rows else {}

        def work():
            from ...core.engine import Engine, RowContext
            from ...core.models import Platform
            from ...drivers.desktop import DesktopDriver, init_com
            init_com()
            eng = Engine(p, {Platform.DESKTOP: DesktopDriver(p.settings),
                             Platform.WEB: self.state.web}, None)
            ctx = RowContext(0, dict(row))
            eng.folder = str(__import__("tempfile").gettempdir())
            return eng._execute(ctx, step)

        def done(r, e):
            if e:
                toast(self, f"Falhou: {e}", "error")
            else:
                toast(self, f"Passo executado ✓ {('→ ' + str(r)[:80]) if r else ''}", "ok")
        run_task(self, work, done)
