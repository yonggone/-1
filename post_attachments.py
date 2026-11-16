"""Attachments for assignment and notice posts."""
import base64
import binascii
import io
from pathlib import PurePosixPath
import re
import warnings

from PIL import Image, ImageOps
from image_storage import store_file

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS = 10
FORMATS = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif',
           'HEIF': 'jpg', 'AVIF': 'jpg', 'BMP': 'jpg', 'TIFF': 'jpg'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif',
                    '.heic', '.heif', '.avif', '.bmp', '.tif', '.tiff'}


def prepare_attachments(items):
    if not isinstance(items, list) or len(items) > MAX_ATTACHMENTS:
        raise ValueError('첨부 파일은 게시물당 10개까지 올릴 수 있어요.')
    files = []
    remaining = MAX_ATTACHMENT_BYTES
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('첨부 파일을 다시 골라 주세요.')
        name, encoded = item.get('name'), item.get('data')
        if (not isinstance(name, str) or not 1 <= len(name) <= 255
                or any(ord(c) < 32 or c in '/\\' for c in name)):
            raise ValueError('첨부 파일 이름을 확인해 주세요.')
        if not isinstance(encoded, str) or len(encoded) > (remaining + 2) // 3 * 4:
            raise ValueError('한 번에 올리는 파일의 합계는 10MB까지예요.')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(f'{name} 파일을 다시 골라 주세요.') from None
        if not raw or len(raw) > remaining:
            raise ValueError('빈 파일을 빼고, 파일 합계가 10MB 이하인지 확인해 주세요.')
        remaining -= len(raw)
        suffix = PurePosixPath(name).suffix.lower()
        if suffix == '.pdf':
            if not re.match(br'%PDF-[0-9]\.[0-9]', raw) or not raw.rstrip().endswith(b'%%EOF'):
                raise ValueError(f'{name} 파일을 PDF로 읽을 수 없어요.')
            files.append((name, 'application/pdf', raw))
        elif suffix in IMAGE_EXTENSIONS:
            try:
                content, ext = prepare_image(raw)
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError,
                    Image.DecompressionBombWarning):
                raise ValueError(f'{name} 사진을 읽을 수 없거나 해상도가 너무 커요.') from None
            original_extension = suffix == '.' + ext or (ext == 'jpg' and suffix in {'.jpeg', '.jfif'})
            output_name = name if original_extension else str(PurePosixPath(name).with_suffix('.' + ext))
            files.append((output_name, 'image/' + ('jpeg' if ext == 'jpg' else ext), content))
        else:
            raise ValueError(f'{name} 파일은 지원하지 않는 형식이에요.')
    return files


def prepare_image(raw):
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw), formats=list(IMAGE_READERS)) as source:
            ext = FORMATS[source.format]
            if ext == 'gif':
                # Keep the original bytes so animated GIFs remain animated.
                source.verify()
                return raw, ext
            image = ImageOps.exif_transpose(source)
            image.thumbnail((2560, 2560))
            if ext == 'jpg':
                if 'A' in image.getbands():
                    rgba = image.convert('RGBA')
                    image = Image.new('RGB', rgba.size, 'white')
                    image.paste(rgba, mask=rgba.getchannel('A'))
                else:
                    image = image.convert('RGB')
            output = io.BytesIO()
            save_format = 'JPEG' if ext == 'jpg' else source.format
            image.save(output, save_format, **({'quality': 88} if ext == 'jpg' else {}))
            content = output.getvalue()
            if len(content) > MAX_ATTACHMENT_BYTES:
                raise ValueError('Image exceeds the storage limit')
            return content, ext


try:
    from pillow_heif import register_heif_opener
except ImportError:
    IMAGE_READERS = FORMATS.keys() - {'HEIF'}
else:
    register_heif_opener()
    IMAGE_READERS = FORMATS


def insert_attachments(db, table, post_id, files):
    count = db.execute(
        'SELECT COUNT(*) AS total FROM post_attachments WHERE board=? AND post_id=?',
        (table, post_id),
    ).fetchone()['total']
    post = db.execute(f'SELECT image IS NOT NULL AS has_image FROM {table} WHERE id=?', (post_id,)).fetchone()
    if files and count + post['has_image'] + len(files) > MAX_ATTACHMENTS:
        raise ValueError('첨부 파일은 기존 파일을 포함해 게시물당 10개까지 올릴 수 있어요.')
    for name, mime, raw in files:
        content = store_file(raw, resource_type='raw', extension='pdf') if mime == 'application/pdf' else store_file(raw)
        db.execute('INSERT INTO post_attachments(board,post_id,name,mime,content) VALUES(?,?,?,?,?)',
                   (table, post_id, name, mime, content))


def with_attachments(db, table, rows, *, post_id=None):
    by_post = {}
    query = 'SELECT id,post_id,name,mime FROM post_attachments WHERE board=?'
    params = (table,)
    if post_id is not None:
        query += ' AND post_id=?'
        params += (post_id,)
    for row in db.execute(query + ' ORDER BY id', params).fetchall():
        by_post.setdefault(row['post_id'], []).append({key: row[key] for key in ('id', 'name', 'mime')})
    return [dict(row, attachments=by_post.get(row['id'], [])) for row in rows]
