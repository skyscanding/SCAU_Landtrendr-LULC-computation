# GEE_LULC_SVM

SVM-based LULC classification for the Dabaoshan mine-area study, runnable
both inside the Google Earth Engine Code Editor (JavaScript) and locally
from Python (driving the same GEE backend).

This module is designed to drop into the
[`SCAU_ecosystem-service-computation`](https://github.com/skyscanding/SCAU_ecosystem-service-computation)
repository as a self-contained submodule. The classification outputs here
feed downstream ecosystem-service computations in the parent repo.

## What's in here

```
GEE_LULC_SVM/
├── README.md                       # this file
├── requirements.txt                # Python dependencies
├── docs/
│   ├── setup_instructions.md       # one-time auth + local install
│   ├── assessment.md               # code review of the original JS
│   └── integration_with_parent.md  # how this fits into the SCAU repo
├── gee_scripts/                    # original JS — paste into GEE Code Editor
│   ├── samples/
│   │   └── training_samples.js
│   ├── single_year/
│   │   ├── landsat_svm.js
│   │   └── sentinel2_svm.js
│   └── multi_year/
│       ├── lulc_multiyear_strict.js
│       └── lulc_multiyear_lenient.js
├── python/                         # local Python equivalents
│   ├── 00_authenticate.py
│   ├── 01_load_samples.py
│   ├── 02_landsat_svm_multiyear.py # the strict pipeline, translated
│   ├── 03_sentinel2_svm.py
│   ├── lib/
│   │   ├── __init__.py
│   │   ├── cloud_mask.py
│   │   ├── composites.py
│   │   ├── indices.py
│   │   ├── io_utils.py
│   │   └── svm_classify.py
│   └── notebooks/
│       └── walkthrough.ipynb       # end-to-end demo
├── data/                           # gitignored except .gitkeep — your local inputs
└── outputs/                        # gitignored except .gitkeep — local GeoTIFFs
```

## Two ways to run

### A. GEE Code Editor (original workflow)

1. Open https://code.earthengine.google.com
2. Create a new script.
3. Paste the contents of `gee_scripts/samples/training_samples.js` to create
   the Geometry Imports.
4. Paste the contents of one of:
   - `gee_scripts/single_year/landsat_svm.js`
   - `gee_scripts/single_year/sentinel2_svm.js`
   - `gee_scripts/multi_year/lulc_multiyear_strict.js`
   - `gee_scripts/multi_year/lulc_multiyear_lenient.js`
5. Hit **Run**, then check the Tasks panel to launch the Drive exports.

The classification GeoTIFFs land in your Google Drive — same as the
original workflow.

### B. Local Python (recommended for repeatable runs)

```bash
# 1. From the parent repo root, install dependencies
cd GEE_LULC_SVM
python -m venv .venv && source .venv/bin/activate   # or use uv / conda
pip install -r requirements.txt

# 2. One-time GEE auth — opens a browser
python python/00_authenticate.py --project YOUR_GCP_PROJECT_ID

# 3. Run the multi-year strict pipeline (local download mode)
python python/02_landsat_svm_multiyear.py \
    --project YOUR_GCP_PROJECT_ID \
    --start-year 2000 --end-year 2024 \
    --aoi-asset projects/ee-skyscanding/assets/Final_Reprojected_zxy \
    --water-asset users/yourname/water \
    --builtup-asset users/yourname/builtUp \
    --unrestored-asset users/yourname/unrestoredLand \
    --restoring-asset users/yourname/restoring \
    --stableveg-asset users/yourname/stableVegetation \
    --output-mode local
```

Output GeoTIFFs are written to `outputs/` and are immediately consumable by
the rasterio / geopandas pipelines in the parent repo. For very large AOIs
where `getDownloadURL`'s 32 MiB cap is exceeded, pass `--output-mode drive`
to fall back to the Drive batch-export path.

See `docs/setup_instructions.md` for the detailed auth walkthrough.

## Quick assessment of the original scripts

A full code review lives in `docs/assessment.md`, but the short version:

**Strengths.** Comprehensive sensor coverage (L7 / L8 / L9 SR+TOA, S2 with
Cloud Score+). The multi-year "strict" pipeline is genuinely strong — GLCM
texture features, class-balanced sampling, per-band z-score normalization,
and a best-per-year selection gated on OA + Kappa.

**Things that were worth tightening.** The single-year scripts had a lot of
duplicated code (cloud masks, indices, SVM training), Chinese / English
console output was inconsistent, and heavy `getInfo()` use inside loops
limits scalability. Those concerns shaped how the Python `lib/` is
factored — every helper exists in exactly one place, and `getInfo()`
calls are only used where the value is actually needed client-side.

## License

Add a license at the parent-repo root (MIT is a sensible default for
academic work) — this submodule inherits it.
