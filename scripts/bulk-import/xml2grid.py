import sys, json, re
from xml.etree.ElementTree import iterparse
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
src, out = sys.argv[1], sys.argv[2]
def colidx(ref):
    n=0
    for ch in ref:
        if ch.isalpha(): n=n*26+ord(ch.upper())-64
        else: break
    return n-1
rows=[]
for ev, el in iterparse(src, events=('end',)):
    if el.tag==NS+'row':
        r=int(el.get('r'))-1
        cells={}
        for c in el.findall(NS+'c'):
            t=c.get('t'); v=None
            if t=='inlineStr':
                v=''.join(x.text or '' for x in c.iter(NS+'t'))
            else:
                ve=c.find(NS+'v')
                if ve is not None and ve.text is not None:
                    v=float(ve.text) if t in (None,'n') else ve.text
                    if isinstance(v,float) and v.is_integer(): v=int(v)
            if v is not None and v!='': cells[colidx(c.get('r'))]=v
        while len(rows)<r: rows.append([])
        line=[None]*(max(cells)+1) if cells else []
        for k,v in cells.items(): line[k]=v
        rows.append(line)
        el.clear()
    elif el.tag==NS+'mergeCell': el.clear()
json.dump(rows, open(out,'w'), ensure_ascii=False)
print(len(rows))
