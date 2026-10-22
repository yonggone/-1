"""Local classroom server. Run: python3 server.py"""
import datetime
import base64
import binascii
import io
import hashlib
import http.cookies
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import warnings
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('CLASS_BOARD_DATA', str(ROOT / '.data')))
DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
DB = DATA / 'board.sqlite3'
SESSIONS, ATTEMPTS = {}, {}
LOCK = threading.Lock()
TTL = 43200
MAX_PHOTO = 10 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25000000

def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db

def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def verify(password, stored):
    return secrets.compare_digest(hash_password(password, stored.split(':')[0]), stored)

def initialize():
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, password TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL, birthday TEXT NOT NULL DEFAULT "", instagram TEXT NOT NULL DEFAULT "")')
        if 'name' not in [row['name'] for row in db.execute('PRAGMA table_info(users)')]:
            db.execute('ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ""')
        db.execute('CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subject TEXT NOT NULL, scheduled_date TEXT NOT NULL, content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, caption TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, original BLOB NOT NULL, preview BLOB NOT NULL, mime TEXT NOT NULL, extension TEXT NOT NULL)')
        accounts = [(str(20400+n), '1234', 'student') for n in range(1,37) if n not in (8,33)]
        accounts.append(('강경민', '경민쌤사랑해요', 'teacher'))
        for account, password, role in accounts:
            if not db.execute('SELECT 1 FROM users WHERE id=?', (account,)).fetchone():
                db.execute('INSERT INTO users(id,password,role) VALUES(?,?,?)', (account, hash_password(password), role))
    os.chmod(DB, 0o600)

def public(user):
    return {k:user[k] for k in ('id','name','role','birthday','instagram','must_change')}

