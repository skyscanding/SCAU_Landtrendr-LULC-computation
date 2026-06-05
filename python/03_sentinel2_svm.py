"""Single-year Sentinel-2 SVM LULC classification — local driver.

Python translation of `gee_scripts/single_year/sentinel2_svm.js`.

Run from the `python/` directory:
    python 03_sentinel2_svm.py --project YOUR_GCP_PROJECT --year 2018 \\
        --water-asset users/X/water --builtup-asset users/X/builtUp \\
        --unrestored-asset users/X/unrestoredLand \\
        --restoring-asset users/X/restoring \\
        --stableveg-asset users/X/stableVegetation
"""
from __future__ import annotations

import argparse
import importlib.util as _ilu
import sys
from pathlib import Path

import ee

sys.path.insert(0, str(Path(__file__).parent))
from lib import (  # noqa: E402
    add_all_indices,
    sentinel2_annual_composite,
    train_and_classify_svm,
    export_image_to_drive,
    download_image_to_local,
)
from lib.indices import BANDS_BASIC  # noqa: E402

_spec = _ilu.spec_from_file_location("load_samples", Path(__file__).parent / "01_load_samples.py")
_load_samples = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_load_samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--year", type=int, default=2018)
    parser.add_argument("--csplus-threshold", type=float, default=0.30)
    parser.add_argument("--aoi-asset", default=_load_samples.DEFAULT_AOI_ASSET)
    parser.add_argument("--water-asset", required=True)
    parser.add_argument("--builtup-asset", required=True)
    parser.add_argument("--unrestored-asset", required=True)
    parser.add_argument("--restoring-asset", required=True)
    parser.add_argument("--stableveg-asset", required=True)
    parser.add_argument("--output-mode", choices=["local", "drive"], default="local")
    parser.add_argument("--drive-folder", default="监督土地分类Sentinel版")
    parser.add_argument("--output-dir", default="../outputs")
    args = parser.parse_args()

    ee.Initialize(project=args.project)
    aoi = _load_samples.load_aoi(args.aoi_asset)
    samples = _load_samples.load_samples_from_assets(
        args.water_asset,
        args.builtup_asset,
        args.unrestored_asset,
        args.restoring_asset,
        args.stableveg_asset,
    )

    composite = sentinel2_annual_composite(
        args.year, aoi, csplus_threshold=args.csplus_threshold
    )
    image_with_indices = add_all_indices(composite).set("isDummy", composite.get("isDummy"))

    result = train_and_classify_svm(
        image_with_indices,
        "Sentinel2_SR",
        BANDS_BASIC,
        samples,
        aoi,
        use_balancing=False,
        gamma=1.0,
        cost=100.0,
        scale=10,
    )
    if result is None:
        print("Classification produced no output.")
        return

    desc = f"{args.year}_Sentinel2_SR_CSPlus_Classification"
    if args.output_mode == "drive":
        export_image_to_drive(
            result.image.toByte(),
            description=desc,
            folder=args.drive_folder,
            region=aoi.geometry(),
            scale=10,
        )
    else:
        out_dir = Path(args.output_dir).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        download_image_to_local(
            result.image.toByte(),
            out_dir / f"{desc}.tif",
            region=aoi.geometry(),
            scale=10,
        )


if __name__ == "__main__":
    main()
