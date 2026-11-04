"""Página da massa de dados (data table) com importação/exportação Excel."""
from __future__ import annotations

import os
import random

from PySide6.QtCore import (QAbstractTableModel, QModelIndex,
                            QSortFilterProxyModel, Qt)
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QFileDialog,
                               QHBoxLayout, QHeaderView, QInputDialog,
                               QLineEdit, QMenu, QMessageBox,
                               QStyledItemDelegate, QTableView, QVBoxLayout,
                               QWidget)

from ...core import excel_io, generators
from ...core.flow import fill_rows
from ...core.models import (CONTROL_COLUMNS, CONTROL_LABELS, CTRL_EXECUTE,
                            CTRL_MESSAGE, CTRL_STATUS, RowStatus)
from ...core.storage import default_workspace
from .. import theme
from ..widgets.common import Badge, Card, button, label, toast


class RowsModel(QAbstractTableModel):
    def __init__(self, state):
        super().__init__()
        self.state = state
        self.cols: list[str] = []
        self.reload()

    @property
    def rows(self):
        return self.state.project.rows

    def reload(self):
        self.beginResetModel()
        self.state.project.sync_columns()
        self.cols = self.state.project.all_columns()
        self.inputs = set(self.state.project.input_columns())
        self.outputs = set(self.state.project.output_columns())
        self.lists = {c for c in self.cols if self.state.project.list_options_for_column(c)}
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.cols)

    def data(self, idx, role=Qt.DisplayRole):
        if not idx.isValid():
            return None
        col = self.cols[idx.column()]
        row = self.rows[idx.row()]
        val = row.get(col, "")
        if role in (Qt.DisplayRole, Qt.EditRole):
            return str(val)
        c = theme.colors()
        if role == Qt.ForegroundRole and col == CTRL_STATUS and val:
            return QColor(theme.status_color(val))
        if role == Qt.BackgroundRole:
            st = row.get(CTRL_STATUS, "")
            if col == CTRL_STATUS and st in (RowStatus.SUCCESS, RowStatus.ERROR, RowStatus.WARNING, RowStatus.RUNNING):
                col_ = QColor(theme.status_color(st))
                col_.setAlpha(40)
                return col_
            if str(row.get(CTRL_EXECUTE, "S")).upper() == "N":
                g = QColor(c["muted"])
                g.setAlpha(25)
                return g
        if role == Qt.FontRole and col == CTRL_STATUS:
            f = QFont()
            f.setBold(True)
            return f
        if role == Qt.ToolTipRole and col == CTRL_MESSAGE:
            return str(val)
        return None

    def headerData(self, section, orient, role=Qt.DisplayRole):
        if orient == Qt.Vertical:
            return str(section + 1) if role == Qt.DisplayRole else None
        col = self.cols[section]
        if role == Qt.DisplayRole:
            prefix = "▾ " if col in self.lists else ("⎘ " if col in self.outputs and col not in self.inputs else "")
            return prefix + CONTROL_LABELS.get(col, col)
        if role == Qt.ForegroundRole:
            c = theme.colors()
            if col in CONTROL_COLUMNS:
                return QColor(c["muted"])
            if col in self.lists:
                return QColor(c["purple"])
            if col in self.outputs and col not in self.inputs:
                return QColor(c["success"])
            return QColor(c["primary"])
        if role == Qt.ToolTipRole:
            f = self.state.project.field_by_name(col)
            if f:
                return f"{f.label or f.name} • {f.ftype}" + (f" • {len(f.options)} opções" if f.options else "")
            if col in self.outputs:
                return "Coluna de captura (preenchida pela automação)"
        return None

    def flags(self, idx):
        return Qt.ItemIsEnabled | Qt.ItemIsSelectable | Qt.ItemIsEditable

    def setData(self, idx, value, role=Qt.EditRole):
        if role != Qt.EditRole:
            return False
        self.rows[idx.row()][self.cols[idx.column()]] = str(value)
        self.dataChanged.emit(idx, idx)
        self.state.mark_dirty()
        return True

    def refresh_row(self, r):
        if 0 <= r < len(self.rows):
            self.dataChanged.emit(self.index(r, 0), self.index(r, len(self.cols) - 1))


