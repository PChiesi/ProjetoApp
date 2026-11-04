"""Driver web baseado em Playwright.

Toda a API síncrona do Playwright roda em uma thread dedicada; os demais
componentes (interface, motor de execução) enviam tarefas por fila. Usa o
Edge/Chrome já instalado na máquina, com perfil persistente (logins ficam
salvos entre execuções).
"""
from __future__ import annotations

import base64
import queue
import re
import threading
import time
from concurrent.futures import Future
from datetime import datetime
from pathlib import Path

from ..core.models import Locator, Platform
from ..core.storage import app_data_dir
from .base import (AutomationError, BaseDriver, DriverUnavailable,
                   ElementNotFound, MappedElement, ScreenMessage)

_PICKER_JS = (Path(__file__).with_name("web_picker.js")).read_text(encoding="utf-8")
# versão como função para page.evaluate (reinjeção em páginas já abertas)
_PICKER_FN = "() => {\n" + _PICKER_JS.strip().rstrip(";") + ";\n}"


def _to_iso_date(value: str) -> str:
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})", value or "")
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return value


class _WebThread(threading.Thread):
    def __init__(self, settings, on_pick=None, on_event=None):
        super().__init__(daemon=True, name="playwright")
        self.settings = settings
        self.tasks: queue.Queue = queue.Queue()
        self.ready = threading.Event()
        self.error: Exception | None = None
        self.on_pick = on_pick
        self.on_event = on_event
        self.picks: list = []
        self.js_messages: list[ScreenMessage] = []
        self.dialog_decider = None     # callable(ScreenMessage) -> botão
        self.ctx = None
        self.page = None
        self._stop = False

    # -------------------------------------------------------------- loop
    def run(self):
        try:
            from playwright.sync_api import sync_playwright
        except Exception as e:  # pragma: no cover
            self.error = DriverUnavailable(f"Playwright não disponível: {e}")
            self.ready.set()
            return
        try:
            pw = sync_playwright().start()
            channel = (self.settings.browser_channel or "").strip()
            kwargs = dict(headless=bool(self.settings.browser_headless),
                          no_viewport=True, args=["--start-maximized"])
            exe = (getattr(self.settings, "browser_path", "") or "").strip()
            if exe:
                kwargs["executable_path"] = exe
            elif channel and channel != "chromium":
                kwargs["channel"] = channel
            profile = app_data_dir() / f"navegador_{channel or 'chromium'}"
            try:
                self.ctx = pw.chromium.launch_persistent_context(str(profile), **kwargs)
            except Exception:
                if "channel" in kwargs:      # navegador não instalado
                    kwargs.pop("channel")
                    self.ctx = pw.chromium.launch_persistent_context(str(profile), **kwargs)
                else:
                    raise
            self.ctx.expose_binding("__amPick", self._binding_pick)
            self.ctx.add_init_script(_PICKER_JS)
            self.ctx.on("page", self._on_page)
            self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
            for p in self.ctx.pages:
                self._hook_page(p)
            if self.settings.start_url:
                try:
                    self.page.goto(self.settings.start_url)
                except Exception:
                    pass
        except Exception as e:
            self.error = DriverUnavailable(f"Não foi possível abrir o navegador: {e}")
            self.ready.set()
            return
        self.ready.set()
        while not self._stop:
            try:
                fn, fut = self.tasks.get(timeout=0.03)
            except queue.Empty:
                self._pump()
                continue
            if fut.set_running_or_notify_cancel():
                try:
                    fut.set_result(fn(self))
                except Exception as e:
                    fut.set_exception(e)
            self._process_picks()
        try:
            self.ctx.close()
        except Exception:
            pass
        try:
            pw.stop()
        except Exception:
            pass

    def _pump(self):
        try:
            if self.page and not self.page.is_closed():
                self.page.wait_for_timeout(40)
            else:
                alive = [p for p in self.ctx.pages if not p.is_closed()]
                if alive:
                    self.page = alive[-1]
                else:
                    time.sleep(0.05)
        except Exception:
            time.sleep(0.05)
        self._process_picks()

    # ----------------------------------------------------------- eventos
    def _on_page(self, page):
        self.page = page
        self._hook_page(page)

    def _hook_page(self, page):
        page.on("dialog", self._on_dialog)
        page.on("close", lambda *_: None)

    def _on_dialog(self, dialog):
        msg = ScreenMessage(Platform.WEB, title=f"Alerta ({dialog.type})",
                            text=dialog.message or "",
                            buttons=["OK", "Cancelar"] if dialog.type != "alert" else ["OK"],
                            kind="js_dialog")
        choice = "OK"
        if self.dialog_decider:
            try:
                choice = self.dialog_decider(msg) or "OK"
            except Exception:
                choice = "OK"
        msg.extra_answer = choice
        try:
            if choice.lower() in ("cancelar", "cancel", "não", "nao", "no", "esc"):
                dialog.dismiss()
            else:
                if dialog.type == "prompt":
                    dialog.accept(dialog.default_value or "")
                else:
                    dialog.accept()
        except Exception:
            pass
        self.js_messages.append(msg)

    def _binding_pick(self, source, info):
        self.picks.append((source.get("frame"), info))

    def _process_picks(self):
        while self.picks:
            frame, info = self.picks.pop(0)
            thumb = b""
            if info and not info.get("cancel"):
                try:
                    sels = info.get("selectors") or []
                    if sels:
                        thumb = frame.locator(sels[0]).first.screenshot(timeout=1500)
                except Exception:
                    thumb = b""
                try:
                    info["frame_url"] = "" if frame == frame.page.main_frame else frame.url
                except Exception:
                    info["frame_url"] = ""
            if self.on_pick:
                try:
                    self.on_pick(info, thumb)
                except Exception:
                    pass

    def call(self, fn, timeout: float | None = 120):
        if not self.is_alive():
            raise DriverUnavailable("Navegador não está aberto")
        fut: Future = Future()
        self.tasks.put((fn, fut))
        return fut.result(timeout=timeout)

    def stop(self):
        self._stop = True


