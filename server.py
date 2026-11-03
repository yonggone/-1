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
import threading
import time
import warnings
try:
    from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
    PIL_AVAILABLE = True
except ModuleNotFoundError:
    PIL_AVAILABLE = False
    Image = None
    ImageDraw = None
    ImageOps = None
    UnidentifiedImageError = OSError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

from database import ROOT, DB, DATABASE_URL, connect, initialize_schema
ATTEMPTS = {}
LOCK = threading.Lock()
TTL = 30 * 24 * 60 * 60
MAX_PHOTO = 10 * 1024 * 1024
SEAT_EDITORS = {'20410', '20431', '20434'}
NAME_EDITORS = {'20410', '20431'}
if PIL_AVAILABLE:
    Image.MAX_IMAGE_PIXELS = 25000000

def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def verify(password, stored):
    return secrets.compare_digest(hash_password(password, stored.split(':')[0]), stored)

def initialize():
    with connect() as db:
        initialize_schema(db)
        accounts = [(str(20400+n), '1234', 'student') for n in range(1,37) if n not in (8,33)]
        accounts.append(('강경민', '경민쌤사랑해요', 'teacher'))
        for account, password, role in accounts:
            if not db.execute('SELECT 1 FROM users WHERE id=?', (account,)).fetchone():
                db.execute('INSERT INTO users(id,password,role) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING', (account, hash_password(password), role))
        if not db.execute('SELECT 1 FROM seat_layout LIMIT 1').fetchone():
            slots = (
                [f'G1R{row}{side}' for row in range(1, 6) for side in ('L', 'R')] +
                [f'G2R{row}{side}' for row in range(1, 5) for side in ('L', 'R')] +
                [f'G3R{row}{side}' for row in range(1, 5) for side in ('L', 'R')] +
                [f'G4R{row}{side}' for row in range(1, 5) for side in ('L', 'R')]
            )
            default_ids = [
                '20412', '20427', '20403', '20418', '20435', '20422', '20405', '20431', '20416', '20401',
                '20429', '20410', '20424', '20407', '20434', '20420', '20414', '20436', '20402', '20411',
                '20430', '20417', '20423', '20404', '20409', '20432', '20425', '20413', '20421', '20406',
                '20415', '20426', '20428', '20419'
            ]
            db.executemany('INSERT INTO seat_layout(slot,student_id) VALUES(?,?)', list(zip(slots, default_ids)))
    if not DATABASE_URL:
        os.chmod(DB, 0o600)

def public(user):
    return {k:user[k] for k in ('id','name','role','birthday','instagram','must_change')}

def process_photo(encoded):
    if not isinstance(encoded,str) or len(encoded) > (MAX_PHOTO+2)//3*4:
        raise ValueError('사진은 10MB 이하로 골라 주세요.')
    try:
        raw = base64.b64decode(encoded,validate=True)
    except (binascii.Error,ValueError):
        raise ValueError('사진 파일을 다시 골라 주세요.')
    if not raw or len(raw)>MAX_PHOTO:
        raise ValueError('사진은 10MB 이하로 골라 주세요.')
    if not PIL_AVAILABLE:
        if raw.startswith(b'\xff\xd8\xff'):
            return raw, raw, 'image/jpeg', 'jpg'
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            return raw, raw, 'image/png', 'png'
        if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            return raw, raw, 'image/webp', 'webp'
        raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                formats = {'JPEG':('image/jpeg','jpg'),'PNG':('image/png','png'),'WEBP':('image/webp','webp')}
                if source.format not in formats:
                    raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요.')
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
        raise ValueError('사진을 읽을 수 없거나 해상도가 너무 커요. 다른 사진을 골라 주세요.')

