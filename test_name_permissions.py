"""Name editing authorization tests using isolated storage."""
import hashlib
import http.cookiejar
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
import database
import server

class NamePermissionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        data = Path(cls.tmp.name)
        cls.storage = patch.multiple(database, DATA=data, DB=data/'board.sqlite3', DATABASE_URL='')
        cls.storage.start()
        cls.local = patch.multiple(server, DB=data/'board.sqlite3', DATABASE_URL='')
        cls.local.start()
        server.initialize()
        with database.connect() as db:
            db.execute("UPDATE users SET must_change=0,name='기존이름',birthday='02-29',instagram='existing'")
            for account in ['20410', '20431', '20434', '20401', '강경민', '20402']:
                db.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
                           (hashlib.sha256(account.encode().hex().encode()).hexdigest(), account, time.time()+3600))
            db.execute("UPDATE users SET must_change=1 WHERE id='20402'")
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.local.stop()
        cls.storage.stop()
        cls.tmp.cleanup()

    def request(self, account, payload=None, path='/api/profile-name'):
        headers = {'Content-Type':'application/json', 'X-Class-Board':'1'}
        if account:
            headers['Cookie'] = 'class_session=' + account.encode().hex()
        req = urllib.request.Request('http://127.0.0.1:%s' % self.http.server_port + path,
            data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_permissions_and_name_only(self):
        for account in [None, '20401', '20434', '강경민', '20402']:
            status, _ = self.request(account, {'id':'20403', 'name':'변경시도'})
            self.assertEqual(status, 401 if account is None else 403)
        with database.connect() as db:
            before = dict(db.execute("SELECT * FROM users WHERE id='20403'").fetchone())
        for account in ['20410', '20431']:
            status, result = self.request(account, {'id':'20403', 'name':'  새이름  '})
            self.assertEqual(status, 200)
            self.assertEqual(result['name'], '새이름')
        with database.connect() as db:
            after = dict(db.execute("SELECT * FROM users WHERE id='20403'").fetchone())
        self.assertEqual(after.pop('name'), '새이름')
        before.pop('name')
        self.assertEqual(before, after)
        for name in ['', '   ', '가'*21, '이름\n', None]:
            self.assertEqual(self.request('20410', {'id':'20403', 'name':name})[0], 400)
        self.assertEqual(self.request('20410', {'id':'missing', 'name':'이름'})[0], 404)
        self.assertEqual(self.request('20431', {'id':'20403', 'name':'이름', 'birthday':'01-01'})[0], 400)
        self.assertEqual(self.request('20401', {'id':'20403', 'name':'이름', 'editor_id':'20410'})[0], 403)

    def test_public_profiles(self):
        for account in ['20401', '20410', '20431', '20434']:
            status, result = self.request(account, path='/api/profiles')
            self.assertEqual(status, 200)
            self.assertEqual(len(result['profiles']), 35)
            for profile in result['profiles']:
                self.assertEqual(set(profile), {'id', 'name', 'role', 'birthday', 'instagram', 'must_change'})
        self.assertEqual(self.request(None, path='/api/profiles')[0], 401)
        self.assertEqual(self.request('20402', path='/api/profiles')[0], 403)

    def test_self_profile_cannot_target_someone_else(self):
        with database.connect() as db:
            before = dict(db.execute("SELECT * FROM users WHERE id='20404'").fetchone())
        status, result = self.request('20401', {'id':'20404', 'name':'본인이름', 'birthday':'03-10', 'instagram':'my_account'}, '/api/profile')
        self.assertEqual(status, 200)
        self.assertEqual(result['user']['id'], '20401')
        self.assertEqual(result['user']['name'], '본인이름')
        with database.connect() as db:
            after = dict(db.execute("SELECT * FROM users WHERE id='20404'").fetchone())
        self.assertEqual(before, after)

if __name__ == '__main__':
    unittest.main()
