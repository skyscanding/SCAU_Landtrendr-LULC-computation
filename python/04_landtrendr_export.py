"""LandTrendr disturbance detection ,  GEE export driver.

Runs the LandTrendr temporal segmentation algorithm on GEE (Landsat NBR
time series, 2009-2024) and exports YOD / MAG / DUR / MPY rasters for
the downstream ecosystem-service pipeline.

Usage:
    python 04_landtrendr_export.py --project YOUR_GCP_PROJECT \
        --aoi-asset projects/ee-skyscanding/assets/Final_Reprojected_zxy \
        --output-mode drive
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import ee

sys.path.insert(0, str(Path(__file__).parent))
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "load_samples", Path(__file__).parent / "01_load_samples.py"
)
_load_samples = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_load_samples)


def build_nbr_collection(aoi: ee.FeatureCollection, start: int, end: int):
    """Build annual median NBR composites from Landsat SR."""
    years = ee.List.sequence(start, end)

    def _annual_nbr(y):
        y = ee.Number(y)
        s = ee.Date.fromYMD(y, 1, 1)
        e = ee.Date.fromYMD(y, 12, 31)

        def _ls_sr(collection_id, bands, names):
            return (
                ee.ImageCollection(collection_id)
                .filterBounds(aoi)
                .filterDate(s, e)
                .filter(ee.Filter.lt("CLOUD_COVER_LAND", 30))
                .map(lambda img: img.select(bands)
                     .multiply(0.0000275).add(-0.2)
                     .rename(names))
            )

        l5 = _ls_sr("LANDSAT/LT05/C02/T1_L2",
                     ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"],
                     ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
        l7 = _ls_sr("LANDSAT/LE07/C02/T1_L2",
                     ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"],
                     ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
        l8 = _ls_sr("LANDSAT/LC08/C02/T1_L2",
                     ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"],
                     ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
        l9 = _ls_sr("LANDSAT/LC09/C02/T1_L2",
                     ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"],
                     ["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])

        merged = l5.merge(l7).merge(l8).merge(l9)
        return (merged.median()
                .normalizedDifference(["NIR", "SWIR1"])
                .rename("NBR")
                .set("year", y)
                .set("system:time_start", s.millis()))

    return ee.ImageCollection.fromImages(years.map(_annual_nbr))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--aoi-asset", default=_load_samples.DEFAULT_AOI_ASSET)
    parser.add_argument("--start-year", type=int, default=2009)
    parser.add_argument("--end-year", type=int, default=2024)
    parser.add_argument("--max-segments", type=int, default=6)
    parser.add_argument("--mag-threshold", type=int, default=200)
    parser.add_argument("--dur-threshold", type=int, default=5)
    parser.add_argument("--preval-threshold", type=int, default=300)
    parser.add_argument("--mmu", type=int, default=11)
    parser.add_argument("--scale", type=int, default=30)
    parser.add_argument("--crs", default="EPSG:32649")
    parser.add_argument(
        "--output-mode",
        choices=["drive", "local"],
        default="drive",
        help="drive = batch-export tasks; local = getDownloadURL",
    )
    parser.add_argument("--drive-folder", default="LandTrendr_export")
    parser.add_argument("--output-dir", default="../outputs")
    args = parser.parse_args()

    print(f"Initializing GEE with project: {args.project}")
    ee.Initialize(project=args.project)

    aoi = _load_samples.load_aoi(args.aoi_asset)

    print(f"Building NBR collection {args.start_year}-{args.end_year}...")
    nbr_col = build_nbr_collection(aoi, args.start_year, args.end_year)

    lt_params = {
        "maxSegments": args.max_segments,
        "spikeThreshold": 0.9,
        "vertexCountOvershoot": 3,
        "preventOneYearRecovery": True,
        "recoveryThreshold": 0.25,
        "pvalThreshold": 0.05,
        "bestModelProportion": 0.75,
        "minObservationsNeeded": 6,
    }

    print("Running LandTrendr...")
    lt_result = ee.Algorithms.TemporalSegmentation.LandTrendr(
        timeSeries=nbr_col, **lt_params
    )

    lt_array = lt_result.select(["LandTrendr"])
    yod = lt_array.arraySlice(0, 3, 4).arrayProject([1]).arrayFlatten([["yod"]])
    mag = lt_array.arraySlice(0, 4, 5).arrayProject([1]).arrayFlatten([["mag"]])
    dur = lt_array.arraySlice(0, 5, 6).arrayProject([1]).arrayFlatten([["dur"]])
    preval = lt_array.arraySlice(0, 6, 7).arrayProject([1]).arrayFlatten([["preval"]])

    mask = (mag.gt(args.mag_threshold).And(dur.lt(args.dur_threshold))
            .And(preval.gt(args.preval_threshold)))

    connected = yod.updateMask(mask).connectedPixelCount(11, True)
    mask = mask.And(connected.gte(args.mmu))

    yod = yod.updateMask(mask).toInt16().clip(aoi.geometry())
    mag_raw = mag.updateMask(mask).toInt16().clip(aoi.geometry())
    dur = dur.updateMask(mask).toInt16().clip(aoi.geometry())

    # Recover MAG to NBR units (LandTrendr outputs MAG x 1000 as integer)
    mag_nbr = mag_raw.multiply(0.001).rename("magNBR").toFloat().clip(aoi.geometry())

    # Reclassify duration: 1 yr, 2 yr, >=3 yr (0 = no disturbance)
    dur_reclass = dur.expression(
        "((d >= 3) ? 3 : ((d >= 2) ? 2 : ((d >= 1) ? 1 : 0)))",
        {"d": dur}
    ).rename("durReclass").toInt16().clip(aoi.geometry())

    # Magnitude per year (NBR/year), avoid division by zero
    mag_per_year = mag_nbr.divide(dur.max(1)).rename("mag_per_year").toFloat().clip(aoi.geometry())

    y_str = f"{args.start_year}_{args.end_year - 1}"
    exports = [
        (f"yod_{y_str}", yod),
        (f"mag_NBR_{y_str}", mag_nbr),
        (f"durReclass_{y_str}", dur_reclass),
        (f"mag_per_year_{y_str}", mag_per_year),
    ]

    if args.output_mode == "local":
        out_dir = Path(args.output_dir).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        from lib.io_utils import download_image_to_local
        for name, img in exports:
            print(f"Downloading {name}...")
            download_image_to_local(img, out_dir / f"{name}.tif", region=aoi.geometry())
    else:
        from lib.io_utils import export_image_to_drive
        for name, img in exports:
            print(f"Exporting {name} to Drive...")
            export_image_to_drive(
                img, description=name, folder=args.drive_folder,
                region=aoi.geometry(), scale=args.scale, crs=args.crs,
            )

    print("Done. Check GEE Tasks panel for export progress.")


if __name__ == "__main__":
    main()
