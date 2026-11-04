"""Página de mapeamento de campos (executável e web)."""
from __future__ import annotations

import base64
import threading

from PySide6.QtCore import QSize, Qt, QThread, Signal
from PySide6.QtGui import QIcon, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox,
                               QDialog, QDialogButtonBox, QFormLayout,
                               QHBoxLayout, QHeaderView, QLabel, QLineEdit,
                               QMessageBox, QPlainTextEdit, QSplitter,
                               QTableWidget, QTableWidgetItem, QVBoxLayout,
                               QWidget)

from ...core import generators
from ...core.flow import field_from_mapped, suggest_step
from ...core.models import FieldDef, FieldType, ListOption, Platform
from ...drivers.web import WebDriver
from ..picker import DesktopPicker
from ..widgets.common import Badge, Card, button, label, pixmap_from_b64, scrollable, toast


class _Task(QThread):
    """Executa uma função fora da thread da UI."""
    result = Signal(object, str)

    def __init__(self, fn):
        super().__init__()
        self.fn = fn

    def run(self):
        try:
            self.result.emit(self.fn(), "")
        except Exception as e:
            self.result.emit(None, str(e))


def run_task(owner, fn, on_done):
    t = _Task(fn)
    owner._tasks = getattr(owner, "_tasks", [])
    owner._tasks.append(t)
    t.result.connect(on_done)
    t.finished.connect(lambda: owner._tasks.remove(t) if t in owner._tasks else None)
    t.start()
    return t