def process_post_image(encoded):
    if encoded in (None, ''):
        return None, ''
    if not isinstance(encoded, str) or len(encoded) > (MAX_PHOTO + 2) // 3 * 4:
        raise ValueError('사진은 10MB 이하로 골라 주세요냥.')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError('사진 파일을 다시 골라 주세요냥.')
    if not raw or len(raw) > MAX_PHOTO:
        raise ValueError('사진은 10MB 이하로 골라 주세요냥.')
    if not PIL_AVAILABLE:
        if raw.startswith(b'\xff\xd8\xff'):
            return raw, 'image/jpeg'
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            return raw, 'image/png'
        if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            return raw, 'image/webp'
        raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요냥.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                formats = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}
                if source.format not in formats:
                    raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요냥.')
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                original_format = source.format
                image = ImageOps.exif_transpose(source)
                image.thumbnail((1440, 1440))
                output = io.BytesIO()
                save_format = original_format
                save_kwargs = {'quality': 85} if save_format == 'JPEG' else {}
                image.save(output, save_format, **save_kwargs)
                mime = formats[original_format]
                return output.getvalue(), mime
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError, SyntaxError):
        raise ValueError('사진을 읽을 수 없거나 해상도가 너무 커요냥. 다른 사진을 골라 주세요.')

def board_table(path):
    if path == 'assignments':
        return 'assignments'
    if path == 'notices':
        return 'notices'
    return None

def read_post_payload(data):
    limits = {'title': 100, 'subject': 30, 'scheduled_date': 10, 'content': 8000}
    values = {}
    for name, limit in limits.items():
        value = data.get(name)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError('제목·과목·시행 날짜·내용을 모두 입력하고 길이를 확인해 주세요.')
        values[name] = value.strip()
    try:
        datetime.date.fromisoformat(values['scheduled_date'])
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', values['scheduled_date']):
            raise ValueError()
    except ValueError:
        raise ValueError('시행 날짜를 확인해 주세요.')
    return values

