"""Phase 2 regression (webcam states) – re-run after Phase 3. Run: python3 tests/browser_phase2.py
Uses the MediaPipe stub from tests/fixtures so the hand tracker needs no internet."""
"""Browser tests for Phase 2 (webcam). Uses real Chrome with Chrome's built-in fake camera."""
import subprocess, sys
from playwright.sync_api import sync_playwright

PORT = 8124
BASE = f"http://localhost:{PORT}"
import os
OUT = os.environ.get("SHOT_DIR", "/tmp")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUB = os.path.join(ROOT, "tests/fixtures/mediapipe_stub.mjs")
MODULE_GLOB = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/vision_bundle.mjs*"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{extra}]" if extra else ""), flush=True)


def launch(p, args):
    return p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"] + args)


def new_page(ctx, errors):
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text + " @ " + m.location.get("url", "")) if m.type == "error" else None)
    return page


def state(page):
    return page.get_attribute("#webcam-panel", "data-state")


def status(page):
    return page.inner_text(".cam-status-text")


def overlay(page):
    return page.inner_text(".cam-overlay-title"), page.inner_text(".cam-overlay-hint")


def retry_visible(page):
    return page.is_visible(".cam-retry")


with sync_playwright() as p:
    # ---------------------------------------------------------------- 1. connected
    print("\n== 1. Fake camera, permission granted ==")
    b = launch(p, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(MODULE_GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    errors = []
    page = new_page(ctx, errors)
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    check("state becomes 'connected'", state(page) == "connected")
    check("status text is CAMERA: CONNECTED", status(page) == "CAMERA: CONNECTED", status(page))
    check("overlay hidden when connected", not page.is_visible(".cam-overlay"))
    check("retry hidden when connected", not retry_visible(page))

    info = page.eval_on_selector("#webcam-panel video", "v=>({w:v.videoWidth,h:v.videoHeight,rs:v.readyState,paused:v.paused})")
    check("video has real frames (dimensions > 0)", info["w"] > 0 and info["h"] > 0, str(info))
    t1 = page.eval_on_selector("#webcam-panel video", "v=>v.currentTime")
    page.wait_for_timeout(800)
    t2 = page.eval_on_selector("#webcam-panel video", "v=>v.currentTime")
    check("video is actually playing (currentTime advances)", t2 > t1, f"{t1:.2f} -> {t2:.2f}")
    tf = page.eval_on_selector("#webcam-panel video", "v=>getComputedStyle(v).transform")
    check("preview is mirrored horizontally (scaleX(-1))", tf == "matrix(-1, 0, 0, 1, 0, 0)", tf)
    tracks = page.eval_on_selector("#webcam-panel video", "v=>({video:v.srcObject.getVideoTracks().length,audio:v.srcObject.getAudioTracks().length})")
    check("only a video track is requested (no microphone)", tracks == {"video": 1, "audio": 0}, str(tracks))

    # Layout: panel must not overlap the fighters or other HUD pieces.
    overlaps = page.evaluate("""()=>{
      const r = s => document.querySelector(s).getBoundingClientRect();
      const a = r('#webcam-panel');
      const hit = (b)=> !(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
      const stage = r('#stage');
      const f = (x)=> stage.left + x/1280*stage.width;       // canvas px -> screen px
      const fy = (y)=> stage.top + y/720*stage.height;
      // P1 (x=340, feet y=630, scale 1.3): head/body/label column, and the scarf that trails behind (starts ~y=395)
      const p1body = {left:f(290), right:f(440), top:fy(270), bottom:fy(640)};
      const p1scarf = {left:f(205), right:f(300), top:fy(385), bottom:fy(640)};
      return {
        sign0: hit(r('#sign-0')), seq: hit(r('#sequence')), hp0: hit(r('#hp-0')),
        status: hit(r('#status')), p1box: hit(p1body) || hit(p1scarf),
        insideStage: a.left>=stage.left && a.right<=stage.right && a.top>=stage.top && a.bottom<=stage.bottom
      };}""")
    check("webcam panel doesn't overlap HP/sign/sequence/status panels or P1", not any(overlaps[k] for k in ["sign0", "seq", "hp0", "status", "p1box"]) and overlaps["insideStage"], str(overlaps))

    # Phase 1 regression
    hp0 = lambda: page.inner_text("#hp-0 .hp-text")
    hp1 = lambda: page.inner_text("#hp-1 .hp-text")
    page.keyboard.press("1"); page.keyboard.press("2"); page.keyboard.press("2")
    check("Phase 1 keys still work (1 hits P1, 2 hits P2)", hp0() == "90 HP" and hp1() == "80 HP", f"{hp0()} / {hp1()}")
    page.keyboard.press("r")
    check("Phase 1 reset key works", hp0() == "100 HP" and hp1() == "100 HP")
    check("canvas renders (non-blank)", page.evaluate("""()=>{const c=document.getElementById('game');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s=0;for(let i=0;i<d.length;i+=400)s+=d[i]+d[i+1]+d[i+2];return s>1000;}"""))
    page.screenshot(path=f"{OUT}/shot_connected.png")

    # Camera unplugged mid-game (simulate the track 'ended' event)
    page.evaluate("()=>document.querySelector('#webcam-panel video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))")
    page.wait_for_selector('#webcam-panel[data-state="unavailable"]', timeout=3000)
    check("camera disconnect -> 'unavailable', CAMERA: NOT AVAILABLE", status(page) == "CAMERA: NOT AVAILABLE" and "disconnected" in overlay(page)[1], str(overlay(page)))
    check("retry button shown after disconnect", retry_visible(page))
    page.click(".cam-retry")
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    check("retry reconnects the camera", state(page) == "connected")
    check("no JS errors during connected run", not errors, "; ".join(errors))
    b.close()

    # ---------------------------------------------------------------- 2. denied -> retry
    print("\n== 2. Permission denied, then granted + retry ==")
    b = launch(p, ["--use-fake-device-for-media-stream", "--deny-permission-prompts"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(MODULE_GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    errors = []
    page = new_page(ctx, errors)
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="denied"]', timeout=10000)
    check("state becomes 'denied'", state(page) == "denied")
    check("status is CAMERA: NOT AVAILABLE", status(page) == "CAMERA: NOT AVAILABLE", status(page))
    check("overlay says PERMISSION DENIED", overlay(page)[0] == "PERMISSION DENIED", str(overlay(page)))
    check("retry button visible", retry_visible(page))
    page.screenshot(path=f"{OUT}/shot_denied.png")
    check("game still runs while denied (keys work)", (page.keyboard.press("1") or True) and page.inner_text("#hp-0 .hp-text") == "90 HP")
    ctx.grant_permissions(["camera"])
    page.click(".cam-retry")
    try:
        page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=8000)
        check("after granting permission, retry connects", True)
    except Exception:
        check("after granting permission, retry connects", False, f"state={state(page)}")
    b.close()

    # ---------------------------------------------------------------- 3. no camera
    print("\n== 3. No camera hardware ==")
    b = launch(p, ["--use-fake-ui-for-media-stream"])  # note: NO fake device
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(MODULE_GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    errors = []
    page = new_page(ctx, errors)
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel:not([data-state="requesting"]):not([data-state="idle"])', timeout=10000)
    check("state becomes 'no-device'", state(page) == "no-device", state(page))
    check("overlay says NO CAMERA DETECTED", overlay(page)[0] == "NO CAMERA DETECTED", str(overlay(page)))
    check("status is CAMERA: NOT AVAILABLE", status(page) == "CAMERA: NOT AVAILABLE")
    check("retry visible", retry_visible(page))
    page.screenshot(path=f"{OUT}/shot_nodevice.png")
    b.close()

    # ---------------------------------------------------------------- 4. insecure origin
    print("\n== 4. Insecure origin (plain http on a non-localhost host) ==")
    ip = subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout.split()[0]
    b = launch(p, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(MODULE_GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    errors = []
    page = new_page(ctx, errors)
    page.goto(f"http://{ip}:{PORT}")
    page.wait_for_selector('#webcam-panel:not([data-state="idle"])', timeout=10000)
    check(f"http://{ip} -> 'unavailable'", state(page) == "unavailable", state(page))
    check("hint explains localhost/https is needed", "localhost" in overlay(page)[1], overlay(page)[1])
    b.close()

    # ---------------------------------------------------------------- 5. requesting
    print("\n== 5. Permission prompt pending ==")
    b = launch(p, ["--use-fake-device-for-media-stream"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.route(MODULE_GLOB, lambda r: r.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"}))
    ctx.add_init_script("navigator.mediaDevices.getUserMedia = () => new Promise(() => {});")
    errors = []
    page = new_page(ctx, errors)
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="requesting"]', timeout=5000)
    check("state is 'requesting' while prompt is open", state(page) == "requesting")
    check("status is CAMERA: REQUESTING…", status(page) == "CAMERA: REQUESTING…", status(page))
    check("overlay asks user to allow", "PERMISSION" in overlay(page)[0], overlay(page)[0])
    page.screenshot(path=f"{OUT}/shot_requesting.png")
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("FAILED:", *failed, sep="\n  - ")
    sys.exit(1)
