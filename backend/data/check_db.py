import sqlite3, os

db = 'stocks.db'
if not os.path.exists(db):
    print('DB 없음')
    exit()

with sqlite3.connect(db) as conn:
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    print('테이블:', [t[0] for t in tables])
    for t in tables:
        cnt = conn.execute(f'SELECT COUNT(*) FROM {t[0]}').fetchone()[0]
        print(f'  {t[0]}: {cnt:,}행')
        if cnt > 0 and t[0] == 'prices':
            mn, mx = conn.execute('SELECT MIN(date), MAX(date) FROM prices').fetchone()
            print(f'    기간: {mn} ~ {mx}')
        if cnt > 0 and t[0] == 'features':
            mn, mx = conn.execute('SELECT MIN(date), MAX(date) FROM features').fetchone()
            print(f'    기간: {mn} ~ {mx}')
