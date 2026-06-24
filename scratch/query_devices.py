import psycopg2
import json

conn = psycopg2.connect("dbname='StationOS_Central' user='postgres' host='localhost' port='6432' password='postgres123'")
cur = conn.cursor()

print("--- ALL DEVICES ---")
cur.execute("SELECT \"Id\", \"Name\", \"Type\", \"Protocol\", \"Status\", \"Config\", \"StationId\" FROM \"Devices\";")
for r in cur.fetchall():
    print(f"ID: {r[0]}, Name: {r[1]}, Type: {r[2]}, Protocol: {r[3]}, Status: {r[4]}, StationId: {r[6]}")
    try:
        config = json.loads(r[5])
        print(f"Config: {json.dumps(config, indent=2)}")
    except Exception as e:
        print(f"Config raw: {r[5]}")
    print("-" * 50)
