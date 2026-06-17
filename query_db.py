import psycopg2
conn = psycopg2.connect("dbname='StationOS_Central' user='postgres' host='localhost' port='6432' password='postgres123'")
cur = conn.cursor()
cur.execute("SELECT * FROM \"Stations\";")
print("--- SUB-STATIONS ---")
colnames = [desc[0] for desc in cur.description]
for row in cur.fetchall():
    print(dict(zip(colnames, row)))




