"""Exportação e importação da massa de dados em Excel (.xlsx).

Planilhas geradas:
  * Massa       – uma linha por rodada; colunas de entrada (azul), de
                  captura/saída (verde) e de controle (cinza). Colunas de
                  lista têm validação de dados (menu suspenso) com os valores
                  carregados da tela no momento do mapeamento.
  * Listas      – valores de cada campo de lista mapeado.
  * Campos      – dicionário de dados (rótulo, tipo, plataforma, localizador).
  * Instruções  – como preencher.
"""
from __future__ import annotations

from datetime import datetime

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from . import generators
from .models import (CONTROL_COLUMNS, CONTROL_LABELS, CTRL_EXECUTE, CTRL_STATUS,
                     FieldType, Platform, Project, RowStatus)

SHEET_DATA = "Massa"
SHEET_LISTS = "Listas"
SHEET_FIELDS = "Campos"
SHEET_HELP = "Instruções"

_FILL_IN = PatternFill("solid", fgColor="3B5BDB")
_FILL_OUT = PatternFill("solid", fgColor="2F9E44")
_FILL_CTRL = PatternFill("solid", fgColor="495057")
_FILL_LIST = PatternFill("solid", fgColor="7048E8")
_STATUS_FILLS = {
    RowStatus.SUCCESS: PatternFill("solid", fgColor="D3F9D8"),
    RowStatus.ERROR: PatternFill("solid", fgColor="FFE3E3"),
    RowStatus.WARNING: PatternFill("solid", fgColor="FFF3BF"),
    RowStatus.SKIPPED: PatternFill("solid", fgColor="E9ECEF"),
}
_HEAD_FONT = Font(bold=True, color="FFFFFF")
_THIN = Side(style="thin", color="DEE2E6")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)


def _header_label(col: str) -> str:
    return CONTROL_LABELS.get(col, col)


def _label_to_col(label: str) -> str:
    label = (label or "").strip()
    for k, v in CONTROL_LABELS.items():
        if label == v or label == k:
            return k
    return label


def export_datatable(project: Project, path: str, blank_rows: int = 0) -> str:
    project.sync_columns()
    columns = project.all_columns()
    inputs = set(project.input_columns())
    outputs = set(project.output_columns())

    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_DATA
    ws_lists = wb.create_sheet(SHEET_LISTS)
    ws_fields = wb.create_sheet(SHEET_FIELDS)
    ws_help = wb.create_sheet(SHEET_HELP)

    # ---------------------------------------------------------- Listas
    list_ranges: dict[str, str] = {}
    lcol = 1
    for col in columns:
        opts = project.list_options_for_column(col)
        if not opts:
            continue
        letter = get_column_letter(lcol)
        c = ws_lists.cell(row=1, column=lcol, value=col)
        c.font, c.fill = _HEAD_FONT, _FILL_LIST
        for i, o in enumerate(opts, start=2):
            ws_lists.cell(row=i, column=lcol, value=o)
        ws_lists.column_dimensions[letter].width = max(
            14, min(45, max(len(str(o)) for o in opts + [col]) + 2))
        list_ranges[col] = (f"'{SHEET_LISTS}'!${letter}$2:"
                            f"${letter}${len(opts) + 1}")
        lcol += 1
    if lcol == 1:
        ws_lists.cell(row=1, column=1,
                      value="Nenhum campo de lista mapeado ainda.")

    # ---------------------------------------------------------- Massa
    for ci, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=ci, value=_header_label(col))
        cell.font = _HEAD_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        cell.border = _BORDER
        if col in CONTROL_COLUMNS:
            cell.fill = _FILL_CTRL
        elif col in list_ranges:
            cell.fill = _FILL_LIST
        elif col in outputs and col not in inputs:
            cell.fill = _FILL_OUT
        else:
            cell.fill = _FILL_IN
        f = project.field_by_name(col)
        if f is not None:
            tip = (f"{f.label or f.name}\nTipo: {FieldType.LABELS.get(f.ftype, f.ftype)}"
                   f"\nPlataforma: {Platform.LABELS.get(f.platform, f.platform)}")
            if f.required:
                tip += "\nObrigatório"
            cell.comment = Comment(tip, "AutoMassa")
        width = 14
        values = [str(r.get(col, "")) for r in project.rows[:200]]
        width = max(width, len(_header_label(col)) + 4,
                    *(min(50, len(v) + 2) for v in values)) if values else max(
            width, len(_header_label(col)) + 4)
        ws.column_dimensions[get_column_letter(ci)].width = min(width, 50)

    for ri, row in enumerate(project.rows, start=2):
        status = row.get(CTRL_STATUS, "")
        for ci, col in enumerate(columns, start=1):
            val = row.get(col, "")
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.border = _BORDER
            if col == CTRL_STATUS and status in _STATUS_FILLS:
                cell.fill = _STATUS_FILLS[status]

    total_rows = max(len(project.rows) + blank_rows, 500)
    for col, ref in list_ranges.items():
        ci = columns.index(col) + 1
        letter = get_column_letter(ci)
        dv = DataValidation(type="list", formula1=f"={ref}", allow_blank=True,
                            showErrorMessage=True,
                            errorTitle="Valor inválido",
                            error="Escolha um valor da lista carregada da tela.")
        dv.add(f"{letter}2:{letter}{total_rows + 1}")
        ws.add_data_validation(dv)
    if CTRL_EXECUTE in columns:
        letter = get_column_letter(columns.index(CTRL_EXECUTE) + 1)
        dv = DataValidation(type="list", formula1='"S,N"', allow_blank=True)
        dv.add(f"{letter}2:{letter}{total_rows + 1}")
        ws.add_data_validation(dv)

    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 32
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{max(2, len(project.rows) + 1)}"

    # ---------------------------------------------------------- Campos
    heads = ["Coluna", "Rótulo na tela", "Tipo", "Plataforma", "Obrigatório",
             "Gerador sugerido", "Localizador", "Qtd. opções", "Opções"]
    for ci, h in enumerate(heads, start=1):
        c = ws_fields.cell(row=1, column=ci, value=h)
        c.font, c.fill = _HEAD_FONT, _FILL_CTRL
    for ri, f in enumerate(project.fields, start=2):
        vals = [f.name, f.label, FieldType.LABELS.get(f.ftype, f.ftype),
                Platform.LABELS.get(f.platform, f.platform),
                "Sim" if f.required else "Não",
                generators.GENERATORS.get(f.generator, ("",))[0],
                f.locator.describe(), len(f.options),
                " | ".join(f.option_texts())[:2000]]
        for ci, v in enumerate(vals, start=1):
            ws_fields.cell(row=ri, column=ci, value=v)
    for ci, w in enumerate([22, 28, 16, 12, 12, 22, 60, 10, 60], start=1):
        ws_fields.column_dimensions[get_column_letter(ci)].width = w
    ws_fields.freeze_panes = "A2"

    # ---------------------------------------------------------- Instruções
    help_lines = [
        ("AutoMassa Studio – Massa de dados", True),
        (f"Projeto: {project.name}", False),
        (f"Gerado em: {datetime.now():%d/%m/%Y %H:%M}", False),
        ("", False),
        ("Cores do cabeçalho", True),
        ("Azul: dado de entrada que será digitado na tela.", False),
        ("Roxo: campo de lista – use o menu suspenso (valores lidos da tela).", False),
        ("Verde: valor capturado pela automação (não precisa preencher).", False),
        ("Cinza: controle da execução (Executar S/N, Status, Mensagem...).", False),
        ("", False),
        ("Dicas", True),
        ("• Cada linha é uma rodada da automação.", False),
        ("• Coloque N na coluna 'Executar (S/N)' para pular uma linha.", False),
        ("• Não renomeie os cabeçalhos: eles ligam a planilha aos campos.", False),
        ("• Pode usar =GERAR(cpf), =GERAR(nome), etc. em qualquer célula para "
         "o programa gerar o valor na hora da execução.", False),
        ("• Geradores disponíveis: " + ", ".join(generators.GENERATORS), False),
    ]
    for i, (txt, bold) in enumerate(help_lines, start=1):
        c = ws_help.cell(row=i, column=1, value=txt)
        c.font = Font(bold=bold, size=13 if bold else 11)
    ws_help.column_dimensions["A"].width = 110

    wb.save(path)
    return path


