"""Geradores de dados de teste (massas).

Todos geram valores válidos (CPF/CNPJ com dígitos verificadores corretos)
para uso direto em sistemas que validam os campos.
"""
from __future__ import annotations

import random
import string
import uuid
from datetime import date, datetime, timedelta

_NOMES = ["Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela",
          "Henrique", "Isabela", "João", "Karina", "Lucas", "Mariana",
          "Nicolas", "Olívia", "Pedro", "Rafaela", "Samuel", "Tatiane",
          "Vinícius", "Larissa", "Gustavo", "Beatriz", "Rodrigo", "Juliana"]
_SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira",
               "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro",
               "Martins", "Carvalho", "Almeida", "Lopes", "Araújo", "Barbosa"]
_RUAS = ["Rua das Flores", "Av. Brasil", "Rua XV de Novembro", "Av. Paulista",
         "Rua São João", "Rua Sete de Setembro", "Av. Getúlio Vargas"]
_CIDADES = [("São Paulo", "SP"), ("Rio de Janeiro", "RJ"),
            ("Belo Horizonte", "MG"), ("Curitiba", "PR"),
            ("Porto Alegre", "RS"), ("Salvador", "BA"), ("Recife", "PE"),
            ("Campinas", "SP"), ("Florianópolis", "SC"), ("Goiânia", "GO")]
_EMPRESAS = ["Comércio", "Serviços", "Indústria", "Tecnologia", "Logística",
             "Distribuidora", "Consultoria"]


def _dv(nums: list[int], weights: list[int]) -> int:
    s = sum(n * w for n, w in zip(nums, weights))
    r = s % 11
    return 0 if r < 2 else 11 - r


def cpf(formatted: bool = True) -> str:
    n = [random.randint(0, 9) for _ in range(9)]
    while len(set(n)) == 1:
        n = [random.randint(0, 9) for _ in range(9)]
    n.append(_dv(n, list(range(10, 1, -1))))
    n.append(_dv(n, list(range(11, 1, -1))))
    s = "".join(map(str, n))
    return f"{s[:3]}.{s[3:6]}.{s[6:9]}-{s[9:]}" if formatted else s


def cnpj(formatted: bool = True) -> str:
    n = [random.randint(0, 9) for _ in range(8)] + [0, 0, 0, 1]
    n.append(_dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]))
    n.append(_dv(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]))
    s = "".join(map(str, n))
    if not formatted:
        return s
    return f"{s[:2]}.{s[2:5]}.{s[5:8]}/{s[8:12]}-{s[12:]}"


def validate_cpf(value: str) -> bool:
    d = [int(c) for c in value if c.isdigit()]
    if len(d) != 11 or len(set(d)) == 1:
        return False
    return (_dv(d[:9], list(range(10, 1, -1))) == d[9]
            and _dv(d[:10], list(range(11, 1, -1))) == d[10])


