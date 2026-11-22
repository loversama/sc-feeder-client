"""Slim the website's FleetYards top-view snapshot to {class: url} for the desktop overlay.
usage: python3 -I overlay-topviews-slim.py <web data/fleetyards-topviews.json> <out.json>"""
import json
import sys

d = json.load(open(sys.argv[1]))
out = {k: v['topView'] for k, v in d['ships'].items() if v.get('topView')}
json.dump({'source': d['source'], 'fetchedAt': d['fetchedAt'], 'ships': out}, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(out))
