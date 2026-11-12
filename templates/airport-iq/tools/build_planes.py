import numpy as np, trimesh, os
from trimesh.transformations import rotation_matrix as R
from trimesh.visual.material import PBRMaterial
from trimesh.visual import TextureVisuals

OUT = r'C:\Users\alkorn\repos\Airport-IQ\apps\live-approach\views\approach\models'
os.makedirs(OUT, exist_ok=True)

def mat(rgb, metal=0.05, rough=0.65):
    return PBRMaterial(baseColorFactor=[rgb[0]/255, rgb[1]/255, rgb[2]/255, 1.0],
                       metallicFactor=metal, roughnessFactor=rough)
BODY=(236,240,248); ENG=(52,60,74); FIN=(118,140,178)

def cyl_x(r, h, sec=18):
    m = trimesh.creation.cylinder(radius=r, height=h, sections=sec)
    m.apply_transform(R(np.pi/2, [0,1,0]))   # length Z -> X
    return m
def cone_x(r, h, plus=True):
    m = trimesh.creation.cone(radius=r, height=h, sections=18)  # apex at +Z
    m.apply_transform(R(np.pi/2 if plus else -np.pi/2, [0,1,0]))  # apex -> +X (or -X)
    return m
def box(dx,dy,dz):
    return trimesh.creation.box(extents=[dx,dy,dz])

def build(spec):
    L=spec['len']; r=spec['rad']; span=spec['span']; quad=spec['quad']; deck2=spec['deck2']
    body=[]
    fus = cyl_x(r, L*0.86)
    if deck2: fus.apply_scale([1,1,1.18])
    body.append(fus)
    nose = cone_x(r*0.98, r*2.6, plus=True);  nose.apply_translation([L*0.43, 0, 0]); body.append(nose)
    tail = cone_x(r*0.9,  r*3.0, plus=False); tail.apply_translation([-L*0.43, 0, r*0.35]); body.append(tail)
    # wings (swept: two trapezoid-ish thin boxes, angled back)
    for sgn in (1,-1):
        w = box(r*2.6, span*0.5, r*0.24)
        w.apply_transform(R(np.radians(-22)*sgn, [1,0,0]))  # slight dihedral off? keep flat -> use z shear via rotation about X small
        w.apply_translation([-L*0.02, sgn*span*0.27, -r*0.35])
        body.append(w)
    # horizontal stabiliser
    for sgn in (1,-1):
        h = box(r*1.7, span*0.2, r*0.2); h.apply_translation([-L*0.42, sgn*span*0.11, r*0.15]); body.append(h)
    # vertical fin (separate colour)
    fin = box(r*1.9, r*0.28, r*(3.4 if deck2 else 2.9)); fin.apply_translation([-L*0.42, 0, r*(1.9 if deck2 else 1.6)])
    # engines
    engs=[]
    er=r*0.52; el=r*2.6; ez=-r*0.95; ex=L*0.02
    offs = [span*0.18, span*0.34] if quad else [span*0.28]
    for o in offs:
        for sgn in (1,-1):
            n = cyl_x(er, el); n.apply_translation([ex, sgn*o, ez]); engs.append(n)

    bodyMesh = trimesh.util.concatenate(body); bodyMesh.visual = TextureVisuals(material=mat(BODY))
    engMesh  = trimesh.util.concatenate(engs); engMesh.visual  = TextureVisuals(material=mat(ENG, metal=0.2, rough=0.5))
    fin.visual = TextureVisuals(material=mat(FIN, rough=0.5))
    scene = trimesh.Scene({'body':bodyMesh, 'engines':engMesh, 'fin':fin})
    return scene

FAM = {
  'regional': dict(len=26, rad=1.5, span=26, quad=False, deck2=False),
  'narrow':   dict(len=38, rad=2.0, span=36, quad=False, deck2=False),
  'wide2':    dict(len=60, rad=3.0, span=60, quad=False, deck2=False),
  'quad':     dict(len=70, rad=3.3, span=64, quad=True,  deck2=False),
  'super':    dict(len=73, rad=3.9, span=80, quad=True,  deck2=True),
}
for fam,spec in FAM.items():
    sc = build(spec)
    p = os.path.join(OUT, fam+'.glb')
    sc.export(p)
    b = sc.bounds
    print(f"{fam:9s} -> {os.path.getsize(p)/1024:.1f} KB  bbox x[{b[0][0]:.1f},{b[1][0]:.1f}] y[{b[0][1]:.1f},{b[1][1]:.1f}] z[{b[0][2]:.1f},{b[1][2]:.1f}]")
