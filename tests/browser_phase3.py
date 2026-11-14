"""Browser tests for Phase 3 (hand tracking) in real Chrome.

Run from the project root:   python3 tests/browser_phase3.py

What is real: Chrome, getUserMedia with a fake camera playing tests/fixtures/marker.y4m
(a magenta square on the LEFT of the raw frame), our Webcam / HandTracker /
MediaPipeHandBackend / WebcamPanel / game loop code.
What is faked: @mediapipe/tasks-vision itself (the sandbox has no internet). The CDN URL is
intercepted and answered by tests/fixtures/mediapipe_stub.mjs, which has the same API shape and
places a hand on the marker it finds in the real video pixels. So these tests do NOT measure
MediaPipe's accuracy or speed.
"""
import base64, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8124
BASE = f"http://localhost:{PORT}"
OUT = os.environ.get("SHOT_DIR", "/tmp")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
STUB = os.path.join(ROOT, "tests/fixtures/mediapipe_stub.mjs")
Y4M = os.path.join(ROOT, "tests/fixtures/marker.y4m")
MODULE_GLOB = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/vision_bundle.mjs*"

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{extra}]" if extra else ""), flush=True)


def serve_stub(route):
    route.fulfill(path=STUB, content_type="text/javascript", headers={"access-control-allow-origin": "*"})


def launch(p, camera=True):
    args = ["--no-sandbox", "--use-fake-ui-for-media-stream"]
    if camera:
        args += ["--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={Y4M}"]
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(b, init=None, stub=True, dsf=1):
    ctx = b.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=dsf)
    if init:
        ctx.add_init_script(init)
    if stub:
        ctx.route(MODULE_GLOB, serve_stub)
    errors = []
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    return ctx, page, errors


def hand_text(page):
    return page.inner_text(".cam-hand-text")


def wait_text(page, text, timeout=5000):
    page.wait_for_function("t => document.querySelector('.cam-hand-text').textContent === t", arg=text, timeout=timeout)


def set_mode(page, mode):
    return page.evaluate("m => { window.__fake.mode = m; return performance.now(); }", mode)


def ready(page):
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    page.wait_for_function("window.__shinobi.handTracker.status === 'ready'", timeout=10000)


def latest(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__shinobi.handTracker.latest))")


def analyze(page, png):
    """Count/locate magenta (video marker), orange (Right hand overlay), cyan (Left hand overlay) pixels."""
    return page.evaluate(
        """async (b64) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const acc = { mag: [0, 0, 0], org: [0, 0, 0], cyan: [0, 0, 0] };
          for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
            const i = (y * c.width + xx) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
            let k = null;
            if (r > 170 && b > 170 && g < 110) k = 'mag';
            else if (r > 220 && g > 140 && g < 215 && b < 130) k = 'org';
            else if (r < 130 && g > 170 && b > 200) k = 'cyan';
            if (k) { acc[k][0]++; acc[k][1] += xx; acc[k][2] += y; }
          }
          const out = { w: c.width, h: c.height };
          for (const k in acc) { const [n, sx, sy] = acc[k];
            out[k] = { n, x: n ? sx / n / c.width : null, y: n ? sy / n / c.height : null }; }
          return out;
        }""",
        base64.b64encode(png).decode(),
    )


