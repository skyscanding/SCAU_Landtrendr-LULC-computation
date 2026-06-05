# GEE_LULC_SVM

SVM-based LULC classification for the Dabaoshan mine-area study, runnable
both inside the Google Earth Engine Code Editor (JavaScript) and locally
from Python (driving the same GEE backend).

This module is designed to drop into the
[`SCAU_ecosystem-service-computation`](https://github.com/skyscanding/SCAU_ecosystem-service-computation)
repository as a self-contained submodule. The classification outputs here
feed downstream ecosystem-service computations in the parent repo.

## What's in here

**gee_scripts/**: original JS, paste into GEE Code Editor
- `samples/training_samples.js`: hand-digitized training points (5 classes: water, builtUp, unrestoredLand, restoring, stableVegetation) plus the AOI FeatureCollection. Paste this first to create the Geometry Imports.
- `single_year/landsat_svm.js`: Landsat 7/8/9 single year (2014), SR + TOA median composites, 6 spectral indices, RBF-SVM, exports 4 GeoTIFFs.
- `single_year/sentinel2_svm.js`: Sentinel-2 single year (2018), Cloud Score+ masking, 10 m resolution.
- `multi_year/lulc_multiyear_strict.js`: production pipeline (2000-2024), GLCM textures, class-balanced sampling, z-score normalization, best per year by OA + Kappa.
- `multi_year/lulc_multiyear_lenient.js`: relaxed variant (2023-2026), no texture or balancing, gamma=0.1, cost=10.

**python/**: local Python equivalents
- `00_authenticate.py`: one-time GEE auth helper, opens browser, writes credentials.
- `01_load_samples.py`: loads training points from GEE assets or local GeoJSON.
- `02_landsat_svm_multiyear.py`: driver for the strict multi-year pipeline.
- `03_sentinel2_svm.py`: driver for single-year Sentinel-2 classification.
- `lib/`: shared helpers: `cloud_mask.py`, `composites.py`, `indices.py`, `io_utils.py`, `svm_classify.py`. Each helper exists exactly once.
- `notebooks/walkthrough.ipynb`: end-to-end Jupyter demo.

**docs/**
- `setup_instructions.md`: step-by-step: GCP project, dependencies, auth, running, verifying, troubleshooting.
- `assessment.md`: code review of all 5 JS scripts.
- `integration_with_parent.md`: how to add this as a submodule or vendored folder.

**data/**: gitignored except `.gitkeep`. Place local training samples here.

**outputs/**: gitignored except `.gitkeep`. Classification GeoTIFFs land here with `--output-mode local`.

**requirements.txt**: Python dependencies (`earthengine-api`, `rasterio`, `geopandas`).

## Two ways to run

### A. GEE Code Editor (original workflow)

1. **Open the Code Editor** at https://code.earthengine.google.com and create a new script.

2. **Import training samples.** Paste the entire contents of `gee_scripts/samples/training_samples.js`. This creates 5 FeatureCollections (`water`, `builtUp`, `unrestoredLand`, `restoring`, `stableVegetation`) and the AOI (`cc`, `table`) as Geometry Imports in the editor sidebar.

3. **Pick and paste a classification script.** Below the imports block, paste one of:
   - `gee_scripts/single_year/landsat_svm.js`: Landsat 7/8/9, single year (2014), 12 bands
   - `gee_scripts/single_year/sentinel2_svm.js`: Sentinel-2, single year (2018), 12 bands
   - `gee_scripts/multi_year/lulc_multiyear_strict.js`: Landsat, multi-year (2000-2024), 15 features with GLCM textures
   - `gee_scripts/multi_year/lulc_multiyear_lenient.js`: Landsat, multi-year (2023-2026), 12 features, tuned hyperparameters

4. **Run the script.** Click **Run**. The console will print composite generation progress, per-sensor SVM accuracy (OA and Kappa), and a per-year best-sensor selection log. Classified layers appear on the map.

5. **Export results.** Open the **Tasks** tab. Each successfully classified year/sensor combo generates one export task. Click **Run** on each to launch the Drive export. GeoTIFFs land in your Google Drive folder (single-year scripts use `ZXY研究区监督土地分类_Landsa新用SVM` and `监督土地分类Sentinel版`; multi-year scripts use `Journal_landsat+SVM`).

### B. Local Python (recommended for repeatable runs)

1. **Install dependencies.**
   ```bash
   cd GEE_LULC_SVM
   python -m venv .venv && source .venv/bin/activate   # or uv / conda
   pip install -r requirements.txt
   ```

2. **Authenticate with Earth Engine (once per machine).** This opens a browser for OAuth.
   ```bash
   python python/00_authenticate.py --project YOUR_GCP_PROJECT_ID
   ```
   Your GCP project must have the Earth Engine API enabled. See `docs/setup_instructions.md` for the full walkthrough.

3. **Upload training samples as GEE assets (first time only).** The JS imports don't carry over to Python. Paste `gee_scripts/samples/training_samples.js` into the Code Editor, then use `Export.table.toAsset()` for each FeatureCollection (water, builtUp, unrestoredLand, restoring, stableVegetation). Run the export tasks, then note each asset path (e.g. `users/YOU/water`).

4. **Run the multi-year strict pipeline.**
   ```bash
   python python/02_landsat_svm_multiyear.py \
       --project YOUR_GCP_PROJECT_ID \
       --start-year 2000 --end-year 2024 \
       --aoi-asset projects/ee-skyscanding/assets/Final_Reprojected_zxy \
       --water-asset users/YOU/water \
       --builtup-asset users/YOU/builtUp \
       --unrestored-asset users/YOU/unrestoredLand \
       --restoring-asset users/YOU/restoring \
       --stableveg-asset users/YOU/stableVegetation \
       --output-mode local
   ```
   The script loops through each year, builds composites, adds indices and textures, normalizes, classifies, evaluates accuracy, picks the best sensor, and exports. A progress log prints to stdout with per-year OA and Kappa scores.

5. **Choose output mode.** `--output-mode local` downloads GeoTIFFs directly to `outputs/` via `getDownloadURL` (cap: ~32 MiB per request: fine for single-band AOI-sized classifications). For larger AOIs, use `--output-mode drive` to batch-export to your Google Drive instead.

6. **Verify outputs.**
   ```python
   import rasterio
   with rasterio.open("outputs/2014_Landsat7_SR_Classification_SVM_Best.tif") as src:
       print(src.profile)
   ```
   Expect CRS `EPSG:32649`, dtype `uint8`, class codes in `{1,2,3,4,5}`. See `docs/setup_instructions.md` for troubleshooting common issues (429 rate limits, download size caps, missing samples).

## Quick assessment of the original scripts

A full code review lives in `docs/assessment.md`. Key takeaways:

**Strengths across all scripts:**
- Comprehensive sensor coverage: Landsat 7/8/9 SR and TOA (30 m), Sentinel-2 SR with Cloud Score+ (10 m).
- The multi-year strict pipeline (`lulc_multiyear_strict.js`) is genuinely publication-grade: GLCM texture features (Contrast, Entropy, Homogeneity) from NDVI, class-balanced sampling that equalizes each class to the smallest, per-band z-score normalization for RBF-SVM, a clean 70/30 train/test split with fixed seed, and a best-per-year selection gated on OA + Kappa. Years where both metrics fall below 0.7 are discarded and not exported.
- The lenient variant (`lulc_multiyear_lenient.js`) uses tuned hyperparameters (gamma=0.1, cost=10) that are more defensible for normalized inputs than the strict version's gamma=1.

**Areas tightened in the Python port:**
- Shared helpers (`cloud_mask.py`, `indices.py`, `svm_classify.py`) replace ~4 duplicated copies across the JS files.
- `getInfo()` calls are kept only where the value drives client-side logic; the rest stays server-side for efficiency.
- CLI argument parsing replaces hardcoded years and asset paths, making batch re-runs trivial.

**Known trade-offs (documented, not fixed):**
- The single-year scripts use overlapping train/test sets (different random seeds), which yields optimistic accuracy estimates. The strict multi-year pipeline uses a proper 70/30 split with no overlap.
- Sample filtering checks only the first band for null values; if subsequent bands are masked the sample still slips through. The Python `lib/svm_classify.py` keeps this behavior to match the JS output exactly.
- Landsat 7 SLC-off gaps (post-2003) are tolerated by median compositing but may degrade accuracy in 2003-2012. Consider adding Landsat 5 TM for those years.
- The commented-out GapFill block in `sentinel2_svm.js` (~70 lines) is preserved for reference but not active.

## License

This project is licensed under a proprietary license with an Academic Evaluation
Exception for HKU and SCAU. See [LICENSE](./LICENSE) for details.

## 中文说明

本项目基于 Google Earth Engine 平台，使用 SVM（支持向量机，RBF 核）对大宝山矿区
进行土地利用/土地覆盖（LULC）监督分类。支持 Landsat 7/8/9（SR 与 TOA）和
Sentinel-2 影像，提供单年与多年两种运行模式。

**多年严格版**（`lulc_multiyear_strict.js`）为期刊产出设计，包含 GLCM 纹理特征、
类别均衡采样、z-score 归一化和基于 OA+Kappa 的最优年份筛选。

**两种运行方式**：
- 在 GEE Code Editor 中粘贴 `gee_scripts/` 下的 JS 脚本运行
- 使用 `python/` 下的 Python 脚本在本地命令行运行，输出 GeoTIFF 至 `outputs/`
