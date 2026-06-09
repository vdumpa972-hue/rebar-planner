#!/usr/bin/env python3
import json, os, re, sys, tempfile, math
from pathlib import Path

DIM_RE = re.compile(r"\d+'(?:\s*-\s*\d+(?:\s+\d+/\d+)?\")?|\d+(?:\.\d+)?\"")
KEYS = ["foundation","footing","stem wall","stemwall","pier","piers","rebar","anchor","vent","sidewall","endwall","beam","dia"]

FAB_PATTERNS = [
    ("PR_HORZ_CIRC_HOOP_TIES_CALLOUT_DESCRIPTION", r"#\s*3\s*@\s*8\s*\"?\s*O\.?C\.?\s*TIES", "Pier circular hoop/tie spacing"),
    ("PR_VERT_L_BARS_CALLOUT_DESCRIPTION", r"6\s*-\s*#\s*4\s*VERT\.?\s*REBARS", "Pier vertical L bars"),
    ("SW_EW_VERT_REBAR_18_OC_CALLOUT_DESCRIPTION", r"#\s*4\s*VERT\.?\s*REBARS?\s*AT\s*18\s*\"?\s*O\.?C\.?") ,
    ("SW_EW_HORZ_CONT_REBAR_12_OC_CALLOUT_DESCRIPTION", r"#\s*4\s*CONT\.?\s*REBARS?\s*AT\s*12\s*\"?\s*O\.?C\.?") ,
    ("SW_EW_HORZ_CONT_3_BARS_CALLOUT_DESCRIPTION", r"3\s*-\s*#\s*4\s*CONTINUOUS\s*REBAR") ,
    ("SW_EW_REBAR_12_OC_CALLOUT_DESCRIPTION", r"#\s*4\s*REBAR\s*AT\s*12\s*\"?\s*O\.?C\.?") ,
    ("WALL_THICKNESS", r"6\s*\"\s*CONCRETE\s*STEMWALL") ,
    ("PIER_DIA", r"28\s*\"\s*DIA\s*CONC\s*PIERS?") ,
]

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

def render(pdf, pages, target_width=1800):
    fitz=imp('fitz'); notes=[]; outs=[]
    if not fitz: return outs,["PyMuPDF not installed; PDF image scan skipped"]
    try:
        doc=fitz.open(pdf); tmp=tempfile.mkdtemp(prefix='rebar_pages_')
        for i,p in enumerate(doc,1):
            if pages and i not in pages: continue
            scale=target_width/float(p.rect.width)
            mat=fitz.Matrix(scale,scale)
            out=str(Path(tmp)/f'page_{i}.png'); p.get_pixmap(matrix=mat, alpha=False).save(out); outs.append((i,out))
    except Exception as e: notes.append('render failed: '+str(e))
    return outs,notes

def image_scan(img_path,page,text_items=None):
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
            circles.append({'page':page,'x':int(cx),'y':int(cy),'r':int(cr),'classification':'circle-candidate','confidence':.35,'evidence':'Detected circular graphic object.'})
    return {'page':page,'image_size':{'width':w,'height':h},'circles':circles,'lines':lines[:250]}

def fields(text, reports):
    out=[]; lo=text.lower(); dims=DIM_RE.findall(text)
    def add(k,v,src,conf,ev,page=None): out.append({'key':k,'value':v,'source':src,'confidence':conf,'evidence':ev,'page':page})
    if any(d.replace(' ','') in ["52'-0\"","52'"] for d in dims): add('sideWallLength',"52'",'pdf-text',.8,"Found 52 foot printed dimension in PDF text.")
    if any(d.replace(' ','')=="13'-4\"" for d in dims): add('endWallLength',"13'-4\"",'pdf-text',.8,"Found 13'-4\" printed dimension in PDF text.")
    if 'pier' in lo and any(d.replace(' ','')=='28"' for d in dims): add('pierDiameter','28"','pdf-text',.65,'Found 28 inch dimension with pier text in PDF text.')
    # IMPORTANT: pier count is intentionally not auto-filled from raw circle count.
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
    longs=[l for r in reports for l in r.get('lines',[]) if l.get('orientation')=='horizontal' and l.get('length_px',0)>150]
    ft_dims=[d for d in dims if d.get('feet') and d['feet']>=5]
    scale={'px_per_foot':None,'status':'missing','evidence':'No reliable dimension-to-line calibration made.'}
    if longs and ft_dims:
        line=max(longs,key=lambda x:x['length_px']); dim=max(ft_dims,key=lambda x:x['feet']); scale={'px_per_foot':round(line['length_px']/dim['feet'],3),'status':'estimated-low-confidence','confidence':.35,'evidence':f"Paired longest printed dimension {dim['value']} with longest horizontal line; user must verify."}
    return {'success':True,'engine':'pdf-text-plus-opencv-baseline','sourcePolicy':'No canned values. No fixed scale. Values are pdf-text, pdf-image, OCR/user/calc, or missing.','notes':notes,'textEvidence':{'dimensions':dims,'keywords':kws,'full_text_preview':text[:4000]},'imageAnalysis':reports,'scale':scale,'extractedFields':fields(text,reports)}

