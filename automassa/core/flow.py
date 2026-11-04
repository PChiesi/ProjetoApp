"""Regras para sugerir passos e campos a partir do mapeamento."""
from __future__ import annotations

from . import generators
from .models import (Action, FieldDef, FieldType, ListOption, Project, Step,
                     ValueSource, sanitize_column_name)


def suggest_step(f: FieldDef) -> Step:
    t = f.ftype
    if t == FieldType.LIST or t == FieldType.RADIO:
        return Step(action=Action.SELECT, field_id=f.id, column=f.name,
                    note=f.label or f.name)
    if t == FieldType.CHECKBOX:
        return Step(action=Action.CHECK, field_id=f.id, column=f.name,
                    note=f.label or f.name)
    if t in FieldType.INPUT_TYPES:
        return Step(action=Action.FILL, field_id=f.id, column=f.name,
                    note=f.label or f.name)
    if t in (FieldType.LABEL, FieldType.TABLE):
        return Step(action=Action.CAPTURE_TEXT, field_id=f.id,
                    output_column=f.name, value_source=ValueSource.FIXED,
                    note=f.label or f.name)
    return Step(action=Action.CLICK, field_id=f.id, value_source=ValueSource.FIXED,
                note=f.label or f.name)


def field_from_mapped(project: Project, mapped) -> FieldDef:
    existing = [f.name for f in project.fields] + list(project.columns)
    label = (mapped.label or "").strip()
    base = label or mapped.locator.name or mapped.locator.auto_id or mapped.ftype
    name = sanitize_column_name(base, existing)
    ftype = mapped.ftype if mapped.ftype in FieldType.ALL else FieldType.OTHER
    f = FieldDef(name=name, label=label, ftype=ftype, locator=mapped.locator,
                 required=bool(mapped.extra.get("required", False)))
    seen = set()
    for item in mapped.options or []:
        text, value = (item if isinstance(item, (list, tuple)) else (item, item))[:2]
        text = str(text).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        f.options.append(ListOption(text, str(value)))
    # remove placeholders comuns ("Selecione...")
    if f.options and f.options[0].text.lower().startswith(("selecione", "escolha", "--", "select")):
        f.options = f.options[1:]
    if f.is_input and ftype not in (FieldType.LIST, FieldType.RADIO, FieldType.CHECKBOX):
        f.generator = generators.guess_generator(f"{label} {name}")
    if mapped.thumbnail_png:
        import base64
        f.thumbnail = base64.b64encode(mapped.thumbnail_png).decode()
    return f


def auto_flow(project: Project) -> list[Step]:
    """Gera um fluxo inicial: preenche entradas e clica botões na ordem
    em que foram mapeados."""
    return [suggest_step(f) for f in project.fields]


def fill_rows(project: Project, n: int, use_generators: bool = True) -> int:
    """Adiciona N linhas com valores gerados/aleatórios das listas."""
    import random
    project.sync_columns()
    start = len(project.rows)
    for i in range(n):
        row = {c: "" for c in project.all_columns()}
        row["_executar"] = "S"
        for col in project.input_columns():
            f = project.field_by_name(col)
            opts = project.list_options_for_column(col)
            if opts:
                row[col] = random.choice(opts)
            elif f and f.default:
                row[col] = f.default
            elif use_generators and f and f.generator:
                row[col] = generators.generate(f.generator, start + i)
            elif use_generators:
                g = generators.guess_generator(col)
                if g:
                    row[col] = generators.generate(g, start + i)
        project.rows.append(row)
    return n
