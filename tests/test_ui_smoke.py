"""Smoke test da interface (roda sem tela com QT_QPA_PLATFORM=offscreen)."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["APPDATA"] = tempfile.mkdtemp()
os.environ["HOME"] = tempfile.mkdtemp()

pytest.importorskip("PySide6")


def test_ui_pages_and_dialogs():
    from PySide6.QtWidgets import QApplication
    from automassa.core.engine import Engine
    from automassa.core.models import Platform
    from automassa.drivers.base import ScreenMessage
    from automassa.ui import theme
    from automassa.ui.main_window import MainWindow
    from automassa.ui.pages.dashboard import ExecutionDetail
    from automassa.ui.pages.execution import ErrorDialog, MessageDialog
    from automassa.ui.pages.mapping import MappedDialog
    import test_core

    from automassa.core import storage as _st
    _st.save_prefs({"abrir_ultimo": False})
    app = QApplication.instance() or QApplication(sys.argv)
    theme.apply(app, "claro")
    w = MainWindow(app)
    w.show()
    p = test_core.build_project()
    Engine(p, {Platform.DESKTOP: test_core.FakeDriver(p.settings)}, w.state.db).run()
    w.state.set_project(p)
    w.state.history_changed.emit()
    for i in range(8):
        w.go(i)
        app.processEvents()
    # editar campo e passo pela UI
    w.mapping.table.selectRow(1)
    w.mapping.editor.name.setText("estado")
    w.mapping.editor._save()
    assert p.fields[1].name == "estado" and p.steps[1].column == "estado"
    assert all("estado" in r for r in p.rows)
    w.flow.main_list.list.setCurrentRow(0)
    w.flow.editor.retries.setValue(3)
    assert p.steps[0].retries == 3
    # diálogos
    ErrorDialog({"row": 0, "order": 1, "step": "x", "error": "falhou", "screenshot": ""}, w)
    MessageDialog(ScreenMessage("desktop", "Aviso", "Texto", ["OK", "Cancelar"]), w)
    MappedDialog(w.state, p.fields[0], w)
    ex = w.state.db.executions()[0]
    ExecutionDetail(w.state.db, ex, w)
    # salvar/abrir
    path = os.path.join(tempfile.mkdtemp(), "proj.amproj")
    assert w.save_project.__func__  # existe
    from automassa.core import storage
    storage.save_project(p, path)
    w.state.mark_dirty(False)
    w._open_path(path, quiet=True)
    assert w.state.project.fields[1].name == "estado"
    w.state.mark_dirty(False)
    w.close()
