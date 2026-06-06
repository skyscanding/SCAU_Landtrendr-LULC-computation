# SCAU Landtrendr + LULC Computation

SVM-based LULC classification for the Dabaoshan mine-area study, runnable
both inside the Google Earth Engine Code Editor (JavaScript) and locally
from Python (driving the same GEE backend).

This repository is one of two sibling repos that together form the full
analysis pipeline:

- **This repo** (`SCAU_Landtrendr-LULC-computation`): GEE-side LandTrendr
  disturbance detection and SVM LULC classification, producing annual
  disturbance rasters (YOD/MAG/DUR/MPY) and classified LULC maps.
- **[SCAU_ecosystem-service-computation](https://github.com/skyscanding/SCAU_ecosystem-service-computation)**:
  Downstream Python pipeline that ingests those GeoTIFFs and runs the
  full analysis chain — LULC trends, landscape metrics, InVEST-style
  ecosystem services, and statistical coupling.

## What's in here

**gee_scripts/**: original JS, paste into GEE Code Editor
- `samples/training_samples.js`: hand-digitized training points (5 classes: water, built_up, unrestored, recovering, stable_vegetation) plus the AOI FeatureCollection. Paste this first to create the Geometry Imports.
- `single_year/landsat_svm.js`: Landsat 7/8/9 single year (2014), SR + TOA median composites, 6 spectral indices, RBF-SVM, exports 4 GeoTIFFs.
- `single_year/sentinel2_svm.js`: Sentinel-2 single year (2018), Cloud Score+ masking, 10 m resolution.
- `multi_year/lulc_multiyear_strict.js`: production pipeline (2000-2025), GLCM textures, class-balanced sampling, z-score normalization, best per year by OA + Kappa.
- `multi_year/lulc_multiyear_lenient.js`: relaxed variant (2023-2026), no texture or balancing, gamma=0.1, cost=10.
- `landtrendr/landtrendr_disturbance.js`: LandTrendr temporal segmentation (NBR 2009-2024), exports YOD/MAG/DUR/MPY rasters with disturbance masking.

**python/**: local Python equivalents
- `00_authenticate.py`: one-time GEE auth helper, opens browser, writes credentials.
- `01_load_samples.py`: loads training points from GEE assets or local GeoJSON.
- `02_landsat_svm_multiyear.py`: driver for the strict multi-year LULC pipeline (now 2000-2025 default). Use `--output-name lulc_{year}` for eco repo compatibility.
- `03_sentinel2_svm.py`: driver for single-year Sentinel-2 classification.
- `04_landtrendr_export.py`: driver for LandTrendr disturbance detection and raster export.
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
   - `gee_scripts/multi_year/lulc_multiyear_strict.js`: Landsat, multi-year (2000-2025), 15 features with GLCM textures
   - `gee_scripts/multi_year/lulc_multiyear_lenient.js`: Landsat, multi-year (2023-2026), 12 features, tuned hyperparameters

4. **Run the script.** Click **Run**. The console will print composite generation progress, per-sensor SVM accuracy (OA and Kappa), and a per-year best-sensor selection log. Classified layers appear on the map.

5. **Export results.** Open the **Tasks** tab. Each successfully classified year/sensor combo generates one export task. Click **Run** on each to launch the Drive export. GeoTIFFs land in your Google Drive folder (single-year scripts use `Landsat_SVM_Classification` and `Sentinel_SVM_Classification`; multi-year scripts use `Journal_landsat+SVM`).

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
       --start-year 2000 --end-year 2025 \
       --aoi-asset projects/ee-skyscanding/assets/Final_Reprojected_zxy \
       --water-asset users/YOU/water \
       --built-up-asset users/YOU/builtUp \
       --unrestored-asset users/YOU/unrestoredLand \
       --recovering-asset users/YOU/restoring \
       --stable-veg-asset users/YOU/stableVegetation \
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
    Expect dtype `uint8`, class codes in `{1,2,3,4,5}`. The CRS defaults to
    `EPSG:32649` (UTM zone 49N, suitable for the Shaoguan / northern Guangdong
    study area). For other regions, change the `crs` parameter in the export
    call to match your local UTM zone (e.g. `EPSG:32650` for zone 50N).
    See `docs/setup_instructions.md` for troubleshooting common issues (429
    rate limits, download size caps, missing samples).

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

## 中文说明

本仓库是大宝山矿区生态修复研究的两个兄弟仓库之一，共同构成完整的分析流程：

- **本仓库**（`SCAU_Landtrendr-LULC-computation`）：GEE 端 LandTrendr 干扰检测和 SVM 土地利用分类，输出年度干扰栅格（YOD/MAG/DUR/MPY）和分类 LULC 地图。
- **[SCAU_ecosystem-service-computation](https://github.com/skyscanding/SCAU_ecosystem-service-computation)**：下游 Python 分析管线，读入上述 GeoTIFF 并执行 LULC 趋势、景观格局、InVEST 生态系统服务和统计耦合分析。

### 内容概览

**gee_scripts/** — GEE Code Editor 中直接粘贴运行的 JS 脚本
- `samples/training_samples.js` — 手标训练样本点（5 类：水体、建设用地、未恢复地、恢复中、稳定植被）和 AOI 边界。
- `single_year/landsat_svm.js` — Landsat 7/8/9 单年（2014），SR+TOA 中值合成，6 个光谱指数，RBF-SVM 分类。
- `single_year/sentinel2_svm.js` — Sentinel-2 单年（2018），Cloud Score+ 云掩膜，10 m 分辨率。
- `multi_year/lulc_multiyear_strict.js` — 多年生产管线（2000-2025），GLCM 纹理、类别均衡、z-score 归一化，按 OA+Kappa 选最优传感器。
- `multi_year/lulc_multiyear_lenient.js` — 宽松版（2023-2026），无纹理无均衡，gamma=0.1，cost=10。
- `landtrendr/landtrendr_disturbance.js` — LandTrendr 时间分割（NBR 2009-2024），使用 emaprlab 模块，输出 YOD/MAG/DUR/MPY。

**python/** — 本地 Python 命令行驱动
- `00_authenticate.py` — 一次性 GEE 认证。
- `01_load_samples.py` — 从 GEE 资产或本地 GeoJSON 加载训练样本。
- `02_landsat_svm_multiyear.py` — 严格版多年分类驱动，默认 2000-2025。使用 `--output-name lulc_{year}` 可匹配下游 eco 仓库的文件名约定。
- `03_sentinel2_svm.py` — Sentinel-2 单年分类驱动。
- `04_landtrendr_export.py` — LandTrendr 干扰检测与栅格导出驱动。
- `lib/` — 共享工具库（云掩膜、合成、指数、SVM 分类、IO），每个函数仅定义一次。
- `notebooks/walkthrough.ipynb` — 端到端 Jupyter 演示。

**docs/** — 安装指南、原始脚本评审、与父仓库集成说明。
**data/** — 本地训练样本存放处（gitignore）。
**outputs/** — 分类 GeoTIFF 输出目录（gitignore）。

### 两种运行方式

**A. GEE Code Editor（原始工作流）**
1. 打开 https://code.earthengine.google.com，新建脚本。
2. 粘贴 `training_samples.js` 创建 Geometry Imports（5 个 FeatureCollection + AOI）。
3. 在下方粘贴一个分类脚本（landsat / sentinel2 / strict / lenient / landtrendr）。
4. 点击 Run，控制台输出合成进度和 SVM 精度（OA、Kappa）。
5. 在 Tasks 面板启动 Drive 导出任务，GeoTIFF 落入 Google Drive。

**B. 本地 Python（推荐用于可重复运行）**
1. 安装依赖：`pip install -r requirements.txt`
2. 认证：`python 00_authenticate.py --project YOUR_PROJECT`
3. 将训练样本上传为 GEE 资产（首次），注意使用地理坐标系 WGS84。
4. 运行多年分类：`python 02_landsat_svm_multiyear.py --project ... --start-year 2000 --end-year 2025 --output-mode local`
5. 输出模式：`--output-mode local` 下载到 `outputs/`（上限 ~32 MiB）；`--output-mode drive` 批量导出到 Drive。
6. 验证：用 rasterio 打开 GeoTIFF，预期 dtype uint8，类别码 1-5，CRS 默认为 EPSG:32649（韶关 UTM zone 49N，其他区域需修改）。

### 原始脚本简评

**优点**：传感器覆盖全面（L7/8/9 SR+TOA，S2+Cloud Score+）。严格版多年管线达到期刊产出标准：GLCM 纹理、类别均衡、z-score 归一化、70/30 划分、OA+Kappa 最优年筛选，低于 0.7 阈值自动丢弃。

**Python 化改进**：共享工具库消除 JS 中的重复代码；`getInfo()` 仅保留在客户端逻辑必需处；CLI 参数替代硬编码年份和路径。

**已知取舍**：单年脚本训练/测试集可重叠（精度偏乐观）；样本过滤仅检查首波段空值；L7 SLC-off 后（2003+）精度可能下降，建议补充 L5 TM；sentinel2 中 GapFill 代码块保留供参考。

## License

This project is licensed under a proprietary license with an Academic Evaluation
Exception for HKU and SCAU. See [LICENSE](./LICENSE) for details.