def import_datatable(project: Project, path: str, replace: bool = True) -> dict:
    """Importa a planilha Massa. Retorna um resumo do que foi lido."""
    wb = load_workbook(path, data_only=False)
    ws = wb[SHEET_DATA] if SHEET_DATA in wb.sheetnames else wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        return {"linhas": 0, "colunas": [], "novas_colunas": [],
                "listas_atualizadas": 0}
    cols = [_label_to_col(str(h)) if h is not None else "" for h in header]
    known = set(project.all_columns())
    new_cols = [c for c in cols if c and c not in known]

    rows: list[dict] = []
    for values in rows_iter:
        if values is None or all(v in (None, "") for v in values):
            continue
        row = {}
        for c, v in zip(cols, values):
            if not c:
                continue
            if v is None:
                v = ""
            elif isinstance(v, datetime):
                v = v.strftime("%d/%m/%Y") if (v.hour, v.minute) == (0, 0) \
                    else v.strftime("%d/%m/%Y %H:%M")
            elif isinstance(v, float) and v.is_integer():
                v = str(int(v))
            row[c] = str(v)
        rows.append(row)

    # Atualiza listas se a planilha Listas foi editada
    lists_updated = 0
    if SHEET_LISTS in wb.sheetnames:
        wl = wb[SHEET_LISTS]
        for col_cells in wl.iter_cols(values_only=True):
            if not col_cells or not col_cells[0]:
                continue
            name = str(col_cells[0])
            values = [str(v) for v in col_cells[1:] if v not in (None, "")]
            f = project.field_by_name(name)
            if f and f.ftype in (FieldType.LIST, FieldType.RADIO) and values:
                if values != f.option_texts():
                    from .models import ListOption
                    old = {o.text: o.value for o in f.options}
                    f.options = [ListOption(v, old.get(v, v)) for v in values]
                    lists_updated += 1

    for c in new_cols:
        if c not in project.columns:
            project.columns.append(c)
    if replace:
        project.rows = rows
    else:
        project.rows.extend(rows)
    project.sync_columns()
    return {"linhas": len(rows), "colunas": [c for c in cols if c],
            "novas_colunas": new_cols, "listas_atualizadas": lists_updated}
