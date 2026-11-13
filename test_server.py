"""HTTP integration tests with isolated SQLite storage, including a process restart."""
import base64
import http.cookiejar
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parent

class PersistenceTest(unittest.TestCase):
    def test_restart(self):
        with tempfile.TemporaryDirectory() as data:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            env = dict(os.environ, CLASS_BOARD_DATA=data, PORT=str(port), DATABASE_URL=os.environ.get('TEST_DATABASE_URL', ''))
            env.pop('RENDER', None)
            url = f'http://127.0.0.1:{port}'
            process = None
            clock_file = Path(data) / 'test-clock-offset'
            clock_file.write_text('0')
            launcher = (
                "import time, runpy, sys; from pathlib import Path; "
                "real_time=time.time; clock=Path(sys.argv[1]); "
                "time.time=lambda: real_time()+float(clock.read_text()); "
                "sys.path.insert(0, sys.argv[2]); "
                "runpy.run_path(sys.argv[2]+'/server.py',run_name='__main__')"
            )
            def start():
                nonlocal process
                process = subprocess.Popen([sys.executable, '-c', launcher, str(clock_file), str(ROOT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(150):
                    if process.poll() is not None:
                        self.fail('server exited')
                    try:
                        with urllib.request.urlopen(url+'/healthz', timeout=1):
                            return
                    except OSError:
                        time.sleep(.05)
                self.fail('startup timed out')
            def stop():
                if process and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            def request(path, payload=None):
                req = urllib.request.Request(url+path, data=json.dumps(payload).encode() if payload is not None else None,
                    headers={'Content-Type':'application/json', 'X-Class-Board':'1'})
                with opener.open(req, timeout=10) as response:
                    content = response.read()
                    return json.loads(content) if 'json' in response.headers.get('Content-Type','') else content
            try:
                start()
                request('/api/login', {'id':'20401', 'password':'1234'})
                request('/api/password', {'password':'restart-test-password'})
                request('/api/profile', {'name':'테스트', 'birthday':'02-29', 'instagram':'class_test'})
                self.assertFalse(request('/api/notifications')['unread']['assignments'])
                assignment = request('/api/assignments', {'title':'재시작 확인', 'subject':'국어', 'scheduled_date':'2026-10-23', 'content':'저장 확인'})['assignment']
                self.assertTrue(request('/api/notifications')['unread']['assignments'])
                first_snapshot = request('/api/assignments')['revision']
                request('/api/notifications/read', {'kind':'assignments','revision':first_snapshot})
                self.assertFalse(request('/api/notifications')['unread']['assignments'])
                with self.assertRaises(urllib.error.HTTPError) as invalid_read:
                    request('/api/notifications/read', {'kind':'calendar','revision':1})
                self.assertEqual(invalid_read.exception.code, 400)
                output = io.BytesIO()
                Image.new('RGB', (10, 10), 'blue').save(output, 'PNG')
                raw = output.getvalue()
                photo = request('/api/photos', {'caption':'사진 확인', 'image':base64.b64encode(raw).decode()})['photo']
                preview = request(f"/api/photos/{photo['id']}/preview")
                encoded = base64.b64encode(raw).decode()
                request('/api/profile', {'name':'테스트','birthday':'02-29','instagram':'class_test','avatar':encoded})
                avatar = request('/api/avatars/20401')
                posts = {}
                for table in ('assignments','notices'):
                    payload = {'title':'첨부 게시물','subject':'국어','scheduled_date':'2026-10-23','content':'본문','image':encoded}
                    post = request('/api/'+table,payload)[table[:-1]]
                    self.assertTrue(post['has_image'])
                    snapshot = request('/api/'+table)['revision']
                    request('/api/notifications/read', {'kind':table,'revision':snapshot})
                    self.assertFalse(request('/api/notifications')['unread'][table])
                    payload.pop('image')
                    payload['title'] = '수정된 게시물'
                    edited = request(f"/api/{table}/{post['id']}/edit",payload)[table[:-1]]
                    self.assertTrue(edited['has_image'])
                    self.assertTrue(request('/api/notifications')['unread'][table])
                    # An older response must not acknowledge a concurrent edit.
                    request('/api/notifications/read', {'kind':table,'revision':snapshot})
                    self.assertTrue(request('/api/notifications')['unread'][table])
                    posts[table] = (post['id'], request(f"/api/{table}/{post['id']}/image"))
                    sample = Image.new('RGB', (10, 10), 'blue')
                    output = io.BytesIO()
                    sample.save(output, 'PDF')
                    pdf = output.getvalue()
                    output = io.BytesIO()
                    sample.save(output, 'AVIF')
                    mixed = [
                        {'name': '휴대폰사진.avif', 'data': base64.b64encode(output.getvalue()).decode()},
                        {'name': '평가안내.pdf', 'data': base64.b64encode(pdf).decode()},
                        {'name': '사진.png', 'data': encoded},
                    ]
                    disposable = request('/api/'+table, dict(payload, attachments=mixed))[table[:-1]]
                    route = f"/api/{table}/{disposable['id']}"
                    avif, document, png = disposable['attachments']
                    listed = request('/api/'+table)[table][0]
                    self.assertEqual(listed['attachments'], disposable['attachments'])
                    self.assertEqual(avif['name'], '휴대폰사진.jpg')
                    self.assertTrue(request(f"{route}/attachments/{avif['id']}").startswith(b'\xff\xd8'))
                    self.assertEqual(request(f"{route}/attachments/{document['id']}"), pdf)
                    self.assertTrue(request(f"{route}/attachments/{png['id']}").startswith(b'\x89PNG'))
                    invalid = dict(payload, remove_attachments=[document['id']],
                                   attachments=[{'name': 'invalid.pdf', 'data': encoded}])
                    with self.assertRaises(urllib.error.HTTPError) as bad_attachment:
                        request(route+'/edit', invalid)
                    self.assertEqual(bad_attachment.exception.code, 400)
                    self.assertEqual(request(f"{route}/attachments/{document['id']}"), pdf)
                    edited = request(route+'/edit', dict(payload, remove_attachments=[avif['id']]))[table[:-1]]
                    self.assertEqual(edited['attachments'], [document, png])
                    with self.assertRaises(urllib.error.HTTPError) as removed:
                        request(f"{route}/attachments/{avif['id']}")
                    self.assertEqual(removed.exception.code, 404)
                    request(route+'/delete', {})
                    self.assertNotIn(disposable['id'], [row['id'] for row in request('/api/'+table)[table]])
                    with self.assertRaises(urllib.error.HTTPError) as removed_post:
                        request(f"{route}/attachments/{document['id']}")
                    self.assertEqual(removed_post.exception.code, 404)
                original_opener = opener
                opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                request('/api/login',{'id':'20410','password':'1234'})
                request('/api/password',{'password':'seat-editor-password'})
                seat_result=request('/api/seats',{'editor_id':'20410','seats':{'G1R1L':'20401','G1R5R':'20412'}})
                expected_seats = seat_result['seats']
                self.assertTrue(request('/api/notifications')['unread']['assignments'])
                snapshot = request('/api/assignments')['revision']
                request('/api/notifications/read', {'kind':'assignments','revision':snapshot})
                self.assertFalse(request('/api/notifications')['unread']['assignments'])
                opener = original_opener
                self.assertTrue(request('/api/notifications')['unread']['assignments'])
                photo_snapshot = request('/api/photos')['revision']
                request('/api/notifications/read', {'kind':'photos','revision':photo_snapshot})
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    request('/api/seats',{'editor_id':'20410','seats':{'G1R1L':'20402'}})
                self.assertEqual(denied.exception.code,403)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    request(f"/api/photos/{photo['id']}/download")
                self.assertEqual(error.exception.code, 403)
                # Advance only this isolated server's clock; no real wait or system clock change.
                clock_file.write_text('3601')
                self.assertEqual(request('/api/me')['user']['id'], '20401')
                later = request('/api/assignments', {'title':'한 시간 후 작성', 'subject':'수학', 'scheduled_date':'2026-10-23', 'content':'가상 시간 경과 후 저장'})['assignment']
                self.assertEqual(len(request('/api/assignments')['assignments']), 3)
                # A full day and process restart must preserve the existing login cookie.
                clock_file.write_text('86401')
                day_user = request('/api/me')['user']
                self.assertEqual(day_user['name'], '테스트')
                self.assertEqual(day_user['must_change'], 0)
                self.assertEqual(len(request('/api/assignments')['assignments']), 3)
                stop()
                start()
                self.assertFalse(request('/api/notifications')['unread']['photos'])
                self.assertTrue(request('/api/notifications')['unread']['assignments'])
                self.assertTrue(request('/api/notifications')['unread']['class24'])
                user = request('/api/me')['user']
                self.assertEqual(user['name'], '테스트')
                self.assertEqual(user['must_change'], 0)
                self.assertEqual([row['id'] for row in request('/api/assignments')['assignments']], [later['id'], posts['assignments'][0], assignment['id']])
                self.assertEqual(request('/api/photos')['photos'][0]['id'], photo['id'])
                self.assertEqual(request(f"/api/photos/{photo['id']}/preview"), preview)
                with self.assertRaises(urllib.error.HTTPError):
                    request('/api/login', {'id':'20401', 'password':'1234'})
                self.assertEqual(request('/api/avatars/20401'), avatar)
                self.assertEqual(request('/api/seats')['seats'], expected_seats)
                for table, (post_id, image_bytes) in posts.items():
                    rows = request('/api/'+table)[table]
                    row = next(row for row in rows if row['id']==post_id)
                    self.assertEqual(row['title'], '수정된 게시물')
                    self.assertTrue(row['has_image'])
                    self.assertEqual(request(f'/api/{table}/{post_id}/image'),image_bytes)
                # Stored sessions contain only a hash of the bearer token.
                import sqlite3
                jar = next(h.cookiejar for h in opener.handlers if hasattr(h, 'cookiejar'))
                def current_token():
                    return next(c.value for c in jar if c.name == 'class_session')
                def replay(token):
                    req = urllib.request.Request(url+'/api/me', headers={'Cookie':'class_session='+token})
                    with urllib.request.urlopen(req, timeout=5) as response:
                        return json.load(response)['user']
                previous = current_token()
                if env['DATABASE_URL']:
                    import psycopg
                    with psycopg.connect(env['DATABASE_URL']) as db:
                        hashes = [row[0] for row in db.execute('SELECT token_hash FROM sessions')]
                else:
                    with sqlite3.connect(Path(data)/'board.sqlite3') as db:
                        hashes = [row[0] for row in db.execute('SELECT token_hash FROM sessions')]
                self.assertNotIn(previous, hashes)
                self.assertTrue(all(len(value) == 64 for value in hashes))
                # A second device's session must also be revoked on password change.
                second = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                login = urllib.request.Request(url+'/api/login', data=json.dumps({'id':'20401','password':'restart-test-password'}).encode(), headers={'X-Class-Board':'1'})
                with second.open(login, timeout=5) as response:
                    response.read()
                second_jar = next(h.cookiejar for h in second.handlers if hasattr(h,'cookiejar'))
                second_token = next(c.value for c in second_jar if c.name == 'class_session')
                request('/api/password', {'current':'restart-test-password','password':'new-persistent-password'})
                self.assertIsNone(replay(previous))
                self.assertIsNone(replay(second_token))
                self.assertEqual(request('/api/me')['user']['id'], '20401')
                logout_token = current_token()
                request('/api/logout', {})
                self.assertIsNone(replay(logout_token))
                request('/api/login', {'id':'20401','password':'new-persistent-password'})
                # Expiration is enforced server-side even if a browser sends an old cookie.
                clock_file.write_text(str(32*24*60*60))
                self.assertIsNone(request('/api/me')['user'])
                stop()
                start()
                self.assertIsNone(request('/api/me')['user'])
                self.assertEqual(request('/api/login', {'id':'20401','password':'new-persistent-password'})['user']['name'], '테스트')

            finally:
                stop()

    def test_render_requires_database(self):
        env = dict(os.environ, RENDER='true', DATABASE_URL='')
        result = subprocess.run([sys.executable, '-c', 'import database'], cwd=ROOT, env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'DATABASE_URL', result.stderr)

if __name__ == '__main__':
    unittest.main()
