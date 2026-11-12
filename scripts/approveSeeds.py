"""Approve pending sandbox subscriptions as the sandbox buyer. RUN BY A PERSON. Not covered by tests.

Reads data/seeds.pending.json (written by seedLive.js create) and, one at a time, opens each approval
link in a headless browser, logs in as the sandbox buyer and presses the consent button.
The selectors follow the buyer login flow used for dispute generation in this repo and may need a
tweak if PayPal changes the page. If this fails, open the links by hand (see VERIFY.md, S1).

  pip install playwright && playwright install chromium
  SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... python3 scripts/approveSeeds.py
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

DATA = os.environ.get('DATA_DIR', 'data')


def from_env_file(name):
  # The shell environment wins. Only if it is not set, read the value from .env next to package.json.
  path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
  if os.path.exists(path):
    for line in open(path):
      key, _, value = line.strip().partition('=')
      if key == name and value:
        return value.strip('"\'')
  return None


EMAIL = os.environ.get('SANDBOX_BUYER_EMAIL') or from_env_file('SANDBOX_BUYER_EMAIL')
PASSWORD = os.environ.get('SANDBOX_BUYER_PASSWORD') or from_env_file('SANDBOX_BUYER_PASSWORD')
if not EMAIL or not PASSWORD:
  sys.exit('Set SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD in the environment (or .env).')
pending = json.load(open(os.path.join(DATA, 'seeds.pending.json')))
if not pending:
  sys.exit('No pending seeds. Run: node scripts/seedLive.js create <n>')

with sync_playwright() as p:
  browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or None)
  for item in pending:
    try:
      started = time.time()
      page = browser.new_context().new_page()
      page.goto(item['approve'])
      page.wait_for_timeout(5000)
      email = page.locator('#email')
      if email.count() and email.is_visible():
        email.fill(EMAIL)
        nxt = page.locator('#btnNext')
        if nxt.count() and nxt.is_visible():
          nxt.click(); page.wait_for_timeout(4000)
      page.locator('#password').wait_for(timeout=20000)
      page.locator('#password').fill(PASSWORD)
      page.locator('#btnLogin').click()
      page.wait_for_timeout(10000)
      # The buyer flow has two steps: "Continue" (funding source) then the consent button on the review page.
      for step in range(4):
        page.wait_for_timeout(3000)
        done = False
        for sel in ('#consentButton', 'text="Agree & Subscribe"', 'text="Agree and Subscribe"', 'button:has-text("Continue")'):
          loc = page.locator(sel)
          if loc.count() and loc.first.is_visible():
            loc.first.click(timeout=20000)
            page.wait_for_timeout(8000)
            done = sel != 'button:has-text("Continue")'
            break
        else:
          break
        if done:
          break
      print(item['subscriptionId'], 'approved in', round(time.time() - started), 's', file=sys.stderr)
      page.context.close()
    except Exception as err:
      print(item['subscriptionId'], 'FAILED:', str(err)[:200], file=sys.stderr)
  browser.close()
