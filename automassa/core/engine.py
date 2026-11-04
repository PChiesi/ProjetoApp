"""Motor de execução: percorre a massa e executa o fluxo em cada rodada.

Independente da interface: comunica-se por um objeto ``EngineEvents``
(a UI implementa com sinais Qt). Controla tempos, pausas, tentativas,
erros (prosseguir / repetir / pular / recomeçar / parar) e mensagens
inesperadas.
"""
from __future__ import annotations

import json
import re
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

from . import generators
from .database import Database
from .models import (CTRL_DATE, CTRL_DURATION, CTRL_EXECUTE, CTRL_MESSAGE,
                     CTRL_STATUS, UNEXPECTED_ASK, UNEXPECTED_AUTO_CLICK,
                     UNEXPECTED_CAPTURE_NEXT, UNEXPECTED_IGNORE, Action,
                     ErrorPolicy, FieldType, Locator, MessageAction, Platform,
                     Project, RowStatus, Step, ValueSource)
from .storage import evidence_dir
from ..drivers.base import (AutomationError, ElementNotFound, ScreenMessage,
                            is_truthy)


# ------------------------------------------------------------- controle
class StopRun(Exception):
    pass


class NextRow(Exception):
    def __init__(self, status: str, message: str = ""):
        super().__init__(message)
        self.status, self.message = status, message


class RestartRow(Exception):
    def __init__(self, message: str = ""):
        super().__init__(message)
        self.message = message


class StepFailed(AutomationError):
    pass


class EngineEvents:
    """Callbacks do motor. Todos podem ser sobrescritos."""

    def log(self, level: str, text: str) -> None: ...
    def execution_started(self, eid: int, total: int, folder: str) -> None: ...
    def row_started(self, idx: int, attempt: int) -> None: ...
    def row_finished(self, idx: int, status: str, message: str, duration: float) -> None: ...
    def step_started(self, idx: int, order: int, name: str) -> None: ...
    def step_finished(self, idx: int, order: int, name: str, status: str,
                      duration_ms: float, error: str) -> None: ...
    def screenshot(self, path: str) -> None: ...
    def message_captured(self, idx: int, msg: ScreenMessage, action: str) -> None: ...
    def state_changed(self, state: str) -> None: ...
    def finished(self, summary: dict) -> None: ...

    def ask_error(self, info: dict) -> str:
        """Retorna uma ErrorPolicy (prosseguir, repetir, pular_rodada...)."""
        return ErrorPolicy.SKIP_ROW

    def ask_message(self, msg: ScreenMessage) -> tuple[str, str]:
        """Retorna (ação, botão) para uma mensagem não prevista."""
        return ("clicar", "OK")


class RowContext:
    def __init__(self, idx: int, row: dict):
        self.idx = idx
        self.row = row
        self.vars: dict[str, str] = {}
        self.status: str = ""
        self.message: str = ""
        self.last_platform: str = ""
        self.row_run_id = 0
        self.warnings: list[str] = []


_TEMPLATE = re.compile(r"\{([^{}]+)\}")


