"""Interface comum dos drivers de automação."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..core.models import Locator


class AutomationError(Exception):
    """Erro de execução de um passo."""


class ElementNotFound(AutomationError):
    pass


class DriverUnavailable(AutomationError):
    pass


@dataclass
class ScreenMessage:
    """Uma mensagem/popup detectada na tela (desktop ou web)."""
    platform: str
    title: str = ""
    text: str = ""
    buttons: list = field(default_factory=list)
    handle: Any = None          # objeto interno do driver
    kind: str = "dialog"        # dialog | js_dialog | dom

    def matches(self, title_pat: str, text_pat: str) -> bool:
        return _match(self.title, title_pat) and _match(
            f"{self.title}\n{self.text}", text_pat)

    def summary(self) -> str:
        t = self.text.replace("\n", " ").strip()
        return f"{self.title}: {t}" if self.title else t


def _match(value: str, pattern: str) -> bool:
    if not pattern:
        return True
    if pattern.startswith("re:"):
        try:
            return re.search(pattern[3:], value or "", re.I) is not None
        except re.error:
            return False
    return pattern.lower() in (value or "").lower()


@dataclass
class MappedElement:
    """Resultado do mapeamento por clique."""
    locator: Locator
    label: str = ""
    ftype: str = "texto"
    options: list = field(default_factory=list)   # list[(texto, valor)]
    value: str = ""
    thumbnail_png: bytes = b""
    extra: dict = field(default_factory=dict)


class BaseDriver:
    platform = ""

    def __init__(self, settings):
        self.settings = settings

    # ciclo de vida -------------------------------------------------------
    def ensure_started(self) -> None: ...
    def close(self) -> None: ...

    # ações ---------------------------------------------------------------
    def fill(self, loc: Locator, value: str, timeout: float) -> None:
        raise NotImplementedError

    def select(self, loc: Locator, value: str, timeout: float) -> str:
        raise NotImplementedError

    def click(self, loc: Locator, timeout: float, double: bool = False) -> None:
        raise NotImplementedError

    def check(self, loc: Locator, state: bool, timeout: float) -> None:
        raise NotImplementedError

    def get_text(self, loc: Locator, timeout: float) -> str:
        raise NotImplementedError

    def exists(self, loc: Locator, timeout: float) -> bool:
        raise NotImplementedError

    def send_keys(self, keys: str) -> None:
        raise NotImplementedError

    def screenshot(self, path: str, loc: Locator | None = None) -> str:
        raise NotImplementedError

    def list_options(self, loc: Locator, timeout: float) -> list:
        return []

    # mensagens -----------------------------------------------------------
    def messages(self) -> list[ScreenMessage]:
        return []

    def answer_message(self, msg: ScreenMessage, button: str) -> bool:
        return False

    # extras --------------------------------------------------------------
    def navigate(self, url: str) -> None:
        raise AutomationError("Ação disponível apenas para web")

    def launch(self, path: str) -> None:
        raise AutomationError("Ação disponível apenas para executáveis")

    def focus(self, title: str) -> None:
        pass


def is_truthy(value: str) -> bool:
    return str(value).strip().lower() in ("s", "sim", "1", "true", "x",
                                           "verdadeiro", "yes", "y", "on",
                                           "marcado")
