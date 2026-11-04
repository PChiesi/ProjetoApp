import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APPDATA", tempfile.mkdtemp())

from automassa.core import excel_io, generators  # noqa: E402
from automassa.core.database import Database  # noqa: E402
from automassa.core.engine import Engine, EngineEvents  # noqa: E402
from automassa.core.models import (CTRL_STATUS, Action, ErrorPolicy, FieldDef,  # noqa: E402
                                   FieldType, ListOption, Locator, MessageAction,
                                   MessageRule, Platform, Project, RowStatus,
                                   Step, ValueSource)
from automassa.drivers.base import (BaseDriver, ElementNotFound,  # noqa: E402
                                    ScreenMessage)


class FakeDriver(BaseDriver):
    platform = Platform.DESKTOP

    def __init__(self, settings):
        super().__init__(settings)
        self.screen = {}
        self.pending = []
        self.answered = []
        self.fail_once = set()

    def fill(self, loc, value, timeout):
        if loc.auto_id in self.fail_once:
            self.fail_once.discard(loc.auto_id)
            raise ElementNotFound("sumiu")
        if loc.auto_id == "nao_existe":
            raise ElementNotFound("nao existe")
        self.screen[loc.auto_id] = value

    def select(self, loc, value, timeout):
        self.screen[loc.auto_id] = value
        return value

    def click(self, loc, timeout, double=False):
        if loc.auto_id == "salvar":
            doc = self.screen.get("doc", "")
            if generators.validate_cpf(doc):
                self.pending.append(ScreenMessage(Platform.DESKTOP, "Info", f"Cliente {doc} gravado com sucesso", ["OK"]))
            else:
                self.pending.append(ScreenMessage(Platform.DESKTOP, "Erro", "CPF inválido", ["OK"]))

    def get_text(self, loc, timeout):
        return "PROTO-123"

    def messages(self):
        out, self.pending = self.pending, []
        return out

    def answer_message(self, msg, button):
        self.answered.append(button)
        return True

    def screenshot(self, path, loc=None):
        Path(path).write_bytes(b"png")
        return path

    def check(self, loc, state, timeout):
        self.screen[loc.auto_id] = state


def build_project():
    p = Project(name="Teste")
    p.settings.step_delay_ms = 0
    p.settings.row_delay_ms = 0
    p.settings.error_policy = ErrorPolicy.SKIP_ROW
    f_doc = FieldDef(name="doc", ftype=FieldType.TEXT, locator=Locator(auto_id="doc"))
    f_uf = FieldDef(name="uf", ftype=FieldType.LIST, locator=Locator(auto_id="uf"),
                    options=[ListOption("SP", "SP"), ListOption("RJ", "RJ")])
    f_save = FieldDef(name="salvar", ftype=FieldType.BUTTON, locator=Locator(auto_id="salvar"))
    f_proto = FieldDef(name="protocolo", ftype=FieldType.LABEL, locator=Locator(auto_id="proto"))
    p.fields = [f_doc, f_uf, f_save, f_proto]
    p.steps = [
        Step(action=Action.FILL, field_id=f_doc.id, column="doc"),
        Step(action=Action.SELECT, field_id=f_uf.id, column="uf"),
        Step(action=Action.CLICK, field_id=f_save.id),
        Step(action=Action.CAPTURE_TEXT, field_id=f_proto.id, output_column="protocolo"),
    ]
    p.message_rules = [
        MessageRule(name="ok", text_contains="sucesso", action=MessageAction.CLICK_CAPTURE,
                    row_status=RowStatus.SUCCESS, output_column="retorno"),
        MessageRule(name="erro", text_contains="re:inv[aá]lido", action=MessageAction.CAPTURE_NEXT,
                    row_status=RowStatus.ERROR, output_column="retorno"),
    ]
    p.rows = [{"doc": generators.cpf(), "uf": "SP"},
              {"doc": "111.111.111-12", "uf": "RJ"},
              {"doc": "=GERAR(cpf)", "uf": "SP", "_executar": "S"},
              {"doc": "x", "uf": "SP", "_executar": "N"}]
    p.sync_columns()
    return p


