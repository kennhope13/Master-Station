import psycopg2
conn = psycopg2.connect("dbname='StationOS_Central' user='postgres' host='localhost' port='6432' password='postgres123'")
cur = conn.cursor()

print("--- ALL STATIONS ---")
cur.execute("SELECT \"Id\", \"Name\", \"Code\", \"ProvinceId\", \"Location\" FROM \"Stations\";")
for r in cur.fetchall():
    print(r)
