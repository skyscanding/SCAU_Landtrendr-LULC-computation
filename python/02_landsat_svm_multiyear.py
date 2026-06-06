"""Multi-year Landsat SVM LULC classification ,  local driver.

This is the Python translation of `gee_scripts/multi_year/lulc_multiyear_strict.js`.
For each year in [START_YEAR, END_YEAR]:
  1. Build SR + TOA composites for L7 (always) and L8/L9 (year >= 2013).
  2. Add spectral indices + GLCM texture features.
  3. Z-score normalize, class-balance, classify with libsvm-RBF.
  4. Evaluate OA and Kappa on a held-out 30% test split.
  5. Pick the best sensor for that year by (OA + Kappa).
  6. Skip export if both metrics are below threshold.
  7. Export the winner ,  to local disk by default, optionally to Drive.

Run from the `python/` directory:
    python 02_landsat_svm_multiyear.py --project YOUR_GCP_PROJECT \\
        --start-year 2000 --end-year 2024 --output-mode local

Caveats vs. the JS:
  - `getInfo()` calls are kept inside the score-comparison loop so we can
    do Python-side comparisons. This makes each year ~1-2 server roundtrips
    heavier than a fully-deferred pipeline, but keeps the logic explicit.
  - `--output-mode local` uses `getDownloadURL` which has a ~32 MiB cap.
    For larger AOIs use `--output-mode drive`.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import ee

# Allow importing from the lib/ folder when running this file directly
sys.path.insert(0, str(Path(__file__).parent))
from lib import (  # noqa: E402
    add_all_indices,
    add_texture_features,
    landsat_sr_annual_composite,
    landsat_toa_annual_composite,
    train_and_classify_svm,
    export_image_to_drive,
    download_image_to_local,
)
from lib.indices import BANDS_WITH_TEXTURE  # noqa: E402

# Import the samples-loading helpers from the sibling script
sys.path.insert(0, str(Path(__file__).parent))
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location("load_samples", Path(__file__).parent / "01_load_samples.py")
_load_samples = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_load_samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="GCP project for ee.Initialize")
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2025)
    parser.add_argument("--cloud-threshold", type=int, default=20)
    parser.add_argument("--oa-threshold", type=float, default=0.70)
    parser.add_argument("--kappa-threshold", type=float, default=0.70)
    parser.add_argument("--aoi-asset", default=_load_samples.DEFAULT_AOI_ASSET)
    parser.add_argument("--water-asset", required=True)
    parser.add_argument("--built-up-asset", required=True)
    parser.add_argument("--unrestored-asset", required=True)
    parser.add_argument("--recovering-asset", required=True)
    parser.add_argument("--stable-veg-asset", required=True)
    parser.add_argument(
        "--output-mode",
        choices=["local", "drive"],
        default="local",
        help="local = download GeoTIFFs into ./outputs; drive = batch-export tasks",
    )
    parser.add_argument("--drive-folder", default="Journal_landsat+SVM")
    parser.add_argument("--output-dir", default="../outputs")
    parser.add_argument(
        "--output-name",
        default=None,
        help="Optional output filename pattern. Use {year} placeholder, "
             "e.g. 'lulc_{year}' to match eco repo convention. "
             "Default: {year}_{sensor}_Classification_SVM_Best",
    )
    args = parser.parse_args()

    print(f"Initializing GEE with project: {args.project}")
    ee.Initialize(project=args.project)

    # AOI + samples
    aoi = _load_samples.load_aoi(args.aoi_asset)
    samples = _load_samples.load_samples_from_assets(
        args.water_asset,
        args.built_up_asset,
        args.unrestored_asset,
        args.recovering_asset,
        args.stable_veg_asset,
    )
    print("Sample summary:", _load_samples.summarize(samples))

    out_dir = Path(args.output_dir).resolve()
    if args.output_mode == "local":
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"Local output dir: {out_dir}")

    # Year loop
    for year in range(args.start_year, args.end_year + 1):
        print(f"\nYear: {year}")
        sr_dict = landsat_sr_annual_composite(year, args.cloud_threshold, aoi)
        toa_dict = landsat_toa_annual_composite(year, args.cloud_threshold, aoi)

        # Assemble candidates for this year
        candidates = [("Landsat7_SR", sr_dict.get("Landsat7_SR")),
                      ("Landsat7_TOA", toa_dict.get("Landsat7_TOA"))]
        if year >= 2013:
            candidates.append(("Landsat89_SR", sr_dict.get("Landsat89_SR")))
            candidates.append(("Landsat89_TOA", toa_dict.get("Landsat89_TOA")))

        results = []
        for sensor_id, base_image in candidates:
            if base_image is None:
                continue
            img = add_texture_features(
                add_all_indices(
                    base_image.select(["Blue", "Green", "Red", "NIR", "SWIR1", "SWIR2"])
                )
            ).set("isDummy", base_image.get("isDummy"))

            result = train_and_classify_svm(
                img, sensor_id, BANDS_WITH_TEXTURE, samples, aoi,
                use_balancing=True, gamma=1.0, cost=100.0,
            )
            if result is not None:
                results.append(result)

        if not results:
            print(f"✘ Year {year}: all sensors failed ,  no export.")
            continue

        results.sort(key=lambda r: r.score, reverse=True)
        best = results[0]

        if best.oa < args.oa_threshold and best.kappa < args.kappa_threshold:
            print(
                f"✘ Year {year}: best was {best.name} "
                f"(OA={best.oa:.4f}, Kappa={best.kappa:.4f}) ,  below threshold."
            )
            continue

        print(f"── Year {year} candidates ──")
        for r in results:
            tag = " ◀ BEST" if r.name == best.name else ""
            print(f"   {r.name}: OA={r.oa:.4f}, Kappa={r.kappa:.4f}{tag}")

        if args.output_name:
            desc = args.output_name.format(year=year)
        else:
            desc = f"{year}_{best.name}_Classification_SVM_Best"
        if args.output_mode == "drive":
            export_image_to_drive(
                best.image.toByte(),
                description=desc,
                folder=args.drive_folder,
                region=aoi.geometry(),
            )
        else:  # local
            try:
                download_image_to_local(
                    best.image.toByte(),
                    out_dir / f"{desc}.tif",
                    region=aoi.geometry(),
                )
            except Exception as e:
                print(f"  ⚠ Local download failed ({e}); falling back to Drive.")
                export_image_to_drive(
                    best.image.toByte(),
                    description=desc,
                    folder=args.drive_folder,
                    region=aoi.geometry(),
                )

    print("\nDone.")
    if args.output_mode == "drive":
        print("Drive export tasks were started. Monitor them at:")
        print("  https://code.earthengine.google.com/tasks")


if __name__ == "__main__":
    main()
