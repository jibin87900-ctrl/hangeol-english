"""content/extra.json 품질 검사. 오류가 하나라도 있으면 exit 1.

사용: python tools/validate.py
"""
import json, re, sys, pathlib

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
errors, warnings = [], []
err = errors.append
warn = warnings.append

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EN = re.compile(r"^[A-Za-z][A-Za-z '\-]*$")
HANGUL = re.compile(r"[가-힣]")
ALLOWED_TAGS = re.compile(r"</?b>|<br>")


def toks(s):
    return [t for t in re.split(r"\s+", re.sub(r"[.?!,]+", " ", s)) if t]


def pair_list(v, where, need=1):
    if not isinstance(v, list) or len(v) < need:
        err(f"{where}: 예문이 {need}개 이상 필요")
        return
    for i, p in enumerate(v):
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) and x.strip() for x in p)):
            err(f"{where}[{i}]: [영어, 한국어] 쌍이어야 함")
        elif not HANGUL.search(p[1]):
            err(f"{where}[{i}]: 한국어 해석이 없음")


def quiz(q, where, blank):
    if not isinstance(q, dict):
        err(f"{where}: 퀴즈 객체가 아님"); return
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        err(f"{where}: 문제(q)가 비어 있음")
    elif blank and q["q"].count("___") != 1:
        err(f"{where}: 빈칸 ___ 이 정확히 1개여야 함")
    o = q.get("o")
    if not (isinstance(o, list) and 2 <= len(o) <= 4 and all(isinstance(x, str) and x.strip() for x in o)):
        err(f"{where}: 보기(o)는 2~4개 문자열")
    elif len({x.strip().lower() for x in o}) != len(o):
        err(f"{where}: 보기가 중복됨")
    if not (isinstance(q.get("a"), int) and isinstance(o, list) and 0 <= q["a"] < len(o)):
        err(f"{where}: 정답 번호(a)가 보기 범위를 벗어남")


# 기본 단어 (index.html 안의 WORD_UNITS)
html = (ROOT / "index.html").read_text(encoding="utf8")
base_words = set()
for _, block in re.findall(r'\["([^"]+)", `(.*?)`\]', html, re.S):
    for line in block.strip().split("\n"):
        base_words.add(line.split("|")[0].strip().lower())
if len(base_words) < 150:
    err("index.html에서 기본 단어를 읽지 못함")

try:
    data = json.loads((ROOT / "content" / "extra.json").read_text(encoding="utf8"))
except Exception as e:
    print("ERROR content/extra.json 을 읽을 수 없음:", e); sys.exit(1)

for key in ("units", "grammar", "expressions"):
    if not isinstance(data.get(key), list):
        err(f"최상위 '{key}' 배열이 없음")
units, grammar, exprs = data.get("units", []), data.get("grammar", []), data.get("expressions", [])

