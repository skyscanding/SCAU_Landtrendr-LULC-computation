# Setup instructions — local Python pipeline

The Python side of `GEE_LULC_SVM` lets you run the same classification
workflow from your laptop / lab machine, in a script or a notebook, with
outputs landing directly on disk instead of in Google Drive.

> Note: Earth Engine still does the heavy compute on Google's servers.
> The Python code orchestrates jobs and downloads results. There's no
> way to mirror the satellite collections to your machine — they're
> petabytes.

---

## 1. Prerequisites

- Python 3.10 or newer.
- A Google account that has been
  [registered for Earth Engine](https://signup.earthengine.google.com).
- A Google Cloud project with the Earth Engine API enabled.
  [Console link](https://console.cloud.google.com/) → create project →
  enable APIs → search "Earth Engine API" → Enable.
- (Optional) `gcloud` CLI installed for first-time auth in some setups.

---

## 2. Install dependencies

```bash
cd GEE_LULC_SVM
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

If you prefer `uv` or `conda`, the same `requirements.txt` works.

---

## 3. Authenticate (once per machine)

```bash
python python/00_authenticate.py --project YOUR_GCP_PROJECT_ID
```

This opens a browser, asks you to sign in, and writes credentials to
`~/.config/earthengine/credentials`. After that, the other scripts can
silently call `ee.Initialize(project=...)`.

> If you get `Permission denied`, double-check that your GCP project has
> the Earth Engine API enabled AND that your Google account is registered
> for EE.

---

## 4. Upload your training samples as GEE assets (recommended)

The original JS workflow defines training points as Geometry Imports
inside the Code Editor. That doesn't transfer cleanly to scripts. The
simplest path:

1. Open https://code.earthengine.google.com
2. Run `gee_scripts/samples/training_samples.js` once.
3. In the Code Editor Console, for each FeatureCollection (water,
   builtUp, unrestoredLand, restoring, stableVegetation), use
   `Export.table.toAsset({collection: water, assetId: 'users/YOU/water'})`.
4. Run the export tasks.

The same pipeline now works with `--water-asset users/YOU/water` (etc.)
in step 5 below.

Alternative: keep training points under version control as a GeoJSON in
this repo's `data/` folder, and adapt `01_load_samples.py` to read it
with `geopandas`. See the `load_samples_from_geojson` stub there.

---

## 5. Run the multi-year pipeline

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

**`--output-mode local`** → GeoTIFFs land in `outputs/` via
`ee.Image.getDownloadURL`. Subject to a ~32 MiB-per-request cap; works
fine for AOI-sized single-band classifications.

**`--output-mode drive`** → batch tasks to a Drive folder, just like the
JS scripts. Use this for large AOIs or if local download times out.

---

## 6. Verify outputs

```bash
python - <<'PY'
import rasterio
from rasterio.plot import show
with rasterio.open("outputs/2014_Landsat7_SR_Classification_SVM_Best.tif") as src:
    print(src.profile)
    print("Unique class codes:", set(src.read(1).flatten()))
PY
```

You should see CRS `EPSG:32649`, dtype `uint8`, and class codes drawn
from `{1, 2, 3, 4, 5}` plus any nodata value.

---

## Troubleshooting

**`ee.ee_exception.EEException: Image.getDownloadURL: ... exceeds maximum size`**
Switch to `--output-mode drive`, or downscale by raising `--scale` (e.g.
30 → 60 m).

**`HTTPError 429: Too Many Requests`**
GEE is rate-limiting. Add a `time.sleep(2)` between years or fewer
parallel candidates. Multi-year strict already runs sequentially.

**Classifier training fails with `Too many missing values`.**
Some samples fell on masked pixels. The script already filters those
out — but if a year has heavy cloud cover and few scenes, even after
filtering you may be below the 10-sample floor. The script logs and
skips those years; check the console output.

**Confusion-matrix accuracy is suspiciously high (e.g. 0.99+).**
Often a sign that training and testing samples are spatially clustered.
Consider stratified spatial splits — left as a TODO in `svm_classify.py`.
