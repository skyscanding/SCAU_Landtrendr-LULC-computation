"""Load training points + AOI for the LULC SVM pipeline.

Two supported input modes:

  1. GEE Geometry Imports — paste the contents of
     gee_scripts/samples/training_samples.js into a notebook cell that
     uses this module after `ee.Initialize()`. Five FeatureCollections
     should be in scope: water, builtUp, unrestoredLand, restoring,
     stableVegetation.

  2. Local Shapefile/GeoJSON — point `--samples-path` at a vector file
     with a `class` column whose values are one of:
     'water', 'builtUp', 'unrestoredLand', 'restoring', 'stableVegetation'.
     Useful for keeping samples under version control.

Either way, this module yields the merged FeatureCollection that the
classification scripts expect (with a numeric `lc` property 1–5).
"""
from __future__ import annotations

import ee

# Canonical class code mapping — keep in lockstep with the JS scripts.
CLASS_CODES: dict[str, int] = {
    "water": 1,
    "built_up": 2,
    "unrestored": 3,
    "recovering": 4,
    "stable_vegetation": 5,
}

# Default AOI asset path from the JS scripts. Override per-call if needed.
DEFAULT_AOI_ASSET = "projects/ee-skyscanding/assets/Final_Reprojected_zxy"


def merge_class_collections(
    water: ee.FeatureCollection,
    built_up: ee.FeatureCollection,
    unrestored: ee.FeatureCollection,
    recovering: ee.FeatureCollection,
    stable_vegetation: ee.FeatureCollection,
) -> ee.FeatureCollection:
    """Tag each per-class FeatureCollection with its `lc` code and merge."""

    def _tag(fc, code):
        return fc.map(lambda f: f.set("lc", code))

    return (
        _tag(water, CLASS_CODES["water"])
        .merge(_tag(built_up, CLASS_CODES["built_up"]))
        .merge(_tag(unrestored, CLASS_CODES["unrestored"]))
        .merge(_tag(recovering, CLASS_CODES["recovering"]))
        .merge(_tag(stable_vegetation, CLASS_CODES["stable_vegetation"]))
    )


def load_aoi(asset_path: str = DEFAULT_AOI_ASSET) -> ee.FeatureCollection:
    """Load the study-area boundary as an ee.FeatureCollection."""
    return ee.FeatureCollection(asset_path)


def load_samples_from_assets(
    water_asset: str,
    built_up_asset: str,
    unrestored_asset: str,
    recovering_asset: str,
    stable_veg_asset: str,
) -> ee.FeatureCollection:
    """Variant for when each class is uploaded as its own GEE asset."""
    return merge_class_collections(
        ee.FeatureCollection(water_asset),
        ee.FeatureCollection(built_up_asset),
        ee.FeatureCollection(unrestored_asset),
        ee.FeatureCollection(recovering_asset),
        ee.FeatureCollection(stable_veg_asset),
    )


def summarize(samples: ee.FeatureCollection) -> dict:
    """Return per-class counts as a plain dict — handy for sanity checks."""
    hist = samples.aggregate_histogram("lc").getInfo()
    code_to_name = {v: k for k, v in CLASS_CODES.items()}
    return {code_to_name.get(int(k), f"unknown({k})"): int(v) for k, v in hist.items()}


if __name__ == "__main__":
    # Quick standalone smoke test — assumes you've authenticated and
    # uploaded class collections as assets matching the paths below.
    import sys

    ee.Initialize()
    try:
        samples = load_samples_from_assets(
            water_asset="users/yourname/water",
            built_up_asset="users/yourname/builtUp",
            unrestored_asset="users/yourname/unrestoredLand",
            restoring_asset="users/yourname/restoring",
            stable_veg_asset="users/yourname/stableVegetation",
        )
        print("Per-class counts:", summarize(samples))
    except Exception as e:
        print(f"Smoke test failed: {e}")
        print("Edit the asset paths in this file's __main__ block before running.")
        sys.exit(1)
