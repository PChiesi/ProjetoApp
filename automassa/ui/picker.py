"""Mapeamento por clique em aplicativos desktop.

* Um retângulo flutuante (que não recebe cliques) realça o elemento sob o
  mouse em tempo real, com uma etiqueta mostrando tipo e nome.
* O clique esquerdo é interceptado (não chega ao sistema alvo) e o elemento
  é mapeado com todas as propriedades UIA, valores de lista e miniatura.
* ESC finaliza. No modo contínuo, cada clique mapeia mais um campo.
"""
from __future__ import annotations

import sys
import threading
import time

from PySide6.QtCore import QObject, QPoint, QRect, Qt, QThread, QTimer, Signal
from PySide6.QtGui import QColor, QGuiApplication, QPainter, QPen
from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from . import theme

IS_WINDOWS = sys.platform.startswith("win")


def cursor_pos_physical() -> tuple[int, int]:
    if IS_WINDOWS:
        import ctypes
        from ctypes import wintypes
        pt = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        return pt.x, pt.y
    from PySide6.QtGui import QCursor
    p = QCursor.pos()
    return p.x(), p.y()


def physical_to_logical(rect: tuple[int, int, int, int]) -> QRect:
    l, t, r, b = rect
    for s in QGuiApplication.screens():
        g = s.geometry()
        dpr = s.devicePixelRatio()
        px, py = g.x() * dpr, g.y() * dpr
        if px <= l < px + g.width() * dpr and py <= t < py + g.height() * dpr:
            return QRect(int(g.x() + (l - px) / dpr), int(g.y() + (t - py) / dpr),
                         int((r - l) / dpr), int((b - t) / dpr))
    return QRect(l, t, r - l, b - t)


class Highlight(QWidget):
    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
                         | Qt.Tool | Qt.WindowTransparentForInput
                         | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.color = QColor(theme.colors()["primary"])

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        fill = QColor(self.color)
        fill.setAlpha(40)
        p.setBrush(fill)
        p.setPen(QPen(self.color, 3))
        p.drawRoundedRect(self.rect().adjusted(2, 2, -2, -2), 5, 5)

    def flash(self, color: str):
        self.color = QColor(color)
        self.update()
        QTimer.singleShot(350, self._reset)

    def _reset(self):
        self.color = QColor(theme.colors()["primary"])
        self.update()


class Bubble(QLabel):
    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
                         | Qt.Tool | Qt.WindowTransparentForInput
                         | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        c = theme.colors()
        self.setStyleSheet(f"background: #1e2235; color: white; padding: 4px 10px;"
                           f" border-radius: 6px; border: 1px solid {c['primary']};"
                           f" font-size: 9pt;")


