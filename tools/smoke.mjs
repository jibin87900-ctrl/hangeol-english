// 앱 자동 점검: 화면이 뜨는지, 레슨을 처음부터 끝까지 풀 수 있는지, 탭이 다 열리는지 확인한다.
// 하나라도 실패하면 exit 1. 사용: node tools/smoke.mjs
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const extra = fs.readFileSync(path.join(ROOT, "content", "extra.json"), "utf8");
const problems = [];

const vc = new VirtualConsole();
vc.on("jsdomError", e => problems.push("페이지 오류: " + ((e.detail && e.detail.stack) || e.stack || e.message)));
vc.on("error", (...a) => problems.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  url: "https://example.test/hangeol-english/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return []; }, onvoiceschanged: null };
    w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = function () {};
    if (!w.CSS) w.CSS = {};
    if (!w.CSS.escape) w.CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => "\\" + c);
    w.fetch = async u => String(u).includes("content/extra.json")
      ? { ok: true, text: async () => extra }
      : { ok: false, text: async () => "" };
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  }
});

const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => d.querySelector(s);
const esc = s => w.CSS.escape(String(s));
function click(el, what) {
  if (!el) throw new Error("클릭할 요소 없음: " + what);
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const check = (cond, msg) => { if (!cond) problems.push(msg); };

async function solve(wrongOnce) {
  const H = w.__hg;
  let wrongDone = !wrongOnce;
  for (let i = 0; i < 300; i++) {
    const L = H.L;
    if (!L) throw new Error("레슨이 열리지 않음");
    if (L.phase === "finish") return;
    if (L.phase === "feedback" || L.phase === "intro") { click($("#ls-main"), "계속 버튼"); await sleep(3); continue; }
    const st = L.queue[0];
    if (!st) throw new Error("문제가 비었는데 레슨이 끝나지 않음");
    const pick = v => click(d.querySelector(`#ls-in [data-act="pick"][data-v="${esc(v)}"]`), "보기 " + v);
    if (st.t === "pickEn" || st.t === "pickKo" || st.t === "listen") {
      if (!wrongDone) {
        click([...d.querySelectorAll('#ls-in [data-act="pick"]')].find(b => b.dataset.v !== st.w.id), "오답 보기");
        wrongDone = true;
      } else pick(st.w.id);
      click($("#ls-main"), "확인");
    } else if (st.t === "gram") {
      pick(st.q.a); click($("#ls-main"), "확인");
    } else if (st.t === "match") {
      for (const x of st.ws) {
        click(d.querySelector(`#ls-in [data-act="m"][data-side="l"][data-id="${esc(x.id)}"]`), "짝 왼쪽 " + x.en);
        click(d.querySelector(`#ls-in [data-act="m"][data-side="r"][data-id="${esc(x.id)}"]`), "짝 오른쪽 " + x.ko);
      }
      await sleep(450);
      continue;
    } else if (st.t === "build" || st.t === "listenBuild") {
      const want = st.s.en.replace(/[.?!,]+/g, " ").split(/\s+/).filter(Boolean);
      for (const t of want) {
        click([...d.querySelectorAll('#bank [data-act="bank"]')].find(b => b.textContent === t), `문장 블록 '${t}' (${st.s.en})`);
      }
      click($("#ls-main"), "확인");
    } else if (st.t === "speak" || st.t === "type") {
      const tx = $("#ls-text");
      tx.value = st.t === "speak" ? st.s.en : st.w.en;
      tx.dispatchEvent(new w.Event("input", { bubbles: true }));
      click($("#ls-main"), "확인");
    } else throw new Error("모르는 문제 유형: " + st.t);
    await sleep(3);
    if (H.L && H.L.phase === "answer" && H.L.queue[0] === st) throw new Error("확인을 눌러도 반응이 없음: " + st.t);
  }
  const L = H.L;
  throw new Error(`레슨이 300단계 안에 끝나지 않음 (phase=${L && L.phase}, 남은 문제=${L && L.queue.map(s => s.t).join(",")}, 진행=${L && L.doneN}/${L && L.total})`);
}

async function runNode(id) {
  click(d.querySelector(`.node[data-id="${esc(id)}"]`), "지도 노드 " + id);
  await sleep(3);
  await solve(id.endsWith("-l1"));
  check(w.__hg.S.nodes[id], "단계 완료가 저장되지 않음: " + id);
  if (id.endsWith("-l1")) check(d.querySelector("#ls-in .miss-list .miss-item"), "결과 화면에 틀린 단어 목록이 없음: " + id);
  click($("#ls-main"), "결과 화면 계속");
  await sleep(3);
  check($("#lesson").hidden, "레슨 화면이 닫히지 않음: " + id);
}

try {
  await sleep(80);
  check(w.__hg && w.__hg.S, "테스트 훅(window.__hg)이 없음");
  check(d.querySelectorAll(".node").length >= 80, "학습 지도 노드가 부족함");
  const data = JSON.parse(extra);
  const units = data.units || [];
  for (const u of units.slice(-3)) {
    check(d.querySelector(`.node[data-id="${esc(u.id)}-l1"]`), "매일 단원이 지도에 없음: " + u.id);
  }
  for (const k of ["l1", "l2", "l3", "l4", "r"]) await runNode("u0-" + k);
  for (const u of units.slice(-2)) for (const k of ["l1", "l2", "l3", "l4", "r"]) await runNode(u.id + "-" + k);

  check(/약한 단어 복습 · \d+개/.test(d.querySelector('[data-act="weak"]').textContent), "약한 단어 복습 버튼에 단어 개수가 없음");
  click(d.querySelector('[data-act="weak"]'), "약한 단어 복습");
  await sleep(3); await solve(false);
  click($("#ls-main"), "복습 결과 계속"); await sleep(3);

  if (data.expressions && data.expressions.length > 1) {
    const past = d.querySelector("#v-learn .expr-past");
    check(past && past.querySelectorAll('[data-act="say"]').length >= 1, "지난 표현 다시 보기 목록이 없음");
  }
  const xq = d.querySelector('[data-act="xq"]');
  if (xq) { click(xq, "오늘의 표현 퀴즈"); await sleep(3); }

  if (w.__hg.S.day.goalMet) {
    const bub = d.querySelector("#v-learn .hero .bubble");
    check(bub && /목표|해냈어요|오늘 몫|멋져요|최고예요/.test(bub.textContent), "목표 달성 문구가 없음");
  }
  for (const v of ["chat", "words", "me", "learn"]) {
    click(d.querySelector(`.tab[data-v="${v}"]`), "탭 " + v); await sleep(3);
    check(!$("#v-" + v).hidden && $("#v-" + v).innerHTML.trim().length > 50, "탭 화면이 비어 있음: " + v);
  }
  check(JSON.parse(w.localStorage.getItem("hangeol-english-app") || "{}").v === 2, "공부 기록이 저장되지 않음");

  // 백업 알림 카드 → 백업 코드 창
  click(d.querySelector('#v-learn [data-act="backup"]'), "백업 알림 카드");
  await sleep(3);
  check(w.__hg.S.lastBackup, "백업한 날짜가 저장되지 않음");
  if (!$("#sheet-wrap").hidden) { click(d.querySelector('[data-act="sheet-close"]'), "백업 창 닫기"); await sleep(3); }
  check(!d.querySelector('#v-learn [data-act="backup"]'), "백업 후에도 알림 카드가 남아 있음");

  // 여기로 건너뛰기
  const before = Object.keys(w.__hg.S.nodes).length;
  const skips = d.querySelectorAll('[data-act="skip-ask"]');
  check(skips.length > 0, "건너뛰기 버튼이 없음");
  click(skips[1] || skips[0], "건너뛰기 버튼"); await sleep(3);
  click(d.querySelector('[data-act="skip-yes"]'), "건너뛰기 확인"); await sleep(3);
  check(Object.keys(w.__hg.S.nodes).length > before, "건너뛰기 후 완료 단계가 늘지 않음");
  check($("#sheet-wrap").hidden, "건너뛰기 창이 닫히지 않음");
  const cur = d.querySelector(".node.cur");
  check(cur && !d.querySelector(`.unit-banner [data-act="skip-ask"][data-u="0"]`), "건너뛴 뒤 앞 단원에 건너뛰기 버튼이 남음");
} catch (e) {
  problems.push(e.stack || String(e));
}

if (problems.length) {
  console.log("앱 점검 실패:");
  problems.forEach(p => console.log(" - " + p));
  process.exit(1);
}
console.log("앱 점검 통과: 지도, 기본 단원 5단계, 매일 단원, 복습, 오늘의 표현, 탭 4개");
process.exit(0);
