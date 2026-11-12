"""Walks the README "Try it" steps 1 to 6 on /judge?film=1, headless. RUN BY A PERSON (VERIFY S11).

  python3 scripts/walkJudge.py http://localhost:3002 <output folder>

Works in local mode and in sandbox mode. Saves a screenshot per step, the Cancel now position at every
step (it must never move), and the merchant API view (Activity rows, refund IDs) to walk_log.json.
It never logs in to PayPal; the server makes the PayPal calls with the app's own credentials.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3002'
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.scratch/walk')
EXE = os.environ.get('CHROMIUM_PATH') or None
os.makedirs(OUT, exist_ok=True)
log = {'base': BASE, 'started': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'steps': [], 'console': [], 'http4xx': []}


def text(page, sel):
  try:
    return page.locator(sel).first.inner_text(timeout=3000)
  except Exception:
    return ''


def merchant(page):
  return page.evaluate("""async () => {
    const s = JSON.parse(localStorage.getItem('faircancel.session') || 'null')
    const res = await fetch('/api/merchant?sessionId=' + s.sessionId)
    return (await res.json()).data
  }""")


def covered(page):
  # True when Cancel now is under the sticky header (hidden from the subscriber).
  return page.evaluate("""() => {
    const b = document.querySelector('.btn--cancel'); const t = document.querySelector('.top')
    if (!b || !t) return null
    return b.getBoundingClientRect().top < t.getBoundingClientRect().bottom - 1
  }""")


def cancel_y(page):
  loc = page.locator('.btn--cancel')
  box = loc.first.bounding_box() if loc.count() else None
  return round(box['y'], 2) if box else None


def step(name, page, extra=None):
  page.wait_for_timeout(900)
  page.screenshot(path=os.path.join(OUT, name + '.png'))
  log['steps'].append({
    'name': name, 'cancelY': cancel_y(page), 'cancelCovered': covered(page), 'scrollY': page.evaluate('window.scrollY'),
    'subscriber': text(page, 'main.split > section:first-child')[:1200],
    'badge': text(page, '.filmbadge'), 'strip': text(page, '.top__status'), 'extra': extra,
  })


def wait_view(page):
  page.wait_for_function("() => document.querySelector('.cancelbar__line') && !document.querySelector('.cancelbar__line').innerText.startsWith('Checking')", timeout=30000)


def claim(page, label, needs_input=True):
  page.click(f'text={label}')
  page.wait_for_selector('#reason' if needs_input else 'text=Resume now', timeout=30000)
  wait_view(page)


def send(page, sentence, ys):
  page.fill('#reason', sentence)
  ys.append(cancel_y(page))
  started = time.time()
  page.click('button[type=submit]')
  page.wait_for_function("() => !document.querySelector('#reason')", timeout=40000)
  ys.append(cancel_y(page))
  return round(time.time() - started, 2)


def press_cancel(page, ys):
  ys.append(cancel_y(page))
  page.click('.btn--cancel')
  page.wait_for_selector('.card--result', timeout=40000)
  ys.append(cancel_y(page))


with sync_playwright() as p:
  browser = p.chromium.launch(executable_path=EXE, headless=True)
  # Default 1024x576 at scale 1.25 = a 1280x720 window at 125% zoom (the filming setup). WALK_VIEWPORT=1440x900 for others.
  w, h = (int(x) for x in os.environ.get('WALK_VIEWPORT', '1024x576').split('x'))
  ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=float(os.environ.get('WALK_SCALE', '1.25')))
  page = ctx.new_page()
  page.on('console', lambda m: log['console'].append(f'{m.type}: {m.text}') if m.type == 'error' else None)
  page.on('response', lambda r: log['http4xx'].append(f'{r.status} {r.url}') if r.status >= 400 else None)
  page.goto(BASE + '/judge?film=1')
  page.wait_for_selector('.top__status')
  page.wait_for_timeout(2500)
  step('01_open', page)

  ys = {}
  claim(page, '2 Cancel')
  ys['2'] = [cancel_y(page)]
  step('02_cancel_before', page)
  d = send(page, 'too expensive', ys['2'])
  step('03_cancel_no_offer', page, {'sec': d})
  press_cancel(page, ys['2'])
  step('04_cancel_done', page)

  claim(page, '1 Pause')
  ys['3'] = [cancel_y(page)]
  step('05_pause_hint', page)
  d = send(page, "Visiting family until mid-January, then I'll be back", ys['3'])
  step('06_pause_offer', page, {'sec': d})
  page.locator('.card--offer .btn--action').first.click()
  page.wait_for_selector('text=Resume now', timeout=40000)
  ys['3'].append(cancel_y(page))
  step('07_pause_suspended', page)

  claim(page, '1 Pause')
  ys['4'] = [cancel_y(page)]
  d = send(page, 'Back after the holidays, my kid is home', ys['4'])
  step('08_holidays_offer', page, {'sec': d})
  # REVIEW_3 F1: the same button again, without pressing Pause, must give a new subscription with an input box.
  # WALK_SKIP_F1=1 skips it (it takes one more sandbox seed).
  if os.environ.get('WALK_SKIP_F1') != '1':
    before = page.locator('.substate .mono').first.inner_text()
    page.click('text=1 Pause')
    page.wait_for_function(f"() => document.querySelector('.substate .mono') && document.querySelector('.substate .mono').innerText !== {json.dumps(before)}", timeout=30000)
    page.wait_for_selector('#reason', timeout=30000)
    log['f1'] = {'before': before, 'after': page.locator('.substate .mono').first.inner_text(), 'inputBox': page.locator('#reason').count() == 1}
    step('08b_pause_again_new_sub', page, log['f1'])

  claim(page, '3 Full refund')
  ys['5'] = [cancel_y(page)]
  d = send(page, "I was charged yesterday but couldn't make any class this week", ys['5'])
  step('09_full_refund_decided', page, {'sec': d})
  press_cancel(page, ys['5'])
  step('10_full_refund_done', page)

  claim(page, '4 Resume a paused one', needs_input=False)
  ys['6'] = [cancel_y(page)]
  step('11_resume_paused', page)
  page.locator('button', has_text='Resume now').first.click()
  page.wait_for_selector('#reason', timeout=40000)
  ys['6'].append(cancel_y(page))
  step('12_resumed', page)
  page.locator('.sublist__row--current button', has_text='Sync').first.click()
  page.wait_for_selector('.sublist__row--current .syncinfo', timeout=30000)
  step('13_synced', page)

  log['cancelY'] = ys
  log['cancelYDistinct'] = sorted({y for v in ys.values() for y in v if y is not None})
  log['merchant'] = merchant(page)
  page.screenshot(path=os.path.join(OUT, '14_dashboard_full.png'), full_page=True)
  browser.close()

json.dump(log, open(os.path.join(OUT, 'walk_log.json'), 'w'), indent=1, ensure_ascii=False)
print('steps', len(log['steps']), 'console errors', len(log['console']), 'http4xx', len(log['http4xx']), 'cancelY', log['cancelYDistinct'])