class FieldEditor(QWidget):
    changed = Signal()

    def __init__(self, state, parent=None, compact=False):
        super().__init__(parent)
        self.state = state
        self.field: FieldDef | None = None
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        top = QHBoxLayout()
        self.thumb = QLabel()
        self.thumb.setMinimumHeight(70)
        self.thumb.setMaximumHeight(120)
        self.thumb.setAlignment(Qt.AlignCenter)
        self.thumb.setStyleSheet("border-radius: 8px;")
        top.addWidget(self.thumb, 1)
        lay.addLayout(top)

        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignRight)
        form.setVerticalSpacing(8)
        self.name = QLineEdit()
        self.name.setToolTip("Nome da coluna na massa de dados / Excel")
        self.label = QLineEdit()
        self.ftype = QComboBox()
        for k in FieldType.ALL:
            self.ftype.addItem(FieldType.LABELS[k], k)
        self.required = QCheckBox("Campo obrigatório")
        self.generator = QComboBox()
        self.generator.addItem("— nenhum —", "")
        for k, (lbl, _) in generators.GENERATORS.items():
            self.generator.addItem(lbl, k)
        self.default = QLineEdit()
        self.default.setPlaceholderText("Valor usado quando a coluna estiver vazia")
        self.options = QPlainTextEdit()
        self.options.setPlaceholderText("Um valor por linha (carregado automaticamente da tela)")
        self.options.setMaximumHeight(140)
        self.platform = Badge("", "info")
        form.addRow("Plataforma", self.platform)
        form.addRow("Nome da coluna", self.name)
        form.addRow("Rótulo na tela", self.label)
        form.addRow("Tipo", self.ftype)
        form.addRow("", self.required)
        form.addRow("Gerador sugerido", self.generator)
        form.addRow("Valor padrão", self.default)
        self.opt_label = QLabel("Valores da lista")
        form.addRow(self.opt_label, self.options)
        lay.addLayout(form)

        self.loc_box = Card("Localizador", "Como o campo é encontrado na tela", shadow=False)
        lf = QFormLayout()
        self.loc_window = QLineEdit()
        self.loc_window.setToolTip("Parte do título da janela. Use re: para expressão regular.")
        self.loc_process = QLineEdit()
        self.loc_autoid = QLineEdit()
        self.loc_name = QLineEdit()
        self.loc_ctype = QLineEdit()
        self.loc_selector = QLineEdit()
        self.loc_alt = QPlainTextEdit()
        self.loc_alt.setMaximumHeight(70)
        self.loc_frame = QLineEdit()
        self._desk_rows = [("Janela", self.loc_window), ("Processo", self.loc_process),
                           ("Automation Id", self.loc_autoid), ("Nome", self.loc_name),
                           ("Tipo UIA", self.loc_ctype)]
        self._web_rows = [("Seletor", self.loc_selector), ("Alternativos", self.loc_alt),
                          ("Frame", self.loc_frame)]
        for lbl, w in self._desk_rows + self._web_rows:
            lf.addRow(lbl, w)
        self.loc_form = lf
        self.loc_box.add(lf)
        lay.addWidget(self.loc_box)

        for w in (self.name, self.label, self.default, self.loc_window, self.loc_process,
                  self.loc_autoid, self.loc_name, self.loc_ctype, self.loc_selector,
                  self.loc_frame):
            w.editingFinished.connect(self._save)
        self.options.textChanged.connect(self._save_soft)
        self.loc_alt.textChanged.connect(self._save_soft)
        self.ftype.currentIndexChanged.connect(self._save)
        self.generator.currentIndexChanged.connect(self._save)
        self.required.toggled.connect(self._save)
        self._loading = False
        self.setEnabled(False)

    def load(self, f: FieldDef | None):
        self._loading = True
        self.field = f
        self.setEnabled(f is not None)
        if f is None:
            self.thumb.clear()
            self._loading = False
            return
        pm = pixmap_from_b64(f.thumbnail)
        if pm:
            self.thumb.setPixmap(pm.scaled(QSize(360, 110), Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            self.thumb.setText("(sem miniatura)")
        self.platform.setText(Platform.LABELS.get(f.platform, f.platform))
        self.platform.set_color("info" if f.platform == Platform.WEB else "purple")
        self.name.setText(f.name)
        self.label.setText(f.label)
        self.ftype.setCurrentIndex(max(0, self.ftype.findData(f.ftype)))
        self.required.setChecked(f.required)
        self.generator.setCurrentIndex(max(0, self.generator.findData(f.generator)))
        self.default.setText(f.default)
        self.options.setPlainText("\n".join(f.option_texts()))
        L = f.locator
        self.loc_window.setText(L.window_title)
        self.loc_process.setText(L.process)
        self.loc_autoid.setText(L.auto_id)
        self.loc_name.setText(L.name)
        self.loc_ctype.setText(L.control_type)
        self.loc_selector.setText(L.selector)
        self.loc_alt.setPlainText("\n".join(L.alt_selectors))
        self.loc_frame.setText(L.frame_url)
        web = f.platform == Platform.WEB
        for lbl, w in self._desk_rows:
            self.loc_form.setRowVisible(w, not web)
        for lbl, w in self._web_rows:
            self.loc_form.setRowVisible(w, web)
        self._update_visibility()
        self._loading = False

    def _update_visibility(self):
        t = self.ftype.currentData()
        show = t in (FieldType.LIST, FieldType.RADIO)
        self.options.setVisible(show)
        self.opt_label.setVisible(show)

    def _save_soft(self):
        if not self._loading:
            self._save()

    def _save(self):
        if self._loading or self.field is None:
            return
        f = self.field
        new_name = self.name.text().strip() or f.name
        if new_name != f.name:
            # mantém as colunas da massa e dos passos sincronizadas
            p = self.state.project
            for s in p.steps + p.reset_steps:
                if s.column == f.name:
                    s.column = new_name
                if s.output_column == f.name:
                    s.output_column = new_name
            for r in p.rows:
                if f.name in r:
                    r[new_name] = r.pop(f.name)
            p.columns = [new_name if c == f.name else c for c in p.columns]
            f.name = new_name
        f.label = self.label.text()
        f.ftype = self.ftype.currentData()
        f.required = self.required.isChecked()
        f.generator = self.generator.currentData() or ""
        f.default = self.default.text()
        old = {o.text: o.value for o in f.options}
        lines = [x.strip() for x in self.options.toPlainText().splitlines() if x.strip()]
        f.options = [ListOption(x, old.get(x, x)) for x in lines]
        L = f.locator
        L.window_title = self.loc_window.text()
        L.process = self.loc_process.text()
        L.auto_id = self.loc_autoid.text()
        L.name = self.loc_name.text()
        L.control_type = self.loc_ctype.text()
        L.selector = self.loc_selector.text()
        L.alt_selectors = [x.strip() for x in self.loc_alt.toPlainText().splitlines() if x.strip()]
        L.frame_url = self.loc_frame.text()
        self._update_visibility()
        self.changed.emit()


class MappedDialog(QDialog):
    """Confirmação de um campo recém-mapeado."""

    def __init__(self, state, f: FieldDef, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Campo mapeado")
        self.setMinimumWidth(520)
        lay = QVBoxLayout(self)
        lay.addWidget(label("Confirme os dados do campo", "h2"))
        n_opts = len(f.options)
        info = (f"Tipo detectado: <b>{FieldType.LABELS.get(f.ftype, f.ftype)}</b>"
                + (f" • <b>{n_opts}</b> valores de lista carregados" if n_opts else ""))
        lay.addWidget(label(info, "muted"))
        self.editor = FieldEditor(state, self)
        self.editor.loc_box.setVisible(False)
        self.editor.load(f)
        lay.addWidget(self.editor)
        self.add_step = QCheckBox("Adicionar passo correspondente ao fluxo")
        self.add_step.setChecked(True)
        lay.addWidget(self.add_step)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("Salvar campo")
        bb.button(QDialogButtonBox.Ok).setProperty("kind", "primary")
        bb.button(QDialogButtonBox.Cancel).setText("Descartar")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)


class MappingPage(QWidget):
    title = "Mapeamento de campos"
    subtitle = "Clique nos campos do sistema para mapeá-los — listas já trazem seus valores"

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.picker = DesktopPicker(self)
        self.picker.mapped.connect(self._on_desktop_mapped)
        self.picker.failed.connect(self._on_picker_failed)
        self.picker.finished.connect(self._on_picker_finished)
        self.state.web_pick.connect(self._on_web_pick)
        self.web_picking = False
        self.web_continuous = False

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(14)

        # ------------------------------------------------ ações de mapeamento
        actions = QHBoxLayout()
        actions.setSpacing(14)
        desk = Card("Executável (Windows)", "WinForms, WPF, Delphi, VB6, Java, Win32…")
        row = QHBoxLayout()
        row.addWidget(button("Mapear campo", "primary", "Clique em um campo do sistema",
                             lambda: self._start_desktop(False), "🎯"))
        row.addWidget(button("Mapear vários", "", "Mapeia em sequência até apertar ESC",
                             lambda: self._start_desktop(True), "⧉"))
        row.addStretch()
        desk.add(row)
        self.min_check = QCheckBox("Minimizar o AutoMassa durante o mapeamento")
        self.min_check.setChecked(True)
        desk.add(self.min_check)
        actions.addWidget(desk, 1)

        web = Card("Web", "Abre o Edge/Chrome com perfil próprio (logins ficam salvos)")
        urlrow = QHBoxLayout()
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://sistema.exemplo.com.br")
        self.url.returnPressed.connect(self._open_url)
        urlrow.addWidget(self.url, 1)
        urlrow.addWidget(button("Abrir", "", "Abrir navegador nesta URL", self._open_url, "🌐"))
        web.add(urlrow)
        wrow = QHBoxLayout()
        self.web_btn = button("Mapear na web", "primary", "Clique nos elementos da página",
                              lambda: self._toggle_web(False), "🎯")
        self.web_multi = button("Mapear vários", "", "Mapeia em sequência até apertar ESC na página",
                                lambda: self._toggle_web(True), "⧉")
        wrow.addWidget(self.web_btn)
        wrow.addWidget(self.web_multi)
        wrow.addStretch()
        web.add(wrow)
        actions.addWidget(web, 1)
        root.addLayout(actions)

        # ------------------------------------------------ lista + editor
        split = QSplitter(Qt.Horizontal)
        left = Card("Campos mapeados", "Arraste para reordenar • duplo clique para editar")
        self.count_badge = Badge("0", "primary")
        left.add_action(self.count_badge)
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["", "Coluna", "Tipo", "Plataforma", "Rótulo", "Lista"])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setIconSize(QSize(64, 28))
        self.table.setAlternatingRowColors(True)
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(4, QHeaderView.Stretch)
        self.table.itemSelectionChanged.connect(self._on_select)
        left.add(self.table, 1)
        brow = QHBoxLayout()
        brow.addWidget(button("Subir", "ghost", "", lambda: self._move(-1), "↑"))
        brow.addWidget(button("Descer", "ghost", "", lambda: self._move(1), "↓"))
        brow.addStretch()
        brow.addWidget(button("Novo manual", "ghost", "Cria um campo sem mapear", self._new_manual, "+"))
        brow.addWidget(button("Duplicar", "ghost", "", self._duplicate, "⧉"))
        brow.addWidget(button("Excluir", "danger", "", self._delete, "🗑"))
        left.add(brow)
        split.addWidget(left)

        right = Card("Detalhes do campo")
        self.test_btn = right.add_action(button("Testar", "", "Localiza o campo na tela agora", self._test, "🔍"))
        self.reload_btn = right.add_action(button("Recarregar lista", "", "Lê novamente os valores da lista", self._reload_list, "⟳"))
        self.editor = FieldEditor(state)
        self.editor.changed.connect(self._on_editor_changed)
        right.add(scrollable(self.editor), 1)
        split.addWidget(right)
        split.setSizes([620, 460])
        root.addWidget(split, 1)

        self.auto_step = QCheckBox("Ao mapear, criar o passo correspondente no fluxo automaticamente")
        self.auto_step.setChecked(True)
        root.addWidget(self.auto_step)

        state.project_loaded.connect(self.refresh)
        state.fields_changed.connect(self.refresh)
        self.refresh()

    # ------------------------------------------------------------ tabela
    def refresh(self):
        p = self.state.project
        self.url.setText(p.settings.start_url)
        cur = self._current()
        self.table.blockSignals(True)
        self.table.setRowCount(len(p.fields))
        for i, f in enumerate(p.fields):
            icon_item = QTableWidgetItem()
            pm = pixmap_from_b64(f.thumbnail)
            if pm:
                icon_item.setIcon(QIcon(pm))
            self.table.setItem(i, 0, icon_item)
            self.table.setItem(i, 1, QTableWidgetItem(f.name))
            self.table.setItem(i, 2, QTableWidgetItem(FieldType.LABELS.get(f.ftype, f.ftype)))
            self.table.setItem(i, 3, QTableWidgetItem(Platform.LABELS.get(f.platform, f.platform)))
            self.table.setItem(i, 4, QTableWidgetItem(f.label))
            self.table.setItem(i, 5, QTableWidgetItem(str(len(f.options)) if f.options else ""))
            self.table.setRowHeight(i, 34)
        self.table.blockSignals(False)
        self.count_badge.setText(f"{len(p.fields)} campos")
        if cur is not None and cur in p.fields:
            self.table.selectRow(p.fields.index(cur))
        elif p.fields:
            self.table.selectRow(0)
        else:
            self.editor.load(None)

    def _current(self) -> FieldDef | None:
        rows = self.table.selectionModel().selectedRows() if self.table.selectionModel() else []
        if not rows:
            return None
        i = rows[0].row()
        fs = self.state.project.fields
        return fs[i] if 0 <= i < len(fs) else None

    def _on_select(self):
        self.editor.load(self._current())

    def _on_editor_changed(self):
        f = self.editor.field
        if f is None:
            return
        i = self.state.project.fields.index(f)
        self.table.item(i, 1).setText(f.name)
        self.table.item(i, 2).setText(FieldType.LABELS.get(f.ftype, f.ftype))
        self.table.item(i, 4).setText(f.label)
        self.table.item(i, 5).setText(str(len(f.options)) if f.options else "")
        self.state.project.sync_columns()
        self.state.mark_dirty()
        self.state.rows_changed.emit()
        self.state.steps_changed.emit()

    def _move(self, d):
        f = self._current()
        fs = self.state.project.fields
        if f is None:
            return
        i = fs.index(f)
        j = i + d
        if 0 <= j < len(fs):
            fs[i], fs[j] = fs[j], fs[i]
            self.state.touch(self.state.fields_changed)
            self.table.selectRow(j)

    def _delete(self):
        f = self._current()
        if f is None:
            return
        p = self.state.project
        used = [s for s in p.steps + p.reset_steps if s.field_id == f.id]
        msg = f"Excluir o campo '{f.name}'?"
        if used:
            msg += f"\n\n{len(used)} passo(s) do fluxo usam este campo e também serão removidos."
        if QMessageBox.question(self, "Excluir campo", msg) != QMessageBox.Yes:
            return
        p.fields.remove(f)
        p.steps = [s for s in p.steps if s.field_id != f.id]
        p.reset_steps = [s for s in p.reset_steps if s.field_id != f.id]
        self.state.touch(self.state.fields_changed, self.state.steps_changed)

    def _duplicate(self):
        f = self._current()
        if f is None:
            return
        from ...core.models import new_id, sanitize_column_name
        g = FieldDef.from_dict(f.to_dict())
        g.id = new_id()
        g.name = sanitize_column_name(f.name, [x.name for x in self.state.project.fields])
        self.state.project.fields.append(g)
        self.state.touch(self.state.fields_changed)

    def _new_manual(self):
        from ...core.models import Locator, sanitize_column_name
        plat = Platform.WEB if self.state.web.running else Platform.DESKTOP
        f = FieldDef(name=sanitize_column_name("campo", [x.name for x in self.state.project.fields]),
                     locator=Locator(platform=plat))
        self.state.project.fields.append(f)
        self.state.touch(self.state.fields_changed)
        self.table.selectRow(len(self.state.project.fields) - 1)

    # ------------------------------------------------------------ desktop
    def _start_desktop(self, continuous: bool):
        win = self.window()
        if self.min_check.isChecked():
            win.showMinimized()
        self.picker.start(continuous)

    def _on_picker_failed(self, err):
        win = self.window()
        if win.isMinimized() and not self.picker.active:
            win.showNormal()
            win.activateWindow()
        toast(self, err, "error")

    def _on_picker_finished(self, n):
        win = self.window()
        if win.isMinimized():
            win.showNormal()
            win.activateWindow()
        if n and self.picker.continuous:
            toast(self, f"{n} campo(s) mapeado(s)", "ok")

    def _on_desktop_mapped(self, mapped):
        self._add_mapped(mapped, ask=not self.picker.continuous)

    # ------------------------------------------------------------ web
    def _open_url(self):
        url = self.url.text().strip()
        if url and not url.startswith(("http://", "https://", "file:")):
            url = "https://" + url
            self.url.setText(url)
        self.state.project.settings.start_url = url or self.state.project.settings.start_url
        self.state.mark_dirty()
        toast(self, "Abrindo navegador…")

        def work():
            self.state.web.ensure_started()
            if url:
                self.state.web.navigate(url)
            return True
        run_task(self, work, lambda r, e: toast(self, e, "error") if e else None)

    def _toggle_web(self, continuous: bool):
        enable = not self.web_picking
        self.web_continuous = continuous

        def work():
            self.state.web.ensure_started()
            self.state.web.set_picking(enable)
            return enable

        def done(r, e):
            if e:
                toast(self, e, "error")
                return
            self._set_web_picking(bool(r))
            if r:
                toast(self, "Clique nos elementos da página. ESC (na página) cancela.")
        run_task(self, work, done)

    def _set_web_picking(self, on: bool):
        self.web_picking = on
        self.web_btn.setText("⏹  Parar mapeamento" if on else "🎯  Mapear na web")
        self.web_btn.setProperty("kind", "danger" if on else "primary")
        self.web_btn.style().unpolish(self.web_btn)
        self.web_btn.style().polish(self.web_btn)
        self.web_multi.setEnabled(not on)

    def _on_web_pick(self, info: dict, thumb: bytes):
        if not self.web_picking:
            return
        if info.get("cancel"):
            run_task(self, lambda: self.state.web.set_picking(False), lambda *_: None)
            self._set_web_picking(False)
            return
        mapped = WebDriver.info_to_mapped(info, thumb)
        if not self.web_continuous:
            run_task(self, lambda: self.state.web.set_picking(False), lambda *_: None)
            self._set_web_picking(False)
            self.window().activateWindow()
        self._add_mapped(mapped, ask=not self.web_continuous)

    # ------------------------------------------------------------ comum
    def _add_mapped(self, mapped, ask: bool):
        p = self.state.project
        f = field_from_mapped(p, mapped)
        add_step = self.auto_step.isChecked()
        if ask:
            dlg = MappedDialog(self.state, f, self)
            dlg.add_step.setChecked(add_step)
            if dlg.exec() != QDialog.Accepted:
                return
            add_step = dlg.add_step.isChecked()
        p.fields.append(f)
        if add_step:
            p.steps.append(suggest_step(f))
        p.sync_columns()
        self.state.touch(self.state.fields_changed, self.state.steps_changed,
                         self.state.rows_changed)
        self.table.selectRow(len(p.fields) - 1)
        extra = f" com {len(f.options)} opções" if f.options else ""
        toast(self, f"Campo '{f.name}' mapeado{extra}", "ok")

    def _test(self):
        f = self._current()
        if f is None:
            return
        p = self.state.project

        def work():
            if f.platform == Platform.WEB:
                drv = self.state.web
            else:
                from ...drivers.desktop import DesktopDriver, init_com
                init_com()
                drv = DesktopDriver(p.settings)
            drv.ensure_started()
            ok = drv.exists(f.locator, 4)
            txt = ""
            if ok:
                try:
                    txt = drv.get_text(f.locator, 2)
                except Exception:
                    pass
            return ok, txt

        def done(r, e):
            if e:
                toast(self, f"Falha ao testar: {e}", "error")
            elif r[0]:
                toast(self, f"Campo encontrado ✓  Valor atual: {r[1][:60]}", "ok")
            else:
                toast(self, "Campo não encontrado na tela atual", "warn")
        run_task(self, work, done)

    def _reload_list(self):
        f = self._current()
        if f is None:
            return
        p = self.state.project

        def work():
            if f.platform == Platform.WEB:
                return self.state.web.list_options(f.locator, 5)
            from ...drivers.desktop import DesktopDriver, init_com
            init_com()
            d = DesktopDriver(p.settings)
            return d.list_options(f.locator, 5)

        def done(r, e):
            if e:
                toast(self, f"Não foi possível ler a lista: {e}", "error")
                return
            opts = [o for o in (r or []) if str(o).strip()]
            f.options = [ListOption(o, o) for o in opts]
            if opts and f.ftype not in (FieldType.LIST, FieldType.RADIO):
                f.ftype = FieldType.LIST
            self.editor.load(f)
            self._on_editor_changed()
            toast(self, f"{len(opts)} valores carregados", "ok")
        run_task(self, work, done)


__all__ = ["MappingPage", "run_task", "threading", "base64", "QPixmap"]