def validate_cnpj(value: str) -> bool:
    d = [int(c) for c in value if c.isdigit()]
    if len(d) != 14:
        return False
    return (_dv(d[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) == d[12]
            and _dv(d[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) == d[13])


def nome() -> str:
    return (f"{random.choice(_NOMES)} {random.choice(_SOBRENOMES)} "
            f"{random.choice(_SOBRENOMES)}")


def email(base: str | None = None) -> str:
    import unicodedata
    b = base or nome()
    b = unicodedata.normalize("NFKD", b).encode("ascii", "ignore").decode()
    b = ".".join(b.lower().split()[:2])
    return f"{b}{random.randint(10, 9999)}@teste.com.br"


def telefone() -> str:
    return f"({random.randint(11, 99)}) 9{random.randint(1000, 9999)}-{random.randint(1000, 9999)}"


def cep() -> str:
    return f"{random.randint(10000, 99999)}-{random.randint(0, 999):03d}"


def data(dias_min: int = -3650, dias_max: int = 0, fmt: str = "%d/%m/%Y") -> str:
    d = date.today() + timedelta(days=random.randint(dias_min, dias_max))
    return d.strftime(fmt)


def nascimento() -> str:
    return data(-365 * 70, -365 * 18)


def numero(minimo: int = 1, maximo: int = 99999) -> str:
    return str(random.randint(minimo, maximo))


def valor(minimo: float = 1, maximo: float = 10000) -> str:
    return f"{random.uniform(minimo, maximo):.2f}".replace(".", ",")


def texto(n: int = 10) -> str:
    return "".join(random.choices(string.ascii_uppercase, k=n))


def empresa() -> str:
    return f"{random.choice(_SOBRENOMES)} {random.choice(_EMPRESAS)} LTDA"


def endereco() -> str:
    return f"{random.choice(_RUAS)}, {random.randint(1, 3000)}"


def cidade() -> str:
    return random.choice(_CIDADES)[0]


def uf() -> str:
    return random.choice(_CIDADES)[1]


def placa() -> str:
    letras = "".join(random.choices(string.ascii_uppercase, k=3))
    return f"{letras}{random.randint(0, 9)}{random.choice(string.ascii_uppercase)}{random.randint(10, 99)}"


def rg() -> str:
    return f"{random.randint(10, 99)}.{random.randint(100, 999)}.{random.randint(100, 999)}-{random.randint(0, 9)}"


GENERATORS = {
    "cpf": ("CPF formatado", lambda: cpf(True)),
    "cpf_numeros": ("CPF só números", lambda: cpf(False)),
    "cnpj": ("CNPJ formatado", lambda: cnpj(True)),
    "cnpj_numeros": ("CNPJ só números", lambda: cnpj(False)),
    "nome": ("Nome completo", nome),
    "email": ("E-mail", email),
    "telefone": ("Telefone celular", telefone),
    "cep": ("CEP", cep),
    "rg": ("RG", rg),
    "data_hoje": ("Data de hoje", lambda: date.today().strftime("%d/%m/%Y")),
    "data_passada": ("Data passada (até 10 anos)", data),
    "data_futura": ("Data futura (até 1 ano)", lambda: data(1, 365)),
    "nascimento": ("Data de nascimento (18-70 anos)", nascimento),
    "numero": ("Número inteiro", numero),
    "valor": ("Valor monetário", valor),
    "texto": ("Texto aleatório", texto),
    "empresa": ("Razão social", empresa),
    "endereco": ("Endereço", endereco),
    "cidade": ("Cidade", cidade),
    "uf": ("UF", uf),
    "placa": ("Placa Mercosul", placa),
    "uuid": ("Identificador único", lambda: uuid.uuid4().hex[:12].upper()),
    "timestamp": ("Data/hora atual",
                  lambda: datetime.now().strftime("%d/%m/%Y %H:%M:%S")),
    "sequencial": ("Sequencial (usa nº da linha)", lambda: ""),
}


def generate(key: str, row_index: int = 0) -> str:
    key = (key or "").strip().lower()
    if key == "sequencial":
        return str(row_index + 1)
    if key.startswith("lista:"):
        opts = [o for o in key[6:].split("|") if o]
        return random.choice(opts) if opts else ""
    gen = GENERATORS.get(key)
    if not gen:
        raise KeyError(f"Gerador desconhecido: {key}")
    return gen[1]()


def guess_generator(name: str) -> str:
    """Sugere um gerador a partir do nome/rótulo do campo."""
    n = (name or "").lower()
    rules = [
        ("cnpj", "cnpj"), ("cpf", "cpf"), ("e-mail", "email"),
        ("email", "email"), ("telefone", "telefone"), ("celular", "telefone"),
        ("fone", "telefone"), ("cep", "cep"), ("nasc", "nascimento"),
        ("rg", "rg"), ("razao", "empresa"), ("razão", "empresa"),
        ("fantasia", "empresa"), ("empresa", "empresa"), ("nome", "nome"),
        ("endere", "endereco"), ("logradouro", "endereco"),
        ("cidade", "cidade"), ("municip", "cidade"), ("uf", "uf"),
        ("estado", "uf"), ("placa", "placa"), ("data", "data_hoje"),
        ("valor", "valor"), ("preco", "valor"), ("preço", "valor"),
        ("quant", "numero"), ("numero", "numero"), ("número", "numero"),
        ("codigo", "uuid"), ("código", "uuid"),
    ]
    for key, gen in rules:
        if key in n:
            return gen
    return ""
