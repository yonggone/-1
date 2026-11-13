import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

import image_storage as storage


class StorageTests(unittest.TestCase):
    def test_old_bytes_are_readable(self):
        self.assertEqual(storage.load_image(b'old-photo'), b'old-photo')

    def test_render_requires_storage_for_new_photos(self):
        with patch.dict(os.environ, {'RENDER': 'true', 'CLOUDINARY_URL': ''}):
            with self.assertRaises(ValueError):
                storage.store_image(b'photo')
            self.assertIsNone(storage.store_image(None))

    def test_authenticated_upload_and_read(self):
        uploader = types.ModuleType('cloudinary.uploader')
        utils = types.ModuleType('cloudinary.utils')
        cloudinary = types.ModuleType('cloudinary')
        cloudinary.uploader, cloudinary.utils = uploader, utils
        uploader.upload = MagicMock(return_value={
            'public_id': 'class-board/digest', 'format': 'jpg', 'version': 123})
        utils.cloudinary_url = MagicMock(return_value=('https://res.cloudinary.com/test/image/authenticated/x.jpg', {}))
        modules = {'cloudinary': cloudinary, 'cloudinary.uploader': uploader, 'cloudinary.utils': utils}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {'CLOUDINARY_URL': 'configured'}):
            reference = storage.store_image(b'photo')
            self.assertTrue(reference.startswith(storage.PREFIX))
            self.assertEqual(uploader.upload.call_args.kwargs['type'], 'authenticated')
            self.assertEqual(storage.store_image(reference), reference)
            with patch('image_storage.urlopen') as request:
                request.return_value.__enter__.return_value.read.return_value = b'photo'
                self.assertEqual(storage.load_image(reference), b'photo')
            self.assertTrue(utils.cloudinary_url.call_args.kwargs['sign_url'])
            self.assertEqual(utils.cloudinary_url.call_args.kwargs['type'], 'authenticated')

    def test_failure_does_not_fall_back_to_db_or_leak_secret(self):
        cloudinary = types.ModuleType('cloudinary')
        uploader = types.ModuleType('cloudinary.uploader')
        cloudinary.uploader = uploader
        uploader.upload = MagicMock(side_effect=RuntimeError('secret-value'))
        with patch.dict(sys.modules, {'cloudinary': cloudinary, 'cloudinary.uploader': uploader}), patch.dict(os.environ, {'CLOUDINARY_URL': 'configured'}):
            with self.assertRaises(ValueError) as error:
                storage.store_image(b'photo')
            self.assertNotIn('secret-value', str(error.exception))


if __name__ == '__main__':
    unittest.main()
