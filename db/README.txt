database folder

original.json is the untouched base database.
Each Backup action downloads two files:
1. Ebi-backup-YYYY-MM-DD_HH-MM-SS.json
2. latest.json

Copy both files into this folder. Old dated backups remain as history.
The app reads the filename written in latest.json first, then falls back to Ebi-backup.json, then original.json.
