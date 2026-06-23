import os
import sys
import json
import re
import datetime

try:
    import psycopg2
except ImportError:
    psycopg2 = None

import sqlite3

def find_appsettings():
    candidates = [
        "./backend/StationOS.Api/appsettings.json",
        "./backend/StationOS.Api/appsettings.Development.json",
        "../backend/StationOS.Api/appsettings.json",
        "C:\\Program Files\\StationMonitor\\backend\\appsettings.json",
        "C:\\Program Files\\StationMonitor\\backend\\appsettings.Development.json",
    ]
    for path in candidates:
        if os.path.exists(path) and path.endswith(".json"):
            return path
    return None

def parse_connection_string(conn_str):
    params = {}
    for part in conn_str.split(';'):
        if '=' in part:
            k, v = part.split('=', 1)
            params[k.strip().lower()] = v.strip()
    return params

def apply_postgres(conn_params):
    if not psycopg2:
        print("⚠️  Không có thư viện 'psycopg2' được cài đặt. Bỏ qua PostgreSQL.")
        return False
        
    try:
        host = conn_params.get('host', 'localhost')
        port = conn_params.get('port', '5432')
        dbname = conn_params.get('database', conn_params.get('db', 'StationOS_Central'))
        user = conn_params.get('username', conn_params.get('user', 'postgres'))
        password = conn_params.get('password', 'postgres123')
        
        conn = psycopg2.connect(
            host=host,
            port=port,
            database=dbname,
            user=user,
            password=password
        )
        conn.autocommit = True
        cur = conn.cursor()
        
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Licenses');")
        has_licenses = cur.fetchone()[0]
        
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='LicenseKeys');")
        has_license_keys = cur.fetchone()[0]
        
        applied = False
        if has_licenses:
            print("Found 'Licenses' table. Inserting Unlimited Enterprise Key...")
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='Licenses';")
            cols = [r[0] for r in cur.fetchall()]
            
            cur.execute('DELETE FROM "Licenses" WHERE "Key" = \'STATION-MONITOR-ENTERPRISE-UNLIMITED\';')
            
            import uuid
            row_id = str(uuid.uuid4())
            
            insert_cols = ['"Id"', '"Key"', '"Tier"', '"MaxUsers"', '"ExpiresAt"', '"ActivatedAt"', '"IsActive"']
            insert_vals = [row_id, 'STATION-MONITOR-ENTERPRISE-UNLIMITED', 'ent', 99999, '2099-12-31 23:59:59+00', datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), True]
            
            extra_limits = ['MaxStations', 'MaxCameras', 'MaxRoiPoints', 'MaxRoiRegions', 'MaxPdRegions']
            for limit in extra_limits:
                if limit in cols:
                    insert_cols.append(f'"{limit}"')
                    insert_vals.append(99999)
            
            query = f'INSERT INTO "Licenses" ({", ".join(insert_cols)}) VALUES ({", ".join(["%s"] * len(insert_vals))});'
            cur.execute(query, tuple(insert_vals))
            print("✅ Đã áp dụng thành công trên PostgreSQL (table 'Licenses')!")
            applied = True
            
        elif has_license_keys:
            print("Found 'LicenseKeys' table. Inserting Unlimited Enterprise Key...")
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='LicenseKeys';")
            cols = [r[0] for r in cur.fetchall()]
            
            cur.execute('DELETE FROM "LicenseKeys" WHERE "Key" = \'STATION-MONITOR-ENTERPRISE-UNLIMITED\';')
            
            import uuid
            row_id = str(uuid.uuid4())
            
            insert_cols = ['"Id"', '"Key"', '"IssuedTo"', '"MaxConcurrentSessions"', '"IsActive"', '"CreatedAt"']
            insert_vals = [row_id, 'STATION-MONITOR-ENTERPRISE-UNLIMITED', 'Enterprise Central Station', 99999, True, datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')]
            
            if 'ExpiresAt' in cols:
                insert_cols.append('"ExpiresAt"')
                cur.execute("SELECT is_nullable FROM information_schema.columns WHERE table_name='LicenseKeys' AND column_name='ExpiresAt';")
                nullable = cur.fetchone()[0] == 'YES'
                insert_vals.append(None if nullable else '2099-12-31 23:59:59+00')
                
            query = f'INSERT INTO "LicenseKeys" ({", ".join(insert_cols)}) VALUES ({", ".join(["%s"] * len(insert_vals))});'
            cur.execute(query, tuple(insert_vals))
            print("✅ Đã áp dụng thành công trên PostgreSQL (table 'LicenseKeys')!")
            applied = True
        else:
            print("❌ Không tìm thấy bảng 'Licenses' hoặc 'LicenseKeys' trong CSDL PostgreSQL.")
            
        cur.close()
        conn.close()
        return applied
    except Exception as e:
        print("❌ Lỗi khi kết nối/truy vấn PostgreSQL:", e)
        return False

def apply_sqlite():
    sqlite_paths = [
        "station_monitor.db",
        "./station_monitor.db",
        "../backend/station_monitor.db",
        "/var/lib/stationos/station_monitor.db",
    ]
    
    # Also support Windows environment variables path check
    if sys.platform == 'win32':
        local_appdata = os.environ.get('LOCALAPPDATA', '')
        if local_appdata:
            sqlite_paths.append(os.path.join(local_appdata, 'StationMonitor', 'station_monitor.db'))
            
    found_db = None
    for p in sqlite_paths:
        if os.path.exists(p):
            found_db = p
            break
            
    if not found_db:
        return False
        
    try:
        conn = sqlite3.connect(found_db)
        cur = conn.cursor()
        
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Licenses';")
        has_licenses = cur.fetchone()
        
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='LicenseKeys';")
        has_license_keys = cur.fetchone()
        
        applied = False
        if has_licenses:
            cur.execute("PRAGMA table_info(Licenses);")
            cols = [r[1] for r in cur.fetchall()]
            
            cur.execute("DELETE FROM Licenses WHERE Key = 'STATION-MONITOR-ENTERPRISE-UNLIMITED';")
            
            import uuid
            row_id = str(uuid.uuid4())
            
            insert_cols = ['Id', 'Key', 'Tier', 'MaxUsers', 'ExpiresAt', 'ActivatedAt', 'IsActive']
            insert_vals = [row_id, 'STATION-MONITOR-ENTERPRISE-UNLIMITED', 'ent', 99999, '2099-12-31 23:59:59', datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), 1]
            
            extra_limits = ['MaxStations', 'MaxCameras', 'MaxRoiPoints', 'MaxRoiRegions', 'MaxPdRegions']
            for limit in extra_limits:
                if limit in cols:
                    insert_cols.append(limit)
                    insert_vals.append(99999)
                    
            query = f'INSERT INTO Licenses ({", ".join(insert_cols)}) VALUES ({", ".join(["?"] * len(insert_vals))});'
            cur.execute(query, tuple(insert_vals))
            conn.commit()
            print(f"✅ Đã áp dụng thành công trên SQLite tại: {found_db} (table 'Licenses')!")
            applied = True
            
        elif has_license_keys:
            cur.execute("PRAGMA table_info(LicenseKeys);")
            cols = [r[1] for r in cur.fetchall()]
            
            cur.execute("DELETE FROM LicenseKeys WHERE Key = 'STATION-MONITOR-ENTERPRISE-UNLIMITED';")
            
            import uuid
            row_id = str(uuid.uuid4())
            
            insert_cols = ['Id', 'Key', 'IssuedTo', 'MaxConcurrentSessions', 'IsActive', 'CreatedAt']
            insert_vals = [row_id, 'STATION-MONITOR-ENTERPRISE-UNLIMITED', 'Enterprise Central Station', 99999, 1, datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')]
            
            if 'ExpiresAt' in cols:
                insert_cols.append('ExpiresAt')
                insert_vals.append('2099-12-31 23:59:59')
                
            query = f'INSERT INTO LicenseKeys ({", ".join(insert_cols)}) VALUES ({", ".join(["?"] * len(insert_vals))});'
            cur.execute(query, tuple(insert_vals))
            conn.commit()
            print(f"✅ Đã áp dụng thành công trên SQLite tại: {found_db} (table 'LicenseKeys')!")
            applied = True
            
        conn.close()
        return applied
    except Exception as e:
        print("❌ Lỗi khi kết nối/truy vấn SQLite:", e)
        return False

def main():
    print("=== STATIONOS LICENSE AUTO-ACTIVATOR ===")
    
    conn_params = None
    settings_path = find_appsettings()
    if settings_path:
        print(f"Đang đọc cấu hình từ: {settings_path}")
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                conn_str = config.get('ConnectionStrings', {}).get('Default', '')
                if conn_str and 'CHANGE_ME' not in conn_str:
                    conn_params = parse_connection_string(conn_str)
        except Exception as e:
            print(f"⚠️  Không thể đọc appsettings.json: {e}")
            
    if not conn_params:
        print("Sử dụng cấu hình kết nối mặc định của PostgreSQL (localhost:6432)...")
        conn_params = {
            'host': 'localhost',
            'port': '6432',
            'database': 'StationOS_Central',
            'username': 'postgres',
            'password': 'postgres123'
        }
        
    pg_applied = apply_postgres(conn_params)
    sqlite_applied = apply_sqlite()
    
    if pg_applied or sqlite_applied:
        print("\n🎉 Kích hoạt hoàn tất! Key bản quyền: STATION-MONITOR-ENTERPRISE-UNLIMITED")
    else:
        print("\n❌ Không thể tự động áp dụng bản quyền. Vui lòng kiểm tra CSDL đang chạy.")

if __name__ == '__main__':
    main()
