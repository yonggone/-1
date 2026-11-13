"""Private Cloudinary image bytes; existing database images remain readable."""
import hashlib
import io
import json
import os
from urllib.request import urlopen

PREFIX = b'CLASSBOARD-CLOUDINARY-v1:'


def enabled():
    return bool(os.environ.get('CLOUDINARY_URL', '').strip())


def store_image(content):
    return store_file(content)


def store_file(content, *, resource_type='image', extension=''):
    if content is None:
        return None
    content = bytes(content)
    if content.startswith(PREFIX) or not enabled():
        if os.environ.get('RENDER') and not enabled():
            raise ValueError('사진 저장소 설정이 필요해요. Render의 CLOUDINARY_URL을 확인해 주세요.')
        return content
    try:
        import cloudinary.uploader
        public_id = 'class-board/' + hashlib.sha256(content).hexdigest()
        if extension:
            public_id += '.' + extension
        result = cloudinary.uploader.upload(
            io.BytesIO(content), resource_type=resource_type, type='authenticated',
            public_id=public_id,
            overwrite=False, unique_filename=False, timeout=60,
        )
        reference = {'public_id': result['public_id'], 'version': result['version']}
        if resource_type == 'raw':
            reference['resource_type'] = 'raw'
        else:
            reference['format'] = result['format']
        return PREFIX + json.dumps(reference, separators=(',', ':')).encode()
    except Exception:
        raise ValueError('외부 사진 저장소에 저장하지 못했어요. 설정과 남은 용량을 확인해 주세요.') from None


def load_image(content):
    content = bytes(content)
    if not content.startswith(PREFIX):
        return content
    try:
        import cloudinary.utils
        reference = json.loads(content[len(PREFIX):])
        # Only server-generated authenticated URLs are fetched, never arbitrary DB URLs.
        url, _ = cloudinary.utils.cloudinary_url(
            reference['public_id'], format=reference.get('format'), version=reference['version'],
            resource_type=reference.get('resource_type', 'image'), type='authenticated', sign_url=True, secure=True,
        )
        with urlopen(url, timeout=30) as response:
            raw = response.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError('Stored image exceeds transport limit')
        return raw
    except Exception:
        raise ValueError('사진 저장소에서 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') from None