class Hud(QWidget):
    """Painel flutuante com instruções durante o mapeamento."""

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
                         | Qt.Tool | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        box = QWidget(self)
        box.setObjectName("hud")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(box)
        inner = QHBoxLayout(box)
        inner.setContentsMargins(18, 10, 18, 10)
        self.dot = QLabel("●")
        self.dot.setStyleSheet(f"color: {theme.colors()['danger']}; font-size: 14pt;")
        inner.addWidget(self.dot)
        self.text = QLabel()
        self.text.setStyleSheet("color: white; font-size: 10pt;")
        inner.addWidget(self.text)
        self.set_count(0, False)
        self._blink = QTimer(self, interval=600)
        self._blink.timeout.connect(lambda: self.dot.setVisible(not self.dot.isVisible()))
        self._blink.start()

    def set_count(self, n: int, continuous: bool):
        mode = "contínuo" if continuous else "único"
        self.text.setText(
            f"<b>Mapeando ({mode})</b> — passe o mouse e <b>clique</b> no campo"
            f" &nbsp;•&nbsp; {n} mapeado(s) &nbsp;•&nbsp; <b>ESC</b> para finalizar")
        self.adjustSize()
        scr = QGuiApplication.primaryScreen().availableGeometry()
        self.move(scr.center().x() - self.width() // 2, scr.top() + 12)


class _Hover(QThread):
    info = Signal(object)

    def __init__(self):
        super().__init__()
        self._run = True

    def run(self):
        from ..drivers import desktop
        desktop.init_com()
        last = None
        while self._run:
            pos = cursor_pos_physical()
            if pos != last:
                last = pos
                d = desktop.describe_point(*pos)
                if d:
                    self.info.emit(d)
            time.sleep(0.09)

    def stop(self):
        self._run = False


class _MapWorker(QThread):
    done = Signal(object, str)

    def __init__(self, x, y):
        super().__init__()
        self.x, self.y = x, y

    def run(self):
        from ..drivers import desktop
        try:
            desktop.init_com()
            self.done.emit(desktop.map_point(self.x, self.y), "")
        except Exception as e:
            self.done.emit(None, str(e))


class DesktopPicker(QObject):
    mapped = Signal(object)        # MappedElement
    failed = Signal(str)
    finished = Signal(int)
    _clicked = Signal(int, int)
    _escape = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.continuous = False
        self.count = 0
        self.active = False
        self._workers: list = []
        self._clicked.connect(self._on_click)
        self._escape.connect(self.stop)

    def start(self, continuous: bool = False):
        if not IS_WINDOWS:
            self.failed.emit("O mapeamento de executáveis funciona no Windows.")
            return
        from ..drivers import desktop
        try:
            desktop._lib()
        except Exception as e:
            self.failed.emit(str(e))
            return
        self.continuous = continuous
        self.count = 0
        self.active = True
        self.hl = Highlight()
        self.bubble = Bubble()
        self.hud = Hud()
        self.hud.set_count(0, continuous)
        self.hud.show()
        self.hover = _Hover()
        self.hover.info.connect(self._on_hover)
        self.hover.start()
        self._start_hooks()

    def _start_hooks(self):
        from pynput import keyboard, mouse
        WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0201, 0x0202
        state = {"down": False}
        me = self

        def mfilter(msg, data):
            if not me.active:
                return True
            if msg in (WM_LBUTTONDOWN, WM_LBUTTONUP):
                x, y = data.pt.x, data.pt.y
                if me._inside_hud(x, y):
                    return True
                if msg == WM_LBUTTONDOWN:
                    state["down"] = True
                    me._clicked.emit(x, y)
                me.mlistener.suppress_event()
            return True

        self.mlistener = mouse.Listener(win32_event_filter=mfilter)
        self.mlistener.start()

        def on_press(key):
            if key == keyboard.Key.esc:
                me._escape.emit()
                return False
        self.klistener = keyboard.Listener(on_press=on_press)
        self.klistener.start()

    def _inside_hud(self, x, y) -> bool:
        try:
            g = self.hud.frameGeometry()
            dpr = self.hud.screen().devicePixelRatio()
            return g.contains(QPoint(int(x / dpr), int(y / dpr)))
        except Exception:
            return False

    def _on_hover(self, d: dict):
        if not self.active:
            return
        r = physical_to_logical(d["rect"])
        if r.width() <= 0 or r.height() <= 0:
            return
        self.hl.setGeometry(r.adjusted(-3, -3, 3, 3))
        self.hl.show()
        name = d["name"] or d["auto_id"] or ""
        self.bubble.setText(f"{d['control_type']}  •  {name[:50]}")
        self.bubble.adjustSize()
        self.bubble.move(r.left(), max(0, r.top() - self.bubble.height() - 6))
        self.bubble.show()

    def _on_click(self, x, y):
        self.hl.flash(theme.colors()["success"])
        w = _MapWorker(x, y)
        w.done.connect(self._on_mapped)
        w.finished.connect(lambda: self._workers.remove(w) if w in self._workers else None)
        self._workers.append(w)
        w.start()
        if not self.continuous:
            QTimer.singleShot(150, self.stop)

    def _on_mapped(self, el, err):
        if el is None:
            self.failed.emit(err or "Não foi possível mapear o elemento")
            return
        self.count += 1
        if self.active:
            self.hud.set_count(self.count, self.continuous)
        self.mapped.emit(el)

    def stop(self):
        if not self.active:
            return
        self.active = False
        for lst in ("mlistener", "klistener"):
            try:
                getattr(self, lst).stop()
            except Exception:
                pass
        try:
            self.hover.stop()
            self.hover.wait(1000)
        except Exception:
            pass
        for w in ("hl", "bubble", "hud"):
            try:
                getattr(self, w).close()
            except Exception:
                pass
        self.finished.emit(self.count)


class GlobalHotkeys(QObject):
    """F9 = pausar/retomar, F10 = parar (funciona com o foco em outro app)."""
    pause = Signal()
    stop = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._listener = None
        try:
            from pynput import keyboard

            def on_press(key):
                if key == keyboard.Key.f9:
                    self.pause.emit()
                elif key == keyboard.Key.f10:
                    self.stop.emit()
            self._listener = keyboard.Listener(on_press=on_press)
            self._listener.daemon = True
            self._listener.start()
        except Exception:
            self._listener = None

    def close(self):
        if self._listener:
            try:
                self._listener.stop()
            except Exception:
                pass


__all__ = ["DesktopPicker", "GlobalHotkeys", "threading"]
