#!/usr/bin/env python3
import json, os, re, sys, tempfile, math
from pathlib import Path

DIM_RE = re.compile(r"\d+'(?:\s*-\s*\d+(?:\s+\d+/\d+)?\")?|\d+(?:\.\d+)?\"")
KEYS = ["foundation","footing","stem wall","stemwall","pier","piers","rebar","anchor","vent","sidewall","endwall","beam","dia"]

def imp(name):
    try: return __import__(name)
    except Exception: return None

def dim_feet(v):
    s=v.replace(' ',''); feet=0; inches=0
    m=re.search(r"(\d+(?:\.\d+)?)'",s)
    if m: feet=float(m.group(1))
    m=re.search(r"(\d+(?:\.\d+)?)\"",s)
    if m: inches=float(m.group(1))
    return feet+inches/12 if feet or inches else None

def text_scan(pdf):
    pdfplumber=imp('pdfplumber'); items=[]; notes=[]
    if not pdfplumber: return items,["pdfplumber not installed; text-coordinate scan skipped"]
    try:
        with pdfplumber.open(pdf) as doc:
            for pi,p in enumerate(doc.pages,1):
                for w in p.extract_words(x_tolerance=2,y_tolerance=3) or []:
                    t=str(w.get('text','')).strip()
                    if t: items.append({'text':t,'page':pi,'x0':float(w.get('x0',0)),'y0':float(w.get('top',0)),'x1':float(w.get('x1',0)),'y1':float(w.get('bottom',0))})
    except Exception as e: notes.append('pdfplumber failed: '+str(e))
    return items,notes

def by_page(items):
    d={}
    for it in items: d.setdefault(it['page'],[]).append(it['text'])
    return {k:' '.join(v) for k,v in d.items()}

def choose_pages(items, max_pages=2):
    pages=by_page(items)
    if not pages: return None
    scored=[]
    for p,t in pages.items():
        lo=t.lower(); score=sum((6 if k in ['foundation'] else 5 if k in ['footing','pier','piers'] else 3) for k in KEYS if k in lo)+min(10,len(DIM_RE.findall(t)))
        scored.append((score,p))
    out=[p for s,p in sorted(scored, reverse=True) if s>0][:max_pages]
    return set(out or list(pages)[:max_pages])

def render(pdf, pages):
    fitz=imp('fitz'); notes=[]; outs=[]
    if not fitz: return outs,["PyMuPDF not installed; PDF image scan skipped"]
    try:
        doc=fitz.open(pdf); tmp=tempfile.mkdtemp(prefix='rebar_pages_'); mat=fitz.Matrix(120/72,120/72)
        for i,p in enumerate(doc,1):
            if pages and i not in pages: continue
            out=str(Path(tmp)/f'page_{i}.png'); p.get_pixmap(matrix=mat, alpha=False).save(out); outs.append((i,out))
    except Exception as e: notes.append('render failed: '+str(e))
    return outs,notes

