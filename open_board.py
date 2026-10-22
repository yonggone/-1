from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

root = Path(__file__).resolve().parent
url = 'http://127.0.0.1:8080'
def ready():
    try:
        with urllib.request.urlopen(url + '/api/me', timeout=1) as response:
            return response.status == 200
    except Exception:
        return False
if not ready():
    with (root / 'server.log').open('a') as log:
        subprocess.Popen([sys.executable, str(root / 'server.py')], cwd=root, stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        if ready():
            break
        time.sleep(0.2)
webbrowser.open(url)