class Engine:
    def __init__(self, project: Project, drivers: dict, db: Database | None,
                 events: EngineEvents | None = None):
        self.p = project
        self.s = project.settings
        self.drivers = drivers            # {Platform.X: driver}
        self.db = db
        self.ev = events or EngineEvents()
        self._pause = threading.Event()
        self._pause.set()
        self._stop = threading.Event()
        self.eid = 0
        self.folder = ""
        self.used_platforms: set[str] = set()
        self._handled_msgs: set = set()
        self.state = "parado"

    # ------------------------------------------------------- controle
    def pause(self):
        self._pause.clear()
        self._set_state("pausado")
        self.ev.log("warn", "Execução pausada")

    def resume(self):
        self._pause.set()
        self._set_state("executando")
        self.ev.log("info", "Execução retomada")

    def toggle_pause(self):
        self.resume() if not self._pause.is_set() else self.pause()

    def stop(self):
        self._stop.set()
        self._pause.set()
        self.ev.log("warn", "Parada solicitada – finalizando passo atual…")

    @property
    def paused(self) -> bool:
        return not self._pause.is_set()

    def _set_state(self, st):
        self.state = st
        self.ev.state_changed(st)

    def _checkpoint(self):
        while not self._pause.wait(0.1):
            if self._stop.is_set():
                break
        if self._stop.is_set():
            raise StopRun()

    def _sleep(self, ms: float):
        ms = max(0.0, ms * float(self.s.speed or 1.0))
        end = time.time() + ms / 1000
        while True:
            self._checkpoint()
            rest = end - time.time()
            if rest <= 0:
                return
            time.sleep(min(0.05, rest))

    # ------------------------------------------------------- execução
    def run(self, row_indices: list[int] | None = None) -> dict:
        rows = self.p.rows
        if row_indices is None:
            row_indices = list(range(len(rows)))
        to_run = [i for i in row_indices if i < len(rows)]
        self._stop.clear()
        self._pause.set()
        self._set_state("executando")
        t0 = time.time()
        summary = {"total": len(to_run), "ok": 0, "erro": 0, "pulado": 0,
                   "aviso": 0, "interrompido": False}
        if self.db:
            self.eid = self.db.start_execution(self.p.name, len(to_run))
        self.folder = str(evidence_dir(self.p.name, self.eid or int(t0)))
        if self.db:
            self.db.set_evidence_dir(self.eid, self.folder)
        self.ev.execution_started(self.eid, len(to_run), self.folder)
        self.ev.log("info", f"Execução #{self.eid} iniciada – {len(to_run)} rodada(s)")
        self._install_dialog_deciders()
        try:
            for n, idx in enumerate(to_run):
                if self._stop.is_set():
                    break
                row = rows[idx]
                if str(row.get(CTRL_EXECUTE, "S")).strip().upper() in ("N", "NAO", "NÃO", "0"):
                    row[CTRL_STATUS] = RowStatus.SKIPPED
                    summary["pulado"] += 1
                    self.ev.row_finished(idx, RowStatus.SKIPPED, "Marcada para não executar", 0)
                    continue
                status = self._run_row(idx, row)
                key = {RowStatus.SUCCESS: "ok", RowStatus.ERROR: "erro",
                       RowStatus.WARNING: "aviso"}.get(status, "pulado")
                summary[key] += 1
                if n < len(to_run) - 1 and not self._stop.is_set():
                    try:
                        self._sleep(self.s.row_delay_ms)
                    except StopRun:
                        break
        finally:
            summary["interrompido"] = self._stop.is_set()
            dur = time.time() - t0
            summary["duracao_s"] = dur
            summary["execucao"] = self.eid
            summary["pasta"] = self.folder
            if self.db:
                st = "Interrompida" if summary["interrompido"] else (
                    "Concluída com erros" if summary["erro"] else "Concluída")
                self.db.finish_execution(self.eid, st, summary["ok"] + summary["aviso"],
                                         summary["erro"], summary["pulado"], dur)
            self._set_state("parado")
            self.ev.log("info", f"Execução finalizada em {dur:.1f}s – "
                                f"{summary['ok']} sucesso, {summary['aviso']} aviso, "
                                f"{summary['erro']} erro, {summary['pulado']} pulado")
            self.ev.finished(summary)
        return summary

    def _run_row(self, idx: int, row: dict) -> str:
        attempt = 0
        t0 = time.time()
        status, message = RowStatus.ERROR, ""
        ctx = RowContext(idx, row)
        if self.db:
            ctx.row_run_id = self.db.start_row(self.eid, idx, json.dumps(row, ensure_ascii=False))
        row[CTRL_STATUS] = RowStatus.RUNNING
        while True:
            attempt += 1
            ctx.status, ctx.message, ctx.vars = "", "", {}
            self.ev.row_started(idx, attempt)
            self.ev.log("info", f"▶ Rodada {idx + 1}" + (f" (tentativa {attempt})" if attempt > 1 else ""))
            try:
                self._run_steps(ctx, self.p.steps)
                # mensagens finais (ex.: "Registro gravado com sucesso")
                if self.s.watch_messages:
                    self._handle_messages(ctx, wait_ms=0)
                status = ctx.status or (RowStatus.WARNING if ctx.warnings else RowStatus.SUCCESS)
                message = ctx.message or "; ".join(ctx.warnings)
                break
            except NextRow as nr:
                status, message = nr.status, nr.message
                break
            except RestartRow as rr:
                if attempt <= int(self.s.max_restarts):
                    self.ev.log("warn", f"↻ Recomeçando rodada {idx + 1}: {rr.message}")
                    try:
                        self._run_reset(ctx)
                    except StopRun:
                        status, message = RowStatus.ERROR, "Execução interrompida"
                        break
                    continue
                status, message = RowStatus.ERROR, (
                    f"Limite de recomeços atingido: {rr.message}")
                break
            except StopRun:
                status, message = RowStatus.ERROR, "Execução interrompida pelo usuário"
                break
            except Exception as e:  # erro inesperado do motor
                status, message = RowStatus.ERROR, f"Erro interno: {e}"
                self.ev.log("error", traceback.format_exc())
                break
        dur = time.time() - t0
        row[CTRL_STATUS] = status
        row[CTRL_MESSAGE] = message
        row[CTRL_DATE] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        row[CTRL_DURATION] = f"{dur:.1f}"
        if self.db:
            self.db.finish_row(ctx.row_run_id, status, message, dur, attempt,
                               json.dumps(row, ensure_ascii=False))
        self.ev.row_finished(idx, status, message, dur)
        level = "ok" if status == RowStatus.SUCCESS else ("warn" if status == RowStatus.WARNING else "error")
        self.ev.log(level, f"■ Rodada {idx + 1}: {status}" + (f" – {message}" if message else ""))
        # após erro, tenta deixar a tela pronta para a próxima rodada
        if status == RowStatus.ERROR and self.p.reset_steps and not self._stop.is_set():
            try:
                self._run_reset(ctx)
            except Exception:
                pass
        return status

    def _run_reset(self, ctx: RowContext):
        if not self.p.reset_steps:
            return
        self.ev.log("info", "Executando fluxo de reinício…")
        saved = ctx.status
        try:
            self._run_steps(ctx, self.p.reset_steps, is_reset=True)
        except (NextRow, RestartRow) as e:
            self.ev.log("warn", f"Fluxo de reinício interrompido: {e}")
        ctx.status = saved

    def _run_steps(self, ctx: RowContext, steps: list[Step], is_reset: bool = False):
        i = 0
        while i < len(steps):
            step = steps[i]
            order = i + 1
            if not step.enabled:
                i += 1
                continue
            if step.condition_column and not str(ctx.row.get(step.condition_column, "")).strip():
                i += 1
                continue
            self._checkpoint()
            name = self.step_name(step, order)
            retries = step.retries if step.retries else self.s.default_retries
            attempt, max_attempts = 0, 1 + max(int(retries or 0), 0)
            while True:
                attempt += 1
                t0 = time.time()
                self.ev.step_started(ctx.idx, order, name)
                try:
                    if step.delay_before_ms:
                        self._sleep(step.delay_before_ms)
                    value = self._execute(ctx, step)
                    self._sleep(step.delay_after_ms or self.s.step_delay_ms)
                    if self.s.watch_messages and step.action != Action.HANDLE_MESSAGES \
                            and not is_reset:
                        self._handle_messages(ctx)
                    if self.s.screenshot_each_step:
                        self._shot(ctx, f"passo{order}")
                    dt = (time.time() - t0) * 1000
                    self._log_step(ctx, order, name, step, "Sucesso", dt, "", value)
                    i += 1
                    break
                except (StopRun, NextRow, RestartRow) as ctl:
                    dt = (time.time() - t0) * 1000
                    if not isinstance(ctl, StopRun):
                        self._log_step(ctx, order, name, step, "Desviado", dt, str(ctl))
                    raise
                except Exception as e:
                    dt = (time.time() - t0) * 1000
                    err = str(e) or e.__class__.__name__
                    # uma mensagem na tela pode ter bloqueado o passo
                    if self.s.watch_messages and not is_reset and isinstance(e, AutomationError):
                        if self._handle_messages(ctx):
                            if attempt < max_attempts + 1:
                                self.ev.log("warn", f"Mensagem tratada; repetindo passo {order}")
                                continue
                    if attempt < max_attempts:
                        self.ev.log("warn", f"Passo {order} falhou ({err}); nova tentativa {attempt + 1}/{max_attempts}")
                        self._log_step(ctx, order, name, step, "Repetido", dt, err)
                        self._sleep(500)
                        continue
                    self._log_step(ctx, order, name, step, "Erro", dt, err)
                    self.ev.log("error", f"✖ Passo {order} – {name}: {err}")
                    shot = ""
                    if self.s.screenshot_on_error:
                        shot = self._shot(ctx, f"erro_passo{order}")
                    if is_reset:
                        i += 1
                        break
                    decision = self._decide(ctx, step, order, name, err, shot)
                    if decision == ErrorPolicy.RETRY:
                        attempt = 0
                        continue
                    if decision == ErrorPolicy.CONTINUE:
                        ctx.warnings.append(f"Passo {order}: {err}")
                        i += 1
                        break
                    if decision == ErrorPolicy.RESTART_ROW:
                        raise RestartRow(err)
                    if decision == ErrorPolicy.STOP:
                        self._stop.set()
                        raise StopRun()
                    raise NextRow(RowStatus.ERROR, f"Passo {order} ({name}): {err}")

    def _decide(self, ctx, step, order, name, err, shot) -> str:
        if step.optional:
            return ErrorPolicy.CONTINUE
        policy = step.on_error if step.on_error and step.on_error != ErrorPolicy.DEFAULT \
            else self.s.error_policy
        if policy == ErrorPolicy.ASK:
            self._set_state("aguardando")
            try:
                policy = self.ev.ask_error({
                    "row": ctx.idx, "order": order, "step": name, "error": err,
                    "screenshot": shot, "data": dict(ctx.row)}) or ErrorPolicy.SKIP_ROW
            finally:
                if not self._stop.is_set():
                    self._set_state("executando")
        return policy

    # ------------------------------------------------------- passos
    @staticmethod
    def step_name(step: Step, order: int = 0, project: Project | None = None) -> str:
        label = Action.LABELS.get(step.action, step.action)
        tgt = step.note or step.column or step.output_column or step.value
        return f"{label}{' – ' + str(tgt)[:40] if tgt else ''}"

    def _timeout(self, step: Step) -> float:
        return (step.timeout_ms or self.s.timeout_ms or 10000) / 1000

    def _driver(self, ctx: RowContext, platform: str):
        d = self.drivers.get(platform)
        if d is None:
            raise AutomationError(f"Driver '{platform}' indisponível")
        d.ensure_started()
        self.used_platforms.add(platform)
        ctx.last_platform = platform
        return d

    def _platform_for(self, ctx: RowContext, step: Step) -> str:
        f = self.p.field_by_id(step.field_id) if step.field_id else None
        if f:
            return f.platform
        if step.action == Action.NAVIGATE:
            return Platform.WEB
        if step.action in (Action.LAUNCH, Action.FOCUS):
            return Platform.DESKTOP
        if ctx.last_platform:
            return ctx.last_platform
        plats = {fd.platform for fd in self.p.fields}
        return Platform.WEB if plats == {Platform.WEB} else Platform.DESKTOP

    def resolve_value(self, ctx: RowContext, step: Step) -> str:
        src = step.value_source
        if src == ValueSource.COLUMN and step.column:
            v = str(ctx.row.get(step.column, "") or "")
            if not v and step.value:
                v = self.render(ctx, step.value)
        elif src == ValueSource.GENERATOR:
            v = generators.generate(step.value, ctx.idx)
            if step.column:
                ctx.row[step.column] = v    # registra o valor usado
        elif src == ValueSource.VARIABLE:
            key = step.value.strip("{} ")
            v = str(ctx.vars.get(key, ctx.row.get(key, "")))
        else:
            v = self.render(ctx, step.value)
        m = re.match(r"^=\s*GERAR\(\s*([\w:|]+)\s*\)\s*$", v, re.I)
        if m:
            v = generators.generate(m.group(1), ctx.idx)
            if src == ValueSource.COLUMN and step.column:
                ctx.row[step.column] = v
        if not v and step.field_id:
            f = self.p.field_by_id(step.field_id)
            if f and f.default:
                v = self.render(ctx, f.default)
        return v

    def render(self, ctx: RowContext, text: str) -> str:
        def rep(m):
            key = m.group(1).strip()
            if key.lower().startswith("gerar:"):
                return generators.generate(key[6:], ctx.idx)
            if key.lower() == "linha":
                return str(ctx.idx + 1)
            if key.lower() == "hoje":
                return datetime.now().strftime("%d/%m/%Y")
            if key.lower() == "agora":
                return datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            if key in ctx.vars:
                return str(ctx.vars[key])
            if key in ctx.row:
                return str(ctx.row[key])
            return m.group(0)
        return _TEMPLATE.sub(rep, text or "")

    def _locator(self, step: Step) -> tuple[Locator, object]:
        f = self.p.field_by_id(step.field_id)
        if f is None:
            raise AutomationError("Passo sem campo mapeado")
        return f.locator, f

    def _execute(self, ctx: RowContext, step: Step) -> str:
        a = step.action
        timeout = self._timeout(step)
        if a == Action.WAIT:
            ms = float(self.render(ctx, step.value or "1000") or 1000)
            self._sleep(ms)
            return f"{ms:.0f}ms"
        if a == Action.SET_VAR:
            val = self.resolve_value(ctx, step)
            name = step.output_column or "var"
            ctx.vars[name] = val
            ctx.row[name] = val
            return val
        if a == Action.HANDLE_MESSAGES:
            wait = float(self.render(ctx, step.value or "0") or 0)
            self._handle_messages(ctx, wait_ms=wait, require=False)
            return ""
        platform = self._platform_for(ctx, step)
        drv = self._driver(ctx, platform)

        if a == Action.NAVIGATE:
            url = self.resolve_value(ctx, step) or self.s.start_url
            drv.navigate(url)
            return url
        if a == Action.LAUNCH:
            path = self.resolve_value(ctx, step) or self.s.app_path
            drv.launch(path)
            return path
        if a == Action.FOCUS:
            drv.focus(self.resolve_value(ctx, step) or self.s.app_window_title)
            return ""
        if a == Action.KEYS:
            keys = self.resolve_value(ctx, step)
            drv.send_keys(keys)
            return keys
        if a == Action.CAPTURE_SCREEN:
            loc = self.p.field_by_id(step.field_id).locator if step.field_id else None
            path = self._shot(ctx, step.output_column or "tela", loc=loc, driver=drv)
            if step.output_column:
                ctx.row[step.output_column] = path
            self._capture(ctx, "tela", step.output_column or "tela", path)
            return path
        if a == Action.CAPTURE_MESSAGE:
            msgs = drv.messages()
            text = " | ".join(m.summary() for m in msgs)
            if step.output_column:
                ctx.row[step.output_column] = text
            self._capture(ctx, "mensagem", step.output_column or "mensagem", text)
            if msgs and step.value:
                drv.answer_message(msgs[0], step.value)
            return text

        loc, fdef = self._locator(step)
        if a == Action.FILL:
            v = self.resolve_value(ctx, step)
            if fdef.ftype in (FieldType.LIST,) :
                drv.select(loc, v, timeout)
            elif fdef.ftype == FieldType.CHECKBOX:
                drv.check(loc, is_truthy(v), timeout)
            else:
                drv.fill(loc, v, timeout)
            return v
        if a == Action.SELECT:
            v = self.resolve_value(ctx, step)
            if not v:
                return ""
            if fdef.ftype == FieldType.RADIO and platform == Platform.DESKTOP:
                rl = Locator(**{**loc.__dict__})
                rl.name, rl.auto_id, rl.rel_x, rl.rel_y = v, "", None, None
                drv.click(rl, timeout)
                return v
            return drv.select(loc, v, timeout)
        if a == Action.CHECK:
            v = self.resolve_value(ctx, step)
            drv.check(loc, is_truthy(v), timeout)
            return v
        if a in (Action.CLICK, Action.DOUBLE_CLICK):
            drv.click(loc, timeout, double=(a == Action.DOUBLE_CLICK))
            return ""
        if a == Action.WAIT_ELEMENT:
            if not drv.exists(loc, timeout):
                raise ElementNotFound(f"'{fdef.name}' não apareceu em {timeout:.0f}s")
            return ""
        if a == Action.WAIT_GONE:
            end = time.time() + timeout
            while drv.exists(loc, 0.3):
                self._checkpoint()
                if time.time() > end:
                    raise StepFailed(f"'{fdef.name}' continuou visível após {timeout:.0f}s")
                time.sleep(0.3)
            return ""
        if a == Action.CAPTURE_TEXT:
            text = drv.get_text(loc, timeout)
            col = step.output_column or fdef.name
            ctx.row[col] = text
            ctx.vars[col] = text
            self._capture(ctx, "texto", col, text)
            return text
        if a == Action.VALIDATE_TEXT:
            expected = self.resolve_value(ctx, step)
            text = drv.get_text(loc, timeout)
            ok = (re.search(expected[3:], text or "", re.I) if expected.startswith("re:")
                  else expected.lower() in (text or "").lower())
            if not ok:
                raise StepFailed(f"Texto esperado '{expected}' – encontrado '{text}'")
            return text
        raise AutomationError(f"Ação desconhecida: {a}")

    # ------------------------------------------------------- evidências
    def _shot(self, ctx: RowContext, name: str, loc=None, driver=None) -> str:
        from ..drivers.web import timestamp
        safe = re.sub(r"[^\w-]+", "_", name)[:40]
        path = str(Path(self.folder) / f"linha{ctx.idx + 1:04d}_{safe}_{timestamp()}.png")
        try:
            drv = driver or self.drivers.get(ctx.last_platform or "")
            if drv is None or (getattr(drv, "platform", "") == Platform.WEB
                               and not getattr(drv, "running", True)):
                drv = self.drivers.get(Platform.DESKTOP)
            if drv is None:
                return ""
            drv.screenshot(path, loc)
            self.ev.screenshot(path)
            return path
        except Exception as e:
            try:
                from ..drivers.desktop import grab_screen
                grab_screen().save(path)
                self.ev.screenshot(path)
                return path
            except Exception:
                self.ev.log("warn", f"Não foi possível capturar a tela: {e}")
                return ""

    def _capture(self, ctx, kind, name, value):
        if self.db:
            self.db.log_capture(self.eid, ctx.idx, kind, name, value)
        self.ev.log("info", f"⎘ Capturado {name}: {str(value)[:120]}")

    def _log_step(self, ctx, order, name, step, status, dt, err="", value=""):
        if self.db:
            v = "***" if self._is_secret(step) else value
            self.db.log_step(self.eid, ctx.row_run_id, ctx.idx, order, name,
                             step.action, status, dt, err, v or "")
        self.ev.step_finished(ctx.idx, order, name, status, dt, err)

    def _is_secret(self, step: Step) -> bool:
        f = self.p.field_by_id(step.field_id) if step.field_id else None
        return bool(f and f.ftype == FieldType.PASSWORD)

    # ------------------------------------------------------- mensagens
    def _install_dialog_deciders(self):
        web = self.drivers.get(Platform.WEB)
        if web is not None and hasattr(web, "set_dialog_decider"):
            def decide(msg: ScreenMessage):
                rule = self._match_rule(msg)
                if rule and rule.action != MessageAction.IGNORE:
                    return rule.button or "OK"
                return "OK"
            web.set_dialog_decider(decide)

    def _match_rule(self, msg: ScreenMessage):
        for r in self.p.message_rules:
            if r.enabled and msg.matches(r.title_contains, r.text_contains):
                return r
        return None

    def _active_drivers(self):
        for plat in list(self.used_platforms):
            d = self.drivers.get(plat)
            if d is not None:
                yield d

    def _handle_messages(self, ctx: RowContext, wait_ms: float = 0,
                         require: bool = False) -> bool:
        """Verifica e trata mensagens. Retorna True se tratou alguma."""
        handled = False
        end = time.time() + wait_ms / 1000
        while True:
            for drv in self._active_drivers():
                try:
                    msgs = drv.messages()
                except Exception:
                    msgs = []
                for m in msgs:
                    handled = True
                    self._apply_message(ctx, drv, m)
            if handled or time.time() >= end:
                break
            self._sleep(250)
        if require and not handled:
            raise StepFailed("Nenhuma mensagem apareceu")
        return handled

    def _apply_message(self, ctx: RowContext, drv, m: ScreenMessage):
        rule = self._match_rule(m)
        auto_buttons = self.s.auto_click_buttons or "OK"
        if rule:
            action, button, rule_name = rule.action, rule.button or auto_buttons, rule.name
        else:
            pol = self.s.unexpected_message_action
            rule_name = "(não prevista)"
            if pol == UNEXPECTED_IGNORE:
                return
            if pol == UNEXPECTED_ASK:
                if m.kind == "js_dialog":
                    action, button = MessageAction.CLICK_CAPTURE, "OK"
                else:
                    self._set_state("aguardando")
                    try:
                        choice, button = self.ev.ask_message(m)
                    finally:
                        if not self._stop.is_set():
                            self._set_state("executando")
                    action = {"clicar": MessageAction.CLICK_CAPTURE,
                              "proxima": MessageAction.CAPTURE_NEXT,
                              "recomecar": MessageAction.RESTART,
                              "ignorar": MessageAction.IGNORE,
                              "parar": "parar"}.get(choice, MessageAction.CLICK_CAPTURE)
                    button = button or auto_buttons
            elif pol == UNEXPECTED_CAPTURE_NEXT:
                action, button = MessageAction.CAPTURE_NEXT, auto_buttons
            else:
                action, button = MessageAction.CLICK_CAPTURE, auto_buttons

        text = m.summary()
        shot = ""
        if action != MessageAction.IGNORE and (rule is None or rule.screenshot):
            if m.kind != "js_dialog":
                shot = self._shot(ctx, "mensagem", driver=drv)
        if self.db:
            self.db.log_message(self.eid, ctx.idx, m.title, m.text, rule_name,
                                action, shot)
        self.ev.message_captured(ctx.idx, m, action)
        self.ev.log("warn" if rule is None else "info",
                    f"💬 Mensagem {rule_name}: {text[:200]} → {MessageAction.LABELS.get(action, action)}")
        if rule and rule.output_column:
            prev = ctx.row.get(rule.output_column, "")
            ctx.row[rule.output_column] = (prev + " | " if prev and ctx.vars.get("_msg_set") else "") + text
            ctx.vars["_msg_set"] = "1"
        if action == MessageAction.IGNORE:
            return
        if action == "parar":
            drv.answer_message(m, button)
            self._stop.set()
            raise StopRun()
        answered = drv.answer_message(m, button) if m.kind != "js_dialog" else True
        if not answered:
            answered = drv.answer_message(m, auto_buttons)
        if not answered:
            self.ev.log("warn", f"Não encontrei o botão '{button}' na mensagem")
        status = rule.row_status if rule else (
            RowStatus.ERROR if action == MessageAction.CAPTURE_NEXT else RowStatus.WARNING)
        if action == MessageAction.CAPTURE_NEXT:
            raise NextRow(status, text)
        if action == MessageAction.RESTART:
            raise RestartRow(text)
        if action == MessageAction.FAIL:
            raise StepFailed(f"Mensagem: {text}")
        if action == MessageAction.CLICK_CAPTURE:
            ctx.message = text
            if rule:
                ctx.status = rule.row_status
            else:
                ctx.warnings.append(f"Mensagem não prevista: {text}")
        elif rule and rule.row_status == RowStatus.ERROR:
            ctx.status = RowStatus.ERROR
            ctx.message = text