class WebDriver(BaseDriver):
    platform = Platform.WEB

    def __init__(self, settings, on_pick=None):
        super().__init__(settings)
        self._thread: _WebThread | None = None
        self._on_pick = on_pick

    # ------------------------------------------------------------ ciclo
    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self._thread.error)

    def ensure_started(self) -> None:
        if self.running:
            try:
                alive = self._thread.call(lambda t: bool([p for p in t.ctx.pages if not p.is_closed()]), 10)
                if alive:
                    return
                self._thread.call(lambda t: setattr(t, "page", t.ctx.new_page()), 20)
                return
            except Exception:
                self.close()
        self._thread = _WebThread(self.settings, on_pick=self._dispatch_pick)
        self._thread.start()
        self._thread.ready.wait(90)
        if self._thread.error:
            err = self._thread.error
            self._thread = None
            raise err

    def set_pick_callback(self, cb):
        self._on_pick = cb

    def _dispatch_pick(self, info, thumb):
        if self._on_pick:
            self._on_pick(info, thumb)

    def set_dialog_decider(self, fn):
        if self._thread:
            self._thread.dialog_decider = fn

    def close(self) -> None:
        if self._thread:
            self._thread.stop()
            self._thread.join(5)
            self._thread = None

    def _call(self, fn, timeout=None):
        self.ensure_started()
        return self._thread.call(fn, timeout)

    # -------------------------------------------------------- mapeamento
    def set_picking(self, enabled: bool) -> None:
        def _do(t):
            for p in t.ctx.pages:
                for fr in p.frames:
                    try:
                        fr.evaluate(_PICKER_FN)
                        fr.evaluate(f"window.__amSetPicking({'true' if enabled else 'false'})")
                    except Exception:
                        pass
            if enabled:
                try:
                    t.page.bring_to_front()
                except Exception:
                    pass
        self._call(_do, 30)

    @staticmethod
    def info_to_mapped(info: dict, thumb: bytes) -> MappedElement:
        sels = info.get("selectors") or []
        loc = Locator(platform=Platform.WEB, selector=sels[0] if sels else "",
                      alt_selectors=sels[1:6], xpath=info.get("xpath", ""),
                      frame_url=info.get("frame_url", ""),
                      page_url=info.get("url", ""), tag=info.get("tag", ""),
                      input_type=info.get("type", ""), name=info.get("name", ""),
                      auto_id=info.get("id", ""))
        return MappedElement(
            locator=loc, label=info.get("label", ""),
            ftype=info.get("kind", "texto"),
            options=[tuple(o) for o in info.get("options", [])],
            value=info.get("value", ""), thumbnail_png=thumb or b"",
            extra={"required": info.get("required", False)})

    # --------------------------------------------------------- localizar
    @staticmethod
    def _frame_for(t, loc: Locator):
        page = t.page
        if loc.frame_url:
            for fr in page.frames:
                if fr.url == loc.frame_url:
                    return fr
            base = loc.frame_url.split("?")[0]
            for fr in page.frames:
                if fr.url.split("?")[0] == base:
                    return fr
        return page.main_frame

    @staticmethod
    def _locate(t, loc: Locator, timeout: float, visible: bool = True):
        sels = [s for s in [loc.selector] + list(loc.alt_selectors or []) if s]
        if loc.xpath:
            sels.append("xpath=" + loc.xpath)
        if not sels:
            raise ElementNotFound("Campo sem seletor mapeado")
        deadline = time.time() + max(timeout, 0.3)
        while True:
            frames = [WebDriver._frame_for(t, loc)]
            if loc.frame_url:
                frames += [f for f in t.page.frames if f not in frames]
            for fr in frames:
                for s in sels:
                    try:
                        lc = fr.locator(s)
                        if lc.count() > 0:
                            el = lc.first
                            if not visible or el.is_visible():
                                return el
                    except Exception:
                        continue
            if time.time() > deadline:
                break
            t.page.wait_for_timeout(150)
        raise ElementNotFound(f"Elemento não encontrado: {loc.describe()}")

    # ------------------------------------------------------------ ações
    def fill(self, loc: Locator, value: str, timeout: float) -> None:
        interval = self.settings.typing_interval_ms

        def _do(t):
            el = self._locate(t, loc, timeout)
            v = "" if value is None else str(value)
            itype = (el.get_attribute("type") or "").lower()
            if itype == "date":
                v = _to_iso_date(v)
            try:
                el.scroll_into_view_if_needed(timeout=2000)
            except Exception:
                pass
            if interval:
                el.click()
                el.press("Control+A")
                el.press("Backspace")
                el.press_sequentially(v, delay=interval)
            else:
                try:
                    el.fill(v, timeout=max(1000, int(timeout * 1000)))
                except Exception:
                    el.click()
                    el.press("Control+A")
                    el.press("Backspace")
                    el.press_sequentially(v, delay=10)
            try:
                el.dispatch_event("change")
                el.dispatch_event("blur")
            except Exception:
                pass
        self._call(_do)

    def select(self, loc: Locator, value: str, timeout: float) -> str:
        def _do(t):
            el = self._locate(t, loc, timeout)
            v = str(value)
            tag = (el.evaluate("e => e.tagName") or "").lower()
            itype = (el.get_attribute("type") or "").lower()
            if tag == "select":
                for kw in ({"label": v}, {"value": v}):
                    try:
                        el.select_option(**kw, timeout=2000)
                        return v
                    except Exception:
                        pass
                opts = el.evaluate("e => Array.from(e.options).map(o => [o.text.trim(), o.value])")
                for text, val in opts:
                    if text.lower().startswith(v.lower()) or v.lower() in text.lower():
                        el.select_option(value=val)
                        return text
                raise AutomationError(f"Opção '{v}' não existe na lista")
            if itype == "radio":
                name = el.get_attribute("name")
                fr = self._frame_for(t, loc)
                radios = fr.locator(f'input[type=radio][name="{name}"]')
                for i in range(radios.count()):
                    r = radios.nth(i)
                    rv = r.get_attribute("value") or ""
                    lab = r.evaluate("e => (e.labels && e.labels[0] ? e.labels[0].innerText : '')") or ""
                    if v.lower() in (rv.lower(), lab.strip().lower()):
                        r.check()
                        return v
                raise AutomationError(f"Opção '{v}' não encontrada no grupo")
            # dropdown customizado (Material, Select2, PrimeNG, etc.)
            el.click()
            t.page.wait_for_timeout(250)
            for sel in (f'[role=option]:has-text("{v}")', f'li:has-text("{v}")',
                        f'text="{v}"'):
                try:
                    opt = t.page.locator(sel).first
                    if opt.count() and opt.is_visible():
                        opt.click()
                        return v
                except Exception:
                    continue
            try:
                el.press_sequentially(v, delay=20)
                el.press("Enter")
                return v
            except Exception:
                raise AutomationError(f"Não foi possível selecionar '{v}'")
        return self._call(_do)

    def click(self, loc: Locator, timeout: float, double: bool = False) -> None:
        def _do(t):
            el = self._locate(t, loc, timeout)
            if double:
                el.dblclick()
            else:
                el.click(timeout=max(1000, int(timeout * 1000)))
        self._call(_do)

    def check(self, loc: Locator, state: bool, timeout: float) -> None:
        def _do(t):
            el = self._locate(t, loc, timeout)
            try:
                el.set_checked(state)
            except Exception:
                checked = el.get_attribute("aria-checked") == "true"
                if checked != state:
                    el.click()
        self._call(_do)

    def get_text(self, loc: Locator, timeout: float) -> str:
        def _do(t):
            el = self._locate(t, loc, timeout, visible=False)
            tag = (el.evaluate("e => e.tagName") or "").lower()
            if tag in ("input", "textarea"):
                return el.input_value()
            if tag == "select":
                return el.evaluate("e => e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''")
            return (el.inner_text() or "").strip()
        return self._call(_do)

    def exists(self, loc: Locator, timeout: float) -> bool:
        def _do(t):
            try:
                self._locate(t, loc, timeout)
                return True
            except ElementNotFound:
                return False
        return self._call(_do)

    def send_keys(self, keys: str) -> None:
        """Aceita teclas no formato Playwright (Enter, Tab, Control+S) ou
        no formato pywinauto ({ENTER}, {TAB}, ^s)."""
        seq = _convert_keys(keys)

        def _do(t):
            for kind, val in seq:
                if kind == "press":
                    t.page.keyboard.press(val)
                else:
                    t.page.keyboard.type(val)
        self._call(_do)

    def screenshot(self, path: str, loc: Locator | None = None) -> str:
        def _do(t):
            if loc is not None:
                try:
                    self._locate(t, loc, 2).screenshot(path=path)
                    return path
                except Exception:
                    pass
            t.page.screenshot(path=path)
            return path
        return self._call(_do)

    def list_options(self, loc: Locator, timeout: float) -> list:
        def _do(t):
            el = self._locate(t, loc, timeout, visible=False)
            return el.evaluate("e => e.options ? Array.from(e.options).map(o => o.text.trim()) : []")
        return self._call(_do)

    def navigate(self, url: str) -> None:
        def _do(t):
            if t.page.is_closed():
                t.page = t.ctx.new_page()
            t.page.goto(url, wait_until="domcontentloaded")
        self._call(_do)

    def current_url(self) -> str:
        return self._call(lambda t: t.page.url, 10)

    # -------------------------------------------------------- mensagens
    def messages(self) -> list[ScreenMessage]:
        if not self.running:
            return []
        sels = [s.strip() for s in (self.settings.web_message_selectors or "").split(";") if s.strip()]

        def _do(t):
            out = list(t.js_messages)
            t.js_messages.clear()
            if not sels:
                return out
            for fr in t.page.frames:
                try:
                    found = fr.evaluate("(s) => window.__amFindMessages ? window.__amFindMessages(s) : []", sels)
                except Exception:
                    continue
                for m in found or []:
                    out.append(ScreenMessage(Platform.WEB, m.get("title", ""), m.get("text", ""),
                                             m.get("buttons", []),
                                             (fr, m["selector"], m["index"]), "dom"))
            return out
        try:
            return self._call(_do, 15)
        except Exception:
            return []

    def answer_message(self, msg: ScreenMessage, button: str) -> bool:
        if msg.kind == "js_dialog":
            return True       # já respondido no momento em que apareceu
        fr, sel, idx = msg.handle
        wanted = [b.strip().lower() for b in (button or "").split(";") if b.strip()]

        def _do(t):
            try:
                return bool(fr.evaluate("([s,i,w]) => window.__amClickIn(s,i,w)", [sel, idx, wanted]))
            except Exception:
                return False
        return self._call(_do, 15)


