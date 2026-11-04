"""Modelos de dados do AutoMassa Studio.

Tudo que compõe um projeto (campos mapeados, fluxo de passos, regras de
mensagens, configurações e a massa de dados) é representado aqui com
dataclasses serializáveis em JSON.
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field, fields
from typing import Any


def new_id() -> str:
    return uuid.uuid4().hex[:10]


# --------------------------------------------------------------------------
# Enumerações (strings simples para facilitar JSON e exibição)
# --------------------------------------------------------------------------
class Platform:
    DESKTOP = "desktop"
    WEB = "web"
    ALL = (DESKTOP, WEB)
    LABELS = {DESKTOP: "Executável", WEB: "Web"}


class FieldType:
    TEXT = "texto"
    PASSWORD = "senha"
    NUMBER = "numero"
    DATE = "data"
    LIST = "lista"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    BUTTON = "botao"
    LABEL = "rotulo"        # texto somente leitura (ótimo para captura)
    TABLE = "tabela"
    TAB = "aba"
    MENU = "menu"
    OTHER = "outro"

    ALL = (TEXT, PASSWORD, NUMBER, DATE, LIST, CHECKBOX, RADIO, BUTTON,
           LABEL, TABLE, TAB, MENU, OTHER)
    LABELS = {
        TEXT: "Texto", PASSWORD: "Senha", NUMBER: "Número", DATE: "Data",
        LIST: "Lista", CHECKBOX: "Caixa de seleção", RADIO: "Opção (radio)",
        BUTTON: "Botão", LABEL: "Rótulo / Texto", TABLE: "Tabela/Grade",
        TAB: "Aba", MENU: "Menu", OTHER: "Outro",
    }
    # Tipos que recebem dados da massa (viram colunas de entrada no Excel)
    INPUT_TYPES = (TEXT, PASSWORD, NUMBER, DATE, LIST, CHECKBOX, RADIO)


class Action:
    FILL = "preencher"
    SELECT = "selecionar"
    CLICK = "clicar"
    DOUBLE_CLICK = "duplo_clique"
    CHECK = "marcar"
    KEYS = "teclas"
    WAIT = "aguardar"
    WAIT_ELEMENT = "aguardar_elemento"
    WAIT_GONE = "aguardar_sumir"
    CAPTURE_TEXT = "capturar_texto"
    CAPTURE_SCREEN = "capturar_tela"
    CAPTURE_MESSAGE = "capturar_mensagem"
    VALIDATE_TEXT = "validar_texto"
    NAVIGATE = "navegar"
    LAUNCH = "abrir_programa"
    FOCUS = "focar_janela"
    SET_VAR = "definir_variavel"
    HANDLE_MESSAGES = "tratar_mensagens"

    ALL = (FILL, SELECT, CLICK, DOUBLE_CLICK, CHECK, KEYS, WAIT, WAIT_ELEMENT,
           WAIT_GONE, CAPTURE_TEXT, CAPTURE_SCREEN, CAPTURE_MESSAGE,
           VALIDATE_TEXT, NAVIGATE, LAUNCH, FOCUS, SET_VAR, HANDLE_MESSAGES)
    LABELS = {
        FILL: "Preencher campo", SELECT: "Selecionar da lista",
        CLICK: "Clicar", DOUBLE_CLICK: "Duplo clique",
        CHECK: "Marcar / desmarcar", KEYS: "Enviar teclas",
        WAIT: "Aguardar tempo", WAIT_ELEMENT: "Aguardar elemento aparecer",
        WAIT_GONE: "Aguardar elemento sumir",
        CAPTURE_TEXT: "Capturar texto do campo",
        CAPTURE_SCREEN: "Capturar tela",
        CAPTURE_MESSAGE: "Capturar mensagem aberta",
        VALIDATE_TEXT: "Validar texto", NAVIGATE: "Abrir URL",
        LAUNCH: "Abrir executável", FOCUS: "Focar janela",
        SET_VAR: "Definir variável", HANDLE_MESSAGES: "Verificar mensagens",
    }
    ICONS = {
        FILL: "✎", SELECT: "▾", CLICK: "◉", DOUBLE_CLICK: "◎", CHECK: "☑",
        KEYS: "⌨", WAIT: "⏱", WAIT_ELEMENT: "⌛", WAIT_GONE: "⌛",
        CAPTURE_TEXT: "⎘", CAPTURE_SCREEN: "📷", CAPTURE_MESSAGE: "💬",
        VALIDATE_TEXT: "✔", NAVIGATE: "🌐", LAUNCH: "🚀", FOCUS: "▣",
        SET_VAR: "𝑥", HANDLE_MESSAGES: "🛈",
    }
    NEEDS_FIELD = (FILL, SELECT, CLICK, DOUBLE_CLICK, CHECK, WAIT_ELEMENT,
                   WAIT_GONE, CAPTURE_TEXT, VALIDATE_TEXT)
    NEEDS_VALUE = (FILL, SELECT, CHECK, KEYS, WAIT, VALIDATE_TEXT, NAVIGATE,
                   LAUNCH, FOCUS, SET_VAR)
    PRODUCES_OUTPUT = (CAPTURE_TEXT, CAPTURE_SCREEN, CAPTURE_MESSAGE, SET_VAR)


class ValueSource:
    COLUMN = "coluna"
    FIXED = "fixo"
    GENERATOR = "gerador"
    VARIABLE = "variavel"
    ALL = (COLUMN, FIXED, GENERATOR, VARIABLE)
    LABELS = {COLUMN: "Coluna da massa", FIXED: "Valor fixo",
              GENERATOR: "Gerador automático", VARIABLE: "Variável / captura"}


class ErrorPolicy:
    DEFAULT = "padrao"      # usa a política do projeto
    ASK = "perguntar"
    CONTINUE = "prosseguir"
    RETRY = "repetir"
    SKIP_ROW = "pular_rodada"
    RESTART_ROW = "recomecar"
    STOP = "parar"
    ALL = (DEFAULT, ASK, CONTINUE, RETRY, SKIP_ROW, RESTART_ROW, STOP)
    LABELS = {
        DEFAULT: "Padrão do projeto", ASK: "Perguntar o que fazer",
        CONTINUE: "Prosseguir para o próximo passo", RETRY: "Repetir o passo",
        SKIP_ROW: "Registrar erro e ir para a próxima rodada",
        RESTART_ROW: "Recomeçar a rodada", STOP: "Parar a execução",
    }


class MessageAction:
    CLICK = "clicar_botao"              # clica no botão e continua
    CLICK_CAPTURE = "clicar_capturar"   # captura texto/print, clica e continua
    CAPTURE_NEXT = "capturar_proxima"   # captura, fecha e vai p/ próxima rodada
    RESTART = "recomecar"               # captura, fecha e recomeça a rodada
    FAIL = "falhar"                     # trata como erro do passo
    IGNORE = "ignorar"
    ALL = (CLICK, CLICK_CAPTURE, CAPTURE_NEXT, RESTART, FAIL, IGNORE)
    LABELS = {
        CLICK: "Clicar no botão e continuar",
        CLICK_CAPTURE: "Capturar, clicar e continuar",
        CAPTURE_NEXT: "Capturar, fechar e ir p/ próxima rodada",
        RESTART: "Capturar, fechar e recomeçar a rodada",
        FAIL: "Tratar como erro", IGNORE: "Ignorar",
    }


class RowStatus:
    PENDING = "Pendente"
    RUNNING = "Executando"
    SUCCESS = "Sucesso"
    ERROR = "Erro"
    WARNING = "Aviso"
    SKIPPED = "Pulado"


# Colunas de controle adicionadas na massa/Excel
CTRL_STATUS = "_status"
CTRL_MESSAGE = "_mensagem"
CTRL_DATE = "_executado_em"
CTRL_DURATION = "_duracao_s"
CTRL_EXECUTE = "_executar"
CONTROL_COLUMNS = (CTRL_EXECUTE, CTRL_STATUS, CTRL_MESSAGE, CTRL_DATE,
                   CTRL_DURATION)
CONTROL_LABELS = {CTRL_EXECUTE: "Executar (S/N)", CTRL_STATUS: "Status",
                  CTRL_MESSAGE: "Mensagem", CTRL_DATE: "Executado em",
                  CTRL_DURATION: "Duração (s)"}


# --------------------------------------------------------------------------
# Helper de serialização tolerante a versões antigas/novas
# --------------------------------------------------------------------------
def _from_dict(cls, data: dict | None):
    if data is None:
        return cls()
    names = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in data.items() if k in names})


@dataclass
class Locator:
    platform: str = Platform.DESKTOP
    # ----- Desktop (UI Automation) -----
    window_title: str = ""          # regex/título da janela principal
    window_class: str = ""
    process: str = ""               # nome do executável (ex.: sistema.exe)
    auto_id: str = ""
    name: str = ""
    control_type: str = ""
    class_name: str = ""
    found_index: int = 0
    path: list = field(default_factory=list)   # caminho de ancestrais
    rel_x: int | None = None        # posição relativa à janela (fallback)
    rel_y: int | None = None
    # ----- Web -----
    selector: str = ""
    alt_selectors: list = field(default_factory=list)
    xpath: str = ""
    frame_url: str = ""
    page_url: str = ""
    tag: str = ""
    input_type: str = ""

    def describe(self) -> str:
        if self.platform == Platform.WEB:
            return self.selector or self.xpath or "(sem seletor)"
        parts = []
        if self.auto_id:
            parts.append(f"id={self.auto_id}")
        if self.name:
            parts.append(f"nome='{self.name}'")
        if self.control_type:
            parts.append(self.control_type)
        if self.rel_x is not None and not parts:
            parts.append(f"pos=({self.rel_x},{self.rel_y})")
        win = self.window_title or self.process
        return (f"[{win}] " if win else "") + " ".join(parts)

    @classmethod
    def from_dict(cls, d):
        return _from_dict(cls, d)


@dataclass
class ListOption:
    text: str = ""
    value: str = ""

    @classmethod
    def from_dict(cls, d):
        if isinstance(d, str):
            return cls(text=d, value=d)
        return _from_dict(cls, d)


@dataclass
class FieldDef:
    id: str = field(default_factory=new_id)
    name: str = ""                  # nome da coluna na massa
    label: str = ""                 # rótulo detectado na tela
    ftype: str = FieldType.TEXT
    locator: Locator = field(default_factory=Locator)
    options: list = field(default_factory=list)   # list[ListOption]
    default: str = ""
    required: bool = False
    generator: str = ""             # gerador sugerido para a coluna
    notes: str = ""
    thumbnail: str = ""             # png base64 do elemento mapeado

    @property
    def platform(self) -> str:
        return self.locator.platform

    @property
    def is_input(self) -> bool:
        return self.ftype in FieldType.INPUT_TYPES

    def option_texts(self) -> list[str]:
        return [o.text for o in self.options]

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        obj = _from_dict(cls, d)
        obj.locator = Locator.from_dict(d.get("locator"))
        obj.options = [ListOption.from_dict(o) for o in d.get("options", [])]
        return obj


@dataclass
class Step:
    id: str = field(default_factory=new_id)
    enabled: bool = True
    action: str = Action.FILL
    field_id: str = ""
    value_source: str = ValueSource.COLUMN
    value: str = ""                 # valor fixo/teclas/url/expressão/gerador
    column: str = ""                # coluna da massa (fonte)
    output_column: str = ""         # coluna onde salvar captura
    delay_before_ms: int = 0
    delay_after_ms: int = 0
    timeout_ms: int = 0             # 0 = padrão do projeto
    retries: int = 0
    on_error: str = ErrorPolicy.DEFAULT
    condition_column: str = ""      # executa só se a coluna tiver valor
    optional: bool = False          # erro não interrompe (prossegue)
    note: str = ""

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return _from_dict(cls, d)


@dataclass
class MessageRule:
    id: str = field(default_factory=new_id)
    enabled: bool = True
    name: str = ""
    title_contains: str = ""        # vazio = qualquer título
    text_contains: str = ""         # aceita regex se começar com re:
    action: str = MessageAction.CLICK
    button: str = "OK"
    row_status: str = RowStatus.SUCCESS
    output_column: str = ""         # salva o texto da mensagem
    screenshot: bool = True

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return _from_dict(cls, d)


@dataclass
class Settings:
    # Tempos
    speed: float = 1.0              # multiplicador (0.5 = 2x mais rápido)
    step_delay_ms: int = 250        # pausa padrão entre passos
    row_delay_ms: int = 800         # pausa entre rodadas
    timeout_ms: int = 10000         # tempo máximo p/ localizar elemento
    typing_interval_ms: int = 0     # intervalo entre teclas (0 = colar)
    # Erros
    error_policy: str = ErrorPolicy.ASK
    max_restarts: int = 2
    default_retries: int = 1
    screenshot_on_error: bool = True
    screenshot_each_step: bool = False
    # Mensagens
    watch_messages: bool = True
    unexpected_message_action: str = "perguntar"   # ver UNEXPECTED_*
    auto_click_buttons: str = "OK;Ok;Sim;Yes;Fechar;Close;Continuar"
    web_message_selectors: str = ("[role=alertdialog];[role=dialog];"
                                  ".modal.show;.swal2-popup;.toast.show;"
                                  ".ui-dialog;.alert-danger;.alert-success")
    # Alvos
    app_path: str = ""
    app_window_title: str = ""
    start_url: str = ""
    browser_channel: str = "msedge"  # msedge | chrome | chromium
    browser_headless: bool = False
    browser_path: str = ""           # executável do navegador (opcional)
    # Excel
    output_folder: str = ""

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return _from_dict(cls, d)


UNEXPECTED_ASK = "perguntar"
UNEXPECTED_AUTO_CLICK = "clicar_auto"
UNEXPECTED_CAPTURE_NEXT = "capturar_proxima"
UNEXPECTED_IGNORE = "ignorar"
UNEXPECTED_LABELS = {
    UNEXPECTED_ASK: "Pausar e perguntar o que fazer",
    UNEXPECTED_AUTO_CLICK: "Capturar e clicar automaticamente (OK/Sim/Fechar)",
    UNEXPECTED_CAPTURE_NEXT: "Capturar, fechar e ir para a próxima rodada",
    UNEXPECTED_IGNORE: "Ignorar",
}


@dataclass
class Project:
    name: str = "Novo projeto"
    description: str = ""
    version: int = 1
    fields: list = field(default_factory=list)          # list[FieldDef]
    steps: list = field(default_factory=list)           # list[Step]
    reset_steps: list = field(default_factory=list)     # list[Step]
    message_rules: list = field(default_factory=list)   # list[MessageRule]
    settings: Settings = field(default_factory=Settings)
    columns: list = field(default_factory=list)         # ordem das colunas
    rows: list = field(default_factory=list)            # list[dict]
    path: str = ""                                      # não serializado

    # ------------------------------------------------------------------
    def field_by_id(self, fid: str) -> FieldDef | None:
        for f in self.fields:
            if f.id == fid:
                return f
        return None

    def field_by_name(self, name: str) -> FieldDef | None:
        for f in self.fields:
            if f.name == name:
                return f
        return None

    def input_columns(self) -> list[str]:
        """Colunas de entrada sugeridas a partir dos campos e do fluxo."""
        cols: list[str] = []
        for s in self.steps:
            if s.value_source == ValueSource.COLUMN and s.column:
                if s.action in (Action.FILL, Action.SELECT, Action.CHECK,
                                Action.VALIDATE_TEXT, Action.KEYS):
                    if s.column not in cols:
                        cols.append(s.column)
        for f in self.fields:
            if f.is_input and f.name not in cols:
                cols.append(f.name)
        return cols

    def output_columns(self) -> list[str]:
        cols: list[str] = []
        for s in list(self.steps) + list(self.reset_steps):
            if s.output_column and s.output_column not in cols:
                cols.append(s.output_column)
        for r in self.message_rules:
            if r.output_column and r.output_column not in cols:
                cols.append(r.output_column)
        return cols

    def all_columns(self) -> list[str]:
        """Ordem final: entradas, saídas e controle."""
        ordered: list[str] = []
        for c in self.columns:
            if c not in CONTROL_COLUMNS and c not in ordered:
                ordered.append(c)
        for c in self.input_columns() + self.output_columns():
            if c not in ordered:
                ordered.append(c)
        return ordered + list(CONTROL_COLUMNS)

    def sync_columns(self) -> None:
        self.columns = [c for c in self.all_columns()
                        if c not in CONTROL_COLUMNS]
        for row in self.rows:
            for c in self.all_columns():
                row.setdefault(c, "")
            if not row.get(CTRL_EXECUTE):
                row[CTRL_EXECUTE] = "S"

    def list_options_for_column(self, col: str) -> list[str]:
        f = self.field_by_name(col)
        if f is None:
            for s in self.steps:
                if s.column == col and s.field_id:
                    f = self.field_by_id(s.field_id)
                    if f:
                        break
        if f is not None and f.ftype in (FieldType.LIST, FieldType.RADIO):
            return f.option_texts()
        if f is not None and f.ftype == FieldType.CHECKBOX:
            return ["S", "N"]
        return []

    # ------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "app": "AutoMassa Studio", "version": self.version,
            "name": self.name, "description": self.description,
            "fields": [f.to_dict() for f in self.fields],
            "steps": [s.to_dict() for s in self.steps],
            "reset_steps": [s.to_dict() for s in self.reset_steps],
            "message_rules": [r.to_dict() for r in self.message_rules],
            "settings": self.settings.to_dict(),
            "columns": list(self.columns),
            "rows": list(self.rows),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Project":
        p = cls()
        p.name = d.get("name", p.name)
        p.description = d.get("description", "")
        p.version = d.get("version", 1)
        p.fields = [FieldDef.from_dict(x) for x in d.get("fields", [])]
        p.steps = [Step.from_dict(x) for x in d.get("steps", [])]
        p.reset_steps = [Step.from_dict(x) for x in d.get("reset_steps", [])]
        p.message_rules = [MessageRule.from_dict(x)
                           for x in d.get("message_rules", [])]
        p.settings = Settings.from_dict(d.get("settings"))
        p.columns = list(d.get("columns", []))
        p.rows = [dict(r) for r in d.get("rows", [])]
        return p


def default_message_rules() -> list[MessageRule]:
    return [
        MessageRule(name="Sucesso / gravado",
                    text_contains="re:(sucesso|gravad|salv|cadastrad|incluíd|conclu)",
                    action=MessageAction.CLICK_CAPTURE, button="OK",
                    row_status=RowStatus.SUCCESS, output_column="msg_retorno"),
        MessageRule(name="Erro / inválido",
                    text_contains="re:(erro|inválid|invalid|falha|obrigatóri|não foi possível)",
                    action=MessageAction.CAPTURE_NEXT, button="OK",
                    row_status=RowStatus.ERROR, output_column="msg_retorno"),
        MessageRule(name="Confirmação",
                    text_contains="re:(deseja|confirma|tem certeza)",
                    action=MessageAction.CLICK, button="Sim",
                    row_status=RowStatus.SUCCESS),
    ]


def sanitize_column_name(text: str, existing: list[str] | None = None) -> str:
    import re
    import unicodedata
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore")
    t = t.decode().strip().lower()
    t = re.sub(r"[^a-z0-9]+", "_", t).strip("_") or "campo"
    if t[0].isdigit():
        t = "c_" + t
    t = t[:40]
    if existing:
        base, i = t, 2
        while t in existing:
            t = f"{base}_{i}"
            i += 1
    return t


def any_to_dict(obj: Any) -> Any:
    return obj.to_dict() if hasattr(obj, "to_dict") else obj