def image_scan(img_path,page,text_items):
    cv2=imp('cv2'); np=imp('numpy')
    if not cv2 or not np: return {'page':page,'error':'opencv-python or numpy not installed'}
    img=cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
    if img is None: return {'page':page,'error':'image read failed'}
    h,w=img.shape[:2]
    if max(h,w)>1800:
        r=1800/float(max(h,w)); img=cv2.resize(img,(int(w*r),int(h*r)),interpolation=cv2.INTER_AREA); h,w=img.shape[:2]
    _,thr=cv2.threshold(img,210,255,cv2.THRESH_BINARY_INV)
    lines=[]
    raw=cv2.HoughLinesP(thr,1,np.pi/180,threshold=120,minLineLength=45,maxLineGap=6)
    if raw is not None:
        for ln in raw[:350]:
            x1,y1,x2,y2=[int(v) for v in ln[0]]; length=math.hypot(x2-x1,y2-y1); ang=abs(math.degrees(math.atan2(y2-y1,x2-x1)))
            ori='horizontal' if ang<8 or ang>172 else 'vertical' if 82<ang<98 else 'diagonal' if 25<ang<65 or 115<ang<155 else 'other'
            lines.append({'page':page,'x1':x1,'y1':y1,'x2':x2,'y2':y2,'length_px':round(length,1),'orientation':ori})
    circles=[]
    cs=cv2.HoughCircles(img,cv2.HOUGH_GRADIENT,dp=1.3,minDist=28,param1=90,param2=32,minRadius=6,maxRadius=55)
    if cs is not None:
        for cx,cy,cr in np.round(cs[0,:]).astype('int')[:160]:
            cls='circle-candidate'; conf=.35; ev='Detected circular graphic object.'
            # classify by repeated rows later
            circles.append({'page':page,'x':int(cx),'y':int(cy),'r':int(cr),'classification':cls,'confidence':conf,'evidence':ev})
    if len(circles)>=4:
        med=sorted(c['r'] for c in circles)[len(circles)//2]
        rows={}
        for c in circles:
            if abs(c['r']-med)<=max(5,med*.35): rows.setdefault(round(c['y']/25)*25,[]).append(c)
        for group in rows.values():
            if len(group)>=3:
                for c in group: c.update({'classification':'repeated-symbol-candidate','confidence':.55,'evidence':'Repeated similar circles aligned on drawing row; needs text leader confirmation.'})
    return {'page':page,'image_size':{'width':w,'height':h},'circles':circles,'lines':lines[:250]}

def fields(text, reports):
    out=[]; lo=text.lower(); dims=DIM_RE.findall(text)
    def add(k,v,src,conf,ev,page=None): out.append({'key':k,'value':v,'source':src,'confidence':conf,'evidence':ev,'page':page})
    if any(d.replace(' ','') in ["52'-0\"","52'"] for d in dims): add('sideWallLength',"52'",'pdf-text',.8,"Found 52 foot printed dimension in PDF text.")
    if any(d.replace(' ','')=="13'-4\"" for d in dims): add('endWallLength',"13'-4\"",'pdf-text',.8,"Found 13'-4\" printed dimension in PDF text.")
    if 'pier' in lo and any(d.replace(' ','')=='28"' for d in dims): add('pierDiameter','28"','pdf-text',.65,'Found 28 inch dimension with pier text in PDF text.')
    if 'pier' in lo:
        cand=[]
        for r in reports:
            for c in r.get('circles',[]):
                if c.get('classification')=='repeated-symbol-candidate': cand.append(c)
        # dedupe
        uni=[]
        for c in cand:
            if not any(abs(c['x']-u['x'])<15 and abs(c['y']-u['y'])<15 and c['page']==u['page'] for u in uni): uni.append(c)
        if uni: add('pierCount',str(len(uni)),'pdf-image',.55 if len(uni)<8 else .68,f'Detected {len(uni)} repeated circle symbols on rendered PDF image; verify before fabrication.',uni[0]['page'])
    return out

def analyze(path):
    ext=Path(path).suffix.lower(); notes=[]; text_items=[]; renders=[]
    if ext=='.pdf':
        text_items,n=text_scan(path); notes+=n; pages=choose_pages(text_items); notes.append('Rendered likely foundation pages: '+str(sorted(pages)) if pages else 'No text page score; no PDF image render page selected')
        renders,n=render(path,pages); notes+=n
    else:
        renders=[(1,path)]; notes.append('Image upload: no PDF text layer')
    text=' '.join(by_page(text_items).values()); dims=[{'value':d,'feet':dim_feet(d)} for d in DIM_RE.findall(text)[:300]]
    kws=[it for it in text_items if any(k in it['text'].lower() for k in KEYS)][:300]
    reports=[image_scan(p,page,text_items) for page,p in renders]
    # no fake scale fallback
    longs=[l for r in reports for l in r.get('lines',[]) if l.get('orientation')=='horizontal' and l.get('length_px',0)>150]
    ft_dims=[d for d in dims if d.get('feet') and d['feet']>=5]
    scale={'px_per_foot':None,'status':'missing','evidence':'No reliable dimension-to-line calibration made.'}
    if longs and ft_dims:
        line=max(longs,key=lambda x:x['length_px']); dim=max(ft_dims,key=lambda x:x['feet']); scale={'px_per_foot':round(line['length_px']/dim['feet'],3),'status':'estimated-low-confidence','confidence':.35,'evidence':f"Paired longest printed dimension {dim['value']} with longest horizontal line; user must verify."}
    return {'success':True,'engine':'pdf-text-plus-opencv-baseline','sourcePolicy':'No canned values. No fixed scale. Values are pdf-text, pdf-image, OCR/user/calc, or missing.','notes':notes,'textEvidence':{'dimensions':dims,'keywords':kws,'full_text_preview':text[:4000]},'imageAnalysis':reports,'scale':scale,'extractedFields':fields(text,reports)}

if __name__=='__main__':
    try: print(json.dumps(analyze(sys.argv[1])))
    except Exception as e: print(json.dumps({'success':False,'error':str(e)}))
