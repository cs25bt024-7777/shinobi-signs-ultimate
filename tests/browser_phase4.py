"""Browser tests for Phase 4 (sign recognition UI) in real Chrome.

Run from the project root (game served on :8124):   python3 tests/browser_phase4.py

What is real: Chrome, getUserMedia (fake camera video), our Webcam / HandTracker / SignPipeline /
WebcamPanel / debug overlay code, real timers and frame loop.
What is faked: MediaPipe itself. The CDN URL is answered by tests/fixtures/mediapipe_stub.mjs, and
the "hands" are SYNTHETIC landmarks (tests/fixtures/syntheticHands.mjs) injected via window.__fake.raw.
So this checks wiring, UI text and timing — NOT recognition of real hands by real MediaPipe.
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://localhost:8124"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
STUB = os.path.join(ROOT, "tests/fixtures/mediapipe_stub.mjs")
Y4M = os.path.join(ROOT, "tests/fixtures/marker.y4m")
GLOB = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/vision_bundle.mjs*"
RAW = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "tests/make_sign_fixtures.mjs")]))

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{extra}]" if extra else ""), flush=True)


def inject(page, key):
    page.evaluate("r => { window.__fake.raw = r; }", RAW[key])


def sign_text(page):
    return page.inner_text(".cam-sign-value")


def wait_sign(page, text, timeout=3000):
    page.wait_for_function("t => document.querySelector('.cam-sign-value').textContent === t", arg=text, timeout=timeout)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True,
                          args=["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                f"--use-file-for-fake-video-capture={Y4M}"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    errors = []
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.add_init_script("window.__fake = { mode: 'none', busyMs: 0, failGpu: false };")
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    page.wait_for_function("window.__shinobi.handTracker.status === 'ready'", timeout=10000)

    # --- no hand ---
    time.sleep(0.4)
    check("no hand: 'NO HAND DETECTED' shown", page.inner_text(".cam-hand-text") == "NO HAND DETECTED")
    check("no hand: sign block hidden", not page.is_visible(".cam-sign"))

    # --- each sign ---
    events = []
    page.evaluate("() => { window.__events = []; window.__shinobi.signPipeline.onSign(s => window.__events.push([s.newSign, Math.round(s.confidence * 100)])); }")
    for name, icon in [("SNAKE", "🐍"), ("TIGER", "🐯"), ("HORSE", "🐴"), ("RAM", "🐏")]:
        inject(page, name)
        try:
            wait_sign(page, f"{icon} {name}")
            ok = True
        except Exception:
            ok = False
        check(f"{name}: panel shows '{icon} {name}'", ok, sign_text(page))
        check(f"{name}: 'HAND DETECTED ✓' and confidence shown", page.inner_text(".cam-hand-text") == "HAND DETECTED ✓" and page.inner_text(".cam-sign-conf").endswith("%"), page.inner_text(".cam-sign-conf"))
        check(f"{name}: HUD player-1 sign panel updated", page.inner_text("#sign-0 .sign-value") == name)
        time.sleep(0.8)  # hold: must not produce repeat events
    ev = page.evaluate("window.__events")
    check("holding each sign ~1 s: exactly one event per sign, in order", [e[0] for e in ev] == ["SNAKE", "TIGER", "HORSE", "RAM"], str(ev))

    # --- unknown ---
    inject(page, "FIST")
    try: wait_sign(page, "UNKNOWN"); ok = True
    except Exception: ok = False
    check("fist: panel shows UNKNOWN (hand still detected)", ok and page.inner_text(".cam-hand-text") == "HAND DETECTED ✓" and page.inner_text(".cam-sign-conf") == "—")
    check("fist: no extra sign event", len(page.evaluate("window.__events")) == 4)

    # --- no hand again ---
    inject(page, "NONE")
    page.wait_for_function("document.querySelector('.cam-hand-text').textContent === 'NO HAND DETECTED'", timeout=3000)
    check("hand removed: NO HAND DETECTED, sign block hidden", not page.is_visible(".cam-sign"))

    # --- two hands ---
    inject(page, "TWO")
    try: wait_sign(page, "🐯 TIGER"); ok = True
    except Exception: ok = False
    check("two hands both TIGER: recognised", ok and page.inner_text(".cam-hand-detail") == "L + R")

    # --- flicker immunity in the real loop: alternate poses faster than the hold time ---
    before = len(page.evaluate("window.__events"))
    for _ in range(6):
        inject(page, "SNAKE"); time.sleep(0.06)
        inject(page, "FIST"); time.sleep(0.06)
    inject(page, "TWO")
    time.sleep(0.5)
    check("rapid SNAKE/FIST flicker (60 ms each) registers no SNAKE event", all(e[0] != "SNAKE" for e in page.evaluate("window.__events")[before:]))

    # --- debug overlay ---
    check("debug overlay hidden by default (CONFIG.signs.debug = false)", not page.is_visible("#sign-debug"))
    page.keyboard.press("d")
    page.wait_for_selector("#sign-debug", state="visible", timeout=2000)
    txt = page.inner_text("#sign-debug")
    check("[D] shows overlay with CURRENT SIGN / CONFIDENCE / curls", "CURRENT SIGN:" in txt and "CONFIDENCE:" in txt and "Index curl" in txt and "Palm tilt" in txt, txt.splitlines()[0])
    page.keyboard.press("d")
    check("[D] again hides it", not page.is_visible("#sign-debug"))
    page.screenshot(path=os.path.join(os.environ.get("SHOT_DIR", "/tmp"), "phase4_ui.png"))

    # --- Phase 1 debug keys still work ---
    page.keyboard.press("1")
    check("Phase 1: key [1] still damages P1", "90" in page.inner_text("#hp-0 .hp-text"))
    page.keyboard.press("r")
    check("no page errors / console errors", not errors, "; ".join(errors[:3]))

    # --- debug via URL ---
    page2 = ctx.new_page()
    page2.add_init_script("window.__fake = { mode: 'none', busyMs: 0, failGpu: false };")
    page2.goto(BASE + "/?debug=signs")
    page2.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    check("?debug=signs enables the overlay from the start", page2.is_visible("#sign-debug"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("FAILED:\n  - " + "\n  - ".join(failed))
    sys.exit(1)
