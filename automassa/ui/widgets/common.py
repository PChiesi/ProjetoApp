"""Componentes visuais reutilizáveis."""
from __future__ import annotations

import base64

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, Qt, QTimer
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (QFrame, QGraphicsDropShadowEffect,
                               QGraphicsOpacityEffect, QHBoxLayout, QLabel,
                               QPushButton, QSizePolicy, QVBoxLayout, QWidget)

from .. import theme


def button(text: str, kind: str = "", tip: str = "", slot=None,
           icon_text: str = "") -> QPushButton:
    b = QPushButton(f"{icon_text}  {text}" if icon_text else text)
    if kind:
        b.setProperty("kind", kind)
    if tip:
        b.setToolTip(tip)
    if slot:
        b.clicked.connect(slot)
    b.setCursor(Qt.PointingHandCursor)
    return b


def label(text: str = "", obj: str = "", wrap: bool = False) -> QLabel:
    lb = QLabel(text)
    if obj:
        lb.setObjectName(obj)
    lb.setWordWrap(wrap)
    return lb


class Card(QFrame):
    def __init__(self, title: str = "", subtitle: str = "", parent=None,
                 shadow: bool = True):
        super().__init__(parent)
        self.setObjectName("card")
        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(18, 16, 18, 16)
        self.lay.setSpacing(10)
        if title:
            head = QHBoxLayout()
            box = QVBoxLayout()
            box.setSpacing(2)
            box.addWidget(label(title, "h2"))
            if subtitle:
                box.addWidget(label(subtitle, "muted", wrap=True))
            head.addLayout(box, 1)
            self.head_actions = QHBoxLayout()
            head.addLayout(self.head_actions)
            self.lay.addLayout(head)
        if shadow:
            eff = QGraphicsDropShadowEffect(self)
            eff.setBlurRadius(24)
            eff.setOffset(0, 4)
            eff.setColor(QColor(0, 0, 0, 40))
            self.setGraphicsEffect(eff)

    def add(self, w, stretch: int = 0):
        if isinstance(w, QWidget):
            self.lay.addWidget(w, stretch)
        else:
            self.lay.addLayout(w, stretch)
        return w

    def add_action(self, w):
        self.head_actions.addWidget(w)
        return w


class KpiCard(QFrame):
    def __init__(self, title: str, icon: str = "", color_key: str = "primary"):
        super().__init__()
        self.setObjectName("kpi")
        self.color_key = color_key
        lay = QHBoxLayout(self)
        lay.setContentsMargins(16, 14, 16, 14)
        self.icon = QLabel(icon)
        self.icon.setFixedSize(42, 42)
        self.icon.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.icon)
        box = QVBoxLayout()
        box.setSpacing(0)
        self.value = label("–", "kpiValue")
        self.title = label(title, "kpiLabel")
        self.sub = label("", "kpiLabel")
        box.addWidget(self.title)
        box.addWidget(self.value)
        box.addWidget(self.sub)
        lay.addLayout(box, 1)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.refresh_style()

    def refresh_style(self):
        c = theme.colors()[self.color_key]
        self.icon.setStyleSheet(
            f"background: {theme.rgba(c, 0.18)}; color: {c}; border-radius: 12px; font-size: 16pt;")

    def set(self, value: str, sub: str = ""):
        self.value.setText(value)
        self.sub.setText(sub)


class Badge(QLabel):
    def __init__(self, text: str = "", color_key: str = "primary"):
        super().__init__(text)
        self.setObjectName("badge")
        self.set_color(color_key)

    def set_color(self, color_key: str):
        c = theme.colors().get(color_key, color_key)
        self.setStyleSheet(f"background: {theme.rgba(c, 0.15)}; color: {c};")


class StatusDot(QLabel):
    def __init__(self, color_key="muted"):
        super().__init__()
        self.setFixedSize(10, 10)
        self.set(color_key)

    def set(self, color_key):
        c = theme.colors().get(color_key, color_key)
        self.setStyleSheet(f"background: {c}; border-radius: 5px;")


def pixmap_from_b64(data: str) -> QPixmap | None:
    if not data:
        return None
    pm = QPixmap()
    pm.loadFromData(base64.b64decode(data))
    return pm if not pm.isNull() else None


class Toast(QFrame):
    """Notificação temporária no canto inferior direito da janela."""
    _active: list = []

    def __init__(self, parent: QWidget, text: str, kind: str = "info",
                 ms: int = 3200):
        super().__init__(parent)
        self.setObjectName("toast")
        c = theme.colors()
        color = c.get({"ok": "success", "error": "danger", "warn": "warning"}.get(kind, "info"))
        lay = QHBoxLayout(self)
        lay.setContentsMargins(14, 10, 16, 10)
        bar = QLabel()
        bar.setFixedWidth(4)
        bar.setStyleSheet(f"background: {color}; border-radius: 2px;")
        lay.addWidget(bar)
        icon = {"ok": "✔", "error": "✖", "warn": "⚠"}.get(kind, "ℹ")
        ic = QLabel(icon)
        ic.setStyleSheet(f"color: {color}; font-size: 13pt;")
        lay.addWidget(ic)
        lb = QLabel(text)
        lb.setWordWrap(True)
        lb.setMaximumWidth(380)
        lay.addWidget(lb)
        eff = QGraphicsDropShadowEffect(self)
        eff.setBlurRadius(30)
        eff.setOffset(0, 6)
        eff.setColor(QColor(0, 0, 0, 90))
        self.setGraphicsEffect(eff)
        self.adjustSize()
        Toast._active.append(self)
        self._place()
        self.show()
        self.raise_()
        QTimer.singleShot(ms, self._close)

    def _place(self):
        p = self.parent()
        y = p.height() - 24
        for t in Toast._active:
            if t is self:
                break
            y -= t.height() + 10
        self.move(p.width() - self.width() - 24, y - self.height())

    def _close(self):
        eff = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(eff)
        anim = QPropertyAnimation(eff, b"opacity", self)
        anim.setDuration(350)
        anim.setStartValue(1.0)
        anim.setEndValue(0.0)
        anim.setEasingCurve(QEasingCurve.OutCubic)
        anim.finished.connect(self._remove)
        anim.start()

    def _remove(self):
        if self in Toast._active:
            Toast._active.remove(self)
        self.deleteLater()


def toast(widget: QWidget, text: str, kind: str = "info"):
    win = widget.window() if widget else None
    if win:
        Toast(win, text, kind)


def hline() -> QFrame:
    f = QFrame()
    f.setFixedHeight(1)
    f.setStyleSheet(f"background: {theme.colors()['border']};")
    return f


def scrollable(w: QWidget) -> QWidget:
    """Envolve um formulário em área de rolagem (telas menores)."""
    from PySide6.QtWidgets import QComboBox, QScrollArea
    for cb in w.findChildren(QComboBox):
        cb.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        cb.setMinimumContentsLength(8)
    sa = QScrollArea()
    sa.setWidgetResizable(True)
    sa.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
    sa.setFrameShape(QFrame.NoFrame)
    sa.setWidget(w)
    return sa
