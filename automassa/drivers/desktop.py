"""Driver para aplicativos desktop (executáveis) usando UI Automation.

Baseado em pywinauto (backend "uia"), funciona com WinForms, WPF, Win32,
Delphi, VB6, Java (com Access Bridge), Qt e a maioria dos sistemas
Windows. Quando um controle não expõe identificação, o driver recorre à
posição relativa à janela registrada no mapeamento.
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import threading
import time

from ..core.models import FieldType, Locator, Platform
from .base import (AutomationError, BaseDriver, DriverUnavailable,
                   ElementNotFound, MappedElement, ScreenMessage, is_truthy)

IS_WINDOWS = sys.platform.startswith("win")

_pwa = None


def _lib():
    """Importa pywinauto sob demanda (apenas Windows)."""
    global _pwa
    if _pwa is None:
        if not IS_WINDOWS:
            raise DriverUnavailable(
                "Automação de executáveis disponível somente no Windows.")
        init_com()
        import pywinauto  # noqa: F401
        from pywinauto import Desktop, keyboard, mouse
        _pwa = {"Desktop": Desktop, "keyboard": keyboard, "mouse": mouse}
    return _pwa


_com_threads: set[int] = set()


def init_com() -> None:
    """Inicializa COM na thread atual (necessário para UIA fora da main)."""
    if not IS_WINDOWS:
        return
    tid = threading.get_ident()
    if tid in _com_threads:
        return
    try:
        import pythoncom
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
    except Exception:
        try:
            import comtypes
            comtypes.CoInitialize()
        except Exception:
            pass
    _com_threads.add(tid)


def set_dpi_awareness() -> None:
    if not IS_WINDOWS:
        return
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def process_name(pid: int) -> str:
    try:
        import psutil
        return psutil.Process(pid).name()
    except Exception:
        return ""


def escape_keys(text: str) -> str:
    """Escapa caracteres especiais do send_keys do pywinauto."""
    out = []
    for ch in str(text):
        if ch in "+^%~(){}[]":
            out.append("{" + ch + "}")
        elif ch == "\n":
            out.append("{ENTER}")
        elif ch == "\t":
            out.append("{TAB}")
        else:
            out.append(ch)
    return "".join(out)


def _title_matches(title: str, pattern: str) -> bool:
    if not pattern:
        return True
    if pattern.startswith("re:"):
        try:
            return re.search(pattern[3:], title or "", re.I) is not None
        except re.error:
            return False
    return pattern.lower() in (title or "").lower()


# Mapeamento de control_type do UIA para tipo de campo do projeto
CONTROL_TO_FIELD = {
    "Edit": FieldType.TEXT, "Document": FieldType.TEXT,
    "ComboBox": FieldType.LIST, "List": FieldType.LIST,
    "CheckBox": FieldType.CHECKBOX, "RadioButton": FieldType.RADIO,
    "Button": FieldType.BUTTON, "SplitButton": FieldType.BUTTON,
    "Hyperlink": FieldType.BUTTON, "Text": FieldType.LABEL,
    "DataGrid": FieldType.TABLE, "Table": FieldType.TABLE,
    "TabItem": FieldType.TAB, "MenuItem": FieldType.MENU,
    "ListItem": FieldType.BUTTON, "TreeItem": FieldType.BUTTON,
    "Spinner": FieldType.NUMBER, "Custom": FieldType.OTHER,
}


class DesktopDriver(BaseDriver):
    platform = Platform.DESKTOP

    def __init__(self, settings):
        super().__init__(settings)
        self._win_cache: dict = {}
        self.main_pid: int | None = None

    # ------------------------------------------------------------ janelas
    def ensure_started(self) -> None:
        _lib()

    def _desktop(self):
        return _lib()["Desktop"](backend="uia")

    def find_window(self, loc: Locator, timeout: float):
        title = loc.window_title or self.settings.app_window_title
        proc = (loc.process or "").lower()
        deadline = time.time() + max(timeout, 0.5)
        last = None
        while True:
            try:
                for w in self._desktop().windows():
                    try:
                        if not w.is_visible():
                            continue
                        t = w.window_text()
                        if not _title_matches(t, title):
                            continue
                        if proc and process_name(w.process_id()).lower() != proc:
                            continue
                        self.main_pid = w.process_id()
                        return w
                    except Exception as e:  # janela fechou no meio
                        last = e
                        continue
            except Exception as e:
                last = e
            if time.time() > deadline:
                break
            time.sleep(0.25)
        raise ElementNotFound(
            f"Janela não encontrada: título '{title}' processo '{loc.process}'"
            + (f" ({last})" if last else ""))

    def _criteria(self, loc: Locator) -> list[dict]:
        """Estratégias de busca, da mais estável para a menos estável."""
        strategies = []
        ct = loc.control_type or None
        if loc.auto_id:
            c = {"auto_id": loc.auto_id}
            if ct:
                c["control_type"] = ct
            strategies.append(c)
        if loc.name and ct not in ("Edit", "Document"):
            c = {"title": loc.name}
            if ct:
                c["control_type"] = ct
            strategies.append(c)
        if ct and loc.class_name:
            strategies.append({"control_type": ct, "class_name": loc.class_name,
                               "found_index": loc.found_index or 0})
        return strategies

    def find(self, loc: Locator, timeout: float):
        win = self.find_window(loc, timeout)
        deadline = time.time() + max(timeout, 0.5)
        strategies = self._criteria(loc)
        try:
            root = self._desktop().window(handle=win.handle) if win.handle else None
        except Exception:
            root = None
        while True:
            for crit in strategies:
                try:
                    if root is not None:
                        spec = root.child_window(**crit)
                        if spec.exists(timeout=0):
                            return spec.wrapper_object()
                    else:
                        el = _manual_find(win, crit)
                        if el is not None:
                            return el
                except Exception:
                    continue
            if time.time() > deadline:
                break
            time.sleep(0.25)
        if loc.rel_x is not None and loc.rel_y is not None:
            return _PointTarget(win, loc.rel_x, loc.rel_y)
        raise ElementNotFound(f"Elemento não encontrado: {loc.describe()}")

    # ------------------------------------------------------------ ações
    def fill(self, loc: Locator, value: str, timeout: float) -> None:
        el = self.find(loc, timeout)
        value = "" if value is None else str(value)
        if isinstance(el, _PointTarget):
            el.click()
            self._type_replace(value)
            return
        try:
            el.set_focus()
        except Exception:
            pass
        done = False
        if not self.settings.typing_interval_ms:
            try:
                el.set_edit_text(value)
                done = True
            except Exception:
                try:
                    el.iface_value.SetValue(value)
                    done = True
                except Exception:
                    done = False
        if not done:
            try:
                el.click_input()
            except Exception:
                pass
            self._type_replace(value)

    def _type_replace(self, value: str) -> None:
        kb = _lib()["keyboard"]
        kb.send_keys("^a{BACKSPACE}", pause=0.02)
        if value:
            pause = (self.settings.typing_interval_ms or 5) / 1000
            kb.send_keys(escape_keys(value), with_spaces=True, with_tabs=True,
                         with_newlines=True, pause=pause)

    def select(self, loc: Locator, value: str, timeout: float) -> str:
        el = self.find(loc, timeout)
        value = str(value)
        if isinstance(el, _PointTarget):
            el.click()
            self._type_replace(value)
            _lib()["keyboard"].send_keys("{ENTER}")
            return value
        errors = []
        try:
            el.select(value)
            return value
        except Exception as e:
            errors.append(str(e))
        # tenta por correspondência parcial
        try:
            for opt in self.list_options_el(el):
                if opt.strip().lower().startswith(value.strip().lower()):
                    el.select(opt)
                    return opt
        except Exception as e:
            errors.append(str(e))
        # último recurso: digitar e confirmar
        try:
            el.click_input()
            self._type_replace(value)
            _lib()["keyboard"].send_keys("{ENTER}")
            return value
        except Exception as e:
            errors.append(str(e))
        raise AutomationError(f"Não foi possível selecionar '{value}': "
                              + "; ".join(errors))

    def click(self, loc: Locator, timeout: float, double: bool = False) -> None:
        el = self.find(loc, timeout)
        if isinstance(el, _PointTarget):
            el.click(double=double)
            return
        try:
            if double:
                el.double_click_input()
            else:
                el.click_input()
        except Exception:
            if double:
                raise
            el.invoke()

    def check(self, loc: Locator, state: bool, timeout: float) -> None:
        el = self.find(loc, timeout)
        if isinstance(el, _PointTarget):
            el.click()
            return
        try:
            current = el.get_toggle_state() == 1
            if current != state:
                el.toggle()
            return
        except Exception:
            pass
        try:
            if state:
                el.select()
            return
        except Exception:
            el.click_input()

    def get_text(self, loc: Locator, timeout: float) -> str:
        el = self.find(loc, timeout)
        if isinstance(el, _PointTarget):
            raise AutomationError("Elemento sem identificação: use captura de tela")
        return element_text(el)

    def exists(self, loc: Locator, timeout: float) -> bool:
        try:
            el = self.find(loc, timeout)
            return not isinstance(el, _PointTarget)
        except AutomationError:
            return False

    def send_keys(self, keys: str) -> None:
        _lib()["keyboard"].send_keys(keys, with_spaces=True, pause=0.03)

    def screenshot(self, path: str, loc: Locator | None = None) -> str:
        img = None
        if loc is not None:
            try:
                el = self.find(loc, 2)
                if not isinstance(el, _PointTarget):
                    img = el.capture_as_image()
            except Exception:
                img = None
        if img is None:
            img = grab_screen()
        img.save(path)
        return path

    def list_options(self, loc: Locator, timeout: float) -> list:
        return self.list_options_el(self.find(loc, timeout))

    @staticmethod
    def list_options_el(el) -> list[str]:
        return read_list_items(el)

    def launch(self, path: str) -> None:
        if not path:
            raise AutomationError("Informe o caminho do executável")
        cmd = path.strip()
        if os.path.exists(cmd):
            subprocess.Popen([cmd], cwd=os.path.dirname(cmd) or None)
        else:
            subprocess.Popen(cmd, shell=True)
        time.sleep(1.5)

    def focus(self, title: str) -> None:
        w = self.find_window(Locator(window_title=title), 5)
        try:
            if w.is_minimized():
                w.restore()
        except Exception:
            pass
        w.set_focus()

    # ------------------------------------------------------------ mensagens
    def messages(self) -> list[ScreenMessage]:
        """Detecta caixas de diálogo abertas pelo aplicativo alvo."""
        if not IS_WINDOWS:
            return []
        found: list[ScreenMessage] = []
        if not self.main_pid:
            return found          # sistema alvo ainda não localizado
        try:
            desk = self._desktop()
            pids = {self.main_pid}
            seen = set()
            for w in desk.windows():
                try:
                    if not w.is_visible():
                        continue
                    pid = w.process_id()
                    if pids and pid not in pids:
                        continue
                    ei = w.element_info
                    cls = ei.class_name or ""
                    is_dialog = cls == "#32770" or _is_modal(w)
                    candidates = [w] if is_dialog else []
                    if pids and pid in pids:
                        try:
                            # diálogos "donos" aparecem como filhos no UIA; filhos
                            # MDI comuns não são modais e são ignorados
                            candidates += [c for c in w.children(control_type="Window")
                                           if c.is_visible() and (
                                               c.element_info.class_name == "#32770"
                                               or _is_modal(c))]
                        except Exception:
                            pass
                    for c in candidates:
                        key = c.element_info.runtime_id
                        if key in seen:
                            continue
                        seen.add(key)
                        msg = _dialog_to_message(c)
                        if msg:
                            found.append(msg)
                except Exception:
                    continue
        except Exception:
            return found
        return found

    def answer_message(self, msg: ScreenMessage, button: str) -> bool:
        dlg = msg.handle
        wanted = [b.strip().lower() for b in (button or "").split(";") if b.strip()]
        try:
            buttons = dlg.descendants(control_type="Button")
        except Exception:
            buttons = []
        for want in wanted:
            for b in buttons:
                name = (b.window_text() or "").replace("&", "").strip().lower()
                if name == want:
                    try:
                        b.invoke()
                    except Exception:
                        b.click_input()
                    return True
        for want in wanted:
            for b in buttons:
                name = (b.window_text() or "").replace("&", "").strip().lower()
                if want in name:
                    try:
                        b.invoke()
                    except Exception:
                        b.click_input()
                    return True
        if not wanted or "esc" in wanted or "fechar" in wanted:
            try:
                dlg.close()
                return True
            except Exception:
                pass
        return False


def _manual_find(win, crit: dict):
    """Busca nos descendentes quando a janela não tem handle Win32."""
    ct = crit.get("control_type")
    try:
        items = win.descendants(control_type=ct) if ct else win.descendants()
    except Exception:
        return None
    matches = []
    for el in items:
        ei = el.element_info
        if "auto_id" in crit and ei.automation_id != crit["auto_id"]:
            continue
        if "title" in crit and ei.name != crit["title"]:
            continue
        if "class_name" in crit and ei.class_name != crit["class_name"]:
            continue
        matches.append(el)
    idx = crit.get("found_index", 0) or 0
    return matches[idx] if idx < len(matches) else None


class _PointTarget:
    """Alvo por coordenadas relativas à janela (fallback)."""

    def __init__(self, win, rx, ry):
        self.win, self.rx, self.ry = win, rx, ry

    def click(self, double: bool = False):
        r = self.win.rectangle()
        x, y = r.left + self.rx, r.top + self.ry
        try:
            self.win.set_focus()
        except Exception:
            pass
        m = _lib()["mouse"]
        if double:
            m.double_click(coords=(x, y))
        else:
            m.click(coords=(x, y))


def _is_modal(w) -> bool:
    try:
        iface = w.iface_window
        return bool(iface.CurrentIsModal)
    except Exception:
        return False


def _dialog_to_message(dlg) -> ScreenMessage | None:
    try:
        title = dlg.window_text() or ""
        texts = []
        for t in dlg.descendants(control_type="Text"):
            s = (t.window_text() or "").strip()
            if s and s not in texts:
                texts.append(s)
        if not texts:
            for t in dlg.descendants(control_type="Edit"):
                s = element_text(t).strip()
                if s:
                    texts.append(s)
        buttons = []
        for b in dlg.descendants(control_type="Button"):
            n = (b.window_text() or "").replace("&", "").strip()
            if n and n.lower() not in ("fechar", "close", "minimizar",
                                       "maximizar", "minimize", "maximize"):
                buttons.append(n)
        if not buttons and not texts:
            return None
        return ScreenMessage(Platform.DESKTOP, title, "\n".join(texts),
                             buttons, dlg, "dialog")
    except Exception:
        return None


def element_text(el) -> str:
    for getter in (
        lambda: el.get_value(),
        lambda: el.iface_value.CurrentValue,
        lambda: el.legacy_properties().get("Value"),
        lambda: el.selected_text(),
        lambda: el.window_text(),
        lambda: " ".join(t for t in el.texts() if t),
    ):
        try:
            v = getter()
            if v not in (None, ""):
                return str(v)
        except Exception:
            continue
    return ""


def read_list_items(el) -> list[str]:
    """Lê os itens de um ComboBox/List do UIA (expande se necessário)."""
    items: list[str] = []
    try:
        for t in el.texts():
            if isinstance(t, (list, tuple)):
                t = " ".join(map(str, t))
            t = str(t).strip()
            if t and t not in items:
                items.append(t)
    except Exception:
        pass
    if len(items) <= 1:
        expanded = False
        try:
            el.expand()
            expanded = True
            time.sleep(0.3)
        except Exception:
            pass
        try:
            for it in el.descendants(control_type="ListItem"):
                t = (it.window_text() or "").strip()
                if t and t not in items:
                    items.append(t)
        except Exception:
            pass
        if expanded:
            try:
                el.collapse()
            except Exception:
                pass
    # remove o valor atual duplicado no topo quando for o texto do combo
    return items


def grab_screen(bbox=None):
    try:
        from PIL import ImageGrab
        return ImageGrab.grab(bbox=bbox, all_screens=bbox is None)
    except Exception:
        import mss
        from PIL import Image
        with mss.mss() as sct:
            mon = sct.monitors[0] if bbox is None else {
                "left": bbox[0], "top": bbox[1],
                "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]}
            shot = sct.grab(mon)
            return Image.frombytes("RGB", shot.size, shot.rgb)


def thumbnail_png(bbox, max_w: int = 360) -> bytes:
    try:
        l, t, r, b = bbox
        pad = 6
        img = grab_screen((max(0, l - pad), max(0, t - pad), r + pad, b + pad))
        if img.width > max_w:
            img = img.resize((max_w, int(img.height * max_w / img.width)))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return b""


# --------------------------------------------------------------- mapeamento
def element_at(x: int, y: int):
    """Retorna o wrapper UIA do elemento sob o ponto (coord. físicas)."""
    init_com()
    return _lib()["Desktop"](backend="uia").from_point(x, y)


def describe_point(x: int, y: int) -> dict | None:
    """Informações rápidas para o realce em tempo real (hover)."""
    try:
        el = element_at(x, y)
        ei = el.element_info
        r = ei.rectangle
        return {"rect": (r.left, r.top, r.right, r.bottom),
                "name": ei.name or "", "control_type": ei.control_type or "",
                "auto_id": ei.automation_id or "", "class_name": ei.class_name or ""}
    except Exception:
        return None


def _nearby_label(el, top) -> str:
    """Busca um rótulo (Text) à esquerda ou acima do controle."""
    try:
        r = el.rectangle()
        best, best_d = "", 10 ** 9
        for t in top.descendants(control_type="Text"):
            txt = (t.window_text() or "").strip()
            if not txt or len(txt) > 60:
                continue
            tr = t.rectangle()
            same_line = abs(tr.mid_point().y - r.mid_point().y) < max(12, r.height())
            left = tr.right <= r.left + 5 and same_line
            above = tr.bottom <= r.top + 5 and abs(tr.left - r.left) < 80
            if left or above:
                d = (r.left - tr.right) if left else (r.top - tr.bottom) * 2
                if 0 <= d < best_d:
                    best, best_d = txt, d
        return best.rstrip(":*").strip()
    except Exception:
        return ""


def map_point(x: int, y: int) -> MappedElement:
    """Mapeia o elemento sob as coordenadas (clique do usuário)."""
    el = element_at(x, y)
    ei = el.element_info
    try:
        top = el.top_level_parent()
    except Exception:
        top = el
    tei = top.element_info
    ct = ei.control_type or ""
    # sobe de um item de lista para o combobox dono
    if ct in ("ListItem", "Text", "Button", "Edit"):
        try:
            p = el.parent()
            hops = 0
            while p is not None and hops < 3:
                if p.element_info.control_type == "ComboBox":
                    el, ei, ct = p, p.element_info, "ComboBox"
                    break
                p = p.parent()
                hops += 1
        except Exception:
            pass

    rect = ei.rectangle
    trect = tei.rectangle
    loc = Locator(
        platform=Platform.DESKTOP,
        window_title=tei.name or "",
        window_class=tei.class_name or "",
        process=process_name(ei.process_id),
        auto_id=ei.automation_id or "",
        name=ei.name or "",
        control_type=ct,
        class_name=ei.class_name or "",
        rel_x=int((rect.left + rect.right) / 2 - trect.left),
        rel_y=int((rect.top + rect.bottom) / 2 - trect.top),
    )
    # índice entre elementos semelhantes (estratégia de fallback)
    try:
        sims = top.descendants(control_type=ct) if ct else []
        sims = [s for s in sims if (s.element_info.class_name or "") == loc.class_name]
        for i, s in enumerate(sims):
            if s.element_info.runtime_id == ei.runtime_id:
                loc.found_index = i
                break
    except Exception:
        pass
    # caminho de ancestrais para diagnóstico
    try:
        path, p = [], el.parent()
        while p is not None and p.element_info.runtime_id != tei.runtime_id and len(path) < 6:
            pe = p.element_info
            path.append(f"{pe.control_type}:{pe.automation_id or pe.name}")
            p = p.parent()
        loc.path = list(reversed(path))
    except Exception:
        pass

    ftype = CONTROL_TO_FIELD.get(ct, FieldType.OTHER)
    label = ""
    if ftype in (FieldType.BUTTON, FieldType.CHECKBOX, FieldType.RADIO,
                 FieldType.TAB, FieldType.MENU, FieldType.LABEL):
        label = ei.name or ""
    if not label:
        label = _nearby_label(el, top) or ei.name or ei.automation_id or ct
    if ftype == FieldType.TEXT:
        hint = f"{label} {ei.automation_id}".lower()
        if "senha" in hint or "password" in hint:
            ftype = FieldType.PASSWORD
        elif "data" in hint or "date" in hint:
            ftype = FieldType.DATE
    elif ct == "Custom" and "date" in (ei.class_name or "").lower():
        ftype = FieldType.DATE
    if "DateTimePicker" in (ei.class_name or "") or "DatePicker" in (ei.class_name or ""):
        ftype = FieldType.DATE

    options = []
    if ftype in (FieldType.LIST,):
        options = [(o, o) for o in read_list_items(el)]
    elif ftype == FieldType.RADIO:
        try:
            parent = el.parent()
            options = [(r.window_text(), r.window_text())
                       for r in parent.children(control_type="RadioButton")
                       if r.window_text()]
        except Exception:
            pass
    value = ""
    try:
        value = element_text(el)
    except Exception:
        pass
    return MappedElement(
        locator=loc, label=label, ftype=ftype, options=options, value=value,
        thumbnail_png=thumbnail_png((rect.left, rect.top, rect.right, rect.bottom)),
        extra={"rect": (rect.left, rect.top, rect.right, rect.bottom),
               "window": tei.name, "pid": ei.process_id})