_KEYMAP = {"ENTER": "Enter", "TAB": "Tab", "ESC": "Escape", "ESCAPE": "Escape",
           "BACKSPACE": "Backspace", "BKSP": "Backspace", "DELETE": "Delete",
           "DEL": "Delete", "UP": "ArrowUp", "DOWN": "ArrowDown",
           "LEFT": "ArrowLeft", "RIGHT": "ArrowRight", "HOME": "Home",
           "END": "End", "PGUP": "PageUp", "PGDN": "PageDown", "SPACE": "Space",
           **{f"F{i}": f"F{i}" for i in range(1, 13)}}
_MODS = {"^": "Control", "+": "Shift", "%": "Alt"}


def _convert_keys(keys: str) -> list[tuple[str, str]]:
    keys = keys or ""
    if keys in _KEYMAP.values() or re.fullmatch(
            r"(?:(?:Control|Shift|Alt|Meta)\+)+\w+", keys):
        return [("press", keys)]
    out, i, buf, mods = [], 0, "", []
    while i < len(keys):
        ch = keys[i]
        if ch in _MODS and i + 1 < len(keys):
            if buf:
                out.append(("type", buf))
                buf = ""
            mods.append(_MODS[ch])
            i += 1
            continue
        if ch == "{":
            j = keys.find("}", i + 1 if keys[i + 1:i + 2] != "}" else i + 2)
            token = keys[i + 1:j] if j > 0 else ""
            i = j + 1 if j > 0 else len(keys)
            parts = token.split()
            name = parts[0] if parts else ""
            count = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
            key = _KEYMAP.get(name.upper(), name)
            if buf:
                out.append(("type", buf))
                buf = ""
            for _ in range(count):
                out.append(("press", "+".join(mods + [key])))
            mods = []
            continue
        if mods:
            if buf:
                out.append(("type", buf))
                buf = ""
            out.append(("press", "+".join(mods + [ch])))
            mods = []
        else:
            buf += ch
        i += 1
    if buf:
        out.append(("type", buf))
    return out


def png_to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode() if data else ""


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
