#!/usr/bin/env python3
"""Remove the local startup integration after disabling X Brief in about:addons."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data',type=Path,default=Path.home()/'.local/share/x-brief');a=p.parse_args()
metadata=json.loads((a.data/'installation.json').read_text());app=Path(metadata['application'])
for path in [app/'x-brief.cfg',app/'defaults/pref/x-brief-autoconfig.js']:
    if path.exists():path.unlink();print('Removed',path)
print('Restart Zen. Disable X Brief in about:addons before restarting if it is still enabled. Release copies and backups have been preserved.')
