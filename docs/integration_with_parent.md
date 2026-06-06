# Sibling-repo handoff with `SCAU_ecosystem-service-computation`

This repo (`SCAU_Landtrendr-LULC-computation`) and the eco repo
(`SCAU_ecosystem-service-computation`) are independent sibling repositories
that work together via a filename and class-code convention.

## How the data flows

```
┌───────────────────────────────────────┐
│ SCAU_Landtrendr-LULC-computation      │
│                                       │
│   LandTrendr JS (GEE Code Editor)     │
│         │                             │
│         ▼                             │
│   outputs: yod_*.tif, mag_NBR_*.tif,  │
│            durReclass_*.tif,           │
│            mag_per_year_*.tif          │
│                                       │
│   SVM LULC JS or Python CLI           │
│         │                             │
│         ▼                             │
│   outputs: lulc_{year}.tif            │  ◀── EPSG:32649, uint8, codes 1-5
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ SCAU_ecosystem-service-computation    │
│                                       │
│  reads outputs/landtrendr/*.tif       │
│  reads outputs/lulc/*.tif             │
│         │                             │
│         ▼                             │
│  step1: LandTrendr stats              │
│  step2: LULC area trends              │
│  step3–10: landscape, InVEST, stats   │
└───────────────────────────────────────┘
```

## Conventions that must stay in sync

| Contract | LULC repo value | Eco repo config key |
|---|---|---|
| CRS | EPSG:32649 | `crs` |
| Pixel size | 30 m (LULC), 30 m (LT) | `study_area.raster_res_m` |
| LULC class codes | 1=water, 2=built_up, 3=unrestored, 4=recovering, 5=stable_vegetation | `lulc.classes` |
| LULC filename | `lulc_{year}.tif` (use `--output-name lulc_{year}`) | `lulc.raster_pattern` |
| LT filename | As exported by the JS script | `landtrendr.{yod,mag,dur,mpy}_raster` |

## Running the full pipeline

1. Run the LandTrendr JS script in GEE Code Editor → export rasters to Drive.
2. Run the LULC classification (JS or Python `--output-name lulc_{year}`) → export to Drive or local `outputs/`.
3. Copy all GeoTIFFs into the eco repo's data directories.
4. Run the eco repo's `master_pipeline.py` with a config pointing at those files.
