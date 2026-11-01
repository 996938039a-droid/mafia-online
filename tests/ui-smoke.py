"""
Headless UI smoke test (optional). Plays a full game across several browser tabs using the
BroadcastChannel "?local=1" mode, so no Supabase is needed.

  pip install playwright && playwright install chromium
  python3 tests/ui-smoke.py [players=5]
"""
import sys, threading, http.server, socketserver, functools, os, time, re
from playwright.sync_api import sync_playwright

PLAYERS = int(sys.argv[1]) if len(sys.argv) > 1 else 5
ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
SHOTS = os.environ.get("SHOTS", "/tmp/mafia-shots")
os.makedirs(SHOTS, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Handler = functools.partial(Quiet, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{port}/index.html?local=1"

errors = []
def hook(page, name):
    page.on("pageerror", lambda e: errors.append(f"[{name}] pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"[{name}] console.{m.type}: {m.text}") if m.type == "error" and "favicon" not in m.text and "net::ERR" not in m.text and "Failed to load resource" not in m.text else None)

def fast_settings(host):
    # shrink timers through the real settings UI so the test is quick
    for key, val in [("reveal", 3), ("night", 8), ("dawn", 3), ("day", 15), ("vote", 10), ("result", 3)]:
        host.fill(f'[data-timer="{key}"]', str(val))
        host.press(f'[data-timer="{key}"]', "Enter")
        host.dispatch_event(f'[data-timer="{key}"]', "change")
        host.wait_for_timeout(120)

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    pages = []
    host = ctx.new_page(); hook(host, "host"); pages.append(host)
    host.goto(BASE)
    host.fill("#nameInput", "Ada")
    host.click("#btnCreate")
    host.wait_for_selector("#room:not(.hidden)", timeout=8000)
    code = host.inner_text("#codeText").strip()
    print("room code:", code)

    for i in range(1, PLAYERS):
        p = ctx.new_page(); hook(p, f"p{i}"); pages.append(p)
        p.goto(BASE)
        p.fill("#nameInput", ["Ada","Ben","Cleo","Dev","Eli","Fay","Gus","Hana","Ivo","Jun"][i])
        p.fill("#codeInput", code)
        p.click("#btnJoin")
        p.wait_for_selector("#room:not(.hidden)", timeout=8000)

    host.wait_for_function(f"document.querySelectorAll('#players .chip').length === {PLAYERS}", timeout=8000)
    print("lobby shows", PLAYERS, "players")
    host.screenshot(path=f"{SHOTS}/01-lobby-desktop.png")

    fast_settings(host)
    host.click("[data-theme-dummy], .theme-card[data-v='village']")
    host.wait_for_timeout(300)
    assert pages[1].evaluate("document.body.dataset.theme") == "village", "theme did not sync"
    host.click(".theme-card[data-v='noir']")
    host.wait_for_timeout(300)
    if os.environ.get("MOD") == "host":
        host.click(".seg [data-v='host']")
        host.wait_for_timeout(300)
        print("moderator mode: host narrates")
    pages[1].screenshot(path=f"{SHOTS}/02-lobby-guest.png")

    host.click("[data-start]")
    for p in pages:
        p.wait_for_function("document.body.dataset.phase === 'reveal'", timeout=6000)
    print("game started; all tabs in reveal")
    for p in pages:
        assert p.is_visible("#roleCard"), "role card missing"
    pages[1].screenshot(path=f"{SHOTS}/03-reveal.png")

    # a late joiner becomes a spectator
    spec = ctx.new_page(); hook(spec, "spectator")
    spec.goto(BASE); spec.fill("#nameInput", "Zed"); spec.fill("#codeInput", code); spec.click("#btnJoin")
    spec.wait_for_selector("#room:not(.hidden)")
    spec.wait_for_function("document.body.dataset.phase !== 'lobby'", timeout=6000)
    spec.wait_for_function("[...document.querySelectorAll('#players .chip .meta')].some(e => e.textContent.includes('Spectator'))", timeout=6000)
    assert not spec.is_visible("#roleCard"), "spectator should not have a role card"
    assert "Ghosts" in spec.inner_text("#chatTabs"), "spectator should see ghost chat"
    print("late joiner is a spectator with ghost chat")

    roles = {}
    for i, p in enumerate(pages):
        roles[i] = p.inner_text("#roleCard .nm").strip()
    print("roles:", roles)

    def phase(p): return p.evaluate("document.body.dataset.phase")

    saw = set()
    shot_night = shot_vote = shot_day = False
    deadline = time.time() + 240
    chatted = False
    while time.time() < deadline:
        ph = phase(host)
        saw.add(ph)
        if ph == "over": break
        for i, p in enumerate(pages):
            try:
                if ph == "night" and p.locator("#actionCard.pulse").count():
                    chips = p.locator(".chip.can")
                    if chips.count(): chips.first.click()
                if ph == "vote" and p.locator("#actionCard.pulse").count():
                    chips = p.locator(".chip.can")
                    if chips.count() and not p.locator(".chip.sel").count():
                        chips.nth(0).click()
            except Exception as e:
                pass
        if ph == "night" and not shot_night:
            pages[2].screenshot(path=f"{SHOTS}/04-night.png"); shot_night = True
            if os.environ.get("MOD") == "host":
                assert host.is_visible("#modBar"), "moderator bar missing"
                assert "Narrator view" in host.inner_text("#roleCard"), "god view missing"
                host.click('[data-ctl="skip"]')
                print("moderator skipped a phase")
        if ph == "day" and not shot_day:
            if not chatted:
                alive = [p for p in pages if not p.locator("#chatInput").is_disabled()]
                if alive:
                    alive[0].fill("#chatInput", "I think it is Ben")
                    alive[0].press("#chatInput", "Enter")
                    chatted = True
                    host.wait_for_timeout(300)
            host.screenshot(path=f"{SHOTS}/05-day.png"); shot_day = True
        if ph == "vote" and not shot_vote:
            host.wait_for_timeout(800)
            host.screenshot(path=f"{SHOTS}/06-vote.png"); shot_vote = True
        time.sleep(0.5)

    print("phases seen:", sorted(saw))
    assert phase(host) == "over", "game did not finish in time"
    host.wait_for_selector("#overCard:not(.hidden)")
    host.screenshot(path=f"{SHOTS}/07-over.png")
    print("winner banner:", host.inner_text("#overCard h3"))

    if chatted:
        n = sum(1 for p in pages if "I think it is Ben" in p.inner_text("#chatLog"))
        print("chat visible on", n, "tabs")
        assert n >= 1

    # ghosts: a dead player may not post publicly but may use the Ghosts tab
    for p in pages:
        if p.locator("#chatTabs [data-ch='ghost']").count():
            p.click("#chatTabs [data-ch='public']")
            p.wait_for_timeout(200)
            break

    # play again returns everyone to the lobby
    host.click("[data-again]")
    for p in pages:
        p.wait_for_function("document.body.dataset.phase === 'lobby'", timeout=6000)
    print("play again -> lobby ok")

    # mobile layout check
    m = browser.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2)
    mp = m.new_page(); hook(mp, "mobile")
    mp.goto(BASE); mp.fill("#nameInput", "Mobi"); mp.click("#btnCreate")
    mp.wait_for_selector("#room:not(.hidden)")
    mp.wait_for_timeout(600)
    mp.screenshot(path=f"{SHOTS}/08-mobile-lobby.png")
    mp.click("#tabbar [data-tab='chat']"); mp.wait_for_timeout(300)
    mp.screenshot(path=f"{SHOTS}/09-mobile-chat.png")
    browser.close()

real = [e for e in errors if "ERR_" not in e]
print("\nconsole/page errors:", len(real))
for e in real[:20]: print("  ", e)
sys.exit(1 if real else 0)
