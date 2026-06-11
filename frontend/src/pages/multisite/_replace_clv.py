#!/usr/bin/env python3
"""Replace CentralLogView component in MultisitePage.tsx."""
import os

target = 'frontend/src/pages/multisite/MultisitePage.tsx'
replacement_file = 'frontend/src/pages/multisite/_new_clv.txt'

with open(target, 'r') as f:
    lines = f.readlines()

# Keep lines 0 through 1696 (1-indexed: 1-1697)
keep = lines[:1697]

# Read replacement code
with open(replacement_file, 'r') as f:
    new_code = f.read()

# Write backup
with open(target + '.bak', 'w') as f:
    f.writelines(lines)

# Write new file
with open(target, 'w') as f:
    f.writelines(keep)
    f.write(new_code)

print(f"Done. Kept {len(keep)} lines + appended replacement ({len(new_code)} chars).")
print(f"Backup at {target}.bak")
