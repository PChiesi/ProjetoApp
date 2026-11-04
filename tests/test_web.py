"""Teste ponta a ponta do driver web (mapeamento por clique + execução)."""
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APPDATA", tempfile.mkdtemp())

pytest.importorskip("playwright")

FORM = """<!doctype html><html><body>
<h2>Cadastro</h2>
<label for="nome">Nome completo</label><input id="nome" name="nome"><br>
<label for="cpf">CPF</label><input id="cpf" name="cpf"><br>
<label for="uf">Estado</label><select id="uf" name="uf"><option value="">Selecione...</option>
<option value="SP">São Paulo</option><option value="RJ">Rio de Janeiro</option><option value="MG">Minas Gerais</option></select><br>
<label><input type="checkbox" id="ativo"> Ativo</label>
<button id="salvar" onclick="salvar()">Salvar</button>
<div id="proto" style="min-height:20px;width:200px">-</div>
<div class="modal show" id="m" style="display:none"><h4 class="modal-title">Aviso</h4><p id="mt"></p><button onclick="document.getElementById('m').style.display='none'">OK</button></div>
<script>
let n=0;
function salvar(){
  const c=document.getElementById('cpf').value;
  if(c.length<11){document.getElementById('mt').innerText='CPF inválido';document.getElementById('m').style.display='block';return;}
  n++; document.getElementById('proto').innerText='PRT-'+n+'-'+document.getElementById('uf').value;
  alert('Registro gravado com sucesso');
}
</script></body></html>"""


@pytest.fixture(scope="module")
def page_url(tmp_path_factory):
    d = tmp_path_factory.mktemp("site")
    f = d / "form.html"
    f.write_text(FORM, encoding="utf-8")
    return f.as_uri()


def test_web_map_and_run(page_url, tmp_path):
    from automassa.core.database import Database
    from automassa.core.engine import Engine
    from automassa.core.flow import field_from_mapped, suggest_step
    from automassa.core.models import (CTRL_STATUS, MessageAction, MessageRule,
                                       Platform, Project, RowStatus, Step, Action)
    from automassa.drivers.web import WebDriver

    p = Project(name="web")
    p.settings.browser_channel = "chromium"
    p.settings.browser_headless = True
    if os.path.exists("/opt/pw-browsers/chromium"):
        p.settings.browser_path = "/opt/pw-browsers/chromium"
    p.settings.step_delay_ms = 0
    p.settings.row_delay_ms = 0
    picks = []
    got = threading.Event()

    def on_pick(info, thumb):
        picks.append((info, thumb))
        got.set()

    drv = WebDriver(p.settings, on_pick=on_pick)
    try:
        drv.navigate(page_url)
        drv.set_picking(True)
        for sel in ("#nome", "#cpf", "#uf", "#ativo", "#salvar", "#proto"):
            got.clear()
            drv._call(lambda t, s=sel: t.page.locator(s).click(force=True))
            assert got.wait(5), sel
        drv.set_picking(False)
        mapped = [WebDriver.info_to_mapped(i, th) for i, th in picks]
        kinds = [m.ftype for m in mapped]
        assert kinds[:5] == ["texto", "texto", "lista", "checkbox", "botao"]
        assert mapped[0].label == "Nome completo"
        assert [o[0] for o in mapped[2].options][1:] == ["São Paulo", "Rio de Janeiro", "Minas Gerais"]
        assert mapped[0].thumbnail_png.startswith(b"\x89PNG")

        for m in mapped:
            f = field_from_mapped(p, m)
            p.fields.append(f)
            p.steps.append(suggest_step(f))
        uf = p.fields[2]
        assert uf.option_texts() == ["São Paulo", "Rio de Janeiro", "Minas Gerais"]  # placeholder removido
        p.steps.insert(0, Step(action=Action.NAVIGATE, value_source="fixo", value=page_url))
        p.message_rules = [
            MessageRule(name="ok", text_contains="sucesso", action=MessageAction.CLICK_CAPTURE,
                        row_status=RowStatus.SUCCESS, output_column="retorno"),
            MessageRule(name="erro", text_contains="inválido", action=MessageAction.CAPTURE_NEXT,
                        row_status=RowStatus.ERROR, output_column="retorno"),
        ]
        names = [f.name for f in p.fields]
        p.rows = [
            {names[0]: "Ana", names[1]: "12345678901", names[2]: "Rio de Janeiro", names[3]: "S"},
            {names[0]: "Bia", names[1]: "1", names[2]: "Minas", names[3]: "N"},
        ]
        p.sync_columns()
        s = Engine(p, {Platform.WEB: drv}, Database(tmp_path / "h.db")).run()
        assert s["ok"] == 1 and s["erro"] == 1, p.rows
        assert p.rows[0][names[5]] == "PRT-1-RJ"
        assert "sucesso" in p.rows[0]["retorno"]
        assert "inválido" in p.rows[1]["retorno"]
        assert p.rows[1][CTRL_STATUS] == RowStatus.ERROR
    finally:
        drv.close()
