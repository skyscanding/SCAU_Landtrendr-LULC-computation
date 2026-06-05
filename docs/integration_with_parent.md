# Integrating with `SCAU_ecosystem-service-computation`

This module is intended to live alongside whatever ecosystem-service
calculation code the parent repo already contains. The classification
outputs (annual LULC GeoTIFFs in `EPSG:32649`, class codes 1–5) are the
primary handoff.

## Adding the submodule to the parent repo

### Option 1 — vendor the folder directly (simple, recommended)

From the parent repo root:

```bash
# After unzipping this package, copy the folder in
cp -r /path/to/unzipped/GEE_LULC_SVM ./

# Stage & commit
git add GEE_LULC_SVM
git commit -m "Add GEE_LULC_SVM module: SVM-based LULC classification pipeline"
git push
```

Pros: a single repo, everything diffs together, no submodule headaches.
Cons: future updates to `GEE_LULC_SVM` are tied to the parent repo's
commit history.

### Option 2 — keep `GEE_LULC_SVM` as its own repo and add as a Git submodule

```bash
# In a separate location, init the GEE_LULC_SVM folder as its own repo
cd /path/to/unzipped/GEE_LULC_SVM
git init
git add .
git commit -m "Initial commit"
# Create a new empty repo on GitHub named GEE_LULC_SVM, then:
git remote add origin git@github.com:skyscanding/GEE_LULC_SVM.git
git branch -M main
git push -u origin main

# In the parent repo
cd /path/to/SCAU_ecosystem-service-computation
git submodule add git@github.com:skyscanding/GEE_LULC_SVM.git GEE_LULC_SVM
git commit -m "Add GEE_LULC_SVM as submodule"
git push
```

Pros: independent versioning; you can reuse `GEE_LULC_SVM` in other
projects. Cons: requires `git submodule update --init --recursive` on
fresh clones, and the parent repo only pins a specific commit.

> Without seeing the parent repo's existing structure I'd lean toward
> **Option 1**. If you're collaborating with classmates and they're
> already comfortable with submodules, switch to Option 2.

## How the data flows between the two

```
                  ┌───────────────────────────────┐
                  │ GEE_LULC_SVM (this module)    │
                  │                               │
                  │   training samples + AOI      │
                  │             │                 │
                  │             ▼                 │
                  │   GEE classification job      │
                  │             │                 │
                  │             ▼                 │
                  │   outputs/{year}_*.tif        │  ◀── EPSG:32649, uint8, codes 1–5
                  └─────────────┬─────────────────┘
                                │
                                ▼
                  ┌───────────────────────────────┐
                  │ Parent repo                   │
                  │                               │
                  │  reads outputs/{year}_*.tif   │
                  │             │                 │
                  │             ▼                 │
                  │  per-class area, transition   │
                  │  matrices, ESV / InVEST runs  │
                  │             │                 │
                  │             ▼                 │
                  │  ecosystem-service tables /   │
                  │  spatial layers               │
                  └───────────────────────────────┘
```

If the parent repo expects inputs at a specific path, edit
`python/02_landsat_svm_multiyear.py`'s `--output-dir` default (line in
the argparse block) and re-run.

## Suggested .gitignore changes for the parent repo

Add these at the parent repo root if not already present:

```
# GEE_LULC_SVM intermediate files
GEE_LULC_SVM/data/*
!GEE_LULC_SVM/data/.gitkeep
GEE_LULC_SVM/outputs/*
!GEE_LULC_SVM/outputs/.gitkeep
GEE_LULC_SVM/.venv/
GEE_LULC_SVM/**/__pycache__/
```

Outputs can be many gigabytes for a 25-year run at 30 m; you don't want
to commit them.

## Reusing the Python lib from parent-repo scripts

```python
import sys
from pathlib import Path

# Adjust if your script lives elsewhere
sys.path.insert(0, str(Path(__file__).parent / "GEE_LULC_SVM" / "python"))

from lib import add_all_indices, landsat_sr_annual_composite
# ... your ecosystem-service computation code here
```

If you'd rather install it as a proper package (`pip install -e
./GEE_LULC_SVM`), add a minimal `pyproject.toml` to the module. Happy to
flesh that out in a follow-up if it would help.