def test_generators():
    for _ in range(50):
        assert generators.validate_cpf(generators.cpf())
        assert generators.validate_cnpj(generators.cnpj())
    assert generators.guess_generator("CPF do cliente") == "cpf"


def test_engine_flow(tmp_path):
    p = build_project()
    drv = FakeDriver(p.settings)
    db = Database(tmp_path / "h.db")
    summary = Engine(p, {Platform.DESKTOP: drv}, db, EngineEvents()).run()
    assert summary["ok"] == 2 and summary["erro"] == 1 and summary["pulado"] == 1
    assert p.rows[0][CTRL_STATUS] == RowStatus.SUCCESS
    assert p.rows[0]["protocolo"] == "PROTO-123"
    assert "sucesso" in p.rows[0]["retorno"]
    assert p.rows[1][CTRL_STATUS] == RowStatus.ERROR
    assert p.rows[1].get("protocolo", "") == ""       # pulou para a próxima rodada
    assert generators.validate_cpf(p.rows[2]["doc"])  # gerado e registrado
    k = db.kpis()
    assert k["execucoes"] == 1 and k["sucesso"] == 2
    assert db.step_times()


def test_error_policies(tmp_path):
    p = build_project()
    p.rows = p.rows[:1]
    p.fields[0].locator.auto_id = "nao_existe"
    asked = []

    class Ev(EngineEvents):
        def ask_error(self, info):
            asked.append(info)
            return ErrorPolicy.CONTINUE

    p.settings.error_policy = ErrorPolicy.ASK
    p.settings.default_retries = 0
    s = Engine(p, {Platform.DESKTOP: FakeDriver(p.settings)}, None, Ev()).run()
    # prosseguiu; sem CPF o sistema mostra "CPF inválido" → regra manda p/ próxima rodada
    assert asked and s["erro"] == 1
    # restart: falha uma vez e depois funciona
    p = build_project()
    p.rows = p.rows[:1]
    p.settings.error_policy = ErrorPolicy.RESTART_ROW
    drv = FakeDriver(p.settings)
    drv.fail_once.add("doc")
    s = Engine(p, {Platform.DESKTOP: drv}, None).run()
    assert s["ok"] == 1


def test_excel_roundtrip(tmp_path):
    p = build_project()
    path = str(tmp_path / "massa.xlsx")
    excel_io.export_datatable(p, path)
    from openpyxl import load_workbook
    wb = load_workbook(path)
    assert {"Massa", "Listas", "Campos", "Instruções"} <= set(wb.sheetnames)
    assert wb["Listas"]["A1"].value == "uf" and wb["Listas"]["A3"].value == "RJ"
    assert wb["Massa"].data_validations.dataValidation
    p2 = build_project()
    p2.rows = []
    info = excel_io.import_datatable(p2, path)
    assert info["linhas"] == 4
    assert p2.rows[0]["uf"] == "SP"
    assert p2.rows[3]["_executar"] == "N"


def test_project_json_roundtrip(tmp_path):
    from automassa.core import storage
    p = build_project()
    path = storage.save_project(p, str(tmp_path / "proj"))
    q = storage.load_project(path)
    assert q.fields[1].options[1].text == "RJ"
    assert q.steps[0].column == "doc"
    assert q.message_rules[1].action == MessageAction.CAPTURE_NEXT


def test_web_keys_conversion():
    from automassa.drivers.web import _convert_keys
    assert _convert_keys("{ENTER}") == [("press", "Enter")]
    assert _convert_keys("^s") == [("press", "Control+s")]
    assert _convert_keys("abc{TAB 2}") == [("type", "abc"), ("press", "Tab"), ("press", "Tab")]
    assert _convert_keys("Control+S") == [("press", "Control+S")]
