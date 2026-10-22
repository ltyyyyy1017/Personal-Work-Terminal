"""Local-only OCR worker. Receives file bytes through stdin; never uploads documents."""
import sys, json, io, base64, contextlib, os
os.environ.setdefault('OMP_NUM_THREADS','1')
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
engine=None
def process(request):
    global engine
    data=base64.b64decode(request['data'],validate=True)
    if len(data)>16*1024*1024:raise ValueError('File too large')
    if request.get('mode')=='spreadsheet':
        from python_calamine import CalamineWorkbook
        book=CalamineWorkbook.from_filelike(io.BytesIO(data));rows=[]
        for name in book.sheet_names[:20]:
            rows.append(name)
            for row in book.get_sheet_by_name(name).to_python():
                if len(rows)>10000:raise ValueError('Spreadsheet row limit')
                rows.append('\t'.join(v.isoformat() if hasattr(v,'isoformat') else str(v) if v is not None else '' for v in row[:80]))
        return {'text':'\n'.join(rows),'engine':'calamine'}
    from PIL import Image
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:pass
    source=Image.open(io.BytesIO(data))
    if source.width*source.height>30_000_000:raise ValueError('Image size limit')
    import numpy as np, cv2
    cv2.setNumThreads(1)
    image=cv2.imdecode(np.frombuffer(data,dtype=np.uint8),cv2.IMREAD_COLOR)
    if image is None:
        from PIL import Image
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:pass
        source=Image.open(io.BytesIO(data))
        if source.width*source.height>30_000_000:raise ValueError('Image size limit')
        image=cv2.cvtColor(np.array(source.convert('RGB')),cv2.COLOR_RGB2BGR)
    if image.shape[0]*image.shape[1]>30_000_000:raise ValueError('Image size limit')
    if engine is None:
        from rapidocr import RapidOCR
        engine=RapidOCR(params={'Global.log_level':'error','EngineConfig.onnxruntime.intra_op_num_threads':1,'EngineConfig.onnxruntime.inter_op_num_threads':1})
    result=engine(image);cells=[]
    if result.boxes is not None:
        for box,text,score in zip(result.boxes,result.txts,result.scores):
            xs=[float(p[0]) for p in box];ys=[float(p[1]) for p in box]
            cells.append({'str':text,'x':min(xs),'y':-min(ys),'width':max(xs)-min(xs),'height':max(ys)-min(ys),'score':float(score)})
    return {'cells':cells,'confidence':sum(c['score'] for c in cells)/max(1,len(cells)),'engine':'RapidOCR 3.10.0'}
for line in sys.stdin:
    if len(line)>24*1024*1024:break
    request={}
    try:
        request=json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):result=process(request)
        print(json.dumps({'id':request['id'],**result},ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id'),'error':type(error).__name__}),flush=True)