def process_photo(encoded):
    if not isinstance(encoded,str) or len(encoded) > (MAX_PHOTO+2)//3*4:
        raise ValueError('사진은 10MB 이하로 골라 주세요냥.')
    try:
        raw = base64.b64decode(encoded,validate=True)
    except (binascii.Error,ValueError):
        raise ValueError('사진 파일을 다시 골라 주세요냥.')
    if not raw or len(raw)>MAX_PHOTO:
        raise ValueError('사진은 10MB 이하로 골라 주세요냥.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                formats = {'JPEG':('image/jpeg','jpg'),'PNG':('image/png','png'),'WEBP':('image/webp','webp')}
                if source.format not in formats:
                    raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요냥.')
                mime,extension = formats[source.format]
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                image = ImageOps.exif_transpose(source)
                image.thumbnail((640,640))
                rgba = image.convert('RGBA')
                background = Image.new('RGBA',rgba.size,'#faf9f5')
                background.alpha_composite(rgba)
                image = background.convert('RGB')
                draw = ImageDraw.Draw(image)
                draw.rectangle((0,max(0,image.height-23),image.width,image.height),fill='#efe9de')
                draw.text((8,max(0,image.height-18)),'2-4 CLASS / PREVIEW',fill='#6c6a64')
                output=io.BytesIO()
                image.save(output,'JPEG',quality=75)
                return raw,output.getvalue(),mime,extension
    except (UnidentifiedImageError,OSError,Image.DecompressionBombWarning,Image.DecompressionBombError,SyntaxError):
        raise ValueError('사진을 읽을 수 없거나 해상도가 너무 커요냥. 다른 사진을 골라 주세요.')

class Handler(BaseHTTPRequestHandler):
    def binary(self, content, mime, filename=None):
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(content)))
        self.send_header('Cache-Control','private, no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if filename:
            self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(content)

    def reply(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(body)

    def session(self):
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie',''))
            token = cookie['class_session'].value if 'class_session' in cookie else ''
        except http.cookies.CookieError:
            return None,None
        with LOCK:
            session = SESSIONS.get(token)
            if not session or session['expires'] < time.time():
                SESSIONS.pop(token,None)
                return None,None
        with connect() as db:
            user = db.execute('SELECT * FROM users WHERE id=?',(session['id'],)).fetchone()
        return token,user

    def new_session(self, user, old_token=None, revoke=False):
        token = secrets.token_urlsafe(32)
        with LOCK:
            SESSIONS.pop(old_token,None)
            for key,value in list(SESSIONS.items()):
                if value['expires'] < time.time() or (revoke and value['id']==user['id']):
                    SESSIONS.pop(key,None)
            SESSIONS[token] = {'id':user['id'],'expires':time.time()+TTL}
        self.reply(200,{'user':public(user)},f'class_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={TTL}')

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            _,user = self.session()
            if path == '/api/me':
                return self.reply(200,{'user':public(user) if user else None})
            if not user:
                return self.reply(401,{'error':'먼저 로그인해 주세요냥 🐾'})
            if user['must_change']:
                return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요냥.'})
            if path == '/api/assignments':
                with connect() as db:
                    rows=db.execute('SELECT assignments.*, users.name AS author_name FROM assignments JOIN users ON users.id=assignments.author ORDER BY assignments.id DESC').fetchall()
                return self.reply(200,{'assignments':[dict(row) for row in rows]})
            if path == '/api/photos':
                with connect() as db:
                    rows=db.execute('SELECT photos.id,caption,author,created_at,users.name AS author_name FROM photos JOIN users ON users.id=photos.author ORDER BY photos.id DESC').fetchall()
                return self.reply(200,{'photos':[dict(row) for row in rows]})
            photo_route=re.fullmatch(r'/api/photos/([1-9][0-9]*)/(preview|download)',path)
            if photo_route:
                photo_id,action=photo_route.groups()
                if action=='download' and user['role']!='teacher':
                    return self.reply(403,{'error':'사진 원본 다운로드는 선생님만 할 수 있어요냥.'})
                column='original' if action=='download' else 'preview'
                with connect() as db:
                    photo=db.execute(f'SELECT {column},mime,extension FROM photos WHERE id=?',(photo_id,)).fetchone()
                if not photo:
                    return self.reply(404,{'error':'사진을 찾을 수 없어요냥.'})
                return self.binary(photo[column],photo['mime'] if action=='download' else 'image/jpeg',f'class-photo-{photo_id}.{photo["extension"]}' if action=='download' else None)
            if path == '/api/profiles':
                with connect() as db:
                    users = db.execute('SELECT * FROM users ORDER BY role DESC,id').fetchall()
                return self.reply(200,{'profiles':[public(u) for u in users]})
            return self.reply(404,{'error':'찾을 수 없는 요청이에요냥.'})
        files = {'/':'index.html', **{'/'+f:f for f in ['index.html','app.js','style.css','account.js','account.css','boards.js','boards.css','chalkboard.css']}}
        if path not in files:
            return self.reply(404,{'error':'페이지를 찾을 수 없어요냥.'})
        file = ROOT/files[path]
        content = file.read_bytes()
        mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[file.suffix]
        self.send_response(200)
        self.send_header('Content-Type',mime+'; charset=utf-8')
        self.send_header('Content-Length',str(len(content)))
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        path = urlparse(self.path).path
        origin = self.headers.get('Origin')
        if self.headers.get('X-Class-Board') != '1' or (origin and urlparse(origin).netloc != self.headers.get('Host')):
            return self.reply(403,{'error':'허용되지 않은 요청이에요냥.'})
        token,user = self.session()
        if path in ('/api/photos','/api/assignments'):
            if not user:
                return self.reply(401,{'error':'먼저 로그인해 주세요냥 🐾'})
            if user['must_change']:
                return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요냥.'})
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= (14*1024*1024 if path=='/api/photos' else 32768):
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise ValueError()
        except (ValueError,UnicodeError):
            return self.reply(400,{'error':'입력 내용을 다시 확인해 주세요냥.'})
        if path == '/api/login':
            account,password = data.get('id',''),data.get('password','')
            if not isinstance(account,str) or not isinstance(password,str) or len(password)>128 or len(account)>30:
                return self.reply(400,{'error':'아이디와 비밀번호를 확인해 주세요냥.'})
            account = account.strip()
            attempt_key = (self.client_address[0],account)
            with LOCK:
                attempts = [t for t in ATTEMPTS.get(attempt_key,[]) if t>time.time()-60]
                if len(attempts)>=10:
                    return self.reply(429,{'error':'1분 뒤에 다시 시도해 주세요냥.'})
                ATTEMPTS[attempt_key] = attempts+[time.time()]
            with connect() as db:
                found = db.execute('SELECT * FROM users WHERE id=?',(account,)).fetchone()
            if not found or not verify(password,found['password']):
                return self.reply(401,{'error':'아이디 또는 비밀번호가 맞지 않아요냥.'})
            with LOCK:
                ATTEMPTS.pop(attempt_key,None)
            return self.new_session(found,token)
        if path == '/api/logout':
            with LOCK:
                SESSIONS.pop(token,None)
            return self.reply(200,{'ok':True},'class_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        if not user:
            return self.reply(401,{'error':'먼저 로그인해 주세요냥 🐾'})
        if path == '/api/password':
            password = data.get('password')
            if not isinstance(password,str) or not 8<=len(password)<=128:
                return self.reply(400,{'error':'새 비밀번호는 8~128자로 정해 주세요냥.'})
            if verify(password,user['password']):
                return self.reply(400,{'error':'지금과 다른 새 비밀번호를 정해 주세요냥.'})
            current = data.get('current','')
            if not user['must_change'] and (not isinstance(current,str) or len(current)>128 or not verify(current,user['password'])):
                return self.reply(400,{'error':'현재 비밀번호를 확인해 주세요냥.'})
            with connect() as db:
                db.execute('UPDATE users SET password=?,must_change=0 WHERE id=?',(hash_password(password),user['id']))
                updated = db.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            return self.new_session(updated,token,revoke=True)
        if user['must_change']:
            return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요냥.'})
        if path == '/api/assignments':
            limits={'title':100,'subject':30,'scheduled_date':10,'content':8000}
            values={}
            for name,limit in limits.items():
                value=data.get(name)
                if not isinstance(value,str) or not value.strip() or len(value)>limit:
                    return self.reply(400,{'error':'제목·과목·시행 날짜·내용을 모두 입력하고 길이를 확인해 주세요냥.'})
                values[name]=value.strip()
            try:
                datetime.date.fromisoformat(values['scheduled_date'])
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',values['scheduled_date']):
                    raise ValueError()
            except ValueError:
                return self.reply(400,{'error':'시행 날짜를 확인해 주세요냥.'})
            with connect() as db:
                cursor=db.execute('INSERT INTO assignments(title,subject,scheduled_date,content,author,created_at) VALUES(?,?,?,?,?,?)',(*values.values(),user['id'],datetime.datetime.now(datetime.timezone.utc).isoformat()))
                row=db.execute('SELECT * FROM assignments WHERE id=?',(cursor.lastrowid,)).fetchone()
            return self.reply(201,{'assignment':dict(row)})
        if path == '/api/photos':
            caption=data.get('caption','')
            if not isinstance(caption,str) or len(caption)>140:
                return self.reply(400,{'error':'사진 설명은 140자 이내로 써 주세요냥.'})
            try:
                original,preview,mime,extension=process_photo(data.get('image'))
            except ValueError as error:
                return self.reply(400,{'error':str(error)})
            with connect() as db:
                cursor=db.execute('INSERT INTO photos(caption,author,created_at,original,preview,mime,extension) VALUES(?,?,?,?,?,?,?)',(caption.strip(),user['id'],datetime.datetime.now(datetime.timezone.utc).isoformat(),original,preview,mime,extension))
                row=db.execute('SELECT id,caption,author,created_at FROM photos WHERE id=?',(cursor.lastrowid,)).fetchone()
            return self.reply(201,{'photo':dict(row)})
        if path == '/api/profile':
            birthday,instagram = data.get('birthday',''),data.get('instagram','')
            name=data.get('name',user['name'])
            if not isinstance(name,str) or len(name)>20 or any(ord(char)<32 for char in name):
                return self.reply(400,{'error':'이름은 줄바꿈 없이 20자 이내로 써 주세요냥.'})
            if not isinstance(birthday,str) or not isinstance(instagram,str):
                return self.reply(400,{'error':'프로필 입력을 확인해 주세요냥.'})
            try:
                if birthday:
                    datetime.datetime.strptime('2000-'+birthday,'%Y-%m-%d')
                    if not re.fullmatch(r'\d{2}-\d{2}',birthday):
                        raise ValueError()
            except ValueError:
                return self.reply(400,{'error':'생일의 월과 일을 확인해 주세요냥.'})
            instagram = instagram.strip().removeprefix('@')
            if instagram and not re.fullmatch(r'[A-Za-z0-9._]{1,30}',instagram):
                return self.reply(400,{'error':'인스타 아이디는 영문, 숫자, 점, 밑줄로 입력해 주세요냥.'})
            with connect() as db:
                db.execute('UPDATE users SET name=?,birthday=?,instagram=? WHERE id=?',(name.strip(),birthday,instagram,user['id']))
                updated = db.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            return self.reply(200,{'user':public(updated)})
        self.reply(404,{'error':'찾을 수 없는 요청이에요냥.'})

if __name__ == '__main__':
    initialize()
    port = int(os.environ.get('PORT','8080'))
    print(f'게시판 실행: http://localhost:{port} (종료: Ctrl+C)',flush=True)
    ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