with sync_playwright() as p:
    # ================================================================== A. main suite
    print("\n== A1. Startup: real MediaPipeHandBackend code against the API-shaped stub ==")
    b = launch(p)
    ctx, page, errors = new_page(b, dsf=2)
    page.goto(BASE)
    ready(page)
    st = page.evaluate("() => ({ created: window.__stub.created, wasm: window.__stub.forVisionTasks, tr: window.__shinobi.handTracker.status })")
    o = st["created"][0] if st["created"] else {}
    check("backend loads the module from the pinned CDN URL and creates a HandLandmarker", len(st["created"]) == 1 and st["tr"] == "ready")
    check("options: VIDEO mode, numHands=2, GPU delegate first, model URL passed",
          o.get("runningMode") == "VIDEO" and o.get("numHands") == 2 and o["baseOptions"]["delegate"] == "GPU"
          and o["baseOptions"]["modelAssetPath"].endswith("hand_landmarker.task"), str(o))
    check("wasm base URL is passed to FilesetResolver", st["wasm"] and st["wasm"][0].endswith("/wasm"), str(st["wasm"]))
    check("requestVideoFrameCallback is available (and is what the loop prefers)",
          page.evaluate("() => typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function'"))

    print("\n== A2. No hand / hand entering / hand leaving ==")
    set_mode(page, "none")
    wait_text(page, "NO HAND DETECTED")
    f = latest(page)
    check("no hand → 'NO HAND DETECTED', hasHand=false, hands=[]", hand_text(page) == "NO HAND DETECTED" and not f["hasHand"] and f["hands"] == [])
    check("panel data-hand='none'", page.get_attribute("#webcam-panel", "data-hand") == "none")

    page.evaluate("""() => { window.__tl = [];
      new MutationObserver(() => window.__tl.push([performance.now(), document.querySelector('.cam-hand-text').textContent]))
        .observe(document.querySelector('.cam-hand-text'), { childList: true, characterData: true, subtree: true }); }""")
    t_enter = set_mode(page, "marker")
    wait_text(page, "HAND DETECTED ✓")
    changes = page.evaluate("""() => { const o = []; let last = null; for (const [t, s] of window.__tl) if (s !== last) { o.push([t, s]); last = s; } return o; }""")
    enter_ms = [t for t, s in changes if s == "HAND DETECTED ✓"][0] - t_enter
    check("hand enters → 'HAND DETECTED ✓' within 500 ms", enter_ms < 500, f"{enter_ms:.0f} ms")
    check("indicator detail says RIGHT", page.inner_text(".cam-hand-detail") == "RIGHT", page.inner_text(".cam-hand-detail"))
    check("panel data-hand='detected'", page.get_attribute("#webcam-panel", "data-hand") == "detected")

    page.wait_for_timeout(300)
    f = latest(page)
    h = f["hands"][0] if f["hands"] else None
    check("one hand: exactly 21 landmarks with finite x/y/z", h and len(h["landmarks"]) == 21 and all(
        all(isinstance(pt[k], (int, float)) for k in "xyz") for pt in h["landmarks"]))
    check("one hand: 21 world landmarks, handedness 'Right', score kept", h and len(h["worldLandmarks"]) == 21 and h["handedness"] == "Right" and h["score"] > 0.9)
    check("one hand: .right set, .left null, rawHandCount=1, not stale", f["right"] and f["left"] is None and f["rawHandCount"] == 1 and not h["stale"])
    cx = sum(pt["x"] for pt in h["landmarks"]) / 21
    cy = sum(pt["y"] for pt in h["landmarks"]) / 21
    check("landmarks are in raw CAMERA space: marker on the LEFT of the raw frame → x≈0.2, y≈0.5",
          abs(cx - 0.2) < 0.03 and abs(cy - 0.5) < 0.03, f"centroid=({cx:.3f},{cy:.3f})")
    check("frame carries the real video size (640×480)", f["videoWidth"] == 640 and f["videoHeight"] == 480, f"{f['videoWidth']}x{f['videoHeight']}")

    t_leave = set_mode(page, "none")
    page.wait_for_timeout(100)
    mid = latest(page)
    check("hand leaves: still shown 100 ms later (debounce) and flagged stale", hand_text(page) == "HAND DETECTED ✓" and mid["hands"] and mid["hands"][0]["stale"], hand_text(page))
    wait_text(page, "NO HAND DETECTED")
    changes = page.evaluate("""() => { const o = []; let last = null; for (const [t, s] of window.__tl) if (s !== last) { o.push([t, s]); last = s; } return o; }""")
    gone_ms = [t for t, s in changes if s == "NO HAND DETECTED"][-1] - t_leave
    check("hand leaves → 'NO HAND DETECTED' after the 250 ms hold (200–600 ms)", 200 <= gone_ms <= 600, f"{gone_ms:.0f} ms")
    check("after leaving: hasHand=false, hands=[]", not latest(page)["hasHand"] and latest(page)["hands"] == [])
    page.wait_for_timeout(200)
    alpha = page.evaluate("() => { const c = document.querySelector('.cam-landmarks'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; }")
    check("landmark overlay is cleared when the hand is gone", alpha == 0, f"alpha sum={alpha}")

    print("\n== A3. Debounce against brief dropouts ==")
    set_mode(page, "marker"); wait_text(page, "HAND DETECTED ✓")
    page.evaluate("() => { window.__tl = []; }")
    set_mode(page, "none"); page.wait_for_timeout(120); set_mode(page, "marker")
    page.wait_for_timeout(700)
    seen = {s for _, s in page.evaluate("() => window.__tl")}
    check("120 ms dropout never flips the indicator to NO HAND DETECTED", "NO HAND DETECTED" not in seen, str(seen))
    page.evaluate("() => { window.__tl = []; }")
    for _ in range(4):
        set_mode(page, "none"); page.wait_for_timeout(80); set_mode(page, "marker"); page.wait_for_timeout(120)
    seen = {s for _, s in page.evaluate("() => window.__tl")}
    check("repeated flicker (80 ms off / 120 ms on ×4) causes no indicator flicker", "NO HAND DETECTED" not in seen, str(seen))

    print("\n== A4. Two hands ==")
    set_mode(page, "two")
    page.wait_for_function("document.querySelector('.cam-hand-detail').textContent === 'L + R'", timeout=5000)
    page.wait_for_timeout(200)
    f = latest(page)
    check("two hands: hands sorted [Left, Right], both with 21 landmarks",
          [h["handedness"] for h in f["hands"]] == ["Left", "Right"] and all(len(h["landmarks"]) == 21 for h in f["hands"]))
    check("two hands: .left and .right shortcuts populated, rawHandCount=2", f["left"] and f["right"] and f["rawHandCount"] == 2)
    check("two hands: indicator 'HAND DETECTED ✓' + detail 'L + R'", hand_text(page) == "HAND DETECTED ✓" and page.inner_text(".cam-hand-detail") == "L + R")
    shot = page.locator(".cam-feed").screenshot()
    open(f"{OUT}/shot_two_hands.png", "wb").write(shot)
    a = analyze(page, shot)
    check("both hands are drawn (orange Right + cyan Left skeletons visible)", a["org"]["n"] > 30 and a["cyan"]["n"] > 30, f"orange={a['org']['n']} cyan={a['cyan']['n']}")
    check("Left hand (camera x=0.7) appears at the LEFT of the mirrored preview", a["cyan"]["x"] is not None and abs(a["cyan"]["x"] - 0.3) < 0.08, f"cyan x={a['cyan']['x']:.2f}")

    set_mode(page, "marker")
    page.wait_for_timeout(100)
    f = latest(page)
    check("one of two hands leaves: it is held (stale) for a moment, the other stays fresh",
          len(f["hands"]) == 2 and f["left"]["stale"] and not f["right"]["stale"])
    page.wait_for_timeout(500)
    f = latest(page)
    check("…then only the remaining hand is reported", len(f["hands"]) == 1 and f["right"] and f["left"] is None and hand_text(page) == "HAND DETECTED ✓")

    print("\n== A5. Mirrored landmark alignment (pixel test on real screenshots) ==")
    set_mode(page, "marker")
    page.wait_for_timeout(500)
    geo = page.evaluate("""() => { const v = document.querySelector('.cam-feed video').getBoundingClientRect();
      const c = document.querySelector('.cam-landmarks').getBoundingClientRect();
      return { v: [v.left, v.top, v.width, v.height], c: [c.left, c.top, c.width, c.height],
        tv: getComputedStyle(document.querySelector('.cam-feed video')).transform,
        tc: getComputedStyle(document.querySelector('.cam-landmarks')).transform,
        ar: document.querySelector('.cam-feed').style.aspectRatio }; }""")
    check("overlay canvas covers exactly the video box", all(abs(x - y) < 1 for x, y in zip(geo["v"], geo["c"])), f"{geo['v']} vs {geo['c']}")
    check("overlay uses the same mirror transform as the video (scaleX(-1))", geo["tv"] == geo["tc"] == "matrix(-1, 0, 0, 1, 0, 0)", f"{geo['tv']} / {geo['tc']}")
    check("preview box takes the camera's true aspect ratio (640 / 480)", geo["ar"] == "640 / 480", geo["ar"])

    shot = page.locator(".cam-feed").screenshot()
    open(f"{OUT}/shot_mirror_ok.png", "wb").write(shot)
    a = analyze(page, shot)
    mag, org = a["mag"], a["org"]
    check("video marker appears on the RIGHT of the mirrored preview (raw x=0.2 → shown x≈0.8)", mag["n"] > 200 and abs(mag["x"] - 0.8) < 0.06, f"marker x={mag['x']:.3f} (n={mag['n']})")
    check("hand overlay lines up with the marker horizontally (|Δx| < 0.06 of panel width)", org["n"] > 30 and abs(org["x"] - mag["x"]) < 0.06, f"overlay x={org['x']:.3f} marker x={mag['x']:.3f}")
    check("hand overlay lines up with the marker vertically (|Δy| < 0.08 of panel height)", abs(org["y"] - mag["y"]) < 0.08, f"overlay y={org['y']:.3f} marker y={mag['y']:.3f}")

    page.add_style_tag(content=".cam-landmarks { transform: none !important; }")
    page.wait_for_timeout(300)
    a2 = analyze(page, page.locator(".cam-feed").screenshot())
    check("NEGATIVE CONTROL: with the overlay's mirror flip removed, the test detects the misalignment",
          abs(a2["org"]["x"] - a2["mag"]["x"]) > 0.4, f"overlay x={a2['org']['x']:.3f} marker x={a2['mag']['x']:.3f}")
    open(f"{OUT}/shot_mirror_broken.png", "wb").write(page.locator(".cam-feed").screenshot())
    page.reload(); ready(page)

    print("\n== A6. Phase 1 + rendering responsiveness while tracking ==")
    page.keyboard.press("1"); page.keyboard.press("2"); page.keyboard.press("2")
    check("Phase 1 keys still work (1 hits P1, 2 hits P2)", page.inner_text("#hp-0 .hp-text") == "90 HP" and page.inner_text("#hp-1 .hp-text") == "80 HP")
    page.keyboard.press("r")
    check("Phase 1 reset key works", page.inner_text("#hp-0 .hp-text") == "100 HP" and page.inner_text("#hp-1 .hp-text") == "100 HP")

    FPS_JS = """() => new Promise(res => { let n = 0, last = performance.now(), max = 0; const t0 = last;
      function f(t) { n++; max = Math.max(max, t - last); last = t;
        if (t - t0 < 2000) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), maxGap: max }); }
      requestAnimationFrame(f); })"""
    CANVAS_SUM = "() => { const c = document.getElementById('game'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 97) s += d[i]; return s; }"

    set_mode(page, "none")
    page.wait_for_timeout(500)
    base_fps = page.evaluate(FPS_JS)
    page.evaluate("() => { window.__fake.busyMs = 8; window.__fake.mode = 'marker'; }")   # emulate 8 ms of inference per frame
    page.wait_for_timeout(500)
    s0 = page.evaluate("() => window.__shinobi.handTracker.stats")
    c0 = page.evaluate(CANVAS_SUM)
    busy_fps = page.evaluate(FPS_JS)
    c1 = page.evaluate(CANVAS_SUM)
    s1 = page.evaluate("() => window.__shinobi.handTracker.stats")
    print(f"      game rAF fps: no-hand baseline={base_fps['fps']:.1f} (max gap {base_fps['maxGap']:.0f} ms) | tracking w/ 8 ms inference={busy_fps['fps']:.1f} (max gap {busy_fps['maxGap']:.0f} ms)")
    print(f"      tracker: {s1['fps']} fps, detect={s1['detectMs']:.1f} ms, processed={s1['processed']}, dup-skipped={s1['skippedDuplicate']}, throttled={s1['skippedThrottle']}")
    check("game loop stays smooth while tracking runs (≥ 45 fps, no gap > 100 ms)", busy_fps["fps"] >= 45 and busy_fps["maxGap"] < 100, f"{busy_fps['fps']:.1f} fps, max gap {busy_fps['maxGap']:.0f} ms")
    check("arena keeps animating while tracking (canvas content changes)", c0 != c1)
    check("tracker rate is capped at ~30 fps and runs continuously (15–31 fps)", 15 <= s1["fps"] <= 31, f"{s1['fps']} fps")
    check("each video frame is processed at most once (processed ≤ 31/s over the 2 s window)", (s1["processed"] - s0["processed"]) <= 31 * 2.3, f"{s1['processed'] - s0['processed']} in ~2.3 s")
    stub = page.evaluate("() => ({ calls: window.__stub.calls, bad: window.__stub.badArgs, dec: window.__stub.decreasing })")
    check("detectForVideo always gets a ready <video> and strictly increasing timestamps", stub["bad"] == 0 and stub["dec"] == 0 and stub["calls"] > 50, str(stub))
    page.evaluate("() => { window.__fake.busyMs = 0; }")

    print("\n== A7. Camera lifecycle drives the tracker ==")
    page.wait_for_function("window.__shinobi.handTracker.hasHand", timeout=5000)
    page.evaluate("() => document.querySelector('.cam-feed video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))")
    page.wait_for_selector('#webcam-panel[data-state="unavailable"]', timeout=3000)
    page.wait_for_timeout(150)
    c_before = page.evaluate("() => window.__stub.calls"); page.wait_for_timeout(300); c_after = page.evaluate("() => window.__stub.calls")
    check("camera lost → tracker stops running and stops calling the detector", not page.evaluate("() => window.__shinobi.handTracker.isRunning") and c_before == c_after, f"{c_before}→{c_after}")
    check("camera lost → hand status row hidden, hasHand=false", not page.is_visible(".cam-hand") and not latest(page)["hasHand"])
    page.click(".cam-retry")
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    page.wait_for_function("window.__shinobi.handTracker.hasHand", timeout=5000)
    check("camera retry → tracking resumes without reloading the model", page.evaluate("() => window.__stub.created.length") == 1 and hand_text(page) == "HAND DETECTED ✓")
    check("no JS errors in the main run", not errors, "; ".join(errors))
    b.close()

    # ================================================================== B. GPU → CPU fallback
    print("\n== B. GPU delegate unavailable → CPU fallback ==")
    b = launch(p)
    ctx, page, errors = new_page(b, init="window.__fake = { mode: 'marker', busyMs: 0, failGpu: true };")
    page.goto(BASE); ready(page); wait_text(page, "HAND DETECTED ✓")
    delegates = page.evaluate("() => window.__stub.created.map(o => o.baseOptions.delegate)")
    check("GPU creation fails → falls back to CPU and tracking works", delegates == ["GPU", "CPU"] and hand_text(page) == "HAND DETECTED ✓", str(delegates))
    b.close()

    # ================================================================== C. rAF fallback
    print("\n== C. requestAnimationFrame fallback (no requestVideoFrameCallback) ==")
    b = launch(p)
    ctx, page, errors = new_page(b, init="delete HTMLVideoElement.prototype.requestVideoFrameCallback; delete HTMLVideoElement.prototype.cancelVideoFrameCallback;")
    page.goto(BASE); ready(page); wait_text(page, "HAND DETECTED ✓")
    page.wait_for_timeout(2000)
    s = page.evaluate("() => window.__shinobi.handTracker.stats")
    check("rVFC removed → loop still tracks via rAF", page.evaluate("() => typeof HTMLVideoElement.prototype.requestVideoFrameCallback") == "undefined" and hand_text(page) == "HAND DETECTED ✓")
    check("rAF fallback skips repeated video frames (rAF ≈ 60 Hz vs camera 30 fps)", s["skippedDuplicate"] > 20 and 15 <= s["fps"] <= 31, f"dup-skipped={s['skippedDuplicate']} fps={s['fps']}")
    check("no JS errors with rAF fallback", not errors, "; ".join(errors))
    b.close()

    # ================================================================== D. tracker load failure + retry
    print("\n== D. MediaPipe can't be loaded (offline) → clear error, game unaffected, retry works ==")
    b = launch(p)
    ctx, page, errors = new_page(b, stub=False)
    ctx.route(MODULE_GLOB, lambda r: r.abort())
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="connected"]', timeout=10000)
    page.wait_for_function("window.__shinobi.handTracker.status === 'error'", timeout=10000)
    page.wait_for_timeout(200)
    check("load failure → 'TRACKER: UNAVAILABLE' with a RETRY button", hand_text(page) == "TRACKER: UNAVAILABLE" and page.is_visible(".cam-hand-retry"), hand_text(page))
    check("load failure → camera preview still CONNECTED and playing", page.get_attribute("#webcam-panel", "data-state") == "connected" and page.eval_on_selector(".cam-feed video", "v => !v.paused && v.videoWidth > 0"))
    check("load failure → error text shown to the player", len(page.inner_text(".cam-stats")) > 5, page.inner_text(".cam-stats"))
    page.keyboard.press("1")
    check("load failure → Phase 1 keys still work", page.inner_text("#hp-0 .hp-text") == "90 HP")
    ctx.unroute(MODULE_GLOB); ctx.route(MODULE_GLOB, serve_stub)
    page.click(".cam-hand-retry")
    try:
        page.wait_for_function("window.__shinobi.handTracker.status === 'ready'", timeout=8000)
        wait_text(page, "HAND DETECTED ✓", timeout=5000)
        check("after the network is back, RETRY loads the model and tracking starts", True)
    except Exception as e:
        check("after the network is back, RETRY loads the model and tracking starts", False, page.evaluate("() => window.__shinobi.handTracker.status + ': ' + window.__shinobi.handTracker.statusDetail"))
    b.close()

    # ================================================================== E. tracker + failed camera
    print("\n== E. No camera at all → tracker idle, nothing breaks ==")
    b = launch(p, camera=False)
    ctx, page, errors = new_page(b)
    page.goto(BASE)
    page.wait_for_selector('#webcam-panel[data-state="no-device"]', timeout=10000)
    page.wait_for_timeout(500)
    check("no camera → hand row hidden, tracker never started, model not loaded",
          not page.is_visible(".cam-hand") and page.evaluate("() => window.__shinobi.handTracker.status") == "idle" and page.evaluate("() => (window.__stub || {created: []}).created.length") == 0)
    check("no camera → no JS errors", not errors, "; ".join(errors))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("FAILED:", *failed, sep="\n  - ")
    sys.exit(1)