seen_words = set(base_words)
unit_dates, names = set(), set()
for ui, u in enumerate(units):
    w0 = f"units[{ui}]"
    d = u.get("date", "")
    if not DATE.match(d):
        err(f"{w0}: date 형식 오류"); continue
    if d in unit_dates:
        err(f"{w0}: {d} 단원이 이미 있음")
    unit_dates.add(d)
    if u.get("id") != "d" + d.replace("-", ""):
        err(f"{w0}: id는 'd{d.replace('-', '')}' 이어야 함")
    name = u.get("name", "")
    if not (isinstance(name, str) and HANGUL.search(name) and len(name) <= 14):
        err(f"{w0}: name은 14자 이하 한국어 주제명")
    if name in names:
        err(f"{w0}: 주제 '{name}' 중복")
    names.add(name)
    roles = u.get("roles")
    if not (isinstance(roles, dict) and roles.get("A") and roles.get("B")):
        err(f"{w0}: roles {{A, B}} 필요")
    words = u.get("words")
    if not (isinstance(words, list) and len(words) == 10):
        err(f"{w0}: 단어는 정확히 10개"); words = words if isinstance(words, list) else []
    for wi, w in enumerate(words):
        ww = f"{w0}.words[{wi}]"
        en = str(w.get("en", "")).strip()
        if not EN.match(en) or len(en.split()) > 3:
            err(f"{ww}: en '{en}'은 영어 단어/짧은 구(3단어 이하)여야 함")
        if en.lower() in seen_words:
            err(f"{ww}: '{en}'은 이미 있는 단어")
        seen_words.add(en.lower())
        if not HANGUL.search(str(w.get("ko", ""))):
            err(f"{ww}: ko 한국어 뜻 없음")
        ex = str(w.get("ex", ""))
        n = len(toks(ex))
        if not (3 <= n <= 9):
            err(f"{ww}: 예문은 3~9단어 ({n}단어)")
        stem = en.lower().split()[0][:4]
        if stem not in ex.lower():
            warn(f"{ww}: 예문에 '{en}'이 안 보임 → 확인")
        if not HANGUL.search(str(w.get("exKo", ""))):
            err(f"{ww}: exKo 예문 해석 없음")
        emo = str(w.get("emo", ""))
        if not emo or emo.isascii() or len(emo) > 8:
            err(f"{ww}: emo 이모지 1개 필요")
    dialog = u.get("dialog")
    if not (isinstance(dialog, list) and 4 <= len(dialog) <= 8):
        err(f"{w0}: dialog는 4~8줄")
        dialog = []
    for li, l in enumerate(dialog):
        if l.get("who") not in ("A", "B"):
            err(f"{w0}.dialog[{li}]: who는 A 또는 B")
        if not str(l.get("en", "")).strip() or len(toks(l.get("en", ""))) > 12:
            err(f"{w0}.dialog[{li}]: en은 12단어 이하")
        if not HANGUL.search(str(l.get("ko", ""))):
            err(f"{w0}.dialog[{li}]: ko 해석 없음")

g_dates = set()
for gi, g in enumerate(grammar):
    w0 = f"grammar[{gi}]"
    d = g.get("date", "")
    if d not in unit_dates:
        err(f"{w0}: 같은 날짜({d})의 단원이 없음")
    if d in g_dates:
        err(f"{w0}: {d} 문법이 이미 있음")
    g_dates.add(d)
    for k in ("t", "s", "b"):
        if not (isinstance(g.get(k), str) and g[k].strip()):
            err(f"{w0}: {k} 비어 있음")
    leftover = ALLOWED_TAGS.sub("", g.get("b", ""))
    if "<" in leftover or ">" in leftover:
        err(f"{w0}: b에는 <b>, </b>, <br> 태그만 허용 (→ 화살표는 '→' 문자 사용)")
    pair_list(g.get("ex"), f"{w0}.ex", 3)
    qz = g.get("qz")
    if not (isinstance(qz, list) and len(qz) == 3):
        err(f"{w0}: qz는 3문제")
    else:
        for qi, q in enumerate(qz):
            quiz(q, f"{w0}.qz[{qi}]", True)

e_dates, e_ens = set(), set()
for ei, e in enumerate(exprs):
    w0 = f"expressions[{ei}]"
    d = e.get("date", "")
    if not DATE.match(d):
        err(f"{w0}: date 형식 오류")
    if d in e_dates:
        err(f"{w0}: {d} 표현이 이미 있음")
    e_dates.add(d)
    en = str(e.get("en", "")).strip()
    if not en:
        err(f"{w0}: en 비어 있음")
    if en.lower() in e_ens:
        err(f"{w0}: '{en}' 표현 중복")
    e_ens.add(en.lower())
    if not HANGUL.search(str(e.get("ko", ""))) or not HANGUL.search(str(e.get("note", ""))):
        err(f"{w0}: ko와 note(언제 쓰는지)는 한국어로")
    pair_list(e.get("ex"), f"{w0}.ex", 2)
    quiz(e.get("quiz"), f"{w0}.quiz", False)

for w in warnings:
    print("WARN ", w)
for e in errors:
    print("ERROR", e)
print(f"단원 {len(units)} · 문법 {len(grammar)} · 표현 {len(exprs)} · 경고 {len(warnings)} · 오류 {len(errors)}")
sys.exit(1 if errors else 0)
