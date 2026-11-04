"""Ponto de entrada do AutoMassa Studio."""
from __future__ import annotations

import sys
import traceback


def _excepthook(exc_type, exc, tb):
    text = "".join(traceback.format_exception(exc_type, exc, tb))
    try:
        from .core.storage import app_data_dir
        with (app_data_dir() / "erros.log").open("a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except Exception:
        pass
    try:
        from PySide6.QtWidgets import QApplication, QMessageBox
        if QApplication.instance():
            QMessageBox.critical(None, "Erro inesperado",
                                 "Ocorreu um erro inesperado. O programa continua aberto.\n\n"
                                 + str(exc)[:800])
    except Exception:
        pass
    sys.__excepthook__(exc_type, exc, tb)


def main() -> int:
    from .drivers.desktop import set_dpi_awareness
    set_dpi_awareness()
    if sys.platform.startswith("win"):
        try:  # ícone próprio na barra de tarefas
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("AutoMassa.Studio")
        except Exception:
            pass

    from PySide6.QtWidgets import QApplication

    from .core import storage
    from .ui import theme
    from .ui.main_window import MainWindow

    sys.excepthook = _excepthook
    app = QApplication(sys.argv)
    app.setApplicationName("AutoMassa Studio")
    app.setOrganizationName("AutoMassa")
    theme.apply(app, storage.load_prefs().get("tema", "escuro"))
    win = MainWindow(app)
    win.show()
    if len(sys.argv) > 1 and sys.argv[1].endswith(storage.PROJECT_EXT):
        win._open_path(sys.argv[1], quiet=True)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
