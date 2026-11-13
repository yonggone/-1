"""Move existing image blobs to private Cloudinary. Run manually with DATABASE_URL set."""
from database import connect
from image_storage import PREFIX, enabled, store_image


def migrate():
    if not enabled():
        raise SystemExit('Set CLOUDINARY_URL before migration.')
    for table, columns in [('photos', ('original', 'preview')), ('assignments', ('image',)),
                           ('notices', ('image',)), ('users', ('avatar',))]:
        with connect() as db:
            ids = [row['id'] for row in db.execute(f'SELECT id FROM {table}').fetchall()]
        moved = 0
        for item_id in ids:
            for column in columns:
                # One image at a time, with a conditional update to preserve concurrent edits.
                with connect() as db:
                    row = db.execute(f'SELECT {column} FROM {table} WHERE id=?', (item_id,)).fetchone()
                content = row[column] if row else None
                if content is None or bytes(content).startswith(PREFIX):
                    continue
                reference = store_image(content)
                with connect() as db:
                    db.execute(f'UPDATE {table} SET {column}=? WHERE id=? AND {column}=?',
                               (reference, item_id, content))
                moved += 1
        print(f'{table}: {moved} image fields processed')


if __name__ == '__main__':
    migrate()