class ListDelegate(QStyledItemDelegate):
    """Editor com menu suspenso para colunas de lista."""

    def __init__(self, model: RowsModel, proxy, parent=None):
        super().__init__(parent)
        self.model = model
        self.proxy = proxy

    def _col(self, idx):
        src = self.proxy.mapToSource(idx)
        return self.model.cols[src.column()]

    def createEditor(self, parent, option, idx):
        col = self._col(idx)
        opts = self.model.state.project.list_options_for_column(col)
        if col == CTRL_EXECUTE:
            opts = ["S", "N"]
        if opts:
            cb = QComboBox(parent)
            cb.setEditable(True)
            cb.addItems([""] + opts)
            return cb
        return super().createEditor(parent, option, idx)

    def setEditorData(self, editor, idx):
        if isinstance(editor, QComboBox):
            editor.setCurrentText(idx.data(Qt.EditRole) or "")
            editor.showPopup()
        else:
            super().setEditorData(editor, idx)

    def setModelData(self, editor, model, idx):
        if isinstance(editor, QComboBox):
            model.setData(idx, editor.currentText(), Qt.EditRole)
        else:
            super().setModelData(editor, model, idx)


class DataPage(QWidget):
    title = "Massa de dados"
    subtitle = "Cada linha é uma rodada • exporte para Excel, edite e importe de volta"

    def __init__(self, state):
        super().__init__()
        self.state = state
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(12)

        bar = Card(shadow=False)
        row = QHBoxLayout()
        row.addWidget(button("Exportar Excel", "primary", "Gera planilha com colunas, listas e validações",
                             self._export, "⬇"))
        row.addWidget(button("Importar Excel", "", "Carrega a massa de uma planilha", self._import, "⬆"))
        row.addWidget(button("Exportar resultado", "success", "Planilha com status e capturas da última execução",
                             self._export_result, "📊"))
        row.addSpacing(16)
        row.addWidget(button("Linha", "", "Adicionar linha vazia", self._add_row, "+"))
        row.addWidget(button("Gerar linhas", "", "Cria N linhas com dados válidos (CPF, nomes, listas…)",
                             self._generate, "✨"))
        row.addWidget(button("Preencher coluna", "", "Preenche a coluna selecionada com um gerador",
                             self._fill_column, "⇣"))
        row.addStretch()
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍  Filtrar…")
        self.search.setMaximumWidth(220)
        row.addWidget(self.search)
        bar.add(row)
        root.addWidget(bar)

        legend = QHBoxLayout()
        for txt, key in (("● Entrada", "primary"), ("● Lista (menu suspenso)", "purple"),
                         ("● Captura", "success"), ("● Controle", "muted")):
            b = Badge(txt, key)
            legend.addWidget(b)
        legend.addStretch()
        self.summary = label("", "muted")
        legend.addWidget(self.summary)
        root.addLayout(legend)

        self.model = RowsModel(state)
        self.proxy = QSortFilterProxyModel(self)
        self.proxy.setSourceModel(self.model)
        self.proxy.setFilterKeyColumn(-1)
        self.proxy.setFilterCaseSensitivity(Qt.CaseInsensitive)
        self.search.textChanged.connect(self.proxy.setFilterFixedString)
        self.table = QTableView()
        self.table.setModel(self.proxy)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectItems)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.setItemDelegate(ListDelegate(self.model, self.proxy, self.table))
        self.table.setEditTriggers(QAbstractItemView.DoubleClicked | QAbstractItemView.EditKeyPressed
                                   | QAbstractItemView.AnyKeyPressed)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.table.horizontalHeader().setDefaultSectionSize(150)
        self.table.verticalHeader().setDefaultSectionSize(30)
        self.table.setSortingEnabled(False)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._menu)
        root.addWidget(self.table, 1)

        self.empty = label("Nenhuma coluna ainda. Mapeie campos ou crie o fluxo — as colunas aparecem aqui "
                           "automaticamente. Depois clique em “Gerar linhas” ou importe um Excel.", "hint", wrap=True)
        root.addWidget(self.empty)

        for sig in (state.project_loaded, state.rows_changed, state.fields_changed, state.steps_changed,
                    state.rules_changed):
            sig.connect(self.reload)
        self.reload()

    # ------------------------------------------------------------------
    def reload(self):
        self.model.reload()
        p = self.state.project
        n = len(p.rows)
        ok = sum(1 for r in p.rows if r.get(CTRL_STATUS) == RowStatus.SUCCESS)
        er = sum(1 for r in p.rows if r.get(CTRL_STATUS) == RowStatus.ERROR)
        self.summary.setText(f"{n} linha(s) • {len(self.model.cols) - len(CONTROL_COLUMNS)} coluna(s)"
                             f" • ✔ {ok}  ✖ {er}")
        self.empty.setVisible(len(self.model.cols) <= len(CONTROL_COLUMNS))
        for i, c in enumerate(self.model.cols):
            if c in CONTROL_COLUMNS:
                self.table.setColumnWidth(i, 110 if c != CTRL_MESSAGE else 260)

    def refresh_row(self, r):
        self.model.refresh_row(r)

    def _selected_rows(self) -> list[int]:
        rows = {self.proxy.mapToSource(i).row() for i in self.table.selectedIndexes()}
        return sorted(rows)

    def _selected_col(self) -> str | None:
        idx = self.table.currentIndex()
        if not idx.isValid():
            return None
        return self.model.cols[self.proxy.mapToSource(idx).column()]

    def _menu(self, pos):
        m = QMenu(self)
        m.addAction("Adicionar linha", self._add_row)
        m.addAction("Duplicar linha(s)", self._dup_rows)
        m.addAction("Excluir linha(s)", self._del_rows)
        m.addSeparator()
        m.addAction("Marcar para executar (S)", lambda: self._set_exec("S"))
        m.addAction("Não executar (N)", lambda: self._set_exec("N"))
        m.addAction("Limpar status", self._clear_status)
        m.addSeparator()
        m.addAction("Preencher coluna com gerador…", self._fill_column)
        m.addAction("Limpar toda a massa", self._clear_all)
        m.exec(self.table.viewport().mapToGlobal(pos))

    def _add_row(self):
        p = self.state.project
        p.rows.append({c: "" for c in p.all_columns()} | {CTRL_EXECUTE: "S"})
        self.state.touch(self.state.rows_changed)
        self.table.scrollToBottom()

    def _dup_rows(self):
        p = self.state.project
        for r in self._selected_rows():
            d = dict(p.rows[r])
            for c in CONTROL_COLUMNS:
                d[c] = ""
            d[CTRL_EXECUTE] = "S"
            p.rows.append(d)
        self.state.touch(self.state.rows_changed)

    def _del_rows(self):
        rows = self._selected_rows()
        if not rows:
            return
        if QMessageBox.question(self, "Excluir", f"Excluir {len(rows)} linha(s)?") != QMessageBox.Yes:
            return
        p = self.state.project
        for r in reversed(rows):
            p.rows.pop(r)
        self.state.touch(self.state.rows_changed)

    def _set_exec(self, v):
        for r in self._selected_rows():
            self.state.project.rows[r][CTRL_EXECUTE] = v
        self.state.touch(self.state.rows_changed)

    def _clear_status(self):
        rows = self._selected_rows() or range(len(self.state.project.rows))
        for r in rows:
            row = self.state.project.rows[r]
            for c in CONTROL_COLUMNS:
                if c != CTRL_EXECUTE:
                    row[c] = ""
        self.state.touch(self.state.rows_changed)

    def _clear_all(self):
        if QMessageBox.question(self, "Limpar", "Apagar todas as linhas da massa?") == QMessageBox.Yes:
            self.state.project.rows = []
            self.state.touch(self.state.rows_changed)

    def _generate(self):
        n, ok = QInputDialog.getInt(self, "Gerar linhas",
                                    "Quantas linhas gerar?\n(listas recebem valores aleatórios das opções "
                                    "carregadas; CPF/CNPJ/nomes são gerados válidos)", 10, 1, 100000)
        if ok:
            fill_rows(self.state.project, n)
            self.state.touch(self.state.rows_changed)
            toast(self, f"{n} linha(s) geradas", "ok")

    def _fill_column(self):
        col = self._selected_col()
        if not col or col in CONTROL_COLUMNS:
            toast(self, "Selecione uma célula da coluna a preencher", "warn")
            return
        p = self.state.project
        opts = p.list_options_for_column(col)
        items = []
        if opts:
            items.append("Valor aleatório da lista")
        items += [f"{lbl}  [{k}]" for k, (lbl, _) in generators.GENERATORS.items()]
        items.append("Valor fixo…")
        choice, ok = QInputDialog.getItem(self, "Preencher coluna", f"Como preencher '{col}'?", items, 0, False)
        if not ok:
            return
        rows = self._selected_rows()
        if len(rows) <= 1:
            rows = list(range(len(p.rows)))
        fixed = None
        if choice == "Valor fixo…":
            fixed, ok = QInputDialog.getText(self, "Valor fixo", "Valor:")
            if not ok:
                return
        for r in rows:
            if fixed is not None:
                v = fixed
            elif choice.startswith("Valor aleatório"):
                v = random.choice(opts)
            else:
                key = choice.rsplit("[", 1)[1].rstrip("]")
                v = generators.generate(key, r)
            p.rows[r][col] = v
        self.state.touch(self.state.rows_changed)

    # ------------------------------------------------------------ Excel
    def _default_path(self, suffix: str) -> str:
        from ...core.models import sanitize_column_name
        folder = self.state.project.settings.output_folder or str(default_workspace())
        return os.path.join(folder, f"{sanitize_column_name(self.state.project.name)}_{suffix}.xlsx")

    def _export(self):
        path, _ = QFileDialog.getSaveFileName(self, "Exportar massa", self._default_path("massa"),
                                              "Excel (*.xlsx)")
        if not path:
            return
        try:
            excel_io.export_datatable(self.state.project, path)
        except PermissionError:
            toast(self, "Feche o arquivo no Excel e tente novamente", "error")
            return
        toast(self, "Planilha exportada ✓", "ok")
        self._offer_open(path)

    def _export_result(self):
        from datetime import datetime
        path, _ = QFileDialog.getSaveFileName(
            self, "Exportar resultado", self._default_path(f"resultado_{datetime.now():%Y%m%d_%H%M}"),
            "Excel (*.xlsx)")
        if not path:
            return
        try:
            excel_io.export_datatable(self.state.project, path)
        except PermissionError:
            toast(self, "Feche o arquivo no Excel e tente novamente", "error")
            return
        toast(self, "Resultado exportado ✓", "ok")
        self._offer_open(path)

    def _offer_open(self, path):
        if QMessageBox.question(self, "Abrir", "Abrir a planilha agora?") == QMessageBox.Yes:
            from PySide6.QtCore import QUrl
            from PySide6.QtGui import QDesktopServices
            QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def _import(self):
        path, _ = QFileDialog.getOpenFileName(self, "Importar massa", str(default_workspace()),
                                              "Excel (*.xlsx *.xlsm)")
        if not path:
            return
        replace = True
        if self.state.project.rows:
            r = QMessageBox.question(self, "Importar",
                                     "Substituir as linhas atuais?\n\nSim = substituir • Não = adicionar ao final",
                                     QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
            if r == QMessageBox.Cancel:
                return
            replace = r == QMessageBox.Yes
        try:
            info = excel_io.import_datatable(self.state.project, path, replace=replace)
        except Exception as e:
            QMessageBox.critical(self, "Importar", f"Não foi possível ler a planilha:\n{e}")
            return
        self.state.touch(self.state.rows_changed, self.state.fields_changed)
        msg = f"{info['linhas']} linha(s) importadas"
        if info["novas_colunas"]:
            msg += f" • novas colunas: {', '.join(info['novas_colunas'])}"
        if info["listas_atualizadas"]:
            msg += f" • {info['listas_atualizadas']} lista(s) atualizadas"
        toast(self, msg, "ok")