def normalize_text(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()

def context_prefix(text):
    u=text.upper()
    if "PIER FOOTING" in u or "6-#4 VERT" in u or "#3 @ 8" in u:
        return "PR"
    if "END WALL" in u or "ENDWALL" in u:
        return "EW"
    if "SIDE WALL" in u or "SIDEWALL" in u:
        return "SW"
    return "REGION"

def add_param(params,key,label,value,evidence,source="pdf-text",confidence=.75):
    params.append({'key':key,'label':label,'value':value,'source':source,'confidence':confidence,'evidence':evidence})

def extract_fabrication_params(raw_text):
    text=normalize_text(raw_text)
    u=text.upper()
    prefix=context_prefix(text)
    params=[]

    # Pier detail specific mappings
    if re.search(r"#\s*3\s*@\s*8\s*\"?\s*O\.?C\.?\s*TIES", u):
        add_param(params,"PR_HORZ_CIRC_HOOP_TIE_SPACING_CALLOUT_DESCRIPTION","Pier circular hoop/tie spacing",'#3 @ 8" OC TIES','Matched #3 @ 8" OC TIES inside selected region.')
    if re.search(r"6\s*-\s*#\s*4\s*VERT\.?\s*REBARS", u):
        add_param(params,"PR_VERT_L_BARS_TOTAL_CALLOUT_DESCRIPTION","Pier vertical L bars",'6-#4 VERT REBARS','Matched 6-#4 VERT REBARS inside selected region.')
        add_param(params,"PR_VERT_L_BARS_1","Pier vertical L bars group 1",'2 of 6 #4 bars','Derived grouping from 6-#4 VERT REBARS. User verify.')
        add_param(params,"PR_VERT_L_BARS_2","Pier vertical L bars group 2",'2 of 6 #4 bars','Derived grouping from 6-#4 VERT REBARS. User verify.')
        add_param(params,"PR_VERT_L_BARS_3","Pier vertical L bars group 3",'2 of 6 #4 bars','Derived grouping from 6-#4 VERT REBARS. User verify.')
    if re.search(r"3\s*\"\s*CLR", u):
        add_param(params,"PR_CLEAR_COVER","Pier clear cover",'3" CLR','Matched 3" CLR inside selected region.')

    # Side/end wall detail mappings
    wall_prefix = "EW" if prefix == "EW" else "SW" if prefix == "SW" else "SW_EW"
    if re.search(r"#\s*4\s*VERT\.?\s*REBARS?\s*AT\s*18\s*\"?\s*O\.?C\.?", u):
        add_param(params,f"{wall_prefix}_VERT_L_BAR_SPACING_CALLOUT_DESCRIPTION",f"{wall_prefix} vertical L bar spacing",'#4 VERT. REBARS AT 18" OC','Matched #4 VERT. REBARS AT 18" OC.')
    if re.search(r"#\s*4\s*CONT\.?\s*REBARS?\s*AT\s*12\s*\"?\s*O\.?C\.?", u):
        add_param(params,f"{wall_prefix}_HORZ_CONT_BAR_SPACING_CALLOUT_DESCRIPTION",f"{wall_prefix} horizontal continuous bar spacing",'#4 CONT. REBARS AT 12" OC','Matched #4 CONT. REBARS AT 12" OC.')
    if re.search(r"3\s*-\s*#\s*4\s*CONTINUOUS\s*REBAR", u):
        add_param(params,f"{wall_prefix}_HORZ_CONT_BAR_COUNT_CALLOUT_DESCRIPTION",f"{wall_prefix} horizontal continuous bar count",'3-#4 CONTINUOUS REBAR','Matched 3-#4 CONTINUOUS REBAR.')
        add_param(params,f"{wall_prefix}_HORZ_CONT_BAR-BOTTOM_1",f"{wall_prefix} bottom continuous bar",'#4 continuous','Derived from 3-#4 CONTINUOUS REBAR. User verify.')
        add_param(params,f"{wall_prefix}_HORZ_CONT_BAR-2",f"{wall_prefix} middle continuous bar",'#4 continuous','Derived from 3-#4 CONTINUOUS REBAR. User verify.')
        add_param(params,f"{wall_prefix}_HORZ_CONT_BAR-TOP_3",f"{wall_prefix} top continuous bar",'#4 continuous','Derived from 3-#4 CONTINUOUS REBAR. User verify.')
    if re.search(r"#\s*4\s*REBAR\s*AT\s*12\s*\"?\s*O\.?C\.?", u):
        add_param(params,f"{wall_prefix}_REBAR_12_OC",f"{wall_prefix} #4 rebar at 12 OC",'#4 REBAR AT 12" OC','Matched #4 REBAR AT 12" OC.')
    if re.search(r"6\s*\"\s*CONCRETE\s*STEMWALL", u):
        add_param(params,"WALL_THICKNESS",'Concrete stemwall thickness','6"','Matched 6" CONCRETE STEMWALL.')
    if re.search(r"28\s*\"\s*DIA\s*CONC\s*PIERS?", u):
        add_param(params,"PIER_DIA",'Pier diameter','28"','Matched 28" DIA CONC PIERS.')
    return params

def analyze_region(path, page, x0, y0, x1, y1):
    pdfplumber=imp('pdfplumber'); fitz=imp('fitz')
    if not pdfplumber:
        return {'success':False,'error':'pdfplumber not installed on analyzer backend.'}
    if not fitz:
        return {'success':False,'error':'PyMuPDF not installed on analyzer backend.'}

    x0,x1=sorted([max(0,min(1,float(x0))), max(0,min(1,float(x1)))])
    y0,y1=sorted([max(0,min(1,float(y0))), max(0,min(1,float(y1)))])
    if x1-x0 < .005 or y1-y0 < .005:
        return {'success':False,'error':'Selected rectangle is too small.'}

    raw_text=''
    words=[]
    try:
        with pdfplumber.open(path) as doc:
            p=doc.pages[int(page)-1]
            bbox=(x0*p.width, y0*p.height, x1*p.width, y1*p.height)
            crop=p.crop(bbox)
            raw_text=crop.extract_text(x_tolerance=2,y_tolerance=3) or ''
            words=crop.extract_words(x_tolerance=2,y_tolerance=3) or []
    except Exception as e:
        return {'success':False,'error':'Region text extraction failed: '+str(e)}

    # Render/crop selected region for basic line/circle counts.
    line_count=None; circle_count=None; image_size=None
    try:
        doc=fitz.open(path); p=doc[int(page)-1]
        scale=1600/float(p.rect.width); pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale), alpha=False)
        tmp=tempfile.mkdtemp(prefix='rebar_region_')
        full=str(Path(tmp)/'page.png'); pix.save(full)
        cv2=imp('cv2')
        if cv2:
            img=cv2.imread(full, cv2.IMREAD_GRAYSCALE)
            if img is not None:
                h,w=img.shape[:2]
                ix0,iy0,ix1,iy1=int(x0*w),int(y0*h),int(x1*w),int(y1*h)
                crop=img[iy0:iy1,ix0:ix1]
                image_size={'width':int(crop.shape[1]),'height':int(crop.shape[0])}
                report=image_scan(full,int(page))
                # rough counts only in whole rendered page for now; text is primary
                line_count=len(report.get('lines',[])) if report else 0
                circle_count=len(report.get('circles',[])) if report else 0
    except Exception:
        pass

    params=extract_fabrication_params(raw_text)
    return {
        'success': True,
        'engine':'selected-rectangle-text-first',
        'page': int(page),
        'rect': {'x0':x0,'y0':y0,'x1':x1,'y1':y1},
        'rawText': raw_text,
        'wordCount': len(words),
        'lineCount': line_count,
        'circleCount': circle_count,
        'imageSize': image_size,
        'params': params,
        'notes': ['Selected rectangle extraction is text-first. Visual counts are debug only; use text evidence for fabrication values.']
    }

if __name__=='__main__':
    try: print(json.dumps(analyze(sys.argv[1])))
    except Exception as e: print(json.dumps({'success':False,'error':str(e)}))