def process_avatar(encoded):
    if encoded in (None, ''):
        return None, ''
    if not isinstance(encoded, str) or len(encoded) > (MAX_PHOTO + 2) // 3 * 4:
        raise ValueError('프로필 사진은 10MB 이하로 골라 주세요냥.')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError('프로필 사진 파일을 다시 골라 주세요냥.')
    if not raw or len(raw) > MAX_PHOTO:
        raise ValueError('프로필 사진은 10MB 이하로 골라 주세요냥.')
    if not PIL_AVAILABLE:
        if raw.startswith(b'\xff\xd8\xff'):
            return raw, 'image/jpeg'
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            return raw, 'image/png'
        if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            return raw, 'image/webp'
        raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요냥.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                formats = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}
                if source.format not in formats:
                    raise ValueError('JPG, PNG, WebP 사진만 올릴 수 있어요냥.')
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                image = ImageOps.exif_transpose(source)
                image.thumbnail((512, 512))
                output = io.BytesIO()
                background = Image.new('RGB', image.size, '#faf9f5')
                rgba = image.convert('RGBA')
                background.paste(rgba, mask=rgba.getchannel('A'))
                background.save(output, 'JPEG', quality=82)
                return output.getvalue(), 'image/jpeg'
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError, SyntaxError):
        raise ValueError('프로필 사진을 읽을 수 없거나 해상도가 너무 커요냥.')

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
        if not token or len(token) > 128:
            return None,None
        with connect() as db:
            user = db.execute(
                'SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id '
                'WHERE sessions.token_hash=? AND sessions.expires_at>?',
                (hashlib.sha256(token.encode()).hexdigest(), time.time())
            ).fetchone()
        return (token,user) if user else (None,None)

    def session_cookie(self, token, max_age):
        secure = '; Secure' if os.environ.get('RENDER') else ''
        return f'class_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}{secure}'

    def new_session(self, user, old_token=None, revoke=False):
        token = secrets.token_urlsafe(32)
        now = time.time()
        with connect() as db:
            db.execute('DELETE FROM sessions WHERE expires_at<=?', (now,))
            if old_token:
                db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(old_token.encode()).hexdigest(),))
            if revoke:
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
            db.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), user['id'], now+TTL))
        self.reply(200,{'user':public(user)},self.session_cookie(token, TTL))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/healthz':
            return self.reply(200, {'ok': True})
        if path.startswith('/api/'):
            _,user = self.session()
            if path == '/api/me':
                return self.reply(200,{'user':public(user) if user else None})
            if not user:
                return self.reply(401,{'error':'먼저 로그인해 주세요'})
            if user['must_change']:
                return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요.'})
            if path == '/api/assignments':
                with connect() as db:
                    rows=db.execute('SELECT assignments.id,title,subject,scheduled_date,content,author,created_at,image IS NOT NULL AS has_image,users.name AS author_name FROM assignments JOIN users ON users.id=assignments.author ORDER BY assignments.id DESC').fetchall()
                return self.reply(200,{'assignments':[dict(row) for row in rows]})
            if path == '/api/notices':
                with connect() as db:
                    rows=db.execute('SELECT notices.id,title,subject,scheduled_date,content,author,created_at,image IS NOT NULL AS has_image,users.name AS author_name FROM notices JOIN users ON users.id=notices.author ORDER BY notices.id DESC').fetchall()
                return self.reply(200,{'notices':[dict(row) for row in rows]})
            if path == '/api/photos':
                with connect() as db:
                    rows=db.execute('SELECT photos.id,caption,author,created_at,users.name AS author_name FROM photos JOIN users ON users.id=photos.author ORDER BY photos.id DESC').fetchall()
                return self.reply(200,{'photos':[dict(row) for row in rows]})
            post_image_route = re.fullmatch(r'/api/(assignments|notices)/([1-9][0-9]*)/image', path)
            if post_image_route:
                table, post_id = post_image_route.groups()
                with connect() as db:
                    post = db.execute(f'SELECT image,image_mime FROM {table} WHERE id=?', (post_id,)).fetchone()
                if not post or not post['image']:
                    return self.reply(404, {'error':'첨부 사진을 찾을 수 없어요.'})
                return self.binary(post['image'], post['image_mime'] or 'image/jpeg')
            photo_route=re.fullmatch(r'/api/photos/([1-9][0-9]*)/(preview|download)',path)
            if photo_route:
                photo_id,action=photo_route.groups()
                if action=='download' and user['role']!='teacher':
                    return self.reply(403,{'error':'사진 원본 다운로드는 선생님만 할 수 있어요.'})
                column='original' if action=='download' else 'preview'
                with connect() as db:
                    photo=db.execute(f'SELECT {column},mime,extension FROM photos WHERE id=?',(photo_id,)).fetchone()
                if not photo:
                    return self.reply(404,{'error':'사진을 찾을 수 없어요.'})
                return self.binary(photo[column],photo['mime'] if action=='download' else 'image/jpeg',f'class-photo-{photo_id}.{photo["extension"]}' if action=='download' else None)
            if path == '/api/profiles':
                with connect() as db:
                    users = db.execute('SELECT * FROM users ORDER BY role DESC,id').fetchall()
                return self.reply(200,{'profiles':[public(u) for u in users]})
            avatar_route = re.fullmatch(r'/api/avatars/(.+)', path)
            if avatar_route:
                profile_id = unquote(avatar_route.group(1))
                with connect() as db:
                    found = db.execute('SELECT avatar,avatar_mime FROM users WHERE id=?', (profile_id,)).fetchone()
                if not found or not found['avatar']:
                    return self.reply(404, {'error':'프로필 사진이 없어요.'})
                return self.binary(found['avatar'], found['avatar_mime'] or 'image/jpeg')
            if path == '/api/seats':
                with connect() as db:
                    seats = db.execute('SELECT slot,student_id FROM seat_layout ORDER BY slot').fetchall()
                return self.reply(200, {'seats': [dict(row) for row in seats]})
            return self.reply(404,{'error':'찾을 수 없는 요청이에요.'})
        files = {'/':'index.html', **{'/'+f:f for f in ['index.html','app.js','style.css','account.js','account.css','boards.js','boards.css','chalkboard.css']}}
        # Serve only the theme assets explicitly bundled with the app.
        assets = {
            '/assets/cork-grain.svg': ('assets/cork-grain.svg', 'image/svg+xml'),
            '/assets/fonts/Jua-Regular.woff2': ('assets/fonts/Jua-Regular.woff2', 'font/woff2'),
            '/assets/fonts/GowunDodum-Regular.woff2': ('assets/fonts/GowunDodum-Regular.woff2', 'font/woff2'),
            '/assets/fonts/GamjaFlower-Regular.woff2': ('assets/fonts/GamjaFlower-Regular.woff2', 'font/woff2'),
        }
        if path in assets:
            filename, mime = assets[path]
            return self.binary((ROOT / filename).read_bytes(), mime)
        if path not in files:
            return self.reply(404,{'error':'페이지를 찾을 수 없어요.'})
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
            return self.reply(403,{'error':'허용되지 않은 요청이에요.'})
        token,user = self.session()
        if path in ('/api/photos','/api/assignments','/api/notices','/api/seats') or re.fullmatch(r'/api/(assignments|notices)/([1-9][0-9]*)/(edit|delete)', path):
            if not user:
                return self.reply(401,{'error':'먼저 로그인해 주세요'})
            if user['must_change']:
                return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요.'})
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= (14*1024*1024 if path in ('/api/photos','/api/assignments','/api/notices') or re.fullmatch(r'/api/(assignments|notices)/([1-9][0-9]*)/edit', path) or path == '/api/profile' else 32768):
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise ValueError()
        except (ValueError,UnicodeError):
            return self.reply(400,{'error':'입력 내용을 다시 확인해 주세요.'})
        if path == '/api/profile-name':
            if not user:
                return self.reply(401, {'error':'먼저 로그인해 주세요.'})
            if user['must_change'] or user['id'] not in NAME_EDITORS:
                return self.reply(403, {'error':'이름을 수정할 권한이 없습니다.'})
            target, name = data.get('id'), data.get('name')
            if set(data) != {'id', 'name'} or not isinstance(target, str):
                return self.reply(400, {'error':'이름 수정 정보를 확인해 주세요.'})
            if not isinstance(name, str) or not name.strip() or len(name) > 20 or any(ord(c) < 32 for c in name):
                return self.reply(400, {'error':'이름은 줄바꿈 없이 1~20자로 입력해 주세요.'})
            with connect() as db:
                if not db.execute('SELECT 1 FROM users WHERE id=?', (target,)).fetchone():
                    return self.reply(404, {'error':'프로필을 찾을 수 없습니다.'})
                db.execute('UPDATE users SET name=? WHERE id=?', (name.strip(), target))
            return self.reply(200, {'id':target, 'name':name.strip()})
        if path == '/api/login':
            account,password = data.get('id',''),data.get('password','')
            if not isinstance(account,str) or not isinstance(password,str) or len(password)>128 or len(account)>30:
                return self.reply(400,{'error':'아이디와 비밀번호를 확인해 주세요.'})
            account = account.strip()
            attempt_key = (self.client_address[0],account)
            with LOCK:
                attempts = [t for t in ATTEMPTS.get(attempt_key,[]) if t>time.time()-60]
                if len(attempts)>=10:
                    return self.reply(429,{'error':'1분 뒤에 다시 시도해 주세요.'})
                ATTEMPTS[attempt_key] = attempts+[time.time()]
            with connect() as db:
                found = db.execute('SELECT * FROM users WHERE id=?',(account,)).fetchone()
            if not found or not verify(password,found['password']):
                return self.reply(401,{'error':'아이디 또는 비밀번호가 맞지 않아요.'})
            with LOCK:
                ATTEMPTS.pop(attempt_key,None)
            return self.new_session(found,token)
        if path == '/api/logout':
            if token:
                with connect() as db:
                    db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
            return self.reply(200,{'ok':True},self.session_cookie('', 0))
        if not user:
            return self.reply(401,{'error':'먼저 로그인해 주세요'})
        if path == '/api/password':
            password = data.get('password')
            if not isinstance(password,str) or not 8<=len(password)<=128:
                return self.reply(400,{'error':'새 비밀번호는 8~128자로 정해 주세요.'})
            if verify(password,user['password']):
                return self.reply(400,{'error':'지금과 다른 새 비밀번호를 정해 주세요.'})
            current = data.get('current','')
            if not user['must_change'] and (not isinstance(current,str) or len(current)>128 or not verify(current,user['password'])):
                return self.reply(400,{'error':'현재 비밀번호를 확인해 주세요.'})
            with connect() as db:
                db.execute('UPDATE users SET password=?,must_change=0 WHERE id=?',(hash_password(password),user['id']))
                updated = db.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            return self.new_session(updated,token,revoke=True)
        if user['must_change']:
            return self.reply(403,{'error':'먼저 비밀번호를 바꿔 주세요.'})
        if path in ('/api/assignments', '/api/notices'):
            table = board_table(path.rsplit('/', 1)[-1])
            try:
                values = read_post_payload(data)
                image, image_mime = process_post_image(data.get('image'))
            except ValueError as error:
                return self.reply(400, {'error': str(error)})
            with connect() as db:
                cursor=db.execute(
                    f'INSERT INTO {table}(title,subject,scheduled_date,content,author,created_at,image,image_mime) VALUES(?,?,?,?,?,?,?,?) RETURNING id',
                    (*values.values(),user['id'],datetime.datetime.now(datetime.timezone.utc).isoformat(),image,image_mime)
                )
                row=db.execute(f'SELECT id,title,subject,scheduled_date,content,author,created_at,image IS NOT NULL AS has_image FROM {table} WHERE id=?',(cursor.fetchone()['id'],)).fetchone()
            return self.reply(201,{table[:-1]:dict(row)})
        edit_route = re.fullmatch(r'/api/(assignments|notices)/([1-9][0-9]*)/edit', path)
        if edit_route:
            table, post_id = edit_route.groups()
            try:
                values = read_post_payload(data)
            except ValueError as error:
                return self.reply(400, {'error': str(error)})
            remove_image = bool(data.get('remove_image'))
            try:
                image, image_mime = process_post_image(data.get('image'))
            except ValueError as error:
                return self.reply(400, {'error': str(error)})
            with connect() as db:
                found = db.execute(f'SELECT author,image,image_mime FROM {table} WHERE id=?', (post_id,)).fetchone()
                if not found:
                    return self.reply(404, {'error':'게시물을 찾을 수 없어요.'})
                if found['author'] != user['id']:
                    return self.reply(403, {'error':'내가 작성한 게시물만 수정할 수 있어요.'})
                next_image, next_mime = found['image'], found['image_mime']
                if remove_image:
                    next_image, next_mime = None, ''
                if image is not None:
                    next_image, next_mime = image, image_mime
                db.execute(
                    f'UPDATE {table} SET title=?,subject=?,scheduled_date=?,content=?,image=?,image_mime=? WHERE id=?',
                    (values['title'], values['subject'], values['scheduled_date'], values['content'], next_image, next_mime, post_id)
                )
                row = db.execute(f'SELECT id,title,subject,scheduled_date,content,author,created_at,image IS NOT NULL AS has_image FROM {table} WHERE id=?', (post_id,)).fetchone()
            return self.reply(200, {table[:-1]: dict(row)})
        delete_route = re.fullmatch(r'/api/(assignments|notices)/([1-9][0-9]*)/delete', path)
        if delete_route:
            table, post_id = delete_route.groups()
            with connect() as db:
                found = db.execute(f'SELECT author FROM {table} WHERE id=?', (post_id,)).fetchone()
                if not found:
                    return self.reply(404, {'error':'게시물을 찾을 수 없어요.'})
                if found['author'] != user['id']:
                    return self.reply(403, {'error':'내가 작성한 게시물만 삭제할 수 있어요.'})
                db.execute(f'DELETE FROM {table} WHERE id=?', (post_id,))
            return self.reply(200, {'ok':True})
        if path == '/api/photos':
            caption=data.get('caption','')
            if not isinstance(caption,str) or len(caption)>140:
                return self.reply(400,{'error':'사진 설명은 140자 이내로 써 주세요.'})
            try:
                original,preview,mime,extension=process_photo(data.get('image'))
            except ValueError as error:
                return self.reply(400,{'error':str(error)})
            with connect() as db:
                cursor=db.execute('INSERT INTO photos(caption,author,created_at,original,preview,mime,extension) VALUES(?,?,?,?,?,?,?) RETURNING id',(caption.strip(),user['id'],datetime.datetime.now(datetime.timezone.utc).isoformat(),original,preview,mime,extension))
                row=db.execute('SELECT id,caption,author,created_at FROM photos WHERE id=?',(cursor.fetchone()['id'],)).fetchone()
            return self.reply(201,{'photo':dict(row)})
        if path == '/api/profile':
            birthday,instagram = data.get('birthday',''),data.get('instagram','')
            name=data.get('name',user['name'])
            if not isinstance(name,str) or not name.strip() or len(name)>20 or any(ord(char)<32 for char in name):
                return self.reply(400,{'error':'이름은 필수이며 줄바꿈 없이 20자 이내로 써 주세요.'})
            if not isinstance(birthday,str) or not isinstance(instagram,str):
                return self.reply(400,{'error':'프로필 입력을 확인해 주세요.'})
            try:
                if birthday:
                    datetime.datetime.strptime('2000-'+birthday,'%Y-%m-%d')
                    if not re.fullmatch(r'\d{2}-\d{2}',birthday):
                        raise ValueError()
            except ValueError:
                return self.reply(400,{'error':'생일의 월과 일을 확인해 주세요.'})
            instagram = instagram.strip().removeprefix('@')
            if instagram and not re.fullmatch(r'[A-Za-z0-9._]{1,30}',instagram):
                return self.reply(400,{'error':'인스타 아이디는 영문, 숫자, 점, 밑줄로 입력해 주세요.'})
            remove_avatar = bool(data.get('remove_avatar'))
            try:
                avatar, avatar_mime = process_avatar(data.get('avatar'))
            except ValueError as error:
                return self.reply(400, {'error': str(error)})
            with connect() as db:
                current = db.execute('SELECT avatar,avatar_mime FROM users WHERE id=?', (user['id'],)).fetchone()
                next_avatar, next_avatar_mime = current['avatar'], current['avatar_mime']
                if remove_avatar:
                    next_avatar, next_avatar_mime = None, ''
                if avatar is not None:
                    next_avatar, next_avatar_mime = avatar, avatar_mime
                db.execute('UPDATE users SET name=?,birthday=?,instagram=?,avatar=?,avatar_mime=? WHERE id=?',(name.strip(),birthday,instagram,next_avatar,next_avatar_mime,user['id']))
                updated = db.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            return self.reply(200,{'user':public(updated)})
        if path == '/api/seats':
            editor = data.get('editor_id', '')
            if not isinstance(editor, str) or editor not in SEAT_EDITORS or editor != user['id']:
                return self.reply(403, {'error':'권한이 없습니다.'})
            seats = data.get('seats')
            if not isinstance(seats, dict) or not seats:
                return self.reply(400, {'error':'자리 정보를 확인해 주세요.'})
            slots = (
                {f'G1R{row}{side}' for row in range(1, 6) for side in ('L', 'R')} |
                {f'G2R{row}{side}' for row in range(1, 5) for side in ('L', 'R')} |
                {f'G3R{row}{side}' for row in range(1, 5) for side in ('L', 'R')} |
                {f'G4R{row}{side}' for row in range(1, 5) for side in ('L', 'R')}
            )
            updates = []
            for slot, student_id in seats.items():
                if slot not in slots or not isinstance(student_id, str):
                    return self.reply(400, {'error':'자리 정보를 확인해 주세요.'})
                sid = student_id.strip()
                if not re.fullmatch(r'20[0-9]{3}', sid):
                    return self.reply(400, {'error':'학번은 숫자 5자리로 입력해 주세요.'})
                updates.append((sid, slot))
            with connect() as db:
                for sid, slot in updates:
                    found = db.execute('SELECT role FROM users WHERE id=?', (sid,)).fetchone()
                    if not found or found['role'] != 'student':
                        return self.reply(400, {'error':f'{sid} 학번은 사용할 수 없어요.'})
                db.executemany('UPDATE seat_layout SET student_id=? WHERE slot=?', updates)
                rows = db.execute('SELECT slot,student_id FROM seat_layout ORDER BY slot').fetchall()
            return self.reply(200, {'seats': [dict(row) for row in rows]})
        self.reply(404,{'error':'찾을 수 없는 요청이에요.'})

if __name__ == '__main__':
    initialize()
    port = int(os.environ.get('PORT','8080'))
    print(f'게시판 실행: http://localhost:{port} (종료: Ctrl+C)',flush=True)
    ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
